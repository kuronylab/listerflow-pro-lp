/**
 * ui.js
 * UI管理モジュール
 */

import { findRealMipButton } from './dom.js';

// UIオブジェクト（グローバル状態）
export const UI = {
  root: null,
  status: null,
  badge: null,
  btnOpt: null,
  btnLabel: null,
  spin: null,
  quickMipBtn: null,
  asinBar: null,
  histSel: null,
  btnCopy: null,
  btnCsv: null
};

/**
 * ステータスボックスをVero Warningsの直前に挿入
 */
function insertBeforeVeroWarnings(statusBox) {
  // div.asin-actionsを直接探す（Get Itemボタンを含む親コンテナ）
  const asinActions = document.querySelector('div.asin-actions');
  
  if (!asinActions) {
    console.warn('[ListerFlow Pro] div.asin-actions not found, appending to body');
    document.body.appendChild(statusBox);
    return;
  }
  
  // asin-actionsの次の兄弟要素を取得
  const nextSibling = asinActions.nextElementSibling;
  
  if (nextSibling) {
    // asin-actionsの直後に挿入（Get Itemボタンのすぐ下）
    asinActions.parentElement.insertBefore(statusBox, nextSibling);
  } else {
    // 次の兄弟がない場合はasin-actionsの直後に追加
    asinActions.parentElement.appendChild(statusBox);
  }
}

/**
 * メインUIを破棄
 */
export function destroyMainUI() {
  if (UI.root && UI.root.isConnected) UI.root.remove();
  UI.root = null;
  UI.status = null;
  UI.badge = null;
  UI.btnOpt = null;
  UI.btnLabel = null;
  UI.spin = null;
}

/**
 * タイトル要素の下にUIを配置
 */
export function ensureUIBelowTitle(titleEl, STORE) {
  if (!titleEl) return;
  if (UI.root && UI.root.isConnected) return;

  // ステータス表示用のボックス（Get ItemとVero Warningsの間に配置）
  const statusBox = document.createElement("div");
  statusBox.className = "lfp-status-box";
  statusBox.id = "lfp-status-box";

  const row = document.createElement("div");
  row.className = "lfp-row";

  const btn = document.createElement("button");
  btn.className = "lfp-btn";
  btn.type = "button";

  const label = document.createElement("span");
  label.className = "lfp-btn-label";
  label.textContent = "最適化";

  const spin = document.createElement("span");
  spin.className = "lfp-spin";
  spin.style.display = "none";

  btn.appendChild(label);
  btn.appendChild(spin);

  const status = document.createElement("div");
  status.className = "lfp-status";
  status.textContent = "文字数：計算中... / Vero：- / 出品：-";

  row.appendChild(btn);
  row.appendChild(status);

  const badge = document.createElement("div");
  badge.className = "lfp-badge";
  badge.textContent = "";

  statusBox.appendChild(row);
  statusBox.appendChild(badge);

  // Vero Warningsの直前に挿入
  insertBeforeVeroWarnings(statusBox);

  UI.root = statusBox;
  UI.status = status;
  UI.badge = badge;
  UI.btnOpt = btn;
  UI.btnLabel = label;
  UI.spin = spin;
}

/**
 * 最適化ボタンの状態を設定（忙しい/アイドル）
 */
export function setBusy(isBusy, STORE) {
  if (!UI.btnOpt) return;
  UI.btnOpt.disabled = isBusy;
  
  // 最適化中の表示
  if (isBusy) {
    if (UI.btnLabel) UI.btnLabel.textContent = "最適化中";
    if (UI.spin) UI.spin.style.display = "inline-block";
  } else {
    // 最適化完了時の表示：needsRetryに応じて「最適化」または「再実行」
    if (UI.btnLabel) UI.btnLabel.textContent = STORE.optimizeState.needsRetry ? "再実行" : "最適化";
    if (UI.spin) UI.spin.style.display = "none";
  }
}

/**
 * ステータスラインを更新
 */
export function setStatusLine(len, veroCount, shipText, highlight, STORE) {
  if (!UI.status) return;
  UI.status.textContent = `文字数：${len} / Vero：${veroCount} / 出品：${shipText}`;
  if (UI.btnOpt && STORE.opt.highlightOptimize) UI.btnOpt.classList.toggle("highlight", !!highlight);
}

/**
 * バッジテキストを設定
 */
export function setBadge(text) {
  if (!UI.badge) return;
  UI.badge.textContent = text || "";
}

/**
 * UI状態をリセット
 */
export function resetUIState(STORE) {
  setBadge("");
  if (UI.btnOpt) UI.btnOpt.disabled = false;
  if (UI.btnOpt) UI.btnOpt.classList.remove("highlight");
  // 最適化状態をリセット
  STORE.optimizeState.needsRetry = false;
  if (UI.btnLabel) UI.btnLabel.textContent = "最適化";
}

/**
 * Quick MIPボタンを作成
 */
export function ensureQuickMipButton(btnGet, STORE) {
  if (UI.quickMipBtn && UI.quickMipBtn.isConnected) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-custom-secondary";
  btn.id = "lfp-quick-mip";

  btn.style.width = `${btnGet.getBoundingClientRect().width}px`;
  btn.style.marginLeft = "8px";
  btn.style.whiteSpace = "nowrap";
  btn.style.display = STORE.opt.quickMipButton ? "inline-flex" : "none";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.disabled = true; // 初期状態は無効（条件判定後に有効化）

  btn.innerHTML = `<span>MIP&nbsp;&nbsp;<i class="glyph-icon icon-linecons-paper-plane"></i></span>`;
  btn.addEventListener("click", () => clickRealMipButton());

  btnGet.parentElement?.appendChild(btn);
  UI.quickMipBtn = btn;
}

/**
 * Quick MIPボタンを削除
 */
export function removeQuickMipButton() {
  if (UI.quickMipBtn && UI.quickMipBtn.isConnected) UI.quickMipBtn.remove();
  UI.quickMipBtn = null;
}

/**
 * 実際のMIPボタンをクリック
 */
function clickRealMipButton() {
  const real = findRealMipButton();
  if (!real) return false;
  const aria = real.getAttribute("aria-disabled");
  if (aria === "true") return false;
  if (real.hasAttribute("disabled")) return false;
  real.click();
  return true;
}

/**
 * MIPボタンの背景カバーを修正
 */
export function fixMipButtonBgCover() {
  // 本物のMIPボタン（Yaballe側）
  const real = document.querySelector("#mip-list-item-btn");
  if (real) {
    const span = real.querySelector("span");
    let icon = real.querySelector("i.glyph-icon.icon-linecons-paper-plane");
    if (!icon) icon = real.querySelector("i");

    // 背景がspanに乗っていて、iconがspan外にあると途中で背景が切れる
    // なのでiconをspan内に移動して背景の「カバー範囲」を自然に伸ばす
    if (span && icon && icon.parentElement !== span) {
      try {
        // nbsp等のテキストノードが間にあっても崩れないように軽く整形
        const kids = Array.from(real.childNodes || []);
        for (const n of kids) {
          if (n && n.nodeType === 3) {
            const t = (n.nodeValue || "").replace(/\u00a0/g, " ");
            n.nodeValue = t;
          }
        }
      } catch (_) { }

      span.appendChild(icon);
    }

    // 角丸は既存スタイルを維持し、配置だけ整える
    if (span) {
      span.style.display = "inline-flex";
      span.style.alignItems = "center";
      span.style.gap = "10px";
    }
  }

  // Quick MIP（拡張側）
  const quick = document.querySelector("#lfp-quick-mip");
  if (quick) {
    const sp = quick.querySelector("span");
    if (sp) {
      sp.style.display = "inline-flex";
      sp.style.alignItems = "center";
      sp.style.gap = "10px";
    }
  }
}

/**
 * ASIN履歴バーを作成
 */
export function createAsinHistoryBar(asinInput, btnGet) {
  if (UI.asinBar && UI.asinBar.isConnected) return;

  const bar = document.createElement("div");
  bar.className = "lfp-asinbar";
  bar.id = "lfp-asinbar";

  const sel = document.createElement("select");
  sel.id = "lfp-hist";
  sel.innerHTML = `<option value="">ASIN履歴（直近100件）</option>`;
  bar.appendChild(sel);
  
  // リセットボタンを追加
  const resetBtn = document.createElement("button");
  resetBtn.className = "lfp-reset-btn";
  resetBtn.textContent = "×リセット";
  resetBtn.title = "ASIN履歴をすべて削除";
  bar.appendChild(resetBtn);

  // コピーボタンを追加
  const copyBtn = document.createElement("button");
  copyBtn.className = "lfp-copy-btn";
  copyBtn.textContent = "📋コピー";
  copyBtn.title = "現在の履歴をスプレッドシート用にコピー";
  bar.appendChild(copyBtn);

  // CSV出力ボタンを追加
  const csvBtn = document.createElement("button");
  csvBtn.className = "lfp-csv-btn";
  csvBtn.textContent = "📥CSV";
  csvBtn.title = "現在の履歴をCSVとして保存";
  bar.appendChild(csvBtn);

  asinInput.parentElement?.insertBefore(bar, asinInput);

  UI.btnCopy = copyBtn;
  UI.btnCsv = csvBtn;

  UI.asinBar = bar;
  UI.histSel = sel;
}

/**
 * ASIN履歴セレクトを更新
 */
export async function refreshHistorySelect(loadHistory, setInputValue, sleep, STORE) {
  if (!UI.histSel) return;
  
  const hist = await loadHistory();
  
  // カスタムドロップダウンを作成
  const existingDropdown = document.getElementById('lfp-custom-dropdown');
  if (existingDropdown) existingDropdown.remove();
  
  const dropdown = document.createElement('div');
  dropdown.id = 'lfp-custom-dropdown';
  dropdown.className = 'lfp-custom-dropdown';
  dropdown.style.display = 'none';
  
  // 履歴アイテム
  for (const entry of hist) {
    const item = document.createElement('div');
    item.className = 'lfp-dropdown-item';
    item.dataset.asin = entry.asin;
    
    // フラグに応じて表示を変える
    let displayText = entry.asin;
    let isBad = false;
    
    // no_listingsフラグが立っている場合は最優先で表示
    if (entry.flags.no_listings) {
      displayText = `! ${entry.asin} No listings`;
      isBad = true;
    } else {
      // 複数のフラグを配列で収集
      const flagLabels = [];
      if (entry.flags.protected) flagLabels.push("protected");
      if (entry.flags.already_listed) flagLabels.push("already_listed");
      if (entry.flags.brand) flagLabels.push("brand");
      
      if (flagLabels.length > 0) {
        displayText = `× ${entry.asin} ${flagLabels.join(" / ")}`;
        isBad = true;
      }
    }
    
    item.textContent = displayText;
    if (isBad) item.classList.add('lfp-dropdown-item-bad');
    
    // クリックイベント
    item.addEventListener('click', () => {
      selectHistoryAsin(entry.asin, setInputValue, sleep, STORE);
      dropdown.style.display = 'none';
    });
    
    dropdown.appendChild(item);
  }
  
  // selectの親要素に追加
  UI.histSel.parentElement.style.position = 'relative';
  UI.histSel.parentElement.appendChild(dropdown);
}

/**
 * ASIN履歴から選択
 */
async function selectHistoryAsin(asin, setInputValue, sleep, STORE) {
  // ASIN入力欄にセット
  const btnGet = document.querySelector('button'); // 簡略化
  const asinInput = document.querySelector('input'); // 簡略化
  if (asinInput) {
    setInputValue(asinInput, asin);
    
    // UI.histSelの表示をリセット（プレースホルダーに戻す）
    if (UI.histSel) {
      UI.histSel.selectedIndex = 0;
    }
    
    // autoGetOnHistoryがONならGet Itemを自動クリック
    if (STORE.opt.autoGetOnHistory && btnGet) {
      await sleep(100);
      btnGet.click();
    }
  }
}
