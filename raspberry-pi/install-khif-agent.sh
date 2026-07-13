#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Kør install script med sudo: sudo ./install-khif-agent.sh"; exit 1; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v curl >/dev/null 2>&1; then echo "Installerer curl..."; apt-get update; apt-get install -y curl ca-certificates; fi
install -d -m 755 /opt/khif-agent
install -d -m 700 /etc/khif-agent
install -d -m 755 /var/lib/khif-agent
install -m 755 "$SCRIPT_DIR/khif-agent.sh" /opt/khif-agent/khif-agent.sh
install -m 755 "$SCRIPT_DIR/screen-power.sh" /opt/khif-agent/screen-power.sh
install -m 755 "$SCRIPT_DIR/khif-agent-schedule.sh" /opt/khif-agent/khif-agent-schedule.sh
install -m 644 "$SCRIPT_DIR/khif-agent.service" /etc/systemd/system/khif-agent.service
if ! command -v python3 >/dev/null 2>&1; then
  echo "Installerer python3..."
  apt-get update
  apt-get install -y python3
fi
if [[ ! -f /etc/khif-agent/github-token ]]; then echo "Indsæt GitHub fine-grained token til khif-info repoet."; echo "Token skal kunne læse/skrive repository contents."; read -r -s -p "GitHub token: " TOKEN; echo; printf "%s" "$TOKEN" > /etc/khif-agent/github-token; chmod 600 /etc/khif-agent/github-token; else echo "Token findes allerede: /etc/khif-agent/github-token"; fi
systemctl daemon-reload
systemctl enable khif-agent.service
systemctl restart khif-agent.service
/opt/khif-agent/khif-agent-schedule.sh
systemctl status khif-agent.service --no-pager
