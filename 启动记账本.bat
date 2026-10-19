@echo off
chcp 936 >nul 2>&1
title 花哪儿了 · 本地服务器
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>&1
if not errorlevel 1 goto havenode
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  goto havenode
)
echo.
echo   未检测到 Node.js。
echo   请先安装 Node.js（https://nodejs.org），或直接双击 index.html 使用。
echo.
pause
exit /b 1

:havenode
echo.
echo   正在启动「花哪儿了」...
echo   启动后浏览器会自动打开，手机可用同一 Wi-Fi 访问终端里显示的地址。
echo.

start "" http://localhost:4173
"%NODE%" "%~dp0server.js"

echo.
pause