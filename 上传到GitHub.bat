@echo off
chcp 65001 >nul 2>&1
title 花哪儿了 · 上传到 GitHub
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto none

node "_tools\upload-github.js" %*
if errorlevel 1 goto failed
pause
exit /b 0

:none
echo.
echo   [错误] 没找到 Node.js
echo          装一个：https://nodejs.org
echo.
pause
exit /b 1

:failed
echo.
echo   [已中止] 按上面提示处理后重跑本脚本即可。
echo.
pause
exit /b 1
