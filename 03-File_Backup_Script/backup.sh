#!/usr/bin/env bash
# File Backup Script
# Usage: ./backup.sh [SOURCE_DIR] [BACKUP_DIR]
# Creates a timestamped compressed tar.gz archive of SOURCE_DIR in BACKUP_DIR.

set -Eeuo pipefail
IFS=$'\n\t'

SOURCE_DIR="${1:-"$HOME/Documents"}"
BACKUP_DIR="${2:-"$HOME/backups"}"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || printf 'computer')"
ARCHIVE_NAME="${HOSTNAME_SHORT}_backup_${TIMESTAMP}.tar.gz"
LOG_FILE="${BACKUP_DIR%/}/backup.log"

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

if [[ ! -d "$SOURCE_DIR" ]]; then
    printf 'Error: source directory does not exist: %s\n' "$SOURCE_DIR" >&2
    exit 1
fi

# Resolve paths to reduce surprises when relative paths are provided.
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd -P)"
mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
LOG_FILE="$BACKUP_DIR/backup.log"
ARCHIVE_PATH="$BACKUP_DIR/$ARCHIVE_NAME"

# Avoid recursively backing up the backup directory into itself.
case "$BACKUP_DIR/" in
    "$SOURCE_DIR/"*)
        printf 'Error: backup directory must not be inside the source directory.\n' >&2
        exit 1
        ;;
esac

log "Starting backup: $SOURCE_DIR -> $ARCHIVE_PATH"
if tar -czf "$ARCHIVE_PATH" -C "$(dirname "$SOURCE_DIR")" "$(basename "$SOURCE_DIR")"; then
    log "Backup completed successfully: $ARCHIVE_PATH"
else
    status=$?
    rm -f "$ARCHIVE_PATH"
    log "ERROR: backup failed (exit status $status)"
    exit "$status"
fi
