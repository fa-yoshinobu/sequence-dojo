# リリースと VirusTotal 検査

ZIP を GitHub Releases へ公開したあと、その中の EXE を VirusTotal で検査し、Release 本文に検査結果へのリンクを表示します。
手元で EXE を作るだけなら [ビルド手順](build.md) を参照してください。

## API キー

リポジトリの **Settings → Secrets and variables → Actions** にある Repository secret **`VT_API_KEY`** を使用します。未登録なら VirusTotal の API キーをこの名前で登録してください。ワークフローは検査ステップだけに環境変数 `VIRUSTOTAL_API_KEY` として渡します。キーをコードや Release 本文に記載する必要はありません。[GitHub の Secret 設定手順](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

VirusTotal への通常の送信は公開サンプルの投稿です。検査結果や送信ファイルはパートナー・利用者と共有され得ます。検査するのは公開した EXE だけで、ソースコードや個人の設定は投稿しません。[VirusTotal の共有について](https://docs.virustotal.com/docs/how-it-works)

## ZIP を公開する

1. リリース対象の変更を commit して GitHub へ push します。[CHANGELOG.md](../CHANGELOG.md) の「Unreleased」をバージョン番号に書き換えておきます。
2. 未使用のバージョンタグを作成して push します。

   ```powershell
   git tag v0.3.0
   git push origin v0.3.0
   ```

3. **Actions → Release** で進捗を確認します。

[Release ワークフロー](../.github/workflows/release.yml)は .NET 10 で単一ファイルの EXE を発行し、`SequenceDojo-win-x64.zip` を公開します。ZIP の内容は **`SequenceDojo.exe` の 1 ファイルだけ**です（入っていなければワークフローを失敗にします）。

タグは `vMAJOR.MINOR.PATCH` または `vMAJOR.MINOR.PATCH-rc.1` などの形式を使用します。EXE のバージョンもタグに合わせます。ワークフローはcsprojの製品版とタグを比較し、発行後のEXEからProductVersionを読み戻して一致を確認してからZIPを作成します。ハイフン付きのタグは GitHub のプレリリースとして公開します。作成済みのタグから公開する場合は **Actions → Release → Run workflow** の `release_tag` にそのタグを指定します。

公開時の本文にはダウンロードリンク・起動方法と「VirusTotal：検査中。」を表示します。公開後のジョブが VirusTotal の検査ワークフローを呼び、完了すると検査中の表示を結果リンクに置き換えます。

リリース本文と検査CIの表示は英語です。本文の定型文は [`.github/release-notes.md`](../.github/release-notes.md) で管理します。`release_assets.py` がZIPのSHA-256を作成し、英語本文へタグ付きの配布リンクを埋め込みます。Changes節は公開前にCHANGELOGから更新してください。検査が完了している既存リリースの本文だけを更新する場合は、**Actions → Update English release notes → Run workflow** で `release_tag` を指定します。配布ファイルやタグを変更せず、VirusTotal の再検査も行いません。

## 公開後の検査と再検査

[VirusTotal 検査ワークフロー](../.github/workflows/virustotal-release.yml)は次の 3 通りで実行します。

- 上記の Release ワークフローが ZIP を公開したあとに呼び出す。
- GitHub の画面などから Release を公開したときの `release: published` イベント。
- **Actions → Scan release with VirusTotal → Run workflow** で公開済みの `release_tag` を指定して再検査する。

公開済みの EXE、または公開 ZIP 内の EXE を取得して検査します。このアプリの配布 ZIP では `SequenceDojo.exe` が対象です。再検査では本文内の検査欄だけを置き換えます。

検査完了後の本文には VirusTotal の検査結果へのリンクを表示し、検出数や判定はリンク先で確認できます。検査日時や SHA-256 などの詳細は Actions の検査レポートに残します。

キー未設定・API エラー・タイムアウトなどで検査が完了しない場合は、本文に「検査未完了」と表示してワークフローを失敗にします。Actions のログを確認し、原因を解消してから再検査を実行してください。検査結果や検査未完了によって、Release や ZIP の公開状態は変更しません。

検査 JSON・Markdown は Actions の `virustotal-実行ID-試行番号` artifact へ 30 日間保存します。Release の添付は配布 ZIP とその SHA-256 です。

## 使用する VirusTotal API

[VirusTotal API v3 のファイル送信](https://docs.virustotal.com/reference/files-scan)を使用します。32 MB を超える EXE は[大容量ファイル用のアップロード URL](https://docs.virustotal.com/reference/files-upload-url)を取得して送信し、この経路の上限は 650 MB です。このアプリの EXE（約 60 MB）は大容量送信の経路で検査します。API キーの利用枠や契約による制約も適用されます。

## 関連ファイル

| ファイル | 内容 |
|---|---|
| `.github/workflows/release.yml` | タグの push で EXE を発行し、ZIP を Release に公開 |
| `.github/workflows/virustotal-release.yml` | 公開済み Release の EXE を VirusTotal で検査し、本文を更新 |
| `.github/workflows/update-release-notes.yml` | 検査済み Release の本文だけを定型文で更新 |
| `.github/scripts/check_release_virustotal.py` | Release の EXE（ZIP 内を含む）を取得して検査し、本文の検査欄を置き換える |
| `.github/scripts/scan_virustotal.py` | VirusTotal API へのファイル送信と結果取得 |
| `.github/scripts/release_assets.py` | ZIPのSHA-256を作成し、英語本文へタグ付きのダウンロードURLを埋め込む |
| `.github/scripts/check_runtime_update.py` / `.github/workflows/check-runtime-update.yml` | 公式メタデータから固定ランタイムの更新を週次確認する |
| `.github/release-notes.md` | Release 本文の定型文 |
| `tests/release/` | 検査スクリプトのテスト（`python -m unittest discover -s tests/release`） |


## 同梱ランタイムの更新確認

自己完結EXEの再現性のため、`SequenceDojo.csproj` の `RuntimeFrameworkVersion` プロパティは `SelfContained=true` の発行時だけ有効にしてランタイムを固定します。`run.bat` などのフレームワーク依存の開発起動にはこのパッチ版の固定を適用せず、SDKの既定の最小ランタイムとPCに導入済みの互換パッチ版を使用します。PCに入っている.NETを更新しても配布EXEの同梱版は変わりません。

`Check bundled runtime` は毎週水曜日と手動起動で、Microsoftの公式リリースメタデータと固定値を比較します。同じメジャー・マイナーの最新安定版だけを対象にし、プレビューは除外します。更新ありはSummaryとログに表示して終了コード1、取得・設定エラーは終了コード2で失敗します。自動の版変更・リリース作成・Asset差替えは行いません。

```powershell
python -B .github/scripts/check_runtime_update.py
```

更新を採用するときは固定値を変更し、ビルド・テスト・自己完結EXEの動作と同梱版を確認したうえで、新しい製品版として公開します。公開済みZIPは更新しません。

検査スクリプトはLadder_viewerと同じ更新・解析処理へ揃えています。共通仕様リポジトリには利用可能な再利用ワークフローがないため、各リポジトリ内の既存スクリプトを維持します。
