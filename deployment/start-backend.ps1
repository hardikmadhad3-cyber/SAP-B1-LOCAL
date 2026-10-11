param([switch]$InstallAutoStart)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run-backend.ps1'
$backend = Join-Path $root 'backend'
$taskName = 'SAP B1 Deploy 5002 Auto Start'
$port = 5002
$envFile = Join-Path $root 'backend\.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing backend configuration: $envFile"
}
if (-not ((Get-Content -LiteralPath $envFile) -match '^\s*PORT\s*=\s*5002\s*$')) {
  throw 'The deployed backend must have PORT=5002.'
}

$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
if ($InstallAutoStart) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $action = New-ScheduledTaskAction -Execute $node -Argument 'server.js' -WorkingDirectory $backend
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts the SAP B1 deployment on port 5002 in the background at logon.' -Force | Out-Null
  Write-Host "Registered auto-start task: $taskName"
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') {
      Write-Host "Backend already ready: http://localhost:$port"
      exit 0
    }
  } catch { }
  throw "Port $port is already in use by PID $($listener[0].OwningProcess). Stop that process before starting this deployment."
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  if ($task.State -ne 'Running') {
    Start-ScheduledTask -TaskName $taskName
  }
} else {
  Start-Process -FilePath 'powershell.exe' -ArgumentList $actionArgs -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

$url = "http://127.0.0.1:$port/health"
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri $url -TimeoutSec 2
    if ($health.status -eq 'ok') {
      Write-Host "Backend ready: http://localhost:$port"
      exit 0
    }
  } catch { }
}

throw "Backend did not pass $url. Check logs\backend-service.log."
