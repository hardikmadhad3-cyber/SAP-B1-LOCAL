@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\start-backend.ps1"
if errorlevel 1 (
  echo Backend failed to start. Check logs\backend-service.log.
  pause
  exit /b 1
)
echo Backend is running in the background. You can close this window.
