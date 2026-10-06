@echo off
REM Bo cai cho may user chi mo https://ddcn.bimonecadvn.com
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CaiDat-MayUser.ps1"
if errorlevel 1 pause
