@echo off
rem 开发机：一条命令走完 构建 -^> 自检 -^> 同步插件目录 -^> 打两种包
rem 控制台用 UTF-8（node 与 PowerShell 都输出 UTF-8 中文），所以本文件保存为 UTF-8 无 BOM
chcp 65001 >nul
setlocal
title pet-buddy 构建并同步
cd /d "%~dp0"
echo ============================================================
echo   pet-buddy 一键构建：构建 -^> 自检 -^> 同步插件目录 -^> 打两种包
echo   （开发机用，需要 node 在 PATH 上；普通同事装机请看 dist\ 里的一键安装包）
echo ============================================================
echo.
echo [1/5] 构建产物        node build.mjs
node build.mjs || goto fail
echo.
echo [2/5] 离线自检        node tools\smoke.mjs
node tools\smoke.mjs || goto fail
echo.
echo [3/5] 同步插件目录    tools\install.ps1 -WithAssets
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install.ps1 -WithAssets || goto fail
echo.
echo [4/5] 标准发布包      tools\pack.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\pack.ps1 || goto fail
echo.
echo [5/5] 一键安装包      tools\pack-oneclick.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\pack-oneclick.ps1 || goto fail
echo.
echo 全部完成：产物在 dist\ 下，插件已同步。请到助手窗口按 F5 刷新。
echo.
pause
exit /b 0
:fail
echo.
echo 有步骤失败（退出码 %ERRORLEVEL%），请看上面的输出。
echo.
pause
exit /b 1
