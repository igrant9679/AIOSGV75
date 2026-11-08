@echo off
rem Builds dist\MissionControlSetup.exe (see build-installer.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1"
