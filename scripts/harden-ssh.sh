#!/bin/bash
# SSH hardening (Ubuntu/OpenSSH) - key-only login + root login disabled + safer defaults
# Usage:
#   sudo bash /home/young-dev/AIM/scripts/harden-ssh.sh
#
# Safety:
# - Refuses to proceed if target user's authorized_keys is missing (unless FORCE=1)
# - Writes a drop-in config under /etc/ssh/sshd_config.d/
# - Validates sshd config with `sshd -t` before restarting ssh service
#
# Rollback:
#   sudo rm -f /etc/ssh/sshd_config.d/99-aim-hardening.conf
#   sudo systemctl restart ssh

set -euo pipefail

TARGET_USER="${TARGET_USER:-young-dev}"
DROP_IN_DIR="/etc/ssh/sshd_config.d"
DROP_IN_FILE="${DROP_IN_DIR}/99-aim-hardening.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: Please run as root (use sudo)." >&2
  exit 1
fi

if ! command -v sshd >/dev/null 2>&1; then
  echo "ERROR: sshd not found." >&2
  exit 1
fi

AUTH_KEYS="/home/${TARGET_USER}/.ssh/authorized_keys"
if [[ "${FORCE:-0}" != "1" ]]; then
  if [[ ! -s "${AUTH_KEYS}" ]]; then
    echo "ERROR: ${AUTH_KEYS} not found or empty." >&2
    echo "Refusing to disable password login (to avoid locking you out)." >&2
    echo "Add your SSH public key to ${AUTH_KEYS} then re-run, or run with FORCE=1 if you know what you're doing." >&2
    exit 1
  fi
fi

mkdir -p "${DROP_IN_DIR}"

cat > "${DROP_IN_FILE}" <<'EOF'
# Managed by AIM/scripts/harden-ssh.sh
# Keep changes in a drop-in file for easy rollback.

# Key-based authentication only
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no

# Block direct root login
PermitRootLogin no

# Reduce brute-force surface
MaxAuthTries 3
MaxSessions 5

# Idle connection cleanup
ClientAliveInterval 300
ClientAliveCountMax 2

# Forwarding off by default (enable only if needed)
X11Forwarding no
AllowTcpForwarding no
GatewayPorts no

# Don't leak user lists
PermitEmptyPasswords no

# Some images (cloud-init) may enable password auth in a Match block.
# A global setting cannot override a previous Match; so we also force in Match all.
Match all
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  ChallengeResponseAuthentication no
EOF

# Validate config before restart
if ! sshd -t; then
  echo "ERROR: sshd config validation failed. Not restarting SSH." >&2
  exit 1
fi

# Restart SSH safely (service name is 'ssh' on Ubuntu)
systemctl restart ssh
systemctl --no-pager --full status ssh | sed -n '1,30p' || true

echo "OK: SSH hardening applied via ${DROP_IN_FILE}"
echo "Tip: Keep your current session open and verify a NEW SSH login works before closing this session."

