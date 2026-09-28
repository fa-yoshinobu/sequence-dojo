@echo off
rem Build and start the app (window app)
cd /d %~dp0
dotnet build src\SequenceDojo -c Release -v q -nologo
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "src\SequenceDojo\bin\Release\net9.0-windows\SequenceDojo.exe"
