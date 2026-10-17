# Starts the ERP on this computer: one port serves the app and its API to every
# PC on the network. Uses PORT from backend\.env (default 5001).
#   .\deployment\start-backend.ps1                    start now (builds the frontend when needed)
#   .\deployment\start-backend.ps1 -InstallAutoStart  also start it at Windows logon
#   .\deployment\start-backend.ps1 -InstallBackup     also schedule the nightly database backup
param([switch]$InstallAutoStart, [switch]$InstallBackup, [switch]$Rebuild)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run-backend.ps1'
$envFile = Join-Path $root 'backend\.env'
$taskName = 'ERP Server Auto Start'

if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing backend configuration: $envFile (copy backend\.env.example and fill it in)." }
$portLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } | Select-Object -First 1
$port = if ($portLine) { [int]($portLine -replace '\D', '') } else { 5001 }

# Configuration check: refuses to start on problems that would lose or expose data.
Push-Location (Join-Path $root 'backend')
try {
  & node scripts/checkProduction.js
  if ($LASTEXITCODE -ne 0) { throw 'The production check failed; fix the items marked FAIL above.' }
} finally { Pop-Location }

# The app is served from frontend\build: rebuild it when it is missing or older than the source.
$build = Join-Path $root 'frontend\build\index.html'
$newestSource = Get-ChildItem -Path (Join-Path $root 'frontend\src'), (Join-Path $root 'frontend\public') -Recurse -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($Rebuild -or -not (Test-Path $build) -or $newestSource.LastWriteTime -gt (Get-Item $build).LastWriteTime) {
  Write-Host 'Building the frontend (a few minutes)...'
  Push-Location (Join-Path $root 'frontend')
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
  } finally { Pop-Location }
}

if ($InstallAutoStart) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Starts the ERP server on port $port at logon." -Force | Out-Null
  Write-Host "Registered auto-start task: $taskName"
}
if ($InstallBackup) {
  & (Join-Path $PSScriptRoot 'backup-database.ps1') -InstallSchedule
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { Write-Host "ERP already running: http://localhost:$port"; exit 0 }
  } catch { }
  throw "Port $port is already in use by PID $($listener[0].OwningProcess). Stop that process first."
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }
} else {
  Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

for ($attempt = 0; $attempt -lt 60; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') {
      $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object { "http://$($_.IPAddress):$port" }
      Write-Host "ERP running: http://localhost:$port"
      if ($addresses) { Write-Host "From other PCs on the network: $($addresses -join ', ')" }
      exit 0
    }
  } catch { }
}
throw "The ERP did not start on port $port. Check logs\backend-service.log."
