@echo off
chcp 65001 >nul 2>&1
title 花哪儿了 · 打包 APK
cd /d "%~dp0"

echo.
echo   ============================================
echo      花哪儿了 · 一键打包 APK
echo   ============================================
echo.

rem ---- 环境变量（装了 JDK / SDK 到别的位置就改这三行）----
rem 三个目录都在 C:\Apps 下，按应用名命名，挪位置只需改这里 + android\local.properties
set "JAVA_HOME=C:\Apps\JDK-17"
set "ANDROID_HOME=C:\Apps\Android-SDK"
set "GRADLE_USER_HOME=C:\Apps\Gradle-Cache"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

if not exist "%JAVA_HOME%\bin\java.exe" (
  echo   [错误] 没找到 JDK 17：%JAVA_HOME%
  echo          装好后改本文件第 12 行，见《花哪儿了-双端打包操作手册.md》第 2 节
  echo.
  pause
  exit /b 1
)

if not exist "%ANDROID_HOME%\platforms" (
  echo   [错误] 没找到 Android SDK：%ANDROID_HOME%
  echo          见《花哪儿了-双端打包操作手册.md》第 2 节
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo   [错误] 没找到 Node.js
  echo.
  pause
  exit /b 1
)

node "%~dp0android\make-apk.js" %*
if errorlevel 1 (
  echo.
  echo   [失败] 打包没成功，看上面的报错。
  echo          对照《花哪儿了-双端打包操作手册.md》第 8~10 节的报错表。
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo     装到手机：
echo       1. 数据线连电脑，手机开「USB 调试」，然后跑：
echo          adb install -r dist-apk\*.apk
echo       2. 或者直接把 dist-apk 里的 apk 发到手机点开安装
echo   ============================================
echo.

if exist "dist-apk" start "" "dist-apk"
pause
