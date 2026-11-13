@echo off
setlocal

rem シーケンス道場 3D のビルド
rem   build.bat   単一ファイルの exe（.NET 同梱）を artifacts\release に作成する

chcp 65001 >nul

set "ROOT=%~dp0"
set "PROJECT=%ROOT%src\SequenceDojo\SequenceDojo.csproj"
set "PUBLISH_DIR=%ROOT%artifacts\release"
set "EXE_NAME=SequenceDojo.exe"
set "EXE=%PUBLISH_DIR%\%EXE_NAME%"

echo [build] シーケンス道場 3D single-file publish
echo [build] Project: "%PROJECT%"
echo [build] Output : "%EXE%"

where dotnet >nul 2>nul
if errorlevel 1 (
  echo [error] dotnet が見つかりません。.NET 10 SDK をインストールしてください。
  echo [error] https://dotnet.microsoft.com/download/dotnet/10.0
  exit /b 1
)

if exist "%PUBLISH_DIR%" (
  tasklist /FI "IMAGENAME eq %EXE_NAME%" 2>nul | find /I "%EXE_NAME%" >nul
  if not errorlevel 1 (
    echo [error] %EXE_NAME% が起動しています。アプリを終了してから実行してください。
    exit /b 1
  )
)

echo [build] exe を作成しています...
dotnet publish "%PROJECT%" ^
  -c Release ^
  -r win-x64 ^
  --self-contained true ^
  -o "%PUBLISH_DIR%" ^
  --nologo ^
  -p:PublishSingleFile=true ^
  -p:IncludeNativeLibrariesForSelfExtract=true ^
  -p:IncludeAllContentForSelfExtract=true ^
  -p:EnableCompressionInSingleFile=true ^
  -p:DebugType=None ^
  -p:DebugSymbols=false

if errorlevel 1 (
  echo [error] publish に失敗しました。
  exit /b 1
)

if not exist "%EXE%" (
  echo [error] 単一ファイルの exe が作成されていません。
  exit /b 1
)

powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; $zip = Join-Path $env:PUBLISH_DIR 'SequenceDojo-win-x64.zip'; Compress-Archive -LiteralPath @((Join-Path $env:PUBLISH_DIR 'SequenceDojo.exe')) -DestinationPath $zip -Force; $line = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($zip)))).Replace('-', '').ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($zip) + [char]10; [IO.File]::WriteAllText($zip + '.sha256', $line, [Text.UTF8Encoding]::new($false))"
if errorlevel 1 exit /b 1

echo [build] 完了: "%EXE%"
exit /b 0
