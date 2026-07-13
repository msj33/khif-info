#!/usr/bin/env bash
set -uo pipefail

OWNER="${KHIF_GITHUB_OWNER:-msj33}"
REPO="${KHIF_GITHUB_REPO:-khif-info-state}"
BRANCH="${KHIF_GITHUB_BRANCH:-main}"

DEVICE_ID="${KHIF_DEVICE_ID:-khif-infoscreen-01}"

TOKEN_FILE="${KHIF_TOKEN_FILE:-/etc/khif-agent/github-token}"
STATE_DIR="${KHIF_STATE_DIR:-/var/lib/khif-agent}"

COMMAND_PATH="${KHIF_COMMAND_PATH:-remote/command.json}"
STATUS_PATH="${KHIF_STATUS_PATH:-remote/status/${DEVICE_ID}.json}"

KIOSK_SERVICE="${KHIF_KIOSK_SERVICE:-khif-kiosk.service}"

STATUS_INTERVAL="${KHIF_STATUS_INTERVAL:-60}"
COMMAND_INTERVAL="${KHIF_COMMAND_INTERVAL:-15}"

LAST_COMMAND_FILE="${STATE_DIR}/last-command-id"

API_ROOT="https://api.github.com/repos/${OWNER}/${REPO}/contents"
RAW_ROOT="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}"

mkdir -p "$STATE_DIR"

last_agent_error=""

log(){
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

now_iso(){
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

read_token(){
  tr -d '\r\n' < "$TOKEN_FILE"
}

json_escape(){
  printf '%s' "$1" |
    sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g; s/\r//g; s/\n/ /g'
}

json_get_string(){
  local key="$1"
  grep -m1 "\"${key}\"" |
    sed -E 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
}

last_command_id(){
  [[ -f "$LAST_COMMAND_FILE" ]] && cat "$LAST_COMMAND_FILE" || true
}

save_last_command_id(){
  printf '%s' "$1" > "$LAST_COMMAND_FILE"
}


#
# Curl helper
# Used only where HTTP errors should be reported
#
_curl_with_error(){
  local url=""
  local -a curl_opts=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -X)
        curl_opts+=("$1" "$2")
        shift 2
        ;;
      --data-binary)
        curl_opts+=("$1" "$2")
        shift 2
        ;;
      -H)
        curl_opts+=("$1" "$2")
        shift 2
        ;;
      *)
        url="$1"
        shift
        ;;
    esac
  done

  local output
  local stderr
  local rc

  output="$(mktemp)"
  stderr="$(mktemp)"

  last_agent_error=""

  curl -fsS \
    "${curl_opts[@]}" \
    "$url" \
    >"$output" \
    2>"$stderr"

  rc=$?

  if [[ $rc -ne 0 ]]; then
    last_agent_error="$(cat "$stderr")"
    [[ -z "$last_agent_error" ]] &&
      last_agent_error="curl error $rc"

    rm -f "$output" "$stderr"
    return "$rc"
  fi

  cat "$output"

  rm -f "$output" "$stderr"
  return 0
}


#
# GitHub GET
# 404 is allowed because status files may not exist yet
#
api_get_file(){
  local path="$1"
  local token

  token="$(read_token)" || {
    last_agent_error="Unable to read token"
    return 1
  }

  curl -fsS \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${token}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API_ROOT}/${path}"
}


#
# GitHub PUT content API
#
api_put_json_file(){
  local path="$1"
  local json_file="$2"

  local token
  local sha=""
  local content
  local body_file
  local api_response

  token="$(read_token)" || {
    last_agent_error="Unable to read token"
    return 1
  }

  #
  # Existing file? Get SHA.
  # Missing file is OK -> create.
  #
  api_response="$(api_get_file "$path" 2>/dev/null || true)"

  sha="$(printf '%s' "$api_response" |
    sed -nE 's/.*"sha"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' |
    head -n1)"

  content="$(base64 -w 0 "$json_file")"

  body_file="$(mktemp)"

  if [[ -n "$sha" ]]; then
    cat > "$body_file" <<EOF
{"message":"Update ${path} from ${DEVICE_ID}","content":"${content}","sha":"${sha}","branch":"${BRANCH}"}
EOF
  else
    cat > "$body_file" <<EOF
{"message":"Create ${path} from ${DEVICE_ID}","content":"${content}","branch":"${BRANCH}"}
EOF
  fi

  _curl_with_error \
    "${API_ROOT}/${path}" \
    -X PUT \
    --data-binary "@${body_file}" \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${token}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "Content-Type: application/json"

  local rc=$?

  rm -f "$body_file"

  return "$rc"
}


fetch_command_json(){
  curl -fsS \
    "${RAW_ROOT}/${COMMAND_PATH}?t=$(date +%s)" \
    2>/dev/null || true
}
uptime_seconds(){
  awk '{print int($1)}' /proc/uptime 2>/dev/null || printf '0'
}

temperature_c(){
  if [[ -r /sys/class/thermal/thermal_zone0/temp ]]; then
    LC_NUMERIC=C awk '{printf "%.1f",$1/1000}' /sys/class/thermal/thermal_zone0/temp
  elif command -v vcgencmd >/dev/null 2>&1; then
    LC_NUMERIC=C vcgencmd measure_temp 2>/dev/null |
      sed -E "s/.*=([0-9.]+).*/\1/"
  else
    printf ''
  fi
}

browser_status(){
  if pgrep -af 'chromium|chromium-browser|chrome' >/dev/null 2>&1; then
    printf 'running'
  else
    printf 'not-running'
  fi
}


write_status(){
  local last_command="${1:-}"
  local last_result="${2:-}"
  local last_error="${3:-}"

  local status_file
  local hostname
  local uptime
  local temp
  local browser
  local last_id
  local temp_json

  status_file="$(mktemp)"

  hostname="$(hostname 2>/dev/null || printf '-')"
  uptime="$(uptime_seconds)"
  temp="$(LC_NUMERIC=C temperature_c)"
  browser="$(browser_status)"
  screen_power="$(screen_power_state)"
  last_id="$(last_command_id)"

  if [[ -n "$temp" ]]; then
    temp_json="$temp"
  else
    temp_json="null"
  fi

  cat > "$status_file" <<EOF
{"deviceId":"$(json_escape "$DEVICE_ID")","status":"online","lastSeen":"$(now_iso)","hostname":"$(json_escape "$hostname")","uptimeSeconds":${uptime:-0},"temperatureC":${temp_json},"browser":"$(json_escape "$browser")","screenPower":"$(json_escape "$screen_power")","currentUrl":"https://msj33.github.io/khif-info/","lastCommandId":"$(json_escape "$last_id")","lastCommand":"$(json_escape "$last_command")","lastCommandResult":"$(json_escape "$last_result")","lastError":"$(json_escape "$last_error")"}
EOF

  api_put_json_file "$STATUS_PATH" "$status_file"

  local rc=$?

  rm -f "$status_file"

  return "$rc"
}


restart_browser(){
  if systemctl restart "$KIOSK_SERVICE" >/dev/null 2>&1; then
    printf 'ok: systemctl restart %s' "$KIOSK_SERVICE"
    return 0
  fi

  pkill -f 'chromium|chromium-browser|chrome' >/dev/null 2>&1 || true
  printf 'ok: chromium process signalled'
}


reload_page(){
  if command -v xdotool >/dev/null 2>&1; then
    DISPLAY=:0 \
    XAUTHORITY=/home/pi/.Xauthority \
    xdotool key --clearmodifiers F5 >/dev/null 2>&1 && {
      printf 'ok: F5 sent'
      return 0
    }
  fi

  restart_browser
}

screen_power_state(){
  if command -v vcgencmd >/dev/null 2>&1; then
    local state
    state=$(vcgencmd display_power 2>/dev/null)
    if [[ "$state" == "Display Power: 0" || "$state" == "0" ]]; then
      printf 'off'
      return 0
    elif [[ "$state" == "Display Power: 1" || "$state" == "1" ]]; then
      printf 'on'
      return 0
    fi
  fi
  printf 'unknown'
}

execute_command(){
  case "$1" in
    none)
      printf 'ignored: none'
      ;;

    reload-page)
      reload_page
      ;;

    restart-browser)
      restart_browser
      ;;

    screen-on)
      if /opt/khif-agent/screen-power.sh on >/dev/null 2>&1; then
        printf 'ok: screen on'
      else
        printf 'error: screen on failed'
      fi
      ;;

    screen-off)
      if /opt/khif-agent/screen-power.sh off >/dev/null 2>&1; then
        printf 'ok: screen off'
      else
        printf 'error: screen off failed'
      fi
      ;;

    reboot-pi)
      write_status \
        "reboot-pi" \
        "ok: rebooting" \
        ""

      /sbin/reboot >/dev/null 2>&1 || \
        systemctl reboot >/dev/null 2>&1

      printf 'ok: reboot requested'
      ;;

    *)
      return 2
      ;;
  esac
}


check_command(){

  local json
  local command_id
  local command
  local device_id
  local expires_at
  local last_id
  local result
  local now_epoch
  local exp_epoch


  json="$(fetch_command_json)"

  [[ -z "$json" ]] && return 0


  command_id="$(printf '%s\n' "$json" | json_get_string id)"
  device_id="$(printf '%s\n' "$json" | json_get_string deviceId)"
  command="$(printf '%s\n' "$json" | json_get_string command)"
  expires_at="$(printf '%s\n' "$json" | json_get_string expiresAt)"

  last_id="$(last_command_id)"


  [[ -z "$command_id" ||
     "$command_id" == "initial" ||
     "$command_id" == "$last_id" ]] &&
     return 0


  [[ "$device_id" != "$DEVICE_ID" &&
     "$device_id" != "all" ]] &&
     return 0


  if [[ -n "$expires_at" ]]; then

    now_epoch="$(date -u +%s)"

    exp_epoch="$(date -u -d "$expires_at" +%s 2>/dev/null || printf '0')"

    if [[ "$exp_epoch" != "0" &&
          "$now_epoch" -gt "$exp_epoch" ]]; then

      save_last_command_id "$command_id"

      write_status \
        "$command" \
        "expired" \
        "Command expired"

      return 0
    fi
  fi


  case "$command" in

    none|reload-page|restart-browser|reboot-pi|screen-on|screen-off)

      result="$(execute_command "$command" 2>&1)"

      save_last_command_id "$command_id"

      write_status \
        "$command" \
        "$result" \
        ""

      ;;


    *)

      save_last_command_id "$command_id"

      write_status \
        "$command" \
        "rejected" \
        "Command not allowed: ${command}"

      ;;

  esac
}
main(){

  if [[ ! -r "$TOKEN_FILE" ]]; then
    log "Token file missing or unreadable: $TOKEN_FILE"

    last_agent_error="Token file missing or unreadable"

    write_status \
      "" \
      "" \
      "$last_agent_error" || true

    exit 1
  fi


  local last_status=0
  local now


  while true; do

    check_command || {
      log "Command check failed: ${last_agent_error:-unknown error}"
    }


    now="$(date +%s)"


    if (( now - last_status >= STATUS_INTERVAL )); then

      write_status "" "" ""

      if [[ $? -ne 0 ]]; then
        log "Status update failed: ${last_agent_error:-unknown error}"
      fi

      last_status="$now"

    fi


    sleep "$COMMAND_INTERVAL"

  done
}


main "$@"
