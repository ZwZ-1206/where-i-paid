@echo off
chcp 936 >nul 2>&1
title 花哪儿了 · 打包发布
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>&1
if not errorlevel 1 goto havenode
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  goto havenode
)
echo.
echo   未检测到 Node.js，无法打包。
echo   请先安装 Node.js（https://nodejs.org）。
echo.
pause
exit /b 1

:havenode
chcp 65001 >nul 2>&1
"%NODE%" "%~dp0build-dist.js"
chcp 936 >nul 2>&1

echo   已打开 dist 文件夹，把它整个拖到托管平台即可。
echo.
start "" "%~dp0dist"
pause