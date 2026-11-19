@echo off
setlocal
chcp 936 >nul
title pet-buddy __VER__ 一键安装
echo ==================================================
echo    余额宠物·大肥鱼 pet-buddy __VER__ 一键安装（单文件版）
echo ==================================================
echo.
set "TMPZIP=%TEMP%\pet-buddy-pkg-%RANDOM%%RANDOM%.zip"
set "TMPDIR=%TEMP%\pet-buddy-pkg-%RANDOM%%RANDOM%"
echo [1/3] 解出安装文件...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0');$i=$t.LastIndexOf('::==PAYLOAD==');if($i -lt 0){exit 1};$b=$t.Substring($i+13);$b=($b -replace '[^A-Za-z0-9+/=]','');[IO.File]::WriteAllBytes('%TMPZIP%',[Convert]::FromBase64String($b))"
if errorlevel 1 goto fail
echo [2/3] 展开到临时目录...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%TMPZIP%' -DestinationPath '%TMPDIR%' -Force"
if errorlevel 1 goto fail
echo [3/3] 开始安装...
powershell -NoProfile -ExecutionPolicy Bypass -File "%TMPDIR%\install-plugin.ps1" -Source "%TMPDIR%\pet-buddy"
set RC=%ERRORLEVEL%
if not "%RC%"=="0" goto fail
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item '%TMPZIP%' -Force -ErrorAction SilentlyContinue; Remove-Item '%TMPDIR%' -Recurse -Force -ErrorAction SilentlyContinue" >nul 2>nul
echo.
echo 安装完成！现在切到助手窗口，按 F5 刷新即可看到桌宠。
echo.
pause
exit /b 0
:fail
echo.
echo 安装失败：把上面的提示截图发给管理员；也可以改用压缩包版（解压后双击里面的「安装.cmd」）。
echo.
pause
exit /b 1
::==PAYLOAD==
