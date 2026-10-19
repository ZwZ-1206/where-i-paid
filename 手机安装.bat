@echo off
chcp 936 >nul 2>&1
title 花哪儿了 · 手机安装助手
cd /d "%~dp0"

echo.
echo   ============================================
echo      花哪儿了 · 手机安装助手
echo   ============================================
echo.
echo   即将生成一个 HTTPS 地址，手机扫码即可安装。
echo   请保持本窗口打开，关闭窗口后地址失效。
echo.
echo   [!] 这是「临时地址」：关掉本窗口后地址就失效了。
echo       装到手机上之后，App 仍能离线记账，但拿不到更新，
echo       也没法把数据导出来。长期使用请先发布到固定网址
echo       （双击 打包发布.bat，把 dist 传到 Cloudflare Pages 等）。
echo.
set "NODE=node"
where node >nul 2>&1
if not errorlevel 1 goto havenode
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  goto havenode
)
echo   [错误] 没找到 Node.js，无法生成安装地址。
echo   请先安装：https://nodejs.org
echo.
pause
exit /b 1

:havenode
if not exist "%~dp0_tools\share.js" (
  echo   [错误] 缺少文件：_tools\share.js
  echo   请确认是在项目根目录里运行这个 bat。
  echo.
  pause
  exit /b 1
)

rem 换成 UTF-8 再启动 node，这样 share.js 输出的框线和二维码才不会乱码
chcp 65001 >nul 2>&1
"%NODE%" "%~dp0_tools\share.js"
chcp 936 >nul 2>&1

echo.
echo   隧道已关闭。
echo.
pause
