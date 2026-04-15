#!/bin/bash
# 스왑 2GB 설정 (OOM 방지). 한 번만 실행 후 재부팅해도 유지됩니다.
# 실행: sudo bash scripts/setup-swap.sh

set -e
SWAPFILE="${SWAPFILE:-/swapfile}"
SIZE="${SWAP_SIZE_MB:-2048}"

if [ -f "$SWAPFILE" ] && grep -q "$SWAPFILE" /proc/swaps 2>/dev/null; then
  echo "Swap already active: $SWAPFILE"
  swapon --show
  exit 0
fi

echo "Creating ${SIZE}MB swap file at $SWAPFILE ..."
if [ -f "$SWAPFILE" ]; then
  echo "File exists, skipping fallocate."
else
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l "${SIZE}M" "$SWAPFILE"
  else
    dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SIZE" status=progress
  fi
fi
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"
echo "Swap enabled."
swapon --show
free -h

if ! grep -q "^$SWAPFILE " /etc/fstab 2>/dev/null; then
  echo "Adding $SWAPFILE to /etc/fstab for persistence..."
  echo "$SWAPFILE none swap sw 0 0" | tee -a /etc/fstab
fi
echo "Done. Swap will persist across reboots."
