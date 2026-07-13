#!/usr/bin/env bash
set -uo pipefail

ACTION="$1"

log(){
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

find_vcgencmd(){
  if command -v vcgencmd >/dev/null 2>&1; then
    command -v vcgencmd
  elif [[ -x /opt/vc/bin/vcgencmd ]]; then
    printf '%s' '/opt/vc/bin/vcgencmd'
  elif [[ -x /usr/bin/vcgencmd ]]; then
    printf '%s' '/usr/bin/vcgencmd'
  else
    return 1
  fi
}

vcgencmd=$(find_vcgencmd) || {
  log "vcgencmd not found"
  echo "vcgencmd not found"
  exit 1
}

case "$ACTION" in
  on)
    if "$vcgencmd" display_power 1 >/dev/null 2>&1; then
      log "Screen power on: $vcgencmd display_power 1"
      exit 0
    fi
    log "Screen power on failed"
    exit 1
    ;;
  off)
    if "$vcgencmd" display_power 0 >/dev/null 2>&1; then
      log "Screen power off: $vcgencmd display_power 0"
      exit 0
    fi
    log "Screen power off failed"
    exit 1
    ;;
  *)
    log "Usage: $0 on|off"
    echo "Usage: $0 on|off"
    exit 2
    ;;
esac
