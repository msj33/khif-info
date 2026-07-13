#!/usr/bin/env bash
set -uo pipefail

OWNER="${KHIF_GITHUB_OWNER:-msj33}"
REPO="${KHIF_GITHUB_REPO:-khif-info}"
BRANCH="${KHIF_GITHUB_BRANCH:-main}"
RAW_ROOT="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}"
SCHEDULE_URL="${RAW_ROOT}/screen-schedule.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_MARKER_START="# KHIF-SCHEDULE-CRON-BEGIN"
CRON_MARKER_END="# KHIF-SCHEDULE-CRON-END"

log(){
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

fetch_schedule(){
  curl -fsS "${SCHEDULE_URL}?t=$(date +%s)" 2>/dev/null
}

clean_crontab(){
  awk '/^# KHIF-SCHEDULE-CRON-BEGIN$/ {inside=1; next} /^# KHIF-SCHEDULE-CRON-END$/ {inside=0; next} !inside {print}' "$1"
}

install_crontab(){
  local schedule_lines="$1"
  local tmp_current tmp_next

  tmp_current="$(mktemp)"
  tmp_next="$(mktemp)"

  crontab -l > "$tmp_current" 2>/dev/null || true
  clean_crontab "$tmp_current" > "$tmp_next"

  if [[ -n "$schedule_lines" ]]; then
    {
      printf '%s\n' "$CRON_MARKER_START"
      printf '%s\n' "$schedule_lines"
      printf '%s\n' "$CRON_MARKER_END"
    } >> "$tmp_next"
  fi

  crontab "$tmp_next"
  rm -f "$tmp_current" "$tmp_next"
}

if ! command -v curl >/dev/null 2>&1; then
  log "curl is required"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  log "python3 is required"
  exit 1
fi

schedule_json="$(fetch_schedule)"
if [[ -z "$schedule_json" ]]; then
  log "Unable to fetch schedule JSON"
  install_crontab ""
  exit 1
fi

schedule_lines="$(printf '%s' "$schedule_json" | python3 - <<'PY'
import json,sys

data_text=sys.stdin.read()
if not data_text.strip():
    sys.exit(0)
try:
    data=json.loads(data_text)
except json.JSONDecodeError:
    sys.exit(0)

if not isinstance(data, dict):
    sys.exit(0)

if not data.get('enabled', True):
    sys.exit(0)

order=['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
cron_day={'monday':'1','tuesday':'2','wednesday':'3','thursday':'4','friday':'5','saturday':'6','sunday':'7'}

lines=[]
for idx, day in enumerate(order):
    item=data.get('days', {}).get(day, {})
    if item.get('enabled', True) is False:
        continue
    start=item.get('startTime', '10:00')
    end=item.get('endTime', '22:00')
    if start == end:
        continue
    try:
        sh, sm = map(int, start.split(':'))
        eh, em = map(int, end.split(':'))
    except Exception:
        continue
    if not (0 <= sh <= 23 and 0 <= sm <= 59 and 0 <= eh <= 23 and 0 <= em <= 59):
        continue
    command_on='vcgencmd display_power 1'
    command_off='vcgencmd display_power 0'
    lines.append(f"{sm} {sh} * * {cron_day[day]} {command_on}")
    if sh < eh or (sh == eh and sm < em):
        lines.append(f"{em} {eh} * * {cron_day[day]} {command_off}")
    else:
        next_day=order[(idx + 1) % len(order)]
        lines.append(f"{em} {eh} * * {cron_day[next_day]} {command_off}")
lines.append("0 3 * * * /usr/bin/env bash /opt/khif-agent/khif-agent-schedule.sh")
for line in lines:
    print(line)
PY
)"

install_crontab "$schedule_lines"
log "Cron schedule updated."
