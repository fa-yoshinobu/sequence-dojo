# ソフトウェア構成（開発者向け）

## 全体構成

Windows アプリ（`SequenceDojo.exe`）1 つの中で、画面とサーバーが動きます。

```
SequenceDojo.exe
├─ MainForm（WinForms ウィンドウ）
│   └─ WebView2 … 画面 wwwroot（js/app.js ほか、Three.js r187）
│        ⇅ WebSocket（ws://localhost:5087/ws）
└─ WebServer（ASP.NET Core / Kestrel、127.0.0.1 のみ）
     └─ PlcService … 周期ループ
          └─ IPlcLink … SlmpLink（SLMP）/ HostLinkLink（上位リンク）/ ModbusLink（Modbus TCP） ⇄ PLC・シミュレータ
```

- `Program.cs`: サーバーを起動 → ウィンドウを表示 → ウィンドウを閉じたらサーバー（PLC 通信を含む）を停止。
- `WebServer.cs`: 静的ファイル配信（`Cache-Control: no-cache`）と WebSocket。既定ポート 5087 が使用中なら空きポートを使う。
- `Plc/IPlcLink.cs`: 通信方式の共通窓口（入力 16 点の書込み・出力の読出し）、接続設定 `PlcConfig`、機種一覧 `/api/profiles`。
- `ProjectFiles.cs`: プロジェクトファイル（`*.sdojo`）の保存・読込。画面とは WebView2 のメッセージでやり取りする（画面 → アプリ: `ready` / `file-open` / `file-save`、アプリ → 画面: `file-opened` / `file-saved` / `file-error` / `save-request`）。閉じるときは `window.__dojoDirty()` で未保存かどうかを確認する。
- `MainForm.cs`: WebView2 のデータ（localStorage など）は `%LOCALAPPDATA%\SequenceDojo\WebView2` に保存。WebView2 ランタイムが無い PC では既定のブラウザで開く。
- 盤の物理シミュレーション（コンベア・ワーク・リミットスイッチ）と配線の回路計算は画面（JavaScript）側で行います。
- サーバーは「X に書く・Y を読む」だけを担当します。

## 画面側の信号の流れ

### WebSocketのアクセス保護

`/ws` は `http://localhost:<実際のポート>` と完全一致するOriginと、起動時に乱数で作成する認証情報の両方を確認する。未指定・不一致の接続は403で拒否し、認証情報そのものを記録せずにサーバーログへ残す。`AllowedHosts` は `localhost;127.0.0.1` に限定する。

MainFormはWebView2のCookieManagerからHttpOnly・SameSite=StrictのCookieを設定して画面を開く。既定ブラウザでは、一時ローカルHTMLから `/session` のリクエスト本文へ認証情報をPOSTし、同じCookieを設定してから画面へリダイレクトする。一時HTMLは終了時に削除する。認証情報をURLやJavaScriptのグローバルへ公開しないため、この方式を用いる。アプリを再起動すると認証情報も変わる。

`js/timers.js` の同一オリジンWorkerが20msごとに通知し、`app.js` が周期計算を実行します（描画ループとは独立）。課題の待機も同じWorkerを使い、最小化中の通常タイマー間引きを避けます。Workerを開始できない場合や実行中に失敗した場合は、診断ログを残し、待機中の残り時間を保って通常タイマーへ切り替えます。

`simulation-clock.js` は経過時間が0.1秒以下なら元の単発dtを維持し、それより遅れた場合だけ20ms単位で追従します。長いスリープからの復帰で大量の処理や書込みを続けないよう、1回の追従は最大1秒です。各小ステップで入力変更を送信します。盤の計算式と I/O → リレー → 移動 → LS の順序は変えません。

```
盤の接点状態 closed[16]  ─┐
                          ├─ 配線モード ON : wiring.evaluate(closed, plcY) → { x[16], out[14] }
PLC 出力 plcY[16]      ─┘   配線モード OFF: x = closed、out = plcY[0..13]
        │
        ├─ x[16]   → 変化時に WebSocket で送信（inputs）
        └─ out[14] → RY1/RY2 のインターロック → コンベア・ワーク移動 → LS 判定
                     PL・DPL の表示
```

- `plcY` は、接続中はサーバーから受け取った値、未接続中は I/O モニタで手動操作した値です。
- 計算結果は `cur`（`x`・`y`・`out`・`closed`）に保存され、描画（`frame()`）と自動判定（`sim.observe()`）が参照します。

既定の5087以外のポートで起動した場合、すべてのタブに共通する上部案内を表示します。ブラウザのlocalStorageはポートごとに別のため、元の設定・配線は保存済み `.sdojo` を開いて復元します。元のポートのデータは削除しません。

`index.html` のCSPは同一オリジンと指定した2つのインラインスクリプトのハッシュを許可し、外部スクリプト・eval・オブジェクトを拒否します。ハッシュ更新は `docs/build.md` を参照してください。

## JavaScript の役割

`app.js` は状態と各モジュールを組み立て、20ms の周期計算と描画ループを起動する。

- `simulation.js`: 状態生成、接点、リレーのインターロック、ワーク移動・衝突、LS判定、課題の操作・観測API。Three.js・DOM・時計に依存しない。`stepSimulation(st, cur, dt, { evaluateWiring, draggedWork })` は I/O → リレー → 移動 → LS の順序を保つ。
- `board-view.js`: Three.js の作業盤・ワーク、描画、カメラと3Dポインタ操作。計算結果の `st` / `cur` を描画する。
- `screen-controls.js` / `task-controls.js`: ワーク・配線・ヘルプ・タブと、課題選択・タイマー・判定表示。
- `communications.js`: WebSocket の接続・再接続・送信と受信した状態の反映。
- `connection-form.js`: 接続フォームとデバイス名。`projects.js`: プロジェクト保存・読込、未保存変更の検知、WebView2のファイルメッセージ。
- `wiring-circuit.js`: 配線の計算と検査。`wiring.js` が3D表示と操作を担当する。

`window.__dojo` の状態・操作APIは維持する。`tests/browser/simulation-replay.test.mjs` は、同梱3課題を仮想PLCと20ms刻みで再生し、分割前の固定fixtureと全I/O・リレー・ワーク位置・判定ログを比較する。実PLCの検証とは区別する。

## 座標系

- 1 = 1mm。盤上面が y = 0、操作者側が +z、右が +x。
- 主な定数（`js/simulation.js`）: `CONV`（コンベア範囲・速度 45mm/s）、`WORK`（ワーク寸法・移動範囲）、`LS_X`（LS の位置）。ビス列の描画位置 `SCREW_Z` は `js/board-view.js`。
- PLC モデルの位置は `js/wiring.js` の `PLC` 定数です。

## WebSocket 通信仕様（`/ws`、JSON）

### 画面 → サーバー

| type | 内容 |
|---|---|
| `inputs` | `{ "type": "inputs", "bits": [bool × 16] }` 入力先頭から 16 点に書き込む値 |
| `connect` | `{ "type": "connect", "config": PlcConfig }` 接続（接続中なら切断してから再接続） |
| `disconnect` | `{ "type": "disconnect" }` |

### サーバー → 画面

```json
{ "type": "state",
  "state": { "connected": true, "error": null, "outputs": [bool × 16], "scanMs": 12.3, "config": { … } } }
```

接続時、状態変化時、出力の変化時に全クライアントへ送信します。

### PLC通信の停止と復帰

`PlcService` は接続・切断・終了を排他し、実行中の通信を有限タイムアウトで待って周期ループを止め、独立したタイムアウトで入力16点を全点OFFにして接続を閉じます。停止要求で通信中のトークンを取り消さず、OFFより先にプロトコルの接続が壊れることを防ぎます。通信異常時もOFFを試み、書込みに失敗しても接続を破棄します。SLMP・上位リンク・Modbus TCPはいずれも1秒後に接続を開き直し、現在の入力を再送します。

認証済みWebSocketがすべて消えて2秒経過すると入力を全点OFFにします。接続リストと件数通知を同じlockで更新し、期限は単調時間で判定します。再接続後は画面から届く新しい入力を使います。出力が変化しなくても約1秒ごと（通信周期が長ければその周期）に `scanMs` を含む状態を通知します。不正JSONや型・要素数が不正な入力メッセージは無視して通信を継続します。

### PlcConfig

| キー | 型 | 既定値 |
|---|---|---|
| `protocol` | `melsec` / `keyence` / `modbus` | `melsec` |
| `profile` | ライブラリの正規名（`melsec:iq-f`、`keyence:kv-8000` など。modbus では未使用） | `melsec:iq-f` |
| `host` / `port` | 接続先 | `192.168.3.250` / `5000` |
| `transport` | `Tcp` / `Udp`（modbus は Tcp 固定） | `Tcp` |
| `inputStart` / `outputStart` | 先頭デバイス文字列 | `X0` / `Y0` |
| `intervalMs` | 周期 | `30` |
| `unitId` | Modbus の Unit ID | `1` |
| `simulator` | GX Simulator 3 / KV STUDIO シミュレータに接続（接続先を固定値に置き換える） | `false` |
| `timeoutMs` | 応答タイムアウト | `1000` |

以前の形式（`profile` が `IqF` などの列挙名）はサーバー・画面の両方で正規名に変換します。

### 機種一覧 `GET /api/profiles`

`{ melsec: [{ name, displayName }], keyence: [...], gxSimulator: [name], kvSimulator: [name] }` を返します。各ライブラリの機種一覧（接続可能なもの）から作ります。

## サーバー（`PlcService.cs`）

- `ConnectAsync` で `PlcLinks.OpenAsync` により通信方式に応じた `IPlcLink` を開き、出力を 1 回読んで応答を確認してから周期ループを開始します（接続全体のタイムアウト 5 秒）。
- ループ: 入力が変化していれば `WriteInputsAsync`、毎周期 `ReadOutputsAsync` で 16 点読出し。
  - SLMP / 上位リンク: 連続ビットの一括読み書き（`ReadBitsSingleRequestAsync` / `WriteBitsSingleRequestAsync`）
  - Modbus: C は複数コイル書込み・コイル読出し、DI は入力ステータス読出し、HR / IR はレジスタ 1 個を 16 ビットとして扱う
- 例外時はエラーを通知し、1 秒待って再試行します。
- 入力点数・出力点数は `InputCount` / `OutputCount` 定数です。

## 画面に保存するデータ（localStorage）

| キー | 内容 |
|---|---|
| `seqdojo.config` | 接続設定 |
| `seqdojo.wires` | 配線（端子キーの組の配列） |
| `seqdojo.wiringMode` | 配線モードの ON/OFF |
| `seqdojo.tab` | 最後に開いたタブ |
| `seqdojo.task` | 最後に選んだ課題 |
| `seqdojo.plcModel` | 配線練習用 PLC の機種（`fx5s` / `fx5u` / `q` / `iqr`） |
| `seqdojo.helpNoAuto` | 起動時にヘルプを表示しない |

端子キーの形式: 盤側 `T:1`〜`T:16`、`T:20`〜`T:33`、`T:+1`〜`T:+4`、`T:-1`〜`T:-4`／PLC 側（機種共通）`P:IN0`〜`P:IN15`（入力）、`P:INCOM`（入力コモン）、`P:OUT0`〜`P:OUT15`（出力）、`P:COM0`〜（出力コモン、グループ順）、`P:24V`・`P:0V`（サービス電源のある機種のみ）。PLC 側を並び順で持つので、配線練習用 PLC を切り替えても配線が残ります。

## プロジェクトファイル（`*.sdojo`）

```json
{
  "format": "sequence-dojo", "version": 1, "app": "シーケンス道場 3D", "savedAt": "2026-09-28T12:00:00.000Z",
  "connection": { "protocol": "melsec", "profile": "melsec:iq-f", "host": "192.168.3.250", "port": 5000, "...": "PlcConfig と同じ" },
  "wiring": { "model": "fx5s", "mode": true, "wires": [["T:+1", "P:INCOM"], ["T:1", "P:IN0"]] },
  "works": { "multi": false, "items": [{ "x": -91, "screws": [true, false, true, true] }] }
}
```

- `format` が `sequence-dojo` でないファイルは開きません。足りない項目は既定値で補います。
- 保存は一時ファイルに書いてから置き換えます（書きかけのファイルを残さない）。5 MB を超えるファイルは開きません。
- WebView2 が使えずブラウザで表示している場合は、ダウンロード（保存）とファイル選択（開く）で代用します。

## デバッグ

画面で `F12`（WebView2 の開発者ツール）を開き、コンソールで `window.__dojo` から内部状態を参照できます。

```js
__dojo.st            // 盤の状態（スイッチ・ワーク・接続状態など）
__dojo.cur           // 直近の入出力計算結果
__dojo.wiring.check()  // 配線チェック結果
__dojo.st.manualY[2] = true  // 未接続時に Y2 を手動 ON
```

## ビルド・実行

```bat
rem 開発中: ビルドして起動
run.bat

rem 配布用の 1 ファイル exe（artifacts\release\SequenceDojo.exe、.NET 同梱）を作る
build.bat
```

- `wwwroot` のファイルはビルド時に exe の隣（`bin\Release\net10.0-windows\wwwroot`）へコピーされます。画面のファイルを編集したら `run.bat` で起動し直してください。
- Three.js は `src/SequenceDojo/wwwroot/vendor/` に同梱しています（`three.module.js`, `three.core.js`、`addons/OrbitControls.js`）。更新する場合は npm の `three` パッケージから同じパスにコピーします。
- `build.bat` とリリース用ワークフロー（`.github/workflows/release.yml`）は自己完結・1 ファイル発行（`PublishSingleFile`、`EnableCompressionInSingleFile`）です。`wwwroot` は埋め込みリソースとしてHTTP配信し、内容のSHA-256をETagに使います。全コンテンツの一時展開は行いません。開発ビルドでは隣の `wwwroot` を使用し、単一EXEでは埋め込み版を使用します。`appsettings.json` は配布物へコピーせず、待受先はコードでloopbackに限定します。WebView2LoaderなどのネイティブDLLの展開は維持します。
- `LegacyExtractionCleanup` は起動時に `%TEMP%\.net\SequenceDojo` 直下の旧ハッシュフォルダだけを整理します。絶対パスの境界を確認し、ルート・子孫にreparse pointがあれば削除しません。`AppContext.BaseDirectory` と `NATIVE_DLL_SEARCH_DIRECTORIES` の使用中フォルダを残し、失敗は診断ログへ記録して起動を続けます。
- WebView2 パッケージが参照する WPF 用アセンブリは、WinForms では不要なので csproj のターゲットで参照から外しています。

## 拡張のヒント

| やりたいこと | 変更箇所 |
|---|---|
| 盤の部品を追加・移動 | `js/board-view.js` の各部品ブロック。クリック可能にするには `interactive(mesh, action)` で登録し、`pointerdown` の `switch` に処理を追加 |
| 配線練習用 PLC の機種を追加 | `js/wiring.js` の `PLC_MODELS` に定義を追加（端子名・入力コモン・出力コモンのグループ・サービス電源の有無・外形 `compact` / `modules`） |
| 判定条件のキーを追加 | `js/simulation.js` の `createTaskApi().observe()` |
| 判定ステップを追加 | `js/tasks.js` の `TaskRunner.run()` |
| 通信方式を追加 | `Plc/` に `IPlcLink` の実装を追加し、`PlcLinks.OpenAsync` と画面の `PROTOCOLS`（`js/connection-form.js`）に登録 |
