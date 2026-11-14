@echo off
REM Edit the password below before running
set ADMIN_PASSWORD=ChangeMe@2026
set PORT=3000
cd /d %~dp0
node server.js
pause
