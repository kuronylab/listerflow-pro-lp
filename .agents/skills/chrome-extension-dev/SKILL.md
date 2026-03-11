---
name: Chrome 拡張機能 (Manifest V3) 開発パターン
description: ListerFlow Pro の開発で確立した Chrome 拡張機能の設計パターン。Service Worker 中継、Content Script の SPA 対応、ストレージ設計、マルチアカウント管理を含む。
---

# Chrome 拡張機能 (Manifest V3) 開発パターン

## 概要

Manifest V3 ベースの Chrome 拡張機能を構築するための設計パターン集。ListerFlow Pro for Yaballe の開発を通じて確立されたベストプラクティス。

---

## 1. ファイル構成テンプレート

```
project-root/
├── manifest.json           # 拡張機能の設定（Manifest V3）
├── assets/
│   └── icons/              # 16, 48, 128px アイコン
├── src/
│   ├── sw/
│   │   └── background.js   # Service Worker（中継局）
│   ├── content/
│   │   ├── content.js      # Content Script（ページ操作）
│   │   └── content.css     # ページ内 UI スタイル
│   ├── popup/
│   │   ├── popup.html      # ポップアップ画面
│   │   ├── popup.js        # ポップアップロジック
│   │   └── popup.css       # ポップアップスタイル
│   └── pages/
│       ├── purchase.html   # 独立ページ（例: 購入画面）
│       ├── purchase.js
│       └── purchase.css
├── gas/
│   └── backend_v2.gs       # GAS バックエンド（別デプロイ）
└── github-pages/
    └── index.html          # ランディングページ
```

---

## 2. Service Worker を中継局として使うパターン

Content Script や Pages からは外部 API を直接呼べない（CSP/CORS制限）。Service Worker を中継局として使う。

### 中継パターン（background.js）

```javascript
const API_URL = "https://script.google.com/macros/s/.../exec";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // 外部サーバーへのリクエストを中継
  if (msg.type === "MY_SERVER_REQUEST") {
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(msg.payload),
          signal: controller.signal,
          redirect: "follow",
          credentials: "omit"
        });

        clearTimeout(timeoutId);

        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (parseErr) {
          // GAS が HTML を返す場合（Google アカウント競合）
          if (text.includes('<!DOCTYPE') || text.includes('<html')) {
            throw new Error('サーバーがHTMLを返しました');
          }
          throw new Error('応答解析失敗: ' + text.substring(0, 100));
        }
        sendResponse({ ok: true, data: result });
      } catch (err) {
        let msg = (err.name === 'AbortError') ? 'タイムアウト' : err.message;
        sendResponse({ ok: false, error: msg });
      }
    })();
    return true; // ★ 非同期レスポンスのため必須
  }
});
```

### 呼び出し側（Content Script / Pages）

```javascript
const response = await chrome.runtime.sendMessage({
  type: "MY_SERVER_REQUEST",
  payload: { action: "create_checkout", email, plan: "pro" }
});

if (response?.ok) {
  // response.data に結果
} else {
  // response.error にエラーメッセージ
}
```

### 教訓
- `return true;` を忘れると非同期レスポンスが送れない
- GAS は Google アカウント競合時に HTML（ログインページ）を返すことがあるため、レスポンスが JSON かを必ずチェック
- `credentials: "omit"` で Cookie を送らないとリダイレクト問題を回避できる
- `Content-Type: "text/plain;charset=utf-8"` で CORS プリフライトを回避

---

## 3. chrome.storage の使い分け

| ストレージ | 用途 | 同期 | 容量 |
|---|---|---|---|
| `chrome.storage.sync` | 設定値（API キーなど） | デバイス間同期 | 100KB |
| `chrome.storage.local` | 統計、履歴、ライセンス | ローカルのみ | 10MB |

### キー命名規則

プレフィックス + バージョン番号でキーを管理する。

```javascript
const KEY_OPT  = "lfp_options_v1";    // sync に保存
const KEY_STATS = "lfp_stats_v1";     // local に保存
const KEY_HIST  = "lfp_asin_history_v1"; // local に保存
```

### デフォルト値パターン

```javascript
const DEFAULTS = { apiKey: "", model: "gpt-4o-mini" };

async function loadOpt() {
  const data = await chrome.storage.sync.get([KEY_OPT]);
  return { ...DEFAULTS, ...(data?.[KEY_OPT] || {}) };
}
```

---

## 4. マルチアカウント対応

対象サイトで複数アカウントを使い分ける場合のライセンス/設定管理パターン。

```javascript
// アカウント検知（Content Script → Service Worker）
chrome.runtime.sendMessage({
  type: "ACCOUNT_DETECTED",
  email: detectedEmail
});

// Service Worker 側の処理
if (msg.type === "ACCOUNT_DETECTED") {
  const prev = await chrome.storage.local.get(['current_email']);
  const prevEmail = prev.current_email;
  const newEmail = msg.email;

  if (prevEmail && prevEmail !== newEmail) {
    // アカウント切り替え検知
    // 1. 新アカウント用のライセンスを辞書から復元
    const stored = await chrome.storage.local.get(['licenses_by_account']);
    const dict = stored.licenses_by_account || {};
    const license = dict[newEmail];

    if (license) {
      // 過去に認証済み → 復元
      await chrome.storage.local.set({ 'license': license });
    } else {
      // 未認証 → Free にリセット
      await chrome.storage.local.remove(['license']);
    }

    // 2. Content Script に切り替えを通知（UI再描画）
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: "ACCOUNT_CHANGED",
          plan: license?.plan || 'free'
        }).catch(() => {});
      });
    });
  }

  await chrome.storage.local.set({ 'current_email': newEmail });
}
```

---

## 5. SPA 対応 Content Script

SPA（Single Page Application）サイトでは、URL 変更時にページがリロードされない。Content Script の UI を適切に再描画するための検知パターン。

```javascript
// MutationObserver でアプリ内のDOMの入れ替わりを検知
const observer = new MutationObserver((mutations) => {
  // 現在の URL がターゲットページかチェック
  if (isTargetPage()) {
    // UI が存在しなければ再描画
    if (!document.getElementById('my-extension-ui')) {
      initializeUI();
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// ハッシュ変更の検知（SPA のルーティング）
window.addEventListener('hashchange', () => {
  if (isTargetPage()) {
    setTimeout(initializeUI, 500); // DOM 構築を待つ
  }
});
```

---

## 6. Service Worker のタイマー管理

Service Worker は非アクティブ時にアンロードされるため、`setInterval` は注意が必要。

```javascript
let timerInterval = null;

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// 起動時にタイマー状態を復元
loadStats().then(async (stats) => {
  if (!stats.isCounterPaused) {
    startTimer();
  }
});
```

### 放置検知パターン

```javascript
async function updateTimer() {
  const stats = await loadStats();
  const now = Date.now();

  // 一定時間操作がなければ自動停止
  if (stats.lastInputTime && (now - stats.lastInputTime > 135000)) {
    const rewindMs = (now - stats.lastInputTime) - 15000;
    stats.totalWorkTime = Math.max(0, stats.totalWorkTime - rewindMs);
    stats.isPaused = true;
    await saveStats(stats);
    stopTimer();
    return;
  }

  stats.totalWorkTime += 1000;
  await saveStats(stats);
}
```

---

## 7. ブロードキャスト同期

Service Worker から全タブの Content Script に状態変更を通知するパターン。

```javascript
function broadcastSync() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: "SYNC_UI" }).catch(() => {});
    });
  });
}
```

> **注意**: `.catch(() => {})` で送信失敗を無視する。Content Script が注入されていないタブへの送信は必ず失敗するため。

---

## よくあるハマりポイント

| 問題 | 原因 | 対策 |
|---|---|---|
| `sendResponse` が届かない | `return true;` を忘れている | 非同期処理には必ず `return true;` |
| Service Worker が停止する | 非アクティブ時に自動アンロード | 状態はストレージに保存し、起動時に復元 |
| Content Script の UI が消える | SPA のページ遷移で DOM がリセット | MutationObserver + hashchange で再描画 |
| CORS エラー | Content Script から直接外部 API 呼び出し | Service Worker を中継局にする |
| GAS が HTML を返す | Google アカウント競合 | レスポンスの形式チェック + `credentials: "omit"` |
