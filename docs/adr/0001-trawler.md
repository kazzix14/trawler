# ADR-0001: Trawler — ブラウザ検証コンテキスト捕捉拡張の設計

- Status: Accepted
- Date: 2026-06-02

> **Trawler** — 底引網漁(trawling)が海底を一網打尽に攫ってくるように、ブラウザ上で起きた事実(console / network / 操作 / DOM 変化 / スクショ等)をまとめて引き上げ、Claude Code に渡すための拡張。

---

## Context

webapp の検証ツール。人間がブラウザ上で異常に気づいた瞬間に、その不具合を **Claude Code がそのまま再現・診断・修正できる形のコンテキスト**として書き出すことが目的。

要件:

- 普段使いのブラウザ上で「気づいた流れのまま」記録したい。専用ハーネス(Playwright 等)ではなく、実ブラウジングに常駐すること。
- 対象 webapp に一切手を入れない(ゼロ instrumentation)。任意のアプリで動き、instrumentation の腐敗を避ける。
- 取得した事実をそのまま Claude Code に渡し、推論・修正は消費側に委ねる。

以下は会話で固めた一連の決定を 1 本にまとめたもの。各決定は独立に読めるが、すべて上記 Context を共有する。

---

## Decision 1 — ブラウザ拡張として実装する(Chrome MV3 先行 / Firefox 後続)

- **WebExtension として実装する。**
- **最初の実装ターゲットは Chrome(Manifest V3)。** Firefox は後続。
- **ゼロ instrumentation を不変条件とする。** 取得はすべてブラウザ側 API + ページ context への介入のみで完結させ、対象アプリのソース・ビルドには一切手を入れない。

### Consequences

良い:

- 実ブラウジングに常駐し、気づいた瞬間にそのまま記録できる。
- 任意の webapp で動く(他人のアプリ・本番でも)。
- Chrome MV3 はツール/ドキュメントが厚く立ち上げが速い。

留意:

- MV3 の service worker は ephemeral(勝手に停止)。rolling 状態を SW のメモリに置けない → content script / IndexedDB 側に持つ(Decision 3)。
- Firefox 移植時の差分を将来負債として抱える:`browser.*` / `chrome.*`(`webextension-polyfill` で吸収)、MAIN world content script のバージョン差、background 寿命モデル差。v0 は Chrome に寄せて書き、移植時に切り出す。

### Alternatives considered

- **Playwright / CDP 駆動の外部ハーネス**:再現生成には強いが「実ブラウジングに常駐」を満たさない。却下。
- **Firefox 先行**:常用は Firefox だが MV3 成熟度・立ち上げ速度で Chrome を先行。Firefox は polyfill 前提で後続。
- **対象アプリへの build 時 source 刻印**(`annotate_rendered_template_with_filename` 等):精度は上がるが instrumentation を要し任意アプリで動かない・腐敗する。却下(Decision 4 で代替)。

---

## Decision 2 — ネットワークは MAIN world の fetch/XHR フックで取得する

ブラウザ別の制約:Chrome MV3 の `webRequest` はレスポンス本文を読めない。`chrome.debugger`(CDP)は読めるがデバッグバナーが常駐。Firefox の `webRequest.filterResponseData` は読めるが Firefox 固有。

- **`run_at: document_start` で MAIN world に注入したスクリプトが `fetch` と `XMLHttpRequest` を monkey-patch して tee する**方式を baseline とする。ページの JS world で走るためブラウザ非依存で request payload と response body を握れる。
- 書き換えは **完全に透過な tee**(戻り値・例外伝播・タイミングを一切変えない)。対象アプリの挙動に影響させない。
- `chrome.debugger`(Chrome)/ `filterResponseData`(Firefox)による高忠実度取得は **将来の opt-in**。v0 では実装しない。

### Consequences

良い:Chrome / Firefox 共通の単一実装でレスポンス本文まで取れる。instrumentation 不要。

留意:ページ JS 起点の fetch/XHR しか拾えない。navigation 本体・`sendBeacon`・一部経路は漏れる → 将来 resource timing で補完。MAIN world 注入は `world: "MAIN"` + `run_at: document_start`(Chrome 111+)。Firefox 移植時はバージョン差/旧来の `<script>` タグ注入で対応。

---

## Decision 3 — 連続タイムライン記録 + checkpoint(lap)による窓の切り出し

- 裏で常に **rolling の単一タイムライン**を記録し続ける。
- ユーザーは任意で **checkpoint(lap)** を打てる(ボタン / ホットキー)。1 checkpoint = タイムスタンプ + 自動スクショ + 任意ラベル。**checkpoint は区間境界ではなく目印**(ストップウォッチの lap)。
- 切り出し時、「ある checkpoint から今まで」または「直近 N 秒」をユーザーが選ぶ。N のデフォルトは設定可能(例:5 分)。
- 始点選択 UI は、タイムライン上のイベント時スクショ(サムネ)を候補点として並べ、絵を見ながら選べるスクラバとする。サムネは固定間隔ではなく **イベント発生時**(checkpoint / 要素マーク / エラー / 該当 network 等)に撮る。

### 記録ストリーム

core(v0):

- console(log / warn / error、エラーは生スタックそのまま)
- network(URL / method / 送信内容 / status / レスポンス本文)— Decision 2
- 未捕捉エラー(`window.onerror` / `unhandledrejection`)
- 操作トレース(click / input[機微入力はマスク] / scroll / focus / key)
- navigation(full load + `pushState` / `popstate`)
- DOM 変化(MutationObserver)— 「起きるはずの mutation が起きていない」を直接証拠化できる
- WebSocket / EventSource(SSE)— Turbo Stream / Action Cable 等はここを通る

optional(将来):resource timing(PerformanceObserver)、storage 変化(localStorage / sessionStorage / cookie)、perf 指標(LCP / CLS / long task)。

out of scope(v0):framework 内部 state(Redux / Vue devtools hook)。minify とフック依存で脆い。

### Consequences

良い:運用が軽い(囲う操作不要)。事後に好きな窓を取れる。イベント時サムネがそのまま「意味のある始点候補」になる。

留意:rolling 保持ぶんを content script / IndexedDB に持つ(SW 不可)。記録ストリームが増えるほどタイムスタンプ整合・同期の実装責任が増える。

---

## Decision 4 — 要素マーク:HTML 行番号 + 開始タグ(子は省略・葉テキストは残す)

対象アプリに手を入れないので build 時 source 刻印は使えない。代わりに **「クリックした要素を特定する手がかり」をブラウザ側だけで厚く拾い、ソース特定は Claude Code がリポジトリ側の grep で行う**役割分担にする。

- ピッカーで要素をクリックしてマーク。マーク時に記録:
  - **その瞬間のスクショ**(可視領域、オリジナルサイズ — Decision 5)
  - **HTML 行番号 + その行の内容**。「行の内容」= **開始タグ(全属性込み)**。
  - セレクタ・id・class・既存の `data-*` / `aria-*`
- **省略ルール(確定):**
  - **子要素の subtree は `...` で省略する。**
  - **短い直接テキスト(葉のラベル等)は残す。** grep の最強の手がかりになるため。

  ```
  L247: <div class="cart-total" data-controller="cart" id="total">...</div>
  L88:  <button data-action="cart#add">カートに追加</button>
  ```

- **「HTML 行番号」が指すもの**:サーバレンダ(Rails / Hotwire 等)なら返却 HTML の行、JS で組む SPA なら現在の DOM をシリアライズした文字列中の行。いずれも行番号単体は弱いので、**開始タグの実物を必ず併記**し、Claude Code が行番号 + 実物 + 葉テキストで grep できるようにする。

### Consequences

良い:instrumentation ゼロのまま、Claude Code が grep で該当箇所(partial / component / controller)を当てられる手がかりが揃う。

留意:テキストも id も testid も無い無名要素は手がかりが薄い → network / スタック / スクショで挟み撃つ(単独では稀に絞れない)。

---

## Decision 5 — 自動スクショのトリガと抑制ポリシー

自動スクショのトリガ(**すべてオリジナルサイズ**、各トリガは設定で **個別 opt-out 可**):

- checkpoint を打った時(Decision 3)
- 要素マーク / 手動キャプチャ時(Decision 4)
- console エラー時(`console.error` + `window.onerror` + `unhandledrejection` を同列で扱う)
- network が撮影ルールにマッチした時(デフォルト 4xx / 5xx — Decision 6)

抑制(dedup)は **1 つだけ**:

- **同一事象は一度撮ったら 3 秒間は撮らない。** 撮った時点から固定 3 秒(スライディングではない)。3 秒経過後に同じものがまだ出ていれば、また 1 枚撮る。
- 「同一」の判定キー(確定):
  - console / onerror / unhandledrejection:**メッセージ + スタック先頭フレーム(throw 元 file:line:col)**
  - network:**domain + path + status**
- **抑制が効くのはスクショだけ。** タイムライン記録は常に全件残す(50 連発なら 50 件)。

スクショ実行は二段:撮影ルール(Decision 6)で capture 判定 → この 3 秒同一抑制を通過 → 撮影。

### Consequences

留意:`tabs.captureVisibleTab` は **アクティブタブの可視領域のみ**(裏タブ・画面外・スクロール外は撮れない、v0 割り切り)。ストレージ最適化・captureVisibleTab レート制限・バースト畳み込みは **v0 では考慮しない**(レート制限に当たり得る点は許容)。

---

## Decision 6 — network スクショの撮影ルールエンジン

撮る/撮らないを宣言的に制御する。**上から評価し、最初にマッチしたもの勝ち**。マッチしなければ `default`。

- マッチ条件:**domain**(glob)、**path**(glob または regex)、**status**(`5xx` / `429` / 範囲)。
- アクション:capture / ignore。
- デフォルト:**first-party の 4xx・5xx を capture、サードパーティと既知ノイズ path は ignore。**

  ```yaml
  rules:                          # 上から評価、最初にマッチしたもの勝ち
    - { domain: "api.myapp.com", status: "5xx", action: capture }
    - { domain: "api.myapp.com", status: "4xx", action: capture }
    - { path: "/analytics/*",     action: ignore }   # 404 出てもノイズなので無視
    - { domain: "*.thirdparty.*", action: ignore }
  default: ignore                 # マッチしなければ撮らない
  ```

- **このルールが効くのは「スクショを撮るか」だけ。** network イベント自体はルールに関係なくタイムラインに常時記録する(撮らなくても後から見れる)。
- 401(未ログイン)や任意リソースの 404 のような「想定内の失敗」をルールで黙らせられるのが肝。

---

## Decision 7 — 出力は単一のクリップボードテキスト束(LLM なし / Playwright なし / companion なし)

- 出力は **1 枚のテキスト束をクリップボードへコピー**する。中身:
  - 先頭 1 行の **priming**:「これはブラウザ検証から出たバグ報告。再現・診断・修正して。以下の記録は観測された事実。原因はまだ推論されていない(あなたが推論する)。」
  - **メモ**
  - **マークした要素情報**(Decision 4:HTML 行番号 + 開始タグ + DOM 手がかり)
  - **切り出しウィンドウの記録**(console / network / 操作トレース / navigation / DOM 変化 / WebSocket 等、タイムスタンプ付き — Decision 3)
  - **スクショは別ファイル保存**(`downloads` API)し、テキストには **保存パスのみ**記載(画像はクリップボードから貼れないため参照渡し)
- **拡張内に LLM を持たない(確定)。** narrative 化(試した/起きた/問題/期待)も原因推論も Claude Code 側に委ねる。Claude Code の方が賢いので、**事実を全部渡して推論はそちらに集約する**のが方針。Trawler は **事実の捕捉とパッケージングに徹する**。
- **companion daemon**(localhost 自動書き込み・`claude` 自動起動)は v0 では作らない。手で paste するレビューゲートを許容する。

### Consequences

良い:部品が最小(常駐 daemon も native messaging も不要)。Chrome / Firefox 同挙動。**事実のみ**を渡すので Claude Code が誤った原因に錨を下ろしにくい。

留意:テストファイルの自動着地・`claude` 自動起動が無い → paste 後に「これを保存して直して」と一言指示が要る(レビュー機会として許容)。バイナリ(スクショ)は参照渡しのみ。クリップボードはテキスト 1 枚なので、切り出しウィンドウは関連リクエストに絞る運用が要る。

### Alternatives considered

- **Playwright 失敗テストを契約として同梱**:検証可能性(red→green)は上がるが不採用(方針)。将来再検討可。
- **companion daemon で repo 直書き + `claude` 自動起動**:摩擦は減るが v0 では過剰自動化。paste の手間が苦になった時点で昇格する。
- **拡張内 LLM enrichment**:不採用。将来の opt-in。

---

## v0 スコープ要約

ゼロ instrumentation の Chrome MV3 拡張 **Trawler**。裏で連続記録(console / network / 操作 / navigation / DOM 変化 / WebSocket)し、checkpoint を目印に窓を事後選択。要素はクリックでマーク(HTML 行 + 開始タグ[子は `...`・葉テキストは残す] + スクショ)。重要イベントで自動スクショ(3 秒同一抑制)。出力は事実だけのテキスト束をクリップボードへ。原因推論・narrative 化・修正は Claude Code が行う。

v0 で明確に入れないもの:Playwright、companion daemon、拡張内 LLM、対象アプリへの instrumentation、ストレージ/レート最適化。
