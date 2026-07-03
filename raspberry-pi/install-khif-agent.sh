#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Kør install script med sudo: sudo ./install-khif-agent.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -d -m 755 /opt/khif-agent
install -d -m 700 /etc/khif-agent
install -d -m 755 /var/lib/khif-agent
install -m 755 "$SCRIPT_DIR/khif-agent.py" /opt/khif-agent/khif-agent.py
install -m 644 "$SCRIPT_DIR/khif-agent.service" /etc/systemd/system/khif-agent.service

if [[ ! -f /etc/khif-agent/github-token ]]; then
  echo "Indsæt GitHub fine-grained token til khif-info repoet."
  echo "Token skal kunne læse/skrive repository contents."
  read -r -s -p "GitHub token: " TOKEN
  echo
  printf "%s" "$TOKEN" > /etc/khif-agent/github-token
  chmod 600 /etc/khif-agent/github-token
else
  echo "Token findes allerede: /etc/khif-agent/github-token"
fi

systemctl daemon-reload
systemctl enable khif-agent.service
systemctl restart khif-agent.service
systemctl status khif-agent.service --no-pager
