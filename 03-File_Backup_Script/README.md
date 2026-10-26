Run these commands in Git Bash:
mkdir test_backup
echo "This is my sample file" > ./test_backup/example.txt

Now run the backup script, replacing the path below with your actual project location:
bash backup.sh backup_source backups

# Project-3: File Backup Script

A simple Bash project that creates timestamped, compressed backups of a directory using `tar.gz` and can schedule backups daily with `cron`.

## Features

- Creates a compressed `.tar.gz` archive.
- Adds a timestamp to each backup filename.
- Writes activity and error messages to `backup.log`.
- Accepts source and destination directories as command-line arguments.
- Includes a helper script to schedule a daily backup at 2:00 AM.
- Checks that the source directory exists and prevents the backup directory from being inside the source directory.

## Requirements

- Linux or another Unix-like environment with Bash, `tar`, and `cron`/`crontab`.
- On some systems, the cron service may need to be enabled by an administrator.

## Files

- `backup.sh` — performs the backup.
- `install_cron.sh` — installs the daily cron job.
- `README.md` — instructions and examples.

## 1. Run a backup manually

From the project directory:

```bash
chmod +x backup.sh install_cron.sh
./backup.sh "$HOME/Documents" "$HOME/backups"
```

If arguments are omitted, the script uses `~/Documents` as the source and `~/backups` as the destination:

```bash
./backup.sh
```

The destination will contain timestamped archives such as:

```text
computer_backup_2026-10-20_02-00-00.tar.gz
backup.log
```

Change `computer` to the machine's short hostname in actual filenames.

## 2. Schedule backups with cron

Install a daily job at 2:00 AM:

```bash
./install_cron.sh "$HOME/Documents" "$HOME/backups"
```

Check installed jobs:

```bash
crontab -l
```

Remove or edit the job with:

```bash
crontab -e
```

The installer avoids adding the exact same cron line twice. Cron uses the machine's local time zone. Make sure the computer is on and the cron service is running at the scheduled time.

## 3. Verify a backup

List the archive contents without extracting:

```bash
tar -tzf "$HOME/backups"/computer_backup_*.tar.gz
```

Use the exact archive filename if multiple backups exist. To extract an archive into a chosen directory:

```bash
mkdir -p "$HOME/restore-test"
tar -xzf "$HOME/backups/your_backup_filename.tar.gz" -C "$HOME/restore-test"
```

## Notes and limitations

- Test with non-critical files before relying on this for important data.
- This project keeps every timestamped archive and does not automatically delete old backups, so monitor disk space.
- A backup is not a substitute for a restore test or an off-device copy.
- If a source path contains unusual shell characters, pass it as a quoted argument when running the script.
- Do not place the backup destination inside the source directory.

## Example

```bash
mkdir -p demo/source demo/backups
echo "Hello backup" > demo/source/example.txt
./backup.sh "$PWD/demo/source" "$PWD/demo/backups"
tar -tzf demo/backups/*.tar.gz
```

How to run the project

1. Download and extract the ZIP file.
2. Open a terminal in the extracted project folder.
3. Make the scripts executable:
   chmod +x backup.sh install_cron.sh
4. Run a backup:
   ./backup.sh "$HOME/Documents" "$HOME/backups"
5. Schedule daily automatic backups:
   ./install_cron.sh "$HOME/Documents" "$HOME/backups"
