#!/usr/bin/env bash
set -uo pipefail

ACTION="$1"

log(){
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

case "$ACTION" in
  on)
    if vcgencmd display_power 1 >/dev/null 2>&1; then
      log "Screen power on: vcgencmd display_power 1"
      exit 0
    fi
    log "Screen power on failed"
    exit 1
    ;;
  off)
    if vcgencmd display_power 0 >/dev/null 2>&1; then
      log "Screen power off: vcgencmd display_power 0"
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
