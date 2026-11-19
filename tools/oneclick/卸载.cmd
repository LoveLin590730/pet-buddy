@echo off
setlocal
chcp 936 >nul
title pet-buddy –∂‘ÿ
cd /d "%~dp0"
echo ==================================================
echo    ”‡∂Ó≥ËŒÔ°§¥Û∑ ”„ pet-buddy  –∂‘ÿ
echo ==================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-plugin.ps1" -Uninstall
echo.
pause
