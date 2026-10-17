# Backs up the ERP: the whole PostgreSQL database from backend/.env DATABASE_URL
# (every company schema plus users, roles and settings) and the attachment files.
#   .\deployment\backup-database.ps1                    one backup now
#   .\deployment\backup-database.ps1 -InstallSchedule   also run it every night at 23:00
# Backups go to <project>\backups (or -BackupDir), are checked after writing, and
# are kept for -KeepDays days. Log: logs\backup.log.
param(
  [string]$BackupDir = '',
  [int]$KeepDays = 30,
  [switch]$InstallSchedule,
  [string]$ScheduleTime = '23:00'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $BackupDir) { $BackupDir = Join-Path $root 'backups' }
$logPath = Join-Path $root 'logs\backup.log'
New-Item -ItemType Directory -Force -Path $BackupDir, (Split-Path $logPath) | Out-Null
function Write-Log($message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
  $line | Out-File -FilePath $logPath -Append -Encoding utf8
  Write-Host $line
}

. (Join-Path $PSScriptRoot 'pg-common.ps1')
$db = Get-ErpDatabase $root
$bin = Get-PgBin

if ($InstallSchedule) {
  $taskName = 'ERP Nightly Backup'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -BackupDir `"$BackupDir`" -KeepDays $KeepDays"
  $trigger = New-ScheduledTaskTrigger -Daily -At $ScheduleTime
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Nightly backup of the ERP database and attachments.' -Force | Out-Null
  Write-Log "Scheduled '$taskName' daily at $ScheduleTime (runs when this Windows user is logged on; missed runs start at next logon)."
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$dumpPath = Join-Path $BackupDir "$($db.Name)_$stamp.dump"
$env:PGPASSWORD = $db.Password
try {
  Write-Log "Backing up database $($db.Name) on $($db.Host):$($db.Port) to $dumpPath"
  & (Join-Path $bin 'pg_dump.exe') -h $db.Host -p $db.Port -U $db.User -d $db.Name -Fc -Z 6 -f $dumpPath
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE." }

  # A backup that cannot be read is not a backup: list its contents.
  $entries = & (Join-Path $bin 'pg_restore.exe') --list $dumpPath
  if ($LASTEXITCODE -ne 0 -or -not $entries) { throw "The backup file $dumpPath cannot be read." }
  $tables = ($entries | Select-String -Pattern ' TABLE DATA ').Count
  Write-Log "Database backup OK: $([math]::Round((Get-Item $dumpPath).Length / 1MB, 2)) MB, $tables tables with data."

  $uploads = Join-Path $root 'backend\uploads'
  $files = Get-ChildItem -Path $uploads -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\tmp\\' }
  if ($files) {
    $zipPath = Join-Path $BackupDir "attachments_$stamp.zip"
    Compress-Archive -Path (Join-Path $uploads '*') -DestinationPath $zipPath -Force
    Write-Log "Attachments backup OK: $($files.Count) files to $zipPath"
  }

  $cutoff = (Get-Date).AddDays(-$KeepDays)
  Get-ChildItem -Path $BackupDir -File | Where-Object { $_.Name -match '\.(dump|zip)$' -and $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force
    Write-Log "Removed backup older than $KeepDays days: $($_.Name)"
  }
} catch {
  Write-Log "BACKUP FAILED: $($_.Exception.Message)"
  throw
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
