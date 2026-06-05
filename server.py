"""
AutoLab Server — FastAPI backend.
Run: python server.py
"""
from __future__ import annotations
import sys
import os
import json
import re
import threading
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import asyncio

from config import config
from orchestrator import agent as agent_module
from orchestrator import memory as mem
from orchestrator.tools import SSHSession

app = FastAPI(title="AutoLab", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

UI_DIR = Path(__file__).parent / "ui"

# ── SSH helpers ───────────────────────────────────────────────────────────────

def _ssh() -> SSHSession:
    s = SSHSession(
        host=config.ssh_host,
        port=config.ssh_port,
        user=config.ssh_user,
        key_path=config.ssh_key_expanded,
        workspace=config.workspace,
    )
    s.connect()
    return s


def ssh_run(cmd: str, timeout: int = 30) -> tuple[str, int]:
    """Open SSH, run command, close. Returns (stdout+stderr, exit_code)."""
    s = _ssh()
    try:
        out, err, code = s.run(cmd, timeout=timeout)
        # Don't raise on non-zero — let caller decide
        return (out + err).strip(), code
    finally:
        s.close()


def ssh_run_multi(commands: list[str], timeout: int = 30) -> list[tuple[str, int]]:
    """Run multiple commands over a single SSH connection."""
    s = _ssh()
    try:
        results = []
        for cmd in commands:
            out, err, code = s.run(cmd, timeout=timeout)
            results.append(((out + err).strip(), code))
        return results
    finally:
        s.close()


# ── Pydantic models ───────────────────────────────────────────────────────────

class TaskRequest(BaseModel):
    task: str
    max_iterations: Optional[int] = None

class ShellRequest(BaseModel):
    command: str

class FileWriteRequest(BaseModel):
    path: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list = []

class SearchRequest(BaseModel):
    query: str
    path: Optional[str] = None


# ── Status ────────────────────────────────────────────────────────────────────

@app.get("/api/status")
def status():
    return {
        "ssh_host": config.ssh_host,
        "workspace": config.workspace,
        "model": config.model,
        "running_tasks": len([t for t in mem.list_tasks() if t["status"] == "running"]),
        "version": "1.0.0",
    }


# ── Task routes ───────────────────────────────────────────────────────────────

@app.get("/api/tasks")
def get_tasks():
    return mem.list_tasks()


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    log = mem.get_task(task_id)
    if not log:
        raise HTTPException(404, "Task not found")
    return log.to_dict()


@app.post("/api/tasks")
def create_task(req: TaskRequest):
    if req.max_iterations:
        config.max_iterations = req.max_iterations

    # Create the task log first so we have the ID immediately
    import uuid
    task_id = str(uuid.uuid4())[:8]

    def _run():
        agent_module.run_task(req.task, task_id=task_id)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return {"task_id": task_id, "status": "started"}


@app.delete("/api/tasks/{task_id}")
def cancel_task(task_id: str):
    cancelled = agent_module.cancel_task(task_id)
    if not cancelled:
        mem.cancel_task(task_id)
    return {"ok": True}


@app.get("/api/tasks/{task_id}/stream")
async def stream_task(task_id: str):
    """SSE stream for live task progress."""
    async def gen():
        last_iter = 0
        for _ in range(1200):  # 20 min max
            log = mem.get_task(task_id)
            if not log:
                yield "data: " + json.dumps({"type": "error", "message": "Task not found"}) + "\n\n"
                return

            iters = log.iterations
            for it in iters[last_iter:]:
                yield "data: " + json.dumps({
                    "type": "iteration",
                    "iteration": it.get("iteration"),
                    "thought": (it.get("thought") or "")[:200],
                    "tool": it.get("tool"),
                    "tool_success": it.get("tool_success"),
                    "exit_code": it.get("exit_code"),
                    "output_preview": (it.get("tool_output") or "")[-300:],
                }) + "\n\n"
            last_iter = len(iters)

            yield "data: " + json.dumps({
                "type": "status",
                "status": log.status,
                "iterations": len(iters),
            }) + "\n\n"

            if log.status not in ("running",):
                yield "data: " + json.dumps({
                    "type": "done",
                    "status": log.status,
                    "result": log.result,
                }) + "\n\n"
                return

            await asyncio.sleep(1)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── File routes ───────────────────────────────────────────────────────────────

@app.get("/api/files")
def list_dir(path: str = "/workspace"):
    try:
        p = path.rstrip("/") or "/"
        # Single command: list dirs and files separately, reliably
        cmd = (
            f"echo '===DIRS==='; "
            f"find '{p}' -mindepth 1 -maxdepth 1 -type d "
            f"! -name '__pycache__' ! -name '.git' ! -name '.*' "
            f"-printf '%f\\n' 2>/dev/null | sort; "
            f"echo '===FILES==='; "
            f"find '{p}' -mindepth 1 -maxdepth 1 -type f "
            f"! -name '.*' "
            f"-printf '%f\\n' 2>/dev/null | sort"
        )
        raw, _ = ssh_run(cmd, timeout=15)
        dirs, files = [], []
        section = None
        for line in raw.splitlines():
            line = line.strip()
            if line == '===DIRS===':   section = 'dirs';  continue
            if line == '===FILES===':  section = 'files'; continue
            if not line: continue
            if section == 'dirs':
                dirs.append({"name": line, "path": f"{p}/{line}", "type": "dir"})
            elif section == 'files':
                files.append({"name": line, "path": f"{p}/{line}", "type": "file"})
        return {"path": path, "dirs": dirs, "files": files}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/files/read")
def read_file(path: str):
    s = None
    try:
        s = _ssh()
        content = s.read_file(path)
        return {"path": path, "content": content}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if s: s.close()


@app.post("/api/files/write")
def write_file(req: FileWriteRequest):
    s = None
    try:
        s = _ssh()
        s.write_file(req.path, req.content)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if s: s.close()


@app.delete("/api/files")
def delete_path(path: str):
    if path.rstrip("/") in ("/", "/workspace", "/root", "/home"):
        raise HTTPException(400, "Refusing to delete protected path")
    try:
        out, code = ssh_run(f"rm -rf '{path}' 2>&1")
        if code != 0:
            raise HTTPException(500, out)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/files/search/stream")
async def search_files_stream(query: str, path: str = ""):
    """
    BFS streaming search. Uses three simple SSH commands per directory
    (list subdirs, find matching filenames, grep content) instead of
    a fragile heredoc. Results stream immediately as found.
    """
    search_path = path or config.workspace
    q = re.sub(r"[;|&`$\\\"'<>]", "", query.strip())

    if not q:
        async def _empty():
            yield f"data: {json.dumps({'type':'done','total':0})}\n\n"
        return StreamingResponse(_empty(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    SKIP_DIRS = {"__pycache__", ".git", ".tox", "node_modules", ".venv",
                 "venv", "dist", "build", ".mypy_cache", ".pytest_cache"}

    def scan_dir(dirpath: str) -> dict:
        """Three simple commands — no heredoc, no quoting issues."""
        result = {"filename_hits": [], "content_hits": [], "subdirs": []}
        ssh = None
        try:
            ssh = _ssh()

            # 1) Subdirs (one level, skip noise dirs)
            out, _, _ = ssh.run(
                f"find {dirpath!r} -mindepth 1 -maxdepth 1 -type d "
                f"! -name __pycache__ ! -name .git ! -name node_modules "
                f"! -name .venv ! -name venv ! -name dist ! -name build "
                f"! -name .tox ! -name .mypy_cache 2>/dev/null",
                timeout=8,
            )
            for line in out.splitlines():
                d = line.strip()
                if d and d != dirpath:
                    result["subdirs"].append(d)

            # 2) Filename matches (case-insensitive)
            out, _, _ = ssh.run(
                f"find {dirpath!r} -mindepth 1 -maxdepth 1 -type f "
                f"-iname '*{q}*' 2>/dev/null | head -30",
                timeout=8,
            )
            for line in out.splitlines():
                p = line.strip()
                if p:
                    result["filename_hits"].append(p)

            # 3) Content grep — files in this directory only (not recursive)
            # Use find + xargs grep to avoid --max-depth portability issues
            exts = "*.py *.txt *.md *.json *.sh *.yaml *.yml *.toml *.cfg *.ini *.js *.ts *.html *.css *.rst *.log *.env *.csv"
            find_cmd = (
                f"find {dirpath!r} -mindepth 1 -maxdepth 1 -type f "
                f"\\( " +
                " -o ".join(f"-name '{e}'" for e in exts.split()) +
                f" \\) 2>/dev/null"
            )
            out, _, _ = ssh.run(
                f"{find_cmd} | xargs grep -il '{q}' 2>/dev/null | head -30",
                timeout=10,
            )
            for line in out.splitlines():
                p = line.strip()
                if not p:
                    continue
                # Get a preview line
                preview = ""
                try:
                    pv_out, _, _ = ssh.run(
                        f"grep -n '{q}' {p!r} 2>/dev/null | head -1 | cut -c1-120",
                        timeout=4,
                    )
                    preview = pv_out.strip()
                except Exception:
                    pass
                result["content_hits"].append({"path": p, "preview": preview})

        except Exception as e:
            pass
        finally:
            if ssh:
                try: ssh.close()
                except: pass
        return result

    async def gen():
        seen: set = set()
        total = 0
        queue = [search_path]
        loop = asyncio.get_event_loop()
        MAX_RESULTS = 100
        MAX_DIRS = 80
        dirs_visited = 0

        while queue and total < MAX_RESULTS and dirs_visited < MAX_DIRS:
            batch, queue = queue[:4], queue[4:]
            dirs_visited += len(batch)

            futures = [loop.run_in_executor(None, scan_dir, d) for d in batch]
            results = await asyncio.gather(*futures, return_exceptions=True)

            for scan in results:
                if isinstance(scan, Exception):
                    continue
                for p in scan["filename_hits"]:
                    if p in seen or total >= MAX_RESULTS: continue
                    seen.add(p)
                    total += 1
                    yield f"data: {json.dumps({'type':'result','path':p,'name':p.split('/')[-1],'match_type':'filename','preview':''})}\n\n"
                for hit in scan["content_hits"]:
                    p = hit["path"]
                    if p in seen or total >= MAX_RESULTS: continue
                    seen.add(p)
                    total += 1
                    yield f"data: {json.dumps({'type':'result','path':p,'name':p.split('/')[-1],'match_type':'content','preview':hit['preview']})}\n\n"
                queue.extend(scan["subdirs"])

            await asyncio.sleep(0)

        yield f"data: {json.dumps({'type':'done','total':total})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# Keep old POST endpoint for compatibility but delegate to same logic
@app.post("/api/files/search")
def search_files_post(req: SearchRequest):
    search_path = req.path or config.workspace
    q = re.sub(r"[;|&`$\\\"']", "", req.query.strip())
    if not q:
        return {"results": [], "query": req.query}
    try:
        results_1, _ = ssh_run(
            f"find '{search_path}' -mindepth 1 "
            f"-not -path '*/__pycache__/*' -not -path '*/.git/*' "
            f"-not -type d -iname '*{q}*' 2>/dev/null | head -30",
            timeout=20,
        )
        results_2, _ = ssh_run(
            f"grep -rl "
            f"--include='*.py' --include='*.txt' --include='*.md' "
            f"--include='*.json' --include='*.sh' --include='*.yaml' "
            f"--exclude-dir='.git' --exclude-dir='__pycache__' "
            f"'{q}' '{search_path}' 2>/dev/null | head -30",
            timeout=25,
        )
        seen, results = set(), []
        for p in results_1.splitlines():
            p = p.strip()
            if p and p not in seen:
                seen.add(p)
                results.append({"path": p, "name": p.split("/")[-1], "match_type": "filename", "preview": ""})
        for p in results_2.splitlines():
            p = p.strip()
            if p and p not in seen:
                seen.add(p)
                prev, _ = ssh_run(f"grep -n '{q}' '{p}' 2>/dev/null | head -1", timeout=5)
                results.append({"path": p, "name": p.split("/")[-1], "match_type": "content", "preview": prev.strip()[:100]})
        return {"results": results, "query": req.query}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Shell ─────────────────────────────────────────────────────────────────────

@app.post("/api/shell")
def run_shell(req: ShellRequest):
    try:
        out, code = ssh_run(f"cd '{config.workspace}' && {req.command} 2>&1", timeout=60)
        return {"stdout": out, "exit_code": code}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── WebSocket terminal ────────────────────────────────────────────────────────

@app.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket):
    await websocket.accept()
    ssh = None
    chan = None
    try:
        import paramiko as _pm
        ssh = _pm.SSHClient()
        ssh.set_missing_host_key_policy(_pm.AutoAddPolicy())
        ssh.connect(
            hostname=config.ssh_host,
            port=config.ssh_port,
            username=config.ssh_user,
            key_filename=config.ssh_key_expanded,
            timeout=15,
        )
        chan = ssh.invoke_shell(term="xterm-256color", width=220, height=50)
        chan.settimeout(0.0)
        chan.send(f"cd {config.workspace}\n")

        async def reader():
            loop = asyncio.get_event_loop()
            while True:
                try:
                    ready = await loop.run_in_executor(None, lambda: chan.recv_ready())
                    if ready:
                        data = chan.recv(4096).decode("utf-8", errors="replace")
                        await websocket.send_text(data)
                    else:
                        await asyncio.sleep(0.02)
                        if chan.closed:
                            break
                except Exception:
                    break

        rt = asyncio.create_task(reader())
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=60)
                if msg.startswith("{"):
                    try:
                        obj = json.loads(msg)
                        if obj.get("type") == "resize":
                            chan.resize_pty(
                                width=int(obj.get("cols", 220)),
                                height=int(obj.get("rows", 50)),
                            )
                            continue
                    except Exception:
                        pass
                chan.send(msg)
            except asyncio.TimeoutError:
                if chan.closed:
                    break
            except WebSocketDisconnect:
                break
        rt.cancel()
    except Exception as e:
        try:
            await websocket.send_text(f"\r\n\x1b[31m[connection error: {e}]\x1b[0m\r\n")
        except Exception:
            pass
    finally:
        if chan:
            try: chan.close()
            except: pass
        if ssh:
            try: ssh.close()
            except: pass


# ── AI Chat ───────────────────────────────────────────────────────────────────

@app.post("/api/chat")
def chat(req: ChatRequest):
    try:
        import litellm as _ll
        _ll.suppress_debug_info = True

        system = f"""You are an expert ML/Python engineer assistant embedded in AutoLab, a GPU research IDE.
The user is connected to a remote GPU server via SSH.
Working directory: {config.workspace}

YOUR CAPABILITIES:
- Write complete, working Python and bash code
- Debug errors from tracebacks or output the user shares
- Explain code, algorithms, and ML concepts clearly
- Suggest improvements to training loops, model architectures, data pipelines
- Help with PyTorch, TensorFlow, HuggingFace, NumPy, pandas, etc.

WHEN WRITING CODE:
- Always use fenced code blocks with the correct language tag: ```python or ```bash
- Write complete, self-contained scripts — not fragments
- Include all necessary imports
- For training scripts, always include: loss logging per epoch, model saving, GPU device handling
- Use f-strings, type hints where helpful, and clear variable names
- For file paths, always use absolute paths under {config.workspace}

WHEN THE USER SHARES A FILE OR ERROR:
- Read it carefully before responding
- For errors: identify the root cause, explain it briefly, provide the fix
- For "fix this file": return the complete corrected file, not just the changed lines
- For "improve/refactor": return the complete improved file

WHEN SUGGESTING BASH COMMANDS:
- Always provide the full command, ready to run
- For pip installs: pip install <package>
- For running scripts: python {config.workspace}/script.py
- For GPU checks: nvidia-smi

FORMAT:
- Lead with the answer/code, explanation after
- For multi-step tasks, use numbered steps
- Keep explanations concise — the user can ask follow-ups
- Never truncate code with "# ... rest of code here" — always write it fully
"""

        messages = [{"role": "system", "content": system}]
        for m in req.history[-30:]:
            role = "assistant" if m.get("role") == "assistant" else "user"
            messages.append({"role": role, "content": m.get("content", "")})
        messages.append({"role": "user", "content": req.message})

        resp = _ll.completion(model=config.model, messages=messages, max_tokens=4096, temperature=0.2)
        return {"reply": resp.choices[0].message.content, "model": config.model}
    except Exception as e:
        raise HTTPException(503, str(e))



# ── Experiments (task comparison) ─────────────────────────────────────────────

@app.get("/api/experiments")
def get_experiments():
    """Return all completed tasks with their metrics for comparison."""
    tasks = []
    for p in sorted((Path("logs")).glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text())
            if data.get("status") not in ("success", "stuck", "error", "max_iterations", "cancelled"):
                continue
            metrics = {}
            if data.get("result") and isinstance(data["result"].get("metrics"), dict):
                metrics = data["result"]["metrics"]
            # Also try to extract metrics from tool outputs via regex
            if not metrics:
                import re as _re
                for it in (data.get("iterations") or [])[-5:]:
                    out = it.get("tool_output","")
                    for m in _re.finditer(r"(?:loss|acc(?:uracy)?|f1|auc|mae|mse|rmse|val_loss|val_acc)[\s:=]+([0-9]+\.?[0-9]*)", out, _re.I):
                        key = m.group(0).split()[0].lower().rstrip(":=")
                        try: metrics[key] = float(m.group(1))
                        except: pass
            tasks.append({
                "task_id": data["task_id"],
                "task": data["task"][:120],
                "status": data["status"],
                "created_at": data["created_at"],
                "iterations": len(data.get("iterations", [])),
                "metrics": metrics,
                "summary": (data.get("result") or {}).get("summary", ""),
                "files_created": (data.get("result") or {}).get("files_created", []),
            })
        except Exception:
            pass
    return tasks


# ── Checkpoints ───────────────────────────────────────────────────────────────

@app.get("/api/checkpoints")
def list_checkpoints():
    """List all checkpoint files in workspace."""
    try:
        out, _ = ssh_run(
            f"find '{config.workspace}' -not -path '*/.git/*' "
            f"\\( -name '*.pt' -o -name '*.pth' -o -name '*.ckpt' "
            f"-o -name '*.safetensors' -o -name '*.bin' \\) "
            f"-printf '%s\t%T@\t%p\n' 2>/dev/null | sort -k2 -rn | head -50",
            timeout=20,
        )
        checkpoints = []
        for line in out.splitlines():
            parts = line.split("\t", 2) if "\t" in line else line.split("	", 2)
            if len(parts) == 3:
                size_bytes, mtime, path = parts
                name = path.split("/")[-1]
                parent = "/".join(path.split("/")[:-1])
                try:
                    size_mb = round(int(size_bytes) / 1024 / 1024, 1)
                except Exception:
                    size_mb = 0
                checkpoints.append({
                    "path": path, "name": name, "dir": parent,
                    "size_mb": size_mb, "mtime": float(mtime) if mtime.replace(".","").isdigit() else 0,
                })
        return checkpoints
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/checkpoints")
def delete_checkpoint(path: str):
    """Delete a checkpoint file."""
    if not path.startswith(config.workspace):
        raise HTTPException(400, "Path outside workspace")
    ext = path.split(".")[-1]
    if ext not in ("pt","pth","ckpt","safetensors","bin"):
        raise HTTPException(400, "Not a checkpoint file")
    try:
        out, code = ssh_run(f"rm -f '{path}' 2>&1")
        if code != 0:
            raise HTTPException(500, out)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── GPU monitoring ────────────────────────────────────────────────────────────

@app.get("/api/gpu")
def gpu_status():
    """Return current GPU stats."""
    try:
        out, _ = ssh_run(
            "nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw "
            "--format=csv,noheader,nounits 2>/dev/null || echo 'unavailable'",
            timeout=8,
        )
        if out.strip() == "unavailable" or not out.strip():
            return {"available": False, "gpus": []}
        gpus = []
        for line in out.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 4:
                try:
                    gpus.append({
                        "name": parts[0],
                        "util": int(parts[1]) if parts[1].isdigit() else 0,
                        "mem_used": int(parts[2]) if parts[2].isdigit() else 0,
                        "mem_total": int(parts[3]) if parts[3].isdigit() else 0,
                        "temp": int(parts[4]) if len(parts)>4 and parts[4].isdigit() else 0,
                        "power": round(float(parts[5]),1) if len(parts)>5 else 0,
                    })
                except Exception:
                    pass
        return {"available": True, "gpus": gpus}
    except Exception as e:
        return {"available": False, "gpus": [], "error": str(e)}


# ── Diff ──────────────────────────────────────────────────────────────────────

class DiffRequest(BaseModel):
    path: str
    original: str
    modified: str

@app.post("/api/diff")
def compute_diff(req: DiffRequest):
    """Return a unified diff between original and modified content."""
    import difflib
    orig_lines = req.original.splitlines(keepends=True)
    mod_lines  = req.modified.splitlines(keepends=True)
    diff = list(difflib.unified_diff(
        orig_lines, mod_lines,
        fromfile=f"a/{req.path.split('/')[-1]}",
        tofile=f"b/{req.path.split('/')[-1]}",
        lineterm="",
    ))
    return {"diff": diff, "additions": sum(1 for l in diff if l.startswith("+")),
            "deletions": sum(1 for l in diff if l.startswith("-"))}


# ── Auto-install detection ────────────────────────────────────────────────────

@app.post("/api/autoinstall")
def auto_install(req: ShellRequest):
    """
    Parse a Python traceback for ModuleNotFoundError and pip install the missing package.
    Returns {installed: bool, package: str, output: str}
    """
    import re as _re
    traceback_text = req.command  # reuse ShellRequest.command as the traceback text
    m = _re.search(r"ModuleNotFoundError: No module named ['\"]+([\w.\-]+)", traceback_text)
    if not m:
        return {"installed": False, "package": "", "output": "No ModuleNotFoundError found"}
    pkg = m.group(1).split(".")[0]  # top-level package
    try:
        out, code = ssh_run(f"pip install {pkg} 2>&1", timeout=120)
        return {"installed": code == 0, "package": pkg, "output": out[-1000:]}
    except Exception as e:
        return {"installed": False, "package": pkg, "output": str(e)}

# ── Static files ──────────────────────────────────────────────────────────────

from fastapi.responses import Response as _Response

@app.get("/", response_class=HTMLResponse)
def dashboard():
    content = (UI_DIR / "index.html").read_text()
    return HTMLResponse(content=content, headers={
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
    })

@app.get("/{path:path}")
def static(path: str):
    f = UI_DIR / path
    if f.exists() and f.is_file():
        return FileResponse(f, headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        })
    raise HTTPException(404)


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("\n" + "═" * 60)
    print("  AutoLab")
    print("═" * 60)
    print(f"  SSH:       {config.ssh_user}@{config.ssh_host}:{config.ssh_port}")
    print(f"  Workspace: {config.workspace}")
    print(f"  Model:     {config.model}")
    print(f"  UI:        http://localhost:{config.ui_port}")
    print("═" * 60 + "\n")
    uvicorn.run(app, host=config.ui_host, port=config.ui_port, log_level="warning")