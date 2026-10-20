@echo off
chcp 65001 >nul 2>&1
title Huanaer - Update GitHub Token
cd /d "%~dp0"
echo.
echo   ==========================================
echo     Update GitHub token
echo   ==========================================
echo.
echo   1) Copy your token in GitHub first:
echo      Settings - Developer settings - Personal access tokens
echo      Repository access: Only select repositories - check where-i-paid
echo      Permissions - Contents: Read and write
echo.
echo   2) When the token is in your clipboard, press any key here.
echo.
pause >nul

where node >nul 2>&1
if errorlevel 1 goto none

node "_tools\set-github-token.js"
if errorlevel 1 goto failed
echo.
echo   Done.
pause
exit /b 0

:none
echo.
echo   [ERROR] Node.js not found. Install it from https://nodejs.org
echo.
pause
exit /b 1

:failed
echo.
echo   [STOPPED] Fix the message above and run this file again.
echo.
pause
exit /b 1
