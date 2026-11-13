# シーケンス道場 3D 改善ゴール

[README](../README.md) · [ソフトウェア構成](architecture.md) · [ビルド・開発](build.md) · [リリース手順](releasing.md)

v0.2.0（.NET 10・Three.js r187 へ移行した時点）のコードレビューに基づく改善項目です。1ゴール＝1つの独立した作業単位で、上から順に着手することを想定しています。

## 共通ルール

- 1ゴールにつき1コミット（または1 PR）。ゴールをまたぐ変更を混ぜない。
- 盤の動き（コンベア速度、リレーのインターロック、LSの判定位置）と配線の回路計算の結果を変えない。変える場合はゴールに明記されたものだけ。
- 既存の `*.sdojo` と `localStorage` の設定をそのまま読めること。
- 実機のPLCへ書き込む範囲（入力先頭から16点）を広げない。
- 各ゴールの完了時に、次の共通検証がすべて成功すること。

```powershell
dotnet build SequenceDojo.sln -c Release
python -m unittest discover -s tests/release
```

G2 の完了後は、追加したテスト（`dotnet test` と画面側のテスト）も共通検証に含めます。

## 進捗

| # | ゴール | 優先度 | 状態 |
| --- | --- | --- | --- |
| G1 | 他のWebページからPLCを操作できない | 高 | 完了 |
| G2 | アプリ本体に自動テストがあり、push/PRで走る | 高 | 未着手 |
| G3 | 切断・異常時にPLCへ古い入力が残らない | 高 | 未着手 |
| G4 | 文書の記述がコードと一致している | 高 | 未着手 |
| G5 | 一時フォルダーへの全展開をやめる | 中 | 未着手 |
| G6 | 起動済みでも `*.sdojo` のダブルクリックで開ける | 中 | 未着手 |
| G7 | 異常の原因がログに残る | 中 | 未着手 |
| G8 | 最小化中も自動判定が正しく動く | 中 | 未着手 |
| G9 | 配布版のEXEで課題を追加できる | 中 | 未着手 |
| G10 | `app.js` を役割ごとに分ける | 中 | 未着手 |
| G11 | リリースの仕組みを他のリポジトリと揃える | 中 | 未着手 |
| G12 | 細かな堅牢化 | 低 | 未着手 |

---

## G1: 他のWebページからPLCを操作できない

**Goal**: アプリの画面以外（利用者がブラウザで開いている別のWebページなど）から、アプリ内サーバーの WebSocket に接続してPLCを操作することができない。

**背景**: `src/SequenceDojo/WebServer.cs` の `/ws` は接続元（Origin）を確認せず、認証もない。ポートは既定で 5087 固定。ブラウザの同一オリジン制約は WebSocket には効かないため、アプリ起動中に利用者がブラウザで開いた任意のページが `ws://localhost:5087/ws` へ接続し、`connect`（接続先のIP・ポート・先頭デバイスを指定）と `inputs`（16点の書込み）を送れる。実機のPLCにつないでいる場合、外部のページからデバイスを書き換えられる。`appsettings.json` の `AllowedHosts` も `*` のまま。READMEの「PC の外からは接続できません」は正しいが、この経路は対象外になっている。

**対象**: `src/SequenceDojo/WebServer.cs`、`Program.cs`、`MainForm.cs`、`appsettings.json`、`wwwroot/js/app.js`、`docs/architecture.md`、`README.md`

**完了条件**
- [x] `/ws` は、Origin ヘッダーがアプリ自身のURL（`http://localhost:<実際のポート>`）と一致しない接続を拒否する。
- [x] 起動ごとに乱数のトークンを作り、WebSocket の接続時に一致を確認する。トークンは MainForm から画面へ渡す（URLやログに残さない方法を選び、選んだ方法をコメントに書く）。
- [x] WebView2 が使えず既定のブラウザで開く場合も、同じトークンで動作する。
- [x] `AllowedHosts` を `localhost;127.0.0.1` に絞る。
- [x] 不正な接続は 403 で断り、G7 のログに記録する。
- [x] READMEの「仕組み」と `architecture.md` に、この保護の説明を追記する。
- [x] Origin 不一致・トークン不一致で拒否されるテストがある（G2）。

**検証**: アプリ起動中に、別のオリジン（例: `file://` で開いたテスト用HTML）から `new WebSocket('ws://localhost:5087/ws')` を実行し、接続できないことを確認する。アプリの画面は従来どおり動く。

**対象外**: サーバーを廃止して WebView2 のメッセージ通信に一本化する構成変更（効果は大きいが、ブラウザ表示の代替手段がなくなるため別途検討）。

---

## G2: アプリ本体に自動テストがあり、push/PRで走る

**Goal**: 通信設定の正規化、Modbusアドレスの解析、配線の回路計算、課題の自動判定に単体テストがあり、main へのpushとPull Requestで自動実行される。

**背景**: テストがあるのはリリース用のPythonスクリプト（`tests/release/`）だけで、アプリ本体（C#・JavaScript）にはテストがない。ビルドを確認するCIもなく、リリース用スクリプトのテストも VirusTotal 検査ワークフローの中でしか走らない。テストしやすい純粋な処理は既にある（`PlcLinks.Normalize`、`ModbusLink.Parse`、`Wiring.evaluate` / `check`、`TaskRunner.run`、`updateRelays`）。

**対象**: `tests/`（新規プロジェクト）、`SequenceDojo.sln`、`src/SequenceDojo/SequenceDojo.csproj`、`.github/workflows/`（新規 `ci.yml`）、`docs/build.md`

**完了条件**
- [ ] `tests/SequenceDojo.Tests`（xUnit）があり、次をテストする。
  - `PlcLinks.Normalize`: 旧形式の機種名、シミュレータ指定での接続先の置換、周期・タイムアウトの範囲制限。
  - `ModbusLink` のアドレス解析: 正常系、読出し専用領域への書込み指定、範囲超過。
  - `PlcService`: テスト用の `IPlcLink` を使い、入力が変化したときだけ書き込むこと、通信エラー後に再開すること。
- [ ] 画面側のテストが `node --test` で動く（追加の依存なし）。対象は `Wiring.evaluate` / `check`（短絡、入力コモン未配線、標準割付）と `TaskRunner`（`expect` / `waitFor` / `expectFor`、中断）。
- [ ] 上記のために、`Wiring` の回路計算を Three.js に依存しない部分へ分ける（計算結果は変えない）。
- [ ] `ci.yml` が `push`（main）と `pull_request` で起動し、`dotnet build`・`dotnet test`・`node --test`・`python -m unittest discover -s tests/release` を実行する。
- [ ] Actionはコミットハッシュで固定し、`permissions: contents: read`、`persist-credentials: false`、`timeout-minutes` を設定する。
- [ ] `docs/build.md` にテストの実行方法を追記する。

**検証**: `Wiring.evaluate` の判定を一時的に壊すと、テストとCIが失敗する。

**対象外**: 3D描画の見た目のテスト、実機PLCとの通信テスト。

---

## G3: 切断・異常時にPLCへ古い入力が残らない

**Goal**: 切断、アプリの終了、画面の再読み込みや異常終了のあと、PLC側に「押したままのボタン」などの古い入力が残らない。壊れたメッセージで通信が止まらない。

**背景**: `src/SequenceDojo/PlcService.cs` は切断時に出力の表示を消すだけで、PLCへ書いた入力（16点）はそのまま残る。画面との WebSocket が切れても周期ループは最後の入力を持ち続ける。`WebServer.cs` の受信処理は、`type` のないメッセージや型の違う値で例外になり、その接続が終わる。`ConnectAsync` / `DisconnectAsync` は排他されておらず、複数の画面から同時に呼ばれると `_loop` と `_loopCts` が食い違う。通信が切れたあとの再接続はライブラリ任せで、切断された接続を使い続けて復帰しない可能性がある。

**対象**: `src/SequenceDojo/PlcService.cs`、`WebServer.cs`、`Plc/*.cs`、`docs/architecture.md`、`docs/plc-setup.md`

**完了条件**
- [ ] 切断時とアプリ終了時に、入力16点を「盤の電源OFFの状態（全点OFF）」で1回書き込んでから接続を閉じる。書込みに失敗しても切断は完了する。
- [ ] 画面との WebSocket がすべて切れたら、一定時間（例: 2秒）後に入力を全点OFFにする。再接続したら画面の値に戻る。
- [ ] この動作を `plc-setup.md` に書く（切断後にPLC側の入力がOFFになること）。
- [ ] `ConnectAsync` と `DisconnectAsync` を排他し、同時に呼ばれても状態が食い違わない。
- [ ] 通信エラーが続く場合、接続を開き直して復帰を試みる（3方式とも、ケーブルを抜いて挿し直すと自動で復帰する）。
- [ ] `/ws` の受信で、JSONとして不正・`type` なし・型違いのメッセージは無視して接続を保つ。`bits` は16点でなければ無視する。
- [ ] 接続中は、出力が変化しなくても周期時間（`scanMs`）の表示が定期的に更新される。
- [ ] 上記の単体テストがある（G2 のテスト用 `IPlcLink` を使う）。

**検証**: シミュレータに接続してPB1を押したままアプリを閉じ、PLC側の入力がOFFになることを確認する。接続中にシミュレータを止めて再開し、自動で復帰する。

**対象外**: 入力の書込み方式の変更（強制セットなど）。

---

## G4: 文書の記述がコードと一致している

**Goal**: README・docs・バッチのメッセージ・ライセンス表記が、現在のコード（.NET 10、Three.js r187）と一致している。

**背景**: .NET 10 と Three.js r187 への移行後、古い記述が残っている。

**対象**: `README.md`、`build.bat`、`THIRD-PARTY-NOTICES.md`、`docs/architecture.md`、`CHANGELOG.md`

**完了条件**
- [ ] README「動作環境」の「.NET SDK 9.0 以上」を .NET 10 SDK に直す。
- [ ] `build.bat` のエラーメッセージのURL（`/download/dotnet/9.0`）を 10.0 に直す。
- [ ] `THIRD-PARTY-NOTICES.md` の「Three.js r170」「© 2010-2024」を、同梱している r187 と `LICENSE-three.txt` の著作権表記に合わせる。
- [ ] `docs/architecture.md` の「`bin\Release\net9.0-windows\wwwroot`」を `net10.0-windows` に直す。この箇所は `\n` が改行として保存され、パスが2行に割れているので、あわせて直す。
- [ ] `CHANGELOG.md` の「未リリース」に、v0.1.0 以降の変更（.NET 10 への移行、Three.js の更新など）を書く。
- [ ] バージョン番号を含む記述（.NET、Three.js）がどのファイルにあるかを `docs/build.md` に一覧で書き、次回の更新漏れを防ぐ。

**検証**: `net9`、`dotnet/9.0`、`r170` でリポジトリを検索し、0件になる。

**対象外**: 文書の構成変更。

---

## G5: 一時フォルダーへの全展開をやめる

**Goal**: 配布版のEXEが、起動のたびに .NET ランタイム一式と画面ファイルを一時フォルダーへ展開しない。古い展開物が溜まらない。

**背景**: `build.bat` と `release.yml` は `IncludeAllContentForSelfExtract=true` で発行している。この設定では、起動時にEXEの中身すべて（ランタイムを含む）を `%TEMP%\.net\SequenceDojo\<ハッシュ>` へ展開する。初回起動が遅く、版ごとに百数十MBが残り、消す仕組みがない。画面ファイルの配信元（`ContentRootPath = AppContext.BaseDirectory`）も一時フォルダーになるため、一時ファイルの掃除ツールで実行中に消されると画面が壊れる。

**対象**: `src/SequenceDojo/SequenceDojo.csproj`、`WebServer.cs`、`build.bat`、`.github/workflows/release.yml`、`docs/build.md`、`docs/architecture.md`

**完了条件**
- [ ] `wwwroot` を埋め込みリソースにし、埋め込みから直接配信する（ETag と `Cache-Control: no-cache` の動作は維持）。
- [ ] `IncludeAllContentForSelfExtract` を外す。ネイティブライブラリ（WebView2Loader）だけが展開対象になる。
- [ ] 開発時（`run.bat`）は従来どおり `wwwroot` のファイルを直接配信し、編集して再読み込みで反映される。
- [ ] EXE 1ファイルだけで起動できること、ZIPの中身がEXEだけであることは変えない。
- [ ] 起動時に、以前の版が残した `%TEMP%\.net\SequenceDojo\` の古いフォルダーを削除する（失敗は無視）。
- [ ] `build.md` の「起動時に中身を一時フォルダへ展開する」の説明を更新する。

**検証**: `build.bat` で作ったEXEを別のPC（または別フォルダー）で起動し、画面・課題・配線が動く。`%TEMP%\.net\SequenceDojo\` に画面ファイルとランタイムが展開されていない。

**対象外**: EXEサイズの削減（トリミングなど）。

---

## G6: 起動済みでも `*.sdojo` のダブルクリックで開ける

**Goal**: アプリの起動中に `*.sdojo` をダブルクリック（または exe へドロップ）すると、起動済みのウィンドウでそのファイルが開く。

**背景**: `src/SequenceDojo/Program.cs` は2重起動を検出すると、既存のウィンドウを前面に出すだけで終了し、渡されたファイルを捨てる。関連付けの登録機能もない（コメントは関連付けに触れている）。

**対象**: `src/SequenceDojo/Program.cs`、`MainForm.cs`、`ProjectFiles.cs`、`docs/usage.md`

**完了条件**
- [ ] 2回目の起動は、ファイルのパスを起動済みのプロセスへ渡してから終了する（同じ利用者のプロセスだけが渡せる方法を使う）。
- [ ] 受け取った側は、未保存の変更があれば確認してから開く（画面の「開く」と同じ確認）。
- [ ] 渡されるのはパスだけで、受け取った側が拡張子とサイズ上限（5 MB）を確認する。
- [ ] 設定から、現在の利用者に対して `.sdojo` の関連付けを登録・解除できる（管理者権限不要）。EXEを移動した場合の再登録方法を `usage.md` に書く。
- [ ] ファイルなしの2回目の起動は、従来どおり既存のウィンドウを前面に出す。

**検証**: アプリ起動中に別の `*.sdojo` をダブルクリックし、確認のあと内容が切り替わる。

**対象外**: 複数ウィンドウでの同時編集。

---

## G7: 異常の原因がログに残る

**Goal**: 起動失敗、通信エラー、予期しない例外の内容が、利用者のPCのログファイルに残り、問い合わせ時に確認できる。

**背景**: ウィンドウアプリ（`WinExe`）のため、ASP.NET Core のログ（コンソール出力）はどこにも残らない。`Program.cs` と `MainForm.cs` に未処理例外のハンドラーがなく、`catch { }` で握りつぶしている箇所もある。画面側のエラーは `index.html` のエラーバーに出るが、記録はされない。

**対象**: `src/SequenceDojo/Program.cs`、`WebServer.cs`、`PlcService.cs`、`MainForm.cs`、`wwwroot/index.html`、`docs/usage.md`

**完了条件**
- [ ] ログを `%LOCALAPPDATA%\SequenceDojo\logs\` に保存し、サイズ上限つきで古い分を捨てる。
- [ ] 記録するもの: 起動・終了、使用ポート、PLCへの接続・切断・通信エラー（接続先と例外の内容）、未処理例外、G1 で拒否した接続。
- [ ] `Application.ThreadException`・`AppDomain.UnhandledException`・`TaskScheduler.UnobservedTaskException` を処理し、記録したうえでメッセージを表示する。
- [ ] 画面側のエラー（`index.html` のエラーバーに出す内容）もログへ送る。
- [ ] ヘルプまたは設定から、ログのフォルダーを開ける。
- [ ] ログの書込みに失敗してもアプリが落ちない。

**検証**: 存在しないIPへ接続してエラーを出し、ログに接続先と原因が残る。

**対象外**: ログの外部送信。

---

## G8: 最小化中も自動判定が正しく動く

**Goal**: ウィンドウを最小化したり他のウィンドウの裏に置いたりしても、コンベアの速度と自動判定の時間が変わらない。

**背景**: `wwwroot/js/app.js` の `simTick` は `setInterval(…, 20)` で動き、1回の進み幅を最大0.1秒に制限している。ブラウザ（WebView2を含む）は非表示のページのタイマーを1秒間隔まで遅らせることがあり、その場合コンベアは実時間の約1/10の速さになる。`docs/tasks.md` は「ウィンドウを最小化しても判定は続きます」と説明している。

**対象**: `src/SequenceDojo/wwwroot/js/app.js`、`MainForm.cs`、`docs/tasks.md`

**完了条件**
- [ ] まず現状を確認する。最小化した状態で自動判定（練習2）を実行し、合否と所要時間を、表示中の結果と比べて記録する。
- [ ] 差がある場合、非表示でもシミュレーションが実時間どおり進むようにする（例: 経過時間を0.1秒で切り捨てず、20ms刻みで複数回進める。または Web Worker のタイマーで駆動する）。
- [ ] 1回の呼び出しで進める時間に上限を設け、長時間のスリープから復帰したときに暴走しない。
- [ ] 判定側（`tasks.js` の待ち時間）も同じ条件で正しく動く。
- [ ] 差がなかった場合は、確認した条件（OS、WebView2 のバージョン）を `tasks.md` に書いて完了とする。

**検証**: 最小化中と表示中で、練習2の自動判定の合格数と、端から端までの移動時間（約4秒）が一致する。

**対象外**: 描画（`requestAnimationFrame`）を非表示中も続けること。

---

## G9: 配布版のEXEで課題を追加できる

**Goal**: ソースをビルドしない利用者でも、自作の課題（JSON）を読み込んで自動判定に使える。壊れた課題ファイルが1つあっても、他の課題は使える。

**背景**: 課題は `wwwroot/tasks/` と `index.json` で管理しており、追加するにはソースを編集してビルドし直す必要がある。`TaskRunner.loadList` は `Promise.all` で読むため、1ファイルでも読めないと課題一覧全体が空になる。課題の内容は検証しておらず、`work.screws` の欠落などは判定の途中で例外になる。

**対象**: `src/SequenceDojo/wwwroot/js/tasks.js`、`app.js`、`ProjectFiles.cs`（またはファイル読込みの共通化）、`WebServer.cs`、`docs/tasks.md`

**完了条件**
- [ ] 課題タブに「課題ファイルを読み込む」があり、選んだJSONを課題一覧に追加できる。
- [ ] `%USERPROFILE%\Documents\SequenceDojo\tasks\`（場所は実装時に確定）のJSONを起動時に読み込む。フォルダーを開く操作がある。
- [ ] 読込み時に課題を検証する。必須項目（`title`、`scenario`）、`grade` の範囲、各ステップの種類、条件キーと値の型を確認し、問題のある行を示して読み込まない。
- [ ] 読めない・不正な課題があっても、他の課題は一覧に出る。
- [ ] 同梱の3課題が検証を通る単体テストがある（G2）。
- [ ] `docs/tasks.md` の「課題を追加する」を、配布版での手順に書き換える（開発者向けの手順は残す）。

**検証**: 配布版のEXEで自作の課題を読み込み、自動判定が動く。わざと壊したJSONを置いても、同梱の課題は選べる。

**対象外**: 課題の編集画面。

---

## G10: `app.js` を役割ごとに分ける

**Goal**: 盤のシミュレーション、3D描画、画面の操作、通信、プロジェクトファイルが別のモジュールになり、シミュレーションは Three.js なしでテストできる。

**背景**: `wwwroot/js/app.js` は1,173行で、シーン構築・ポインター操作・入出力計算・WebSocket・接続フォーム・I/Oモニタ・課題・描画ループ・プロジェクトファイルを1つのモジュールに持つ。入出力計算（`panelContacts`、`updateRelays`、`updateLimitSwitches`、`resolveWorks`）は純粋に近いが、Three.js のオブジェクトと同じ場所にあり、単体でテストできない。

**対象**: `src/SequenceDojo/wwwroot/js/`、`docs/architecture.md`、`README.md`（フォルダ構成）

**完了条件**
- [ ] シミュレーション（接点、リレーのインターロック、コンベアとワークの移動、LS判定）を、Three.js とDOMに依存しないモジュールに分ける。
- [ ] 通信（WebSocket と状態の反映）、接続フォーム、プロジェクトファイルをそれぞれ別のモジュールにする。
- [ ] `app.js` は、モジュールの組み立てと描画ループが中心になる（目安500行以下）。
- [ ] シミュレーションの単体テストがある（インターロックの優先、ワークがLS位置にあるときの入力、複数ワークの衝突）。
- [ ] 分割の前後で、同梱3課題の自動判定の結果が変わらない。
- [ ] `window.__dojo` のデバッグ用の参照は維持する。
- [ ] `architecture.md` の「拡張のヒント」と README のフォルダ構成を更新する。

**検証**: 共通検証と G2 のテスト。シミュレータに接続し、同梱3課題の自動判定が分割前と同じ合格数になる。

**対象外**: ビルドツール（バンドラー）や TypeScript の導入。

---

## G11: リリースの仕組みを他のリポジトリと揃える

**Goal**: 配布ZIPの名前・チェックサム・リリース本文・検査スクリプトが、Ladder_viewer・window-rescue と同じ規則になり、スクリプトの修正を1か所で済ませられる。

**背景**: このリポジトリだけ、ZIP名がバージョン入り（`SequenceDojo-v0.3.0-win-x64.zip`）で、SHA-256のチェックサムがなく、本文の生成が `render-release-notes.ps1`（他は `release_assets.py`）になっている。`check_release_virustotal.py` と `scan_virustotal.py` は3つのリポジトリで内容が食い違っている。`RuntimeFrameworkVersion` を 10.0.14 に固定しており、同梱ランタイムの更新は手作業。

**対象**: `.github/workflows/`、`.github/scripts/`、`tests/release/`、`src/SequenceDojo/SequenceDojo.csproj`、`docs/releasing.md`、`README.md`

**完了条件**
- [ ] ZIP名を固定名（`SequenceDojo-win-x64.zip`）にし、`.sha256` を添付する。README に最新版の直接リンクを載せる。
- [ ] 過去のリリース（v0.1.0）の添付は変更しない。
- [ ] 検査スクリプトを3リポジトリで同一の内容にする。可能なら [共通リリース標準](https://github.com/fa-yoshinobu/release_standard) の再利用可能ワークフローを呼ぶ形にして、各リポジトリのコピーをなくす。
- [ ] リリース時に、EXEのバージョンがタグと一致することを確認する（他の2リポジトリと同じ検査）。
- [ ] 同梱ランタイムの扱いを決める。固定を続けるなら、古くなったことを知らせる定期ワークフローを用意する。外すなら、同梱されたバージョンをリリース本文かログに出す。
- [ ] `docs/releasing.md` を新しい手順に更新する。

**検証**: プレリリースのタグ（例: `v0.3.0-rc.1`）で一連の流れを実行し、固定名のZIP・チェックサム・検査結果リンクが揃う。

**対象外**: コード署名。

---

## G12: 細かな堅牢化

**Goal**: 下記の小さな問題がそれぞれ解消されている。項目ごとに独立して着手できる。

**完了条件**
- [ ] **ポートが変わっても設定が消えない**: 既定ポートが使用中で別のポートになると、`localStorage` が別扱いになり設定が初期化されて見える。接続設定と配線をポートに依存しない場所へ保存するか、ポートが変わったことを画面に表示する。
- [ ] **CSP**: `index.html` に Content-Security-Policy を設定する（インラインスクリプトと import map を含めて動作する形で）。
- [ ] **未使用の設定**: `appsettings.Development.json` と、使っていない設定項目を整理する。
- [ ] **`.gitattributes` / `.editorconfig`**: 改行と文字コード、C#とJavaScriptの書式を定義する。
- [ ] **警告をエラーに**: CIのビルドで `TreatWarningsAsErrors` を有効にし、警告を解消する。
- [ ] **握りつぶしの見直し**: `catch { }` の箇所を、G7 のログへ記録する形に直す。

**検証**: 共通検証と、各項目の目視確認。
