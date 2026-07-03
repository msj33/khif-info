#!/usr/bin/env python3
"""KHIF Info Raspberry Pi Agent v1.

Poller GitHub for whitelisted commands and writes heartbeat/status back.
No arbitrary shell commands are accepted.
"""
import base64
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

OWNER = os.getenv("KHIF_GITHUB_OWNER", "msj33")
REPO = os.getenv("KHIF_GITHUB_REPO", "khif-info")
BRANCH = os.getenv("KHIF_GITHUB_BRANCH", "main")
DEVICE_ID = os.getenv("KHIF_DEVICE_ID", "khif-infoscreen-01")
TOKEN_FILE = Path(os.getenv("KHIF_TOKEN_FILE", "/etc/khif-agent/github-token"))
STATE_DIR = Path(os.getenv("KHIF_STATE_DIR", "/var/lib/khif-agent"))
COMMAND_PATH = os.getenv("KHIF_COMMAND_PATH", "remote/command.json")
STATUS_PATH = os.getenv("KHIF_STATUS_PATH", f"remote/status/{DEVICE_ID}.json")
KIOSK_SERVICE = os.getenv("KHIF_KIOSK_SERVICE", "khif-kiosk.service")
STATUS_INTERVAL = int(os.getenv("KHIF_STATUS_INTERVAL", "30"))
COMMAND_INTERVAL = int(os.getenv("KHIF_COMMAND_INTERVAL", "15"))
LAST_COMMAND_FILE = STATE_DIR / "last-command-id"
ALLOWED_COMMANDS = {"none", "reload-page", "restart-browser", "reboot-pi"}
API_ROOT = f"https://api.github.com/repos/{OWNER}/{REPO}/contents"

def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def read_token():
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError(f"Token file is empty: {TOKEN_FILE}")
    return token

def api_request(method, path, body=None):
    token = read_token()
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{API_ROOT}/{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "khif-info-agent/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {method} {path} failed: HTTP {e.code} {detail}")

def get_json_file(path):
    obj = api_request("GET", path)
    if not obj:
        return None, None
    content = obj.get("content", "").replace("\n", "")
    if not content:
        return None, obj.get("sha")
    return json.loads(base64.b64decode(content).decode("utf-8")), obj.get("sha")

def put_json_file(path, payload):
    existing, sha = get_json_file(path)
    content = base64.b64encode((json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")).decode("ascii")
    body = {
        "message": f"Update {path} from {DEVICE_ID}",
        "content": content,
        "branch": BRANCH,
    }
    if sha:
        body["sha"] = sha
    return api_request("PUT", path, body)

def run(cmd, timeout=10):
    return subprocess.run(cmd, shell=True, text=True, capture_output=True, timeout=timeout)

def get_uptime_seconds():
    try:
        return int(float(Path("/proc/uptime").read_text().split()[0]))
    except Exception:
        return 0

def get_temperature_c():
    try:
        raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()
        return round(int(raw) / 1000, 1)
    except Exception:
        try:
            r = run("vcgencmd measure_temp", timeout=5)
            if r.returncode == 0 and "temp=" in r.stdout:
                return float(r.stdout.split("temp=")[1].split("'")[0])
        except Exception:
            pass
    return None

def browser_status():
    r = run("pgrep -af 'chromium|chromium-browser|chrome'", timeout=5)
    return "running" if r.returncode == 0 and r.stdout.strip() else "not-running"

def restart_browser():
    # Prefer a systemd kiosk service if one exists, otherwise kill Chromium and rely on autostart/watchdog.
    r = run(f"systemctl restart {KIOSK_SERVICE}", timeout=20)
    if r.returncode == 0:
        return "ok: systemctl restart"
    r = run("pkill -f 'chromium|chromium-browser|chrome'", timeout=10)
    # pkill returns 1 if no process matched. Treat as acceptable; autostart may recreate process.
    return "ok: chromium process signalled"

def reload_page():
    # xdotool is optional. If unavailable, fall back to browser restart.
    env_prefix = "DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority"
    r = run(f"{env_prefix} xdotool key --clearmodifiers F5", timeout=10)
    if r.returncode == 0:
        return "ok: F5 sent"
    return restart_browser()

def execute_command(command):
    if command == "none":
        return "ignored: none"
    if command == "reload-page":
        return reload_page()
    if command == "restart-browser":
        return restart_browser()
    if command == "reboot-pi":
        # Write status before rebooting, then reboot.
        write_status(last_command=command, last_result="ok: rebooting")
        run("/sbin/reboot", timeout=5)
        return "ok: reboot requested"
    raise ValueError(f"Command not allowed: {command}")

def last_command_id():
    try:
        return LAST_COMMAND_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        return ""

def save_last_command_id(command_id):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LAST_COMMAND_FILE.write_text(command_id or "", encoding="utf-8")

def write_status(last_command="", last_result="", last_error=""):
    payload = {
        "deviceId": DEVICE_ID,
        "status": "online",
        "lastSeen": now_iso(),
        "hostname": socket.gethostname(),
        "uptimeSeconds": get_uptime_seconds(),
        "temperatureC": get_temperature_c(),
        "browser": browser_status(),
        "currentUrl": "https://msj33.github.io/khif-info/",
        "lastCommandId": last_command_id(),
        "lastCommand": last_command,
        "lastCommandResult": last_result,
        "lastError": last_error,
    }
    put_json_file(STATUS_PATH, payload)

def check_command():
    command_obj, _ = get_json_file(COMMAND_PATH)
    if not command_obj:
        return
    command_id = str(command_obj.get("id", ""))
    if not command_id or command_id == "initial" or command_id == last_command_id():
        return
    if command_obj.get("deviceId") not in (DEVICE_ID, "all"):
        return
    expires_at = command_obj.get("expiresAt")
    if expires_at:
        try:
            expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expiry:
                save_last_command_id(command_id)
                write_status(last_command=command_obj.get("command", ""), last_result="expired", last_error="Command expired")
                return
        except Exception:
            pass
    command = str(command_obj.get("command", ""))
    if command not in ALLOWED_COMMANDS:
        save_last_command_id(command_id)
        write_status(last_command=command, last_result="rejected", last_error=f"Command not allowed: {command}")
        return
    try:
        result = execute_command(command)
        save_last_command_id(command_id)
        write_status(last_command=command, last_result=result, last_error="")
    except Exception as e:
        save_last_command_id(command_id)
        write_status(last_command=command, last_result="error", last_error=str(e))

def main():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    last_status = 0
    while True:
        try:
            check_command()
            if time.time() - last_status >= STATUS_INTERVAL:
                write_status()
                last_status = time.time()
        except Exception as e:
            # Avoid crashing tight loop; try to report next cycle.
            print(f"Agent error: {e}", flush=True)
        time.sleep(COMMAND_INTERVAL)

if __name__ == "__main__":
    main()
