# ビルド・開発

アプリの操作は [操作方法](usage.md)、GitHub Releases への公開は [リリース手順](releasing.md) を参照してください。

## 必要な環境

- Windows 10 / 11
- [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0)
- Git（以下のソース取得コマンドを使う場合）

## ソースの取得

PowerShell で実行します。以降のコマンドも、リポジトリのルートで実行してください。

```powershell
git clone https://github.com/fa-yoshinobu/sequence-dojo.git
cd sequence-dojo
```

## 開発中の起動

```powershell
.\run.bat
```

Release 構成でビルドして、アプリのウィンドウを開きます（出力先は `src\SequenceDojo\bin\Release\net9.0-windows`）。
画面のファイル（`src\SequenceDojo\wwwroot`）を編集したら、アプリを閉じて `run.bat` で起動し直してください。

## 配布用 EXE の作成

```powershell
.\build.bat
```

Windows x64 向けの単一ファイル EXE を作成します。出力先は `publish\win-x64-single` で、次の 1 ファイルだけを配置します。

```text
publish/win-x64-single/
└─ SequenceDojo.exe
```

EXE は .NET ランタイムと画面ファイルを含む単一ファイル（約 60 MB）です。配布先に .NET のインストールは不要です。
起動時に中身を一時フォルダへ展開するので、初回起動は少し時間がかかります。

起動中の `SequenceDojo.exe` がある場合はビルドを中止します。アプリを閉じてから、同じコマンドを再実行してください。出力先は毎回作り直します。

## 検査スクリプトのテスト

リリース時の VirusTotal 検査スクリプトのテストです（Python 3.11 以上）。

```powershell
python -m unittest discover -s tests/release
```
