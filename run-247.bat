@echo off
title Gonest International Appointment Scheduler - 24/7 watchdog
cd /d %~dp0
:loop
echo [%date% %time%] Starting server... >> server-restart.log
node server.js
echo [%date% %time%] Server exited - restarting in 2 seconds... >> server-restart.log
timeout /t 2 /nobreak >nul
goto loop