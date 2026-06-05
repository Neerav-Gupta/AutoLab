"""
AutoLab Agent — autonomous tool-use loop.

Flow per task:
  1. Connect SSH
  2. PLAN  — gather env info (gpu, workspace)
  3. LOOP  — call LLM → parse tool call → execute → feed result back
  4. MONITOR — when a long process starts, poll cheaply without LLM
  5. FINISH — notify, persist result
"""
from __future__ import annotations
import json
import os
import re
import time
import smtplib
import threading
from email.mime.text import MIMEText
from typing import Optional

import requests
import litellm

from config import config
from orchestrator.tools import SSHSession, dispatch_tool, ToolResult
from orchestrator.memory import TaskLog, new_task, get_prior_context
from orchestrator.prompts import build_system_prompt, format_tool_result_for_llm

# Suppress litellm verbose logging
litellm.suppress_debug_info = True
os.environ.setdefault("LITELLM_LOG", "ERROR")

# Registry of running agent threads so the server can cancel them
_running: dict[str, threading.Event] = {}  # task_id → cancel_event


# ── LLM call ──────────────────────────────────────────────────────────────────

def _call_llm(messages: list[dict]) -> str:
    """Call the configured model via LiteLLM. Returns raw text."""
    resp = litellm.completion(
        model=config.model,
        messages=messages,
        max_tokens=4096,
        temperature=0.2,
    )
    return resp.choices[0].message.content.strip()


def _parse_response(raw: str) -> dict:
    """Parse LLM response to dict. Strip any accidental markdown fences."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Sometimes model wraps in extra whitespace
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to extract JSON object from response
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            return json.loads(match.group(0))
        raise ValueError(f"Could not parse LLM response as JSON:\n{raw[:500]}")


# ── Notification ──────────────────────────────────────────────────────────────

def _notify(subject: str, body: str):
    if config.webhook_url:
        try:
            requests.post(
                config.webhook_url,
                json={"text": f"*{subject}*\n{body}"},
                timeout=10,
            )
        except Exception as e:
            print(f"[notify] webhook failed: {e}")

    if config.notify_email and config.smtp_host:
        try:
            msg = MIMEText(body)
            msg["Subject"] = f"[AutoLab] {subject}"
            msg["From"] = config.smtp_from
            msg["To"] = config.notify_email
            with smtplib.SMTP(config.smtp_host, config.smtp_port) as s:
                if config.smtp_user:
                    s.starttls()
                    s.login(config.smtp_user, config.smtp_password)
                s.send_message(msg)
        except Exception as e:
            print(f"[notify] email failed: {e}")


# ── Agent loop ────────────────────────────────────────────────────────────────

def run_task(task: str, task_id: Optional[str] = None) -> str:
    """
    Run the autonomous agent loop for a task.
    Blocks until the task finishes (run in a thread for async use).
    Returns task_id.
    """
    # Pass task_id so memory creates the log with the correct ID immediately.
    # Without this, new_task() generates its own UUID and a second log file appears.
    log = new_task(task, task_id=task_id)

    cancel_event = threading.Event()
    _running[log.task_id] = cancel_event

    ssh = SSHSession(
        host=config.ssh_host,
        port=config.ssh_port,
        user=config.ssh_user,
        key_path=config.ssh_key_expanded,
        workspace=config.workspace,
    )

    system_prompt = build_system_prompt(config.workspace)
    messages = [{"role": "system", "content": system_prompt}]

    print(f"\n[{log.task_id}] Starting: {task[:80]}")

    try:
        ssh.connect()

        # ── Phase 1: gather environment context ──────────────────────────────
        gpu_out, _, _ = ssh.run("nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader 2>/dev/null || echo 'No GPU info'")
        ws_out, _, _ = ssh.run(f"ls -lhp '{config.workspace}' 2>/dev/null | head -40")
        prior = get_prior_context(limit=3)

        initial_context = (
            f"Task: {task}\n\n"
            f"GPU status:\n{gpu_out.strip()}\n\n"
            f"Workspace ({config.workspace}):\n{ws_out.strip()}\n\n"
            f"Prior experiments:\n{prior}"
        )
        messages.append({"role": "user", "content": initial_context})

        # ── Phase 2: tool-use loop ────────────────────────────────────────────
        retry_count = 0
        max_retries_per_error = 3

        for iteration in range(1, config.max_iterations + 1):

            if cancel_event.is_set():
                log.finish("cancelled")
                print(f"[{log.task_id}] Cancelled at iteration {iteration}")
                return log.task_id

            print(f"[{log.task_id}] Iteration {iteration}/{config.max_iterations} — calling LLM...")

            # Call LLM
            try:
                raw = _call_llm(messages)
            except Exception as e:
                print(f"[{log.task_id}] LLM error: {e}")
                log.add_iteration(iteration, f"LLM error: {e}", None, {}, None, None)
                time.sleep(5)
                continue

            # Parse response
            try:
                response = _parse_response(raw)
            except Exception as e:
                print(f"[{log.task_id}] Parse error: {e}")
                messages.append({"role": "assistant", "content": raw})
                messages.append({
                    "role": "user",
                    "content": f"Your response could not be parsed as JSON. Error: {e}\nPlease respond with valid JSON only.",
                })
                continue

            thought = response.get("thought", "")
            tool_name = response.get("tool")
            args = response.get("args", {})
            status = response.get("status", "working")

            print(f"[{log.task_id}]   thought: {thought[:80]}")
            print(f"[{log.task_id}]   tool: {tool_name} | status: {status}")

            # ── Terminal states ───────────────────────────────────────────────
            if status == "success":
                result = response.get("result", {})
                log.add_iteration(iteration, thought, None, {}, None, None)
                log.finish("success", result=result)
                _notify(
                    f"Task completed ✓ [{log.task_id}]",
                    f"Task: {task}\n\nSummary: {result.get('summary','')}\n\nSuggested next: {result.get('suggested_next','')}",
                )
                print(f"[{log.task_id}] SUCCESS: {result.get('summary','')[:120]}")
                return log.task_id

            if status == "stuck":
                result = response.get("result", {})
                log.add_iteration(iteration, thought, None, {}, None, None)
                log.finish("stuck", result=result)
                _notify(
                    f"Agent stuck [{log.task_id}]",
                    f"Task: {task}\n\nBlocker: {result.get('blocker','')}\n\nSuggested fix: {result.get('suggested_fix','')}",
                )
                print(f"[{log.task_id}] STUCK: {result.get('blocker','')[:120]}")
                return log.task_id

            # ── Execute tool ──────────────────────────────────────────────────
            if not tool_name:
                # Model responded without a tool — ask it to continue
                messages.append({"role": "assistant", "content": raw})
                messages.append({"role": "user", "content": "Please continue — call a tool or mark status as success/stuck."})
                continue

            tool_result: ToolResult = dispatch_tool(
                ssh, tool_name, args, timeout=config.tool_timeout
            )

            log.add_iteration(
                iteration=iteration,
                thought=thought,
                tool=tool_name,
                args=args,
                tool_output=tool_result.to_llm_string(),
                tool_success=tool_result.success,
                exit_code=tool_result.exit_code,
            )

            # Track retries on failure
            if not tool_result.success:
                retry_count += 1
                if retry_count >= max_retries_per_error:
                    print(f"[{log.task_id}]   {max_retries_per_error} consecutive failures — asking agent to reassess")
                    retry_count = 0
            else:
                retry_count = 0

            # ── Auto-install missing packages ─────────────────────────────
            if not tool_result.success:
                combined = (tool_result.output or "") + (tool_result.error or "")
                import re as _re
                mn = _re.search(r"ModuleNotFoundError: No module named ['\"\`]+([\w.\-]+)", combined)
                if mn:
                    pkg = mn.group(1).split(".")[0]
                    print(f"[{log.task_id}]   Auto-installing missing package: {pkg}")
                    from orchestrator.tools import tool_install_package
                    install_result = tool_install_package(ssh, pkg)
                    if install_result.success:
                        print(f"[{log.task_id}]   Installed {pkg} — retrying tool")
                        # Retry the same tool call after install
                        tool_result = dispatch_tool(ssh, tool_name, args, timeout=config.tool_timeout)
                        log.add_iteration(
                            iteration=iteration,
                            thought=f"[Auto-installed {pkg}] Retrying: {thought}",
                            tool=tool_name, args=args,
                            tool_output=tool_result.to_llm_string(),
                            tool_success=tool_result.success,
                            exit_code=tool_result.exit_code,
                        )

            # Feed result back to LLM
            messages.append({"role": "assistant", "content": raw})
            messages.append({
                "role": "user",
                "content": format_tool_result_for_llm(tool_name, tool_result.to_llm_string()),
            })

            print(f"[{log.task_id}]   exit={tool_result.exit_code} | success={tool_result.success}")

        # ── Max iterations reached ────────────────────────────────────────────
        log.finish("max_iterations", result={"summary": f"Reached max iterations ({config.max_iterations})"})
        _notify(
            f"Max iterations reached [{log.task_id}]",
            f"Task: {task}\n\nReached {config.max_iterations} iterations without completing.",
        )

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[{log.task_id}] FATAL: {e}\n{tb}")
        log.finish("error", error=str(e))
        _notify(f"Agent error [{log.task_id}]", f"Task: {task}\n\nError: {e}")

    finally:
        ssh.close()
        _running.pop(log.task_id, None)

    return log.task_id


def cancel_task(task_id: str) -> bool:
    event = _running.get(task_id)
    if event:
        event.set()
        return True
    return False


def is_running(task_id: str) -> bool:
    return task_id in _running