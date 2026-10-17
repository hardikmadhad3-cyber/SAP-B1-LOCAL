# Runs the ERP server (backend + built frontend on one port) and restarts it if it
# stops unexpectedly. Output goes to logs\backend-service.log.
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $root 'backend'
$logDirectory = Join-Path $root 'logs'
$logPath = Join-Path $logDirectory 'backend-service.log'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location $backend
$env:NODE_ENV = 'production'

$restarts = 0
while ($true) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting ERP server from $backend" | Out-File -FilePath $logPath -Append -Encoding utf8
  $started = Get-Date
  & node server.js *>> $logPath
  $code = $LASTEXITCODE
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERP server stopped with exit code $code" | Out-File -FilePath $logPath -Append -Encoding utf8
  # A run that lasted a while resets the counter; repeated quick crashes back off up to a minute.
  if (((Get-Date) - $started).TotalMinutes -gt 5) { $restarts = 0 } else { $restarts += 1 }
  Start-Sleep -Seconds ([math]::Min(60, 2 * [math]::Pow(2, [math]::Min($restarts, 5))))
}
