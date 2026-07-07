#!/usr/bin/env bash
set -uo pipefail
OWNER="${KHIF_GITHUB_OWNER:-msj33}"
REPO="${KHIF_GITHUB_REPO:-khif-info}"
BRANCH="${KHIF_GITHUB_BRANCH:-main}"
DEVICE_ID="${KHIF_DEVICE_ID:-khif-infoscreen-01}"
TOKEN_FILE="${KHIF_TOKEN_FILE:-/etc/khif-agent/github-token}"
STATE_DIR="${KHIF_STATE_DIR:-/var/lib/khif-agent}"
COMMAND_PATH="${KHIF_COMMAND_PATH:-remote/command.json}"
STATUS_PATH="${KHIF_STATUS_PATH:-remote/status/${DEVICE_ID}.json}"
KIOSK_SERVICE="${KHIF_KIOSK_SERVICE:-khif-kiosk.service}"
STATUS_INTERVAL="${KHIF_STATUS_INTERVAL:-30}"
COMMAND_INTERVAL="${KHIF_COMMAND_INTERVAL:-15}"
LAST_COMMAND_FILE="${STATE_DIR}/last-command-id"
API_ROOT="https://api.github.com/repos/${OWNER}/${REPO}/contents"
RAW_ROOT="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}"
mkdir -p "$STATE_DIR"
last_agent_error=""
log(){ printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
now_iso(){ date -u +'%Y-%m-%dT%H:%M:%SZ'; }
read_token(){ tr -d '\r\n' < "$TOKEN_FILE"; }
json_escape(){ printf '%s' "$1"|sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g; s/\r//g; s/\n/ /g'; }
json_get_string(){ local key="$1"; grep -m1 "\"${key}\""|sed -E 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'; }
last_command_id(){ [[ -f "$LAST_COMMAND_FILE" ]]&&cat "$LAST_COMMAND_FILE"||true; }
save_last_command_id(){ printf '%s' "$1">"$LAST_COMMAND_FILE"; }
# Helper function to execute curl and capture errors.
# Usage: _curl_with_error <url> [-X method] [--data-binary file] [-H "header"] ...
# Sets last_agent_error on failure and returns non-zero.
_curl_with_error(){
  local url="" method_arg="" data_binary_arg="" curl_headers=()
  local -a curl_opts=() # Array for storing curl options like -X, --data-binary, -H

  # Parse arguments
  local arg
  while [[ $# -gt 0 ]]; do
    arg="$1"
    case "$arg" in
      -X) method_arg="$arg $2"; curl_opts+=("$arg" "$2"); shift 2;;
      --data-binary) data_binary_arg="$arg $2"; curl_opts+=("$arg" "$2"); shift 2;;
      -H) curl_opts+=("$arg" "$2"); shift 2;;
      *) url="$arg"; shift;; # Assume the remaining argument is the URL
    esac
  done

  local curl_cmd_output curl_cmd_stderr curl_exit_code
  last_agent_error=""
  curl_cmd_output=$(mktemp)
  curl_cmd_stderr=$(mktemp)

  # Execute curl with collected options
  curl -fsS "${curl_opts[@]}" "$url" > "$curl_cmd_output" 2> "$curl_cmd_stderr"
  curl_exit_code=$?

  if [[ $curl_exit_code -ne 0 ]]; then
    local err_msg=$(cat "$curl_cmd_stderr")
    last_agent_error="curl error ($curl_exit_code): ${err_msg:-No details for $url}"
    rm -f "$curl_cmd_output" "$curl_cmd_stderr"
    return 1
  fi
  cat "$curl_cmd_output"
  rm -f "$curl_cmd_output" "$curl_cmd_stderr"
  return 0
}
api_get_file(){
  local path="$1" token
  token="$(read_token)" || { last_agent_error="Failed to read token file: $TOKEN_FILE"; return 1; }
  _curl_with_error "${API_ROOT}/${path}" -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${token}" -H "X-GitHub-Api-Version: 2022-11-28"
}
api_put_json_file(){
  local path="$1" json_file="$2" token sha content body_file api_response
  token="$(read_token)" || { last_agent_error="Failed to read token file: $TOKEN_FILE"; return 1; }
  api_response="$(api_get_file "$path")"
  local get_file_status=$?
  
  # If api_get_file failed and it's not a "Not Found" error, we should probably stop.
  # A 404 is acceptable for a new file.
  if [[ $get_file_status -ne 0 ]]; then
    if ! printf '%s' "$last_agent_error" | grep -q 'Not Found'; then
      log "Error getting SHA for $path, proceeding with create: $last_agent_error"
      # Do not return here, allow the PUT operation to proceed with an empty SHA
    else
      last_agent_error="" # Clear 404 Not Found error as it's expected for create
    fi
  else
    sha="$(printf '%s' "$api_response"|sed -nE 's/.*"sha"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p'|head -n1)"
  fi

  content="$(base64 -w 0 "$json_file")"
  body_file="$(mktemp)"
  if [[ -n "$sha" ]]; then
    echo "{\"message\":\"Update ${path} from ${DEVICE_ID}\",\"content\":\"${content}\",\"sha\":\"${sha}\",\"branch\":\"${BRANCH}\"}" > "$body_file"
  else
    echo "{\"message\":\"Create ${path} from ${DEVICE_ID}\",\"content\":\"${content}\",\"branch\":\"${BRANCH}\"}" > "$body_file"
  fi
  _curl_with_error "${API_ROOT}/${path}" -X PUT --data-binary "$body_file" -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${token}" -H "X-GitHub-Api-Version: 2022-11-28" -H "Content-Type: application/json"
  local put_status=$?
  rm -f "$body_file"
  return $put_status
}
fetch_command_json(){
  _curl_with_error "${RAW_ROOT}/${COMMAND_PATH}?t=$(date +%s)"
}
uptime_seconds(){ awk '{print int($1)}' /proc/uptime 2>/dev/null||printf '0'; }
temperature_c(){ if [[ -r /sys/class/thermal/thermal_zone0/temp ]]; then awk '{printf "%.1f",$1/1000}' /sys/class/thermal/thermal_zone0/temp; elif command -v vcgencmd >/dev/null 2>&1; then vcgencmd measure_temp 2>/dev/null|sed -E "s/.*=([0-9.]+).*/\1/"; else printf ''; fi; }
browser_status(){ if pgrep -af 'chromium|chromium-browser|chrome' >/dev/null 2>&1; then printf 'running'; else printf 'not-running'; fi; }
write_status(){
  local last_command="${1:-}" last_result="${2:-}" last_error_arg="${3:-}"
  local status_file hostname uptime temp browser last_id temp_json current_error="${last_agent_error:-$last_error_arg}"
  status_file="$(mktemp)"
  hostname="$(hostname 2>/dev/null||printf '-')"
  uptime="$(uptime_seconds)"
  temp="$(temperature_c)"
  browser="$(browser_status)"
  last_id="$(last_command_id)"
  [[ -n "$temp" ]]&&temp_json="$temp"||temp_json="null"
  cat > "$status_file" <<EOF
{"deviceId":"$(json_escape "$DEVICE_ID")","status":"online","lastSeen":"$(now_iso)","hostname":"$(json_escape "$hostname")","uptimeSeconds":${uptime:-0},"temperatureC":${temp_json},"browser":"$(json_escape "$browser")","currentUrl":"https://msj33.github.io/khif-info/","lastCommandId":"$(json_escape "$last_id")","lastCommand":"$(json_escape "$last_command")","lastCommandResult":"$(json_escape "$last_result")","lastError":"$(json_escape "$current_error")"}
EOF
  last_agent_error="" # Clear error after reporting
  api_put_json_file "$STATUS_PATH" "$status_file"
  local put_status=$?
  rm -f "$status_file"
  return $put_status
}
restart_browser(){ if systemctl restart "$KIOSK_SERVICE" >/dev/null 2>&1; then printf 'ok: systemctl restart %s' "$KIOSK_SERVICE"; return 0; fi; pkill -f 'chromium|chromium-browser|chrome' >/dev/null 2>&1||true; printf 'ok: chromium process signalled'; }
reload_page(){ if command -v xdotool >/dev/null 2>&1; then DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority xdotool key --clearmodifiers F5 >/dev/null 2>&1&&{ printf 'ok: F5 sent'; return 0; }; fi; restart_browser; }
execute_command(){
  case "$1" in
    none) printf 'ignored: none';;
    reload-page) reload_page;;
    restart-browser) restart_browser;;
    reboot-pi)
      write_status "reboot-pi" "ok: rebooting" ""
      /sbin/reboot >/dev/null 2>&1||systemctl reboot >/dev/null 2>&1
      printf 'ok: reboot requested';;
    *) return 2;;
  esac
}
check_command(){
  local json command_id command device_id expires_at last_id result now_epoch exp_epoch
  json="$(fetch_command_json)"
  local fetch_status=$?
  if [[ $fetch_status -ne 0 ]]; then
    log "Command fetch failed: $last_agent_error"
    write_status "" "" "$last_agent_error" # Report this fetch error
    return 1
  fi
  [[ -z "$json" ]]&&return 0 # No command content
  command_id="$(printf '%s\n' "$json"|json_get_string id)"
  device_id="$(printf '%s\n' "$json"|json_get_string deviceId)"
  command="$(printf '%s\n' "$json"|json_get_string command)"
  expires_at="$(printf '%s\n' "$json"|json_get_string expiresAt)"
  last_id="$(last_command_id)"

  [[ -z "$command_id"||"$command_id" == "initial"||"$command_id" == "$last_id" ]]&&return 0
  [[ "$device_id" != "$DEVICE_ID"&&"$device_id" != "all" ]]&&return 0

  if [[ -n "$expires_at" ]]; then
    now_epoch="$(date -u +%s)"
    exp_epoch="$(date -u -d "$expires_at" +%s 2>/dev/null||printf '0')"
    if [[ "$exp_epoch" != "0"&&"$now_epoch" -gt "$exp_epoch" ]]; then
      save_last_command_id "$command_id"
      write_status "$command" "expired" "Command expired"
      return 0
    fi
  fi

  case "$command" in
    none|reload-page|restart-browser|reboot-pi)
      result="$(execute_command "$command" 2>&1)"
      save_last_command_id "$command_id"
      write_status "$command" "$result" ""
      ;;
    *)
      save_last_command_id "$command_id"
      write_status "$command" "rejected" "Command not allowed: ${command}"
      ;;
  esac
  return 0
}
main(){
  if [[ ! -r "$TOKEN_FILE" ]]; then
    log "Token file missing or unreadable: $TOKEN_FILE"
    last_agent_error="Token file missing or unreadable"
    # Attempt to write a status with this critical error, but don't retry endlessly if that fails too
    write_status "" "" "$last_agent_error" || true
    exit 1
  fi
  local last_status=0 now
  while true; do
    check_command
    now="$(date +%s)"
    if (( now-last_status >= STATUS_INTERVAL )); then
      write_status "" "" ""
      local status_write_status=$?
      if [[ $status_write_status -ne 0 ]]; then
        log "Status update failed: $last_agent_error"
        # The error is already captured in last_agent_error from api_put_json_file
        # No need to call write_status again with the error as it would cause recursion
      fi
      last_status="$now"
    fi
    sleep "$COMMAND_INTERVAL"
  done
}
main "$@"
