# Trawler 🪤🎣

> 底引網漁 (trawling) が海底を一網打尽に攫ってくるように、ブラウザ上で起きた事実
> (console / network / 操作 / DOM 変化 / スクショ等) をまとめて引き上げ、
> **Claude Code にそのまま渡せる「事実だけのテキスト束」** にする WebExtension。

Trawler は **ゼロ instrumentation** のブラウザ検証ツールです。対象 webapp には一切手を
入れません。普段使いのブラウザに常駐して裏でタイムラインを録り続け、異常に気づいた瞬間に
「直近 N 秒」や「あるチェックポイントから今まで」を切り出してクリップボードへコピーします。
原因推論・narrative 化・修正は **消費側 (Claude Code) に委ねます** — Trawler は事実の捕捉と
パッケージングに徹します。

設計の背景と決定事項は [docs/adr/0001-trawler.md](docs/adr/0001-trawler.md) を参照。

---

## 何を記録するか (v0)

| ストリーム | 取得元 | 備考 |
|---|---|---|
| console (log/info/warn/error/debug) | MAIN world で `console.*` を透過パッチ | error はスタック先頭フレーム付き |
| network (URL/method/送信内容/status/レスポンス本文) | MAIN world で `fetch` / `XHR` を透過 tee | 本文は設定文字数で切詰め |
| 未捕捉エラー (`error` / `unhandledrejection`) | MAIN world | |
| WebSocket / EventSource(SSE) | MAIN world でラップ | Turbo Stream / Action Cable 等 |
| navigation (load / pushState / popstate / hashchange) | MAIN(history) + content(load) | |
| 操作トレース (click / input / scroll / focus / key / submit) | content (DOM) | 機微入力はマスク |
| DOM 変化 | content (MutationObserver) | 一定間隔で集約 |
| perf (navigation / resource / longtask / LCP / CLS) | MAIN world `PerformanceObserver({buffered:true})` | **リクエスト毎の TTFB** でサーバ遅延(N+1)とクライアント遅延を判別。注入前のリクエストも回収 |
| チェックポイント / 要素マーク | ユーザー操作 | 自動スクショ付き |

スクショの自動トリガ: チェックポイント / 要素マーク / console エラー / network ルール一致
(デフォルト 4xx・5xx)。**同一事象は撮影から固定 3 秒間は抑制** (タイムライン記録は常に全件)。

---

## 必要環境

- Node.js 20+ (推奨 24)
- pnpm 9+
- Chrome 121+ / Firefox 128+

## セットアップ

```bash
pnpm install      # 依存導入 + postinstall で `wxt prepare`（型生成）
pnpm icons        # アイコン生成（public/icon/*.png）※初回のみ
```

## 開発 (HMR 付き)

```bash
pnpm dev          # Chrome を起動して読み込み
pnpm dev:firefox  # Firefox を起動して読み込み
```

## ビルド

```bash
pnpm build            # → .output/chrome-mv3/
pnpm build:firefox    # → .output/firefox-mv3/
pnpm zip              # 配布用 zip (Chrome)
pnpm zip:firefox      # 配布用 zip (Firefox)
```

### 手動で読み込む

- **Chrome**: `chrome://extensions` → デベロッパーモード ON → 「パッケージ化されていない拡張機能を読み込む」→ `.output/chrome-mv3/`
- **Firefox**: `about:debugging#/runtime/this-firefox` → 「一時的なアドオンを読み込む」→ `.output/firefox-mv3/manifest.json`

## 検証

```bash
pnpm test           # vitest (純粋ロジックのユニットテスト)
pnpm test:coverage  # カバレッジ付き
pnpm compile        # tsc --noEmit による型チェック
```

---

## 使い方

1. 対象 webapp を普通に操作する（Trawler が裏で録り続ける）。
2. 異常に気づいたら拡張アイコン（または `Ctrl/Cmd+Shift+Y`）で**サイドパネル**を開く。ページ操作中も開いたままなので、ピッカーやタイムライン確認が自然にできる。
3. **Mark を作る**（中心ワークフロー）:
   - （任意）**Pick element**（`Alt+Shift+P`）で該当要素を指す → パネルに pick した開始タグが表示される。ページ上には案内バナーが出て、pick するとトーストで確認。
   - **note（必須）**を書く → **+ Add mark**。Marks リストに追加され、その瞬間のスクショも自動で撮られる。**各 mark は「そのページ分のタイムライン」を凍結保持**するので、バッファが流れても・リロードしても後から確実にコピーできる。
   - → つまり `pick(任意) & note 入力 → Add mark → リストに追加`。
4. **コピーは2通り**:
   - **Mark ごと**: Marks リスト各項目の **Copy**（その note ＋要素 ＋スクショ ＋凍結したページ分タイムライン）。
   - **時間窓ごと**: 「直近 N 秒」/「チェックポイント以降」/**「このページだけ・直近 N ページ」**（ページ遷移境界で切る）を選んで **Copy window context**。`Alt+Shift+Y` でチェックポイント。
5. クリップボードに事実だけのテキスト束が入り、スクショは `Downloads/trawler/` に保存され本文にはパスのみが載る。
6. Claude Code に貼って「これを保存して直して」と指示する。

> 画像はクリップボードのテキストから貼れないため**参照渡し**（保存パスのみ）。クリップボードは
> テキスト 1 枚なので、切り出しは関連リクエスト/該当 Mark に絞るのがコツ。

---

## アーキテクチャ

MV3 の 3 つの実行コンテキストで役割を分担しています（ゼロ instrumentation の肝）。

```
  ┌─────────────────────────── ページ (対象 webapp) ───────────────────────────┐
  │  MAIN world  (entrypoints/inject.ts ← injectScript で注入, document_start)   │
  │   fetch/XHR/WebSocket/EventSource/console/onerror/history を「透過 tee」       │
  │              │  window.postMessage({source:'__TRAWLER__', ...})              │
  │              ▼                                                              │
  │  ISOLATED world (entrypoints/trawler.content.ts)                            │
  │   postMessage 受信＋検証 / 操作・DOM変化・navigation 収集 / 要素ピッカー       │
  │   メモリ内 rolling timeline（アプリの IndexedDB は汚さない）/ スクショtrigger  │
  └───────────────┬──────────────────────────────────────────────┬────────────┘
        runtime messaging                                   runtime messaging
                  ▼                                                ▼
  ┌─────────── background (entrypoints/background.ts) ───────────┐   ┌── panel ──┐
  │  captureVisibleTab (550ms throttle + 3秒dedup)               │   │ 窓選択     │
  │  拡張オリジン IndexedDB: スクショ + durable event log         │   │ メモ       │
  │  downloads でスクショ保存 / export 束組み立て                  │   │ Copy(貼付) │
  └─────────────────────────────────────────────────────────────┘   └───────────┘
```

- **MAIN world にしか置けない理由**: `console.*` / `onerror` / `history.pushState` /
  `fetch` はページの JS realm のオブジェクト。ISOLATED world は別 realm なので、そこで
  パッチしてもページの呼び出しを観測できない。MAIN world だけが同じ realm を共有する。
- **クロスブラウザ抽象化**: [WXT](https://wxt.dev) を採用。`browser.*`（promise 統一）の
  自動提供、per-browser マニフェスト生成、MAIN world 注入ヘルパ (`injectScript`) を標準装備し、
  Chrome MV3 / Firefox MV3 を**単一コードベース**で出力する（`wxt build -b firefox`）。
  ブラウザ差分は `lib/` の各モジュールではなく WXT 層に隔離されている。
- **アプリの storage を汚さない**: タイムラインは content の**メモリ**に保持し、永続化は
  **拡張オリジンの IndexedDB**（background）に行う。content script の `indexedDB` は
  ページオリジンを指すため使わない。

### ディレクトリ

```
entrypoints/
  inject.ts            MAIN-world フック束（unlisted; injectScript で注入）
  trawler.content.ts   ISOLATED content script（収集の配線）
  background.ts        SW/event page（スクショ・保存・export の配線）
  sidepanel/           サイドパネル UI（窓選択・スクラバ・メモ・Copy）
  options/             設定 UI
lib/
  types.ts protocol.ts messaging.ts settings.ts   契約（型・通信）
  time.ts id.ts text.ts glob.ts redact.ts ring-buffer.ts  純粋ユーティリティ
  capture/   rules.ts dedup.ts          スクショ撮影ルール / 3秒抑制
  page/      *-hooks.ts relay.ts        MAIN world（拡張 API 非使用）
  content/   *-tracker.ts picker.ts store.ts ...  ISOLATED 収集
  background/ db.ts screenshot*.ts event-log.ts downloads.ts export.ts
  export/    serialize-bundle.ts        出力束の組み立て
```

---

## 設定 (Options)

- 切り出しデフォルト秒数 / rolling バッファ上限（秒・件数）
- dedup ウィンドウ（既定 3000ms）
- スクショ形式（png / jpeg）、各トリガの個別 ON/OFF
- 入力マスク、本文切詰め文字数、保存サブディレクトリ
- **network 撮影ルール**（JSON）: `domain`(glob) / `path`(glob または `/regex/`) / `status`
  (`5xx` `4xx` `429` `400-499`) を上から評価し最初にマッチしたもの勝ち。既定は first-party の
  4xx・5xx を capture、それ以外 ignore。例:

  ```json
  {
    "rules": [
      { "domain": "api.myapp.com", "status": "5xx", "action": "capture" },
      { "domain": "api.myapp.com", "status": "4xx", "action": "capture" },
      { "path": "/analytics/*", "action": "ignore" },
      { "domain": "*.thirdparty.*", "action": "ignore" }
    ],
    "default": "ignore"
  }
  ```

---

## v0 で入れていないもの

Playwright / companion daemon / 拡張内 LLM / 対象アプリへの instrumentation /
ストレージ・レート最適化。詳細は ADR の「v0 スコープ要約」を参照。

## ライセンス

[LICENSE](LICENSE) を参照。
