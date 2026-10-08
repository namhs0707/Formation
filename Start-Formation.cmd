@echo off
powershell.exe -NoProfile -File "%~dp0scripts\start-local-server.ps1" -Database formation_ir_demo -Port 3002
pause
