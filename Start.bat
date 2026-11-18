@echo off
cd /d "%~dp0"
if not exist "rPDU Power v1.html" (
  echo The single-file app is missing. From this folder run: npm run pack
  pause
  exit /b 1
)
start "" "rPDU Power v1.html"
