#!/usr/bin/env python3
"""
AutoLab setup helper — checks your environment and config.
Run: python preflight.py
"""
import sys
import os
import subprocess
from pathlib import Path


def check(label, fn):
    try:
        result = fn()
        print(f"  ✓  {label}{f' — {result}' if result else ''}")
        return True
    except Exception as e:
        print(f"  ✗  {label} — {e}")
        return False


def main():
    print("\n" + "═" * 50)
    print("  AutoLab Setup Check")
    print("═" * 50 + "\n")

    ok = True

    # Python version
    ok &= check("Python 3.10+", lambda: (
        None if sys.version_info >= (3, 10)
        else (_ for _ in ()).throw(Exception(f"found {sys.version_info.major}.{sys.version_info.minor}"))
    ))

    # .env file
    if not Path(".env").exists():
        print("  ✗  .env file — not found")
        print("     Run: cp .env.example .env  then edit it\n")
        ok = False
    else:
        ok &= check(".env file", lambda: "found")

    # Required packages
    packages = ["fastapi", "uvicorn", "paramiko", "litellm", "pydantic_settings", "dotenv"]
    for pkg in packages:
        ok &= check(f"pip: {pkg}", lambda p=pkg: __import__(p.replace("-","_")) and None)

    # Load config
    try:
        from config import config
        ok &= check("SSH host", lambda: config.ssh_host if config.ssh_host else (_ for _ in ()).throw(Exception("SSH_HOST not set in .env")))
        ok &= check("SSH key path", lambda: (
            config.ssh_key_expanded
            if Path(config.ssh_key_expanded).exists()
            else (_ for _ in ()).throw(Exception(f"Key not found: {config.ssh_key_expanded}"))
        ))
        ok &= check("Model", lambda: config.model)
    except Exception as e:
        print(f"  ✗  Config — {e}")
        ok = False

    # Test SSH connection
    try:
        from config import config
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(
            hostname=config.ssh_host, port=config.ssh_port,
            username=config.ssh_user,
            key_filename=config.ssh_key_expanded,
            timeout=10,
        )
        _, stdout, _ = ssh.exec_command("echo 'connected' && nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'no GPU'")
        out = stdout.read().decode().strip()
        ssh.close()
        ok &= check("SSH connection", lambda: out)
    except Exception as e:
        print(f"  ✗  SSH connection — {e}")
        ok = False

    print()
    if ok:
        print("  All checks passed! Run: python server.py")
    else:
        print("  Fix the issues above, then run: python server.py")
    print()


if __name__ == "__main__":
    main()