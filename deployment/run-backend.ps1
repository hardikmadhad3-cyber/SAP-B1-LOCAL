$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $root 'backend'
$logDirectory = Join-Path $root 'logs'
$logPath = Join-Path $logDirectory 'backend-service.log'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location $backend

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting backend from $backend" |
  Out-File -FilePath $logPath -Append -Encoding utf8
& node server.js *>> $logPath
exit $LASTEXITCODE
