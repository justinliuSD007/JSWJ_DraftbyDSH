@echo off
chcp 65001 >nul
title 技术文件起草插件安装

rem 优先使用图形安装器；缺失时回退到命令行脚本。
if exist "%~dp0Setup.exe" (
  start "" "%~dp0Setup.exe"
  exit /b 0
)

echo.
echo  未找到 Setup.exe，改用命令行安装。
echo  ----------------------------------------
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "RESULT=%ERRORLEVEL%"

echo.
if not "%RESULT%"=="0" (
  echo 安装未完成，请查看上面的错误信息。
) else (
  echo 安装完成。请重新打开 DSH。
)
echo.
pause
exit /b %RESULT%
