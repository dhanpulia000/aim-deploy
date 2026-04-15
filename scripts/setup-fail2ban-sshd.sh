#!/bin/bash
# Install + configure fail2ban for sshd on Ubuntu
# Usage:
#   sudo bash /home/young-dev/AIM/scripts/setup-fail2ban-sshd.sh
#
# This sets a conservative sshd jail to block brute-force attempts.

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: Please run as root (use sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y fail2ban

mkdir -p /etc/fail2ban

cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port = ssh
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
ignoreip = 127.0.0.1/8 ::1
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban
fail2ban-client status sshd || true
echo "OK: fail2ban enabled for sshd"

