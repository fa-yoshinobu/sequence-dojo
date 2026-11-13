# ビルド・開発

アプリの操作は [操作方法](usage.md)、GitHub Releases への公開は [リリース手順](releasing.md) を参照してください。

## 必要な環境

- Windows 10 / 11
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
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

Release 構成でビルドして、アプリのウィンドウを開きます（出力先は `src\SequenceDojo\bin\Release\net10.0-windows`）。
画面のファイル（`src\SequenceDojo\wwwroot`）を編集したら、アプリを閉じて `run.bat` で起動し直してください。

## 配布用 EXE の作成

```powershell
.\build.bat
```

Windows x64 向けの単一ファイル EXE を作成します。出力先は `artifacts\release` で、次のEXE、および配布ZIP・SHA-256を配置します。

```text
artifacts/release/
└─ SequenceDojo.exe
```

EXE は .NET ランタイムと画面ファイルを含む単一ファイル（約 60 MB）です。配布先に .NET のインストールは不要です。
画面ファイルはアセンブリ内の埋め込みリソースから直接配信し、`wwwroot` 全体を一時フォルダへ展開しません。WebView2LoaderなどのネイティブDLLだけは.NETの仕組みで展開されます。開発時は出力先の `wwwroot` を配信するため、画面を編集してビルドし直せます。

起動時に `%TEMP%\.net\SequenceDojo` 直下の旧ハッシュフォルダを整理します。現在のネイティブ検索先・実行フォルダを含むものと、ジャンクションなどのリンクを含むものは残します。削除に失敗しても起動を続け、診断ログへ記録します。

起動中の `SequenceDojo.exe` がある場合はビルドを中止します。アプリを閉じてから、同じコマンドを再実行してください。既存の出力フォルダは削除せず、配布ファイルを更新します。

## アプリ本体と画面側のテスト

Windowsと.NET 10 SDKで次を実行します。実機PLCやWebView2の画面操作は不要です。

```powershell
dotnet build SequenceDojo.sln -c Release
dotnet test SequenceDojo.sln -c Release --no-build
```

`tests/SequenceDojo.Tests` は、通信設定の正規化、Modbusアドレス解析、偽PLCによる入力変更時の書込み・通信異常からの回復と、実ローカルサーバーへのWebSocket認証を検証します。サーバーはテストごとに空きポートで起動し、終了時に停止します。WebSocketはOriginと起動時cookieの両方が正しい場合だけ接続できることを確認します。外部ブラウザ用の `/session` は、不正トークンを拒否し、正規フォームからHttpOnly・SameSite Strictのcookieを設定することを検証します。不正JSONや入力配列を送った後も正規メッセージを処理できることを確認します。

画面側のテストはNode.js 24で実行します。npmパッケージの追加は不要です。

```powershell
node --test tests/browser/*.test.mjs
```

`wiring-circuit.js` は描画から分離した同じ回路計算を使用し、短絡・入力コモン未配線・サービス電源・出力コモン・全機種の標準割付を検証します。`TaskRunner` はexpect・waitFor・expectForと中断時のボタン解放を検証します。3D描画の見た目や実機通信を検証するテストではありません。

`.github/workflows/ci.yml` はmainへのpushとPull Requestで、.NET build/test、Node.jsのテスト、次のPythonテストを実行します。

## 検査スクリプトのテスト

リリース時の VirusTotal 検査スクリプトのテストです（Python 3.11 以上）。

```powershell
python -m unittest discover -s tests/release
```

配布ZIPとその `.zip.sha256` も `artifacts/release/` に作成します。ZIPには必要な配布ファイルだけを含め、既存ZIP・チェックサム・リリース本文は含めません。旧出力フォルダは自動削除しません。


## バージョン更新時の確認箇所

| 対象 | 版を設定・記載するファイル | 更新時の確認 |
| --- | --- | --- |
| .NET対象フレームワーク | `src/SequenceDojo/SequenceDojo.csproj` と `tests/SequenceDojo.Tests/SequenceDojo.Tests.csproj` の `TargetFramework`、`run.bat`、`docs/architecture.md`、この文書の開発出力先 | 出力パスの対象フレームワーク名を揃える |
| .NET SDK | `.github/workflows/release.yml` と `.github/workflows/ci.yml`、`build.bat` の案内URL、`README.md` の動作環境、この文書の必要環境、`docs/releasing.md` | ビルドに必要なSDKのメジャー版を揃える |
| 同梱.NETランタイム | `src/SequenceDojo/SequenceDojo.csproj` の `RuntimeFrameworkVersion` | 固定したパッチ版と自己完結EXEの同梱版を確認する |
| Three.js | `src/SequenceDojo/wwwroot/vendor/three.core.js` の `REVISION`、同じパッケージの `three.module.js` と `addons/OrbitControls.js`、`LICENSE-three.txt` | vendor一式を同じ版から更新し、`THIRD-PARTY-NOTICES.md` の版・著作権年、`docs/architecture.md`、`CHANGELOG.md`を揃える |
| 製品バージョン | `src/SequenceDojo/SequenceDojo.csproj` の `Version`、リリースタグ、`CHANGELOG.md`、`.github/release-notes.md` | 製品版と変更履歴を揃え、.NET/Three.jsの版とは区別する |

## CSPと改行規約

`index.html` のCSPは同一オリジンのスクリプトと、エラーハンドラー・import mapのSHA256だけを許可します。`unsafe-eval` / scriptの `unsafe-inline` は使いません。WebSocketはlocalhostの可変ポートを許可し、サーバーでもCookieとOriginを確認します。既存のstyle属性とエラーバーにはstyleの `unsafe-inline` を使います。

インラインスクリプトやimport mapを変更したら、次を実行してCSPのハッシュを更新し、整合性テストを通してください。ブラウザがHTMLの改行をLFへ正規化するため、ハッシュ計算も同じ正規化を行います。

```powershell
node .github/scripts/update-csp-hashes.mjs
node --test tests/browser/security-policy.test.mjs
```

CIの .NET buildは `-warnaserror` で警告もエラーにします。`.gitattributes` と `.editorconfig` はUTF-8・LFを基本とし、bat/cmdはCRLF、C#の字下げは4、JavaScript等は2スペースです。既存ファイルの一括整形・改行変換は行いません。
