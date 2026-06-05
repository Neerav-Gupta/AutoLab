"""
Tool implementations — each tool runs something on the remote pod via SSH
and returns a structured result the agent can read.
"""
from __future__ import annotations
import os
import time
import json
import threading
from dataclasses import dataclass, field
from typing import Optional
import paramiko


# ── SSH connection pool (one persistent connection per agent run) ──────────────

class SSHSession:
    """Reusable SSH session for a single agent task."""

    def __init__(self, host: str, port: int, user: str, key_path: str, workspace: str):
        self.host = host
        self.port = port
        self.user = user
        self.key_path = str(os.path.expanduser(key_path))
        self.workspace = workspace
        self._client: Optional[paramiko.SSHClient] = None

    def connect(self):
        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self._client.connect(
            hostname=self.host,
            port=self.port,
            username=self.user,
            key_filename=self.key_path,
            timeout=20,
        )

    def close(self):
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None

    def run(self, cmd: str, timeout: int = 60) -> tuple[str, str, int]:
        """Run a command. Returns (stdout, stderr, exit_code)."""
        if not self._client:
            self.connect()
        _, stdout, stderr = self._client.exec_command(
            cmd, timeout=timeout, get_pty=False
        )
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        return out, err, code

    def run_in_workspace(self, cmd: str, timeout: int = 60) -> tuple[str, str, int]:
        return self.run(f"cd {self.workspace} && {cmd}", timeout=timeout)

    def write_file(self, path: str, content: str):
        sftp = self._client.open_sftp()
        # Ensure parent dir exists
        parent = "/".join(path.split("/")[:-1])
        if parent:
            self.run(f"mkdir -p '{parent}'")
        with sftp.file(path, "w") as f:
            f.write(content.encode())
        sftp.close()

    def read_file(self, path: str) -> str:
        sftp = self._client.open_sftp()
        with sftp.file(path, "r") as f:
            content = f.read().decode("utf-8", errors="replace")
        sftp.close()
        return content


# ── Tool result ───────────────────────────────────────────────────────────────

@dataclass
class ToolResult:
    tool: str
    success: bool
    output: str
    error: str = ""
    exit_code: int = 0
    metadata: dict = field(default_factory=dict)

    def to_llm_string(self) -> str:
        """Format for the LLM to read."""
        parts = [f"[{self.tool}]"]
        if not self.success:
            parts.append(f"FAILED (exit {self.exit_code})")
        if self.output:
            # Truncate very long output — LLM doesn't need 10k lines
            out = self.output
            if len(out) > 6000:
                out = out[:3000] + "\n\n... (truncated) ...\n\n" + out[-1500:]
            parts.append(out)
        if self.error:
            err = self.error[-2000:] if len(self.error) > 2000 else self.error
            parts.append(f"STDERR:\n{err}")
        return "\n".join(parts)


# ── Individual tools ──────────────────────────────────────────────────────────

def tool_run_python(ssh: SSHSession, code: str, timeout: int = 600) -> ToolResult:
    """Write a Python script to /tmp and execute it."""
    script_path = f"/tmp/autolab_{int(time.time())}.py"
    try:
        ssh.write_file(script_path, code)
        out, err, code_ = ssh.run(
            f"cd {ssh.workspace} && python '{script_path}' 2>&1",
            timeout=timeout,
        )
        return ToolResult(
            tool="run_python",
            success=code_ == 0,
            output=out,
            error=err if code_ != 0 else "",
            exit_code=code_,
            metadata={"script_path": script_path},
        )
    except Exception as e:
        return ToolResult(tool="run_python", success=False, output="", error=str(e), exit_code=1)


def tool_run_bash(ssh: SSHSession, command: str, timeout: int = 120) -> ToolResult:
    """Run a bash command in the workspace."""
    try:
        out, err, code = ssh.run_in_workspace(command, timeout=timeout)
        combined = out + ("\n" + err if err and code != 0 else "")
        return ToolResult(
            tool="run_bash",
            success=code == 0,
            output=combined,
            error=err if code != 0 else "",
            exit_code=code,
        )
    except Exception as e:
        return ToolResult(tool="run_bash", success=False, output="", error=str(e), exit_code=1)


def tool_read_file(ssh: SSHSession, path: str) -> ToolResult:
    """Read a file from the remote machine."""
    try:
        content = ssh.read_file(path)
        return ToolResult(tool="read_file", success=True, output=content)
    except Exception as e:
        return ToolResult(tool="read_file", success=False, output="", error=str(e), exit_code=1)


def tool_write_file(ssh: SSHSession, path: str, content: str) -> ToolResult:
    """Write content to a file on the remote machine."""
    try:
        ssh.write_file(path, content)
        return ToolResult(
            tool="write_file",
            success=True,
            output=f"Written {len(content)} bytes to {path}",
            metadata={"path": path},
        )
    except Exception as e:
        return ToolResult(tool="write_file", success=False, output="", error=str(e), exit_code=1)


def tool_list_dir(ssh: SSHSession, path: str) -> ToolResult:
    """List directory contents."""
    try:
        out, err, code = ssh.run(
            f"ls -lhp '{path}' 2>/dev/null | head -200"
        )
        return ToolResult(tool="list_dir", success=code == 0, output=out, error=err, exit_code=code)
    except Exception as e:
        return ToolResult(tool="list_dir", success=False, output="", error=str(e), exit_code=1)


def tool_search_files(ssh: SSHSession, query: str, path: str = "") -> ToolResult:
    """Search for files by name or content."""
    search_path = path or ssh.workspace
    q = query.replace("'", "")
    try:
        # Name search
        out1, _, _ = ssh.run(
            f"find '{search_path}' -not -path '*/__pycache__/*' -not -path '*/.git/*' "
            f"-iname '*{q}*' 2>/dev/null | head -30"
        )
        # Content search
        out2, _, _ = ssh.run(
            f"grep -rl '{q}' '{search_path}' --include='*.py' --include='*.txt' "
            f"--include='*.json' --include='*.sh' --include='*.yaml' "
            f"--exclude-dir='.git' --exclude-dir='__pycache__' 2>/dev/null | head -20"
        )
        combined = ""
        if out1.strip():
            combined += f"Files matching name '{q}':\n{out1}\n"
        if out2.strip():
            combined += f"Files containing '{q}':\n{out2}\n"
        if not combined:
            combined = f"No results found for '{q}'"
        return ToolResult(tool="search_files", success=True, output=combined)
    except Exception as e:
        return ToolResult(tool="search_files", success=False, output="", error=str(e), exit_code=1)


def tool_gpu_status(ssh: SSHSession) -> ToolResult:
    """Get GPU memory and utilization status."""
    try:
        out, err, code = ssh.run(
            "nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu "
            "--format=csv,noheader 2>/dev/null || echo 'nvidia-smi not available'"
        )
        return ToolResult(tool="gpu_status", success=True, output=out.strip())
    except Exception as e:
        return ToolResult(tool="gpu_status", success=False, output="", error=str(e), exit_code=1)


def tool_install_package(ssh: SSHSession, package: str, timeout: int = 180) -> ToolResult:
    """pip install a package."""
    pkg = package.replace(";", "").replace("&&", "").strip()
    try:
        out, err, code = ssh.run(
            f"pip install {pkg} --quiet 2>&1", timeout=timeout
        )
        return ToolResult(
            tool="install_package",
            success=code == 0,
            output=out or f"Installed {pkg}",
            error=err if code != 0 else "",
            exit_code=code,
        )
    except Exception as e:
        return ToolResult(tool="install_package", success=False, output="", error=str(e), exit_code=1)


def tool_check_process(ssh: SSHSession, pid: int) -> ToolResult:
    """Check if a process is still running. Zero-cost monitoring."""
    try:
        out, _, code = ssh.run(f"ps -p {pid} -o pid,stat,comm --no-headers 2>/dev/null")
        running = code == 0 and out.strip() != ""
        return ToolResult(
            tool="check_process",
            success=True,
            output=f"Process {pid}: {'running' if running else 'finished'}\n{out.strip()}",
            metadata={"pid": pid, "running": running},
        )
    except Exception as e:
        return ToolResult(tool="check_process", success=False, output="", error=str(e), exit_code=1)


def tool_tail_log(ssh: SSHSession, path: str, lines: int = 50) -> ToolResult:
    """Read the last N lines of a log file. Zero-cost monitoring."""
    try:
        out, err, code = ssh.run(f"tail -n {lines} '{path}' 2>/dev/null")
        return ToolResult(
            tool="tail_log",
            success=code == 0,
            output=out,
            error=err if code != 0 else "",
            exit_code=code,
        )
    except Exception as e:
        return ToolResult(tool="tail_log", success=False, output="", error=str(e), exit_code=1)


# ── Tool dispatcher ────────────────────────────────────────────────────────────

TOOL_MAP = {
    "run_python":      tool_run_python,
    "run_bash":        tool_run_bash,
    "read_file":       tool_read_file,
    "write_file":      tool_write_file,
    "list_dir":        tool_list_dir,
    "search_files":    tool_search_files,
    "gpu_status":      tool_gpu_status,
    "install_package": tool_install_package,
    "check_process":   tool_check_process,
    "tail_log":        tool_tail_log,
}


def dispatch_tool(ssh: SSHSession, tool_name: str, args: dict, timeout: int) -> ToolResult:
    """Call a tool by name with args dict."""
    fn = TOOL_MAP.get(tool_name)
    if not fn:
        return ToolResult(
            tool=tool_name,
            success=False,
            output="",
            error=f"Unknown tool: {tool_name}",
            exit_code=1,
        )
    try:
        # Inject ssh and timeout
        kwargs = {k: v for k, v in args.items()}
        if "timeout" not in kwargs and tool_name in ("run_python", "run_bash", "install_package"):
            kwargs["timeout"] = timeout
        return fn(ssh, **kwargs)
    except TypeError as e:
        return ToolResult(
            tool=tool_name,
            success=False,
            output="",
            error=f"Bad arguments for {tool_name}: {e}",
            exit_code=1,
        )