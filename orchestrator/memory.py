"""
Task memory — persists experiment history so the agent knows what's been tried.
"""
from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskLog:
    """Represents one agent task run."""

    def __init__(self, task_id: str, task: str):
        self.task_id = task_id
        self.task = task
        self.created_at = _now()
        self.updated_at = _now()
        self.status = "running"  # running | success | stuck | error | cancelled | max_iterations
        self.iterations: list[dict] = []
        self.result: Optional[dict] = None
        self.error: Optional[str] = None

    def add_iteration(
        self,
        iteration: int,
        thought: str,
        tool: Optional[str],
        args: dict,
        tool_output: Optional[str],
        tool_success: Optional[bool],
        exit_code: Optional[int] = None,
    ):
        self.iterations.append({
            "iteration": iteration,
            "timestamp": _now(),
            "thought": thought,
            "tool": tool,
            "args": args,
            "tool_output": (tool_output or "")[-4000:],  # cap stored output
            "tool_success": tool_success,
            "exit_code": exit_code,
        })
        self.updated_at = _now()
        self._save()

    def finish(self, status: str, result: Optional[dict] = None, error: Optional[str] = None):
        self.status = status
        self.result = result
        self.error = error
        self.updated_at = _now()
        self._save()

    def _save(self):
        path = LOG_DIR / f"{self.task_id}.json"
        path.write_text(json.dumps(self.to_dict(), indent=2))

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "task": self.task,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "status": self.status,
            "iterations": self.iterations,
            "result": self.result,
            "error": self.error,
        }

    @classmethod
    def load(cls, task_id: str) -> Optional["TaskLog"]:
        path = LOG_DIR / f"{task_id}.json"
        if not path.exists():
            return None
        data = json.loads(path.read_text())
        obj = cls.__new__(cls)
        obj.__dict__.update(data)
        return obj


# ── Public API ────────────────────────────────────────────────────────────────

def new_task(task: str, task_id: Optional[str] = None) -> TaskLog:
    tid = task_id or str(uuid.uuid4())[:8]
    log = TaskLog(task_id=tid, task=task)
    log._save()
    return log


def get_task(task_id: str) -> Optional[TaskLog]:
    return TaskLog.load(task_id)


def list_tasks() -> list[dict]:
    tasks = []
    for p in sorted(LOG_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text())
            tasks.append({
                "task_id": data["task_id"],
                "task": data["task"][:120],
                "status": data["status"],
                "created_at": data["created_at"],
                "updated_at": data.get("updated_at", data["created_at"]),
                "iterations": len(data.get("iterations", [])),
            })
        except Exception:
            pass
    return tasks


def get_prior_context(limit: int = 5) -> str:
    """Return a summary of recent successful tasks for the agent to reference."""
    tasks = list_tasks()
    successful = [t for t in tasks if t["status"] == "success"][:limit]
    if not successful:
        return "No prior experiments found."
    lines = ["Recent completed experiments:"]
    for t in successful:
        lines.append(f"- [{t['task_id']}] {t['task'][:80]} ({t['created_at'][:10]})")
    return "\n".join(lines)


def cancel_task(task_id: str) -> bool:
    log = get_task(task_id)
    if not log:
        return False
    if log.status == "running":
        log.finish("cancelled")
    return True