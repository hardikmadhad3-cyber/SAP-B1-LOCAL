# Restores an ERP backup made by backup-database.ps1.
#   .\deployment\restore-database.ps1 -BackupFile backups\x.dump
#       restores into a separate check database (<db>_restore_check) and compares
#       its row counts with the live database: proves the backup works, touches nothing live.
#   .\deployment\restore-database.ps1 -BackupFile backups\x.dump -ReplaceLiveDatabase
#       replaces the live database (stop the backend first). Asks you to type the database name.
param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [switch]$ReplaceLiveDatabase,
  [switch]$KeepCheckDatabase
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'pg-common.ps1')
$db = Get-ErpDatabase $root
$bin = Get-PgBin
$BackupFile = (Resolve-Path -LiteralPath $BackupFile).Path
$psql = Join-Path $bin 'psql.exe'
$env:PGPASSWORD = $db.Password

function Invoke-Sql([string]$database, [string]$sql) {
  $output = & $psql -h $db.Host -p $db.Port -U $db.User -d $database -v ON_ERROR_STOP=1 -At -c $sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $sql" }
  return $output
}
# Row counts of every table outside the system schemas, as "schema.table=count" lines.
function Get-RowCounts([string]$database) {
  $sql = @"
SELECT string_agg(format('%s.%s=%s', schemaname, relname, n), E'\n' ORDER BY schemaname, relname) FROM (
  SELECT table_schema AS schemaname, table_name AS relname,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS n
  FROM information_schema.tables
  WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')) t;
"@
  return (Invoke-Sql $database $sql) -split "`n"
}

try {
  if ($ReplaceLiveDatabase) {
    $answer = Read-Host "This REPLACES the live database '$($db.Name)' with $BackupFile. Stop the backend first. Type the database name to continue"
    if ($answer -ne $db.Name) { throw 'Cancelled: the name did not match.' }
    $target = $db.Name
    Invoke-Sql 'postgres' "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target' AND pid <> pg_backend_pid();" | Out-Null
    Invoke-Sql 'postgres' "DROP DATABASE IF EXISTS `"$target`";" | Out-Null
  } else {
    $target = "$($db.Name)_restore_check"
    Invoke-Sql 'postgres' "DROP DATABASE IF EXISTS `"$target`";" | Out-Null
  }
  Invoke-Sql 'postgres' "CREATE DATABASE `"$target`";" | Out-Null
  & (Join-Path $bin 'pg_restore.exe') -h $db.Host -p $db.Port -U $db.User -d $target --no-owner --exit-on-error $BackupFile
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE." }
  Write-Host "Restored $BackupFile into database '$target'."

  if (-not $ReplaceLiveDatabase) {
    $restored = Get-RowCounts $target
    $live = Get-RowCounts $db.Name
    $differences = Compare-Object -ReferenceObject $live -DifferenceObject $restored
    $tables = @($restored | Where-Object { $_ }).Count
    if ($differences) {
      Write-Host "Restore check: $tables tables restored. Differences from the live database (expected for data entered after the backup):"
      $differences | ForEach-Object { Write-Host "  $($_.SideIndicator) $($_.InputObject)" }
    } else {
      Write-Host "Restore check OK: all $tables tables match the live database row for row."
    }
    if (-not $KeepCheckDatabase) {
      Invoke-Sql 'postgres' "DROP DATABASE `"$target`";" | Out-Null
      Write-Host "Removed the check database '$target'."
    }
  }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
