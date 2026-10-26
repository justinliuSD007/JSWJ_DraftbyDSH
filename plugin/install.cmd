@echo off
chcp 65001 >nul
title 技术文件起草插件安装

echo.
echo  技术文件起草（JSWJ_DraftbyDSH）安装器
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
