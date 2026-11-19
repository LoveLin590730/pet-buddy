@echo off
setlocal
chcp 936 >nul
title pet-buddy 一键安装
cd /d "%~dp0"
echo ==================================================
echo    余额宠物·大肥鱼 pet-buddy  一键安装
echo ==================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-plugin.ps1" -Source "%~dp0pet-buddy"
set RC=%ERRORLEVEL%
echo.
if "%RC%"=="0" (
  echo 安装完成！现在切到助手窗口，按 F5 刷新即可看到桌宠。
) else (
  echo 安装没有完成（退出码 %RC%），请看上面的提示。
)
echo.
pause
exit /b %RC%
