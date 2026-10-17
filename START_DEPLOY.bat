@echo off
rem Starts the ERP on this computer (checks the configuration, builds the app when needed).
rem First-time setup:  START_DEPLOY.bat -InstallAutoStart -InstallBackup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\start-backend.ps1" %*
if errorlevel 1 (
  echo The ERP did not start. Read the messages above or logs\backend-service.log.
  pause
  exit /b 1
)
echo The ERP is running in the background. You can close this window.
