#!/usr/bin/env bash
# Installs a daily cron job at 2:00 AM for this backup script.
# Usage: ./install_cron.sh [SOURCE_DIR] [BACKUP_DIR]

set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
SOURCE_DIR="${1:-"$HOME/Documents"}"
BACKUP_DIR="${2:-"$HOME/backups"}"

chmod +x "$BACKUP_SCRIPT"
mkdir -p "$BACKUP_DIR"

# Quote shell arguments for safe use inside the cron command.
printf -v SOURCE_Q '%q' "$SOURCE_DIR"
printf -v BACKUP_Q '%q' "$BACKUP_DIR"
CRON_LINE="0 2 * * * $BACKUP_SCRIPT $SOURCE_Q $BACKUP_Q"

CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
if printf '%s\n' "$CURRENT_CRON" | grep -Fqx "$CRON_LINE"; then
    echo "This cron job is already installed."
    exit 0
fi

{
    printf '%s\n' "$CURRENT_CRON"
    printf '%s\n' "$CRON_LINE"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed daily backup at 2:00 AM."
echo "Source: $SOURCE_DIR"
echo "Destination: $BACKUP_DIR"
echo "To review: crontab -l"
