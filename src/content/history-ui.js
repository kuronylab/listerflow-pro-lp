/* ListerFlow Pro – History UI
   ※ store.js (STORE, dropdownMousedownHandler, dropdownClickHandler) に依存
   ※ history.js (loadHistory, deleteHistoryItemFromContent) に依存
   ※ dom-helpers.js (findAsinInputSmart, findButtonByText, setInputValue) に依存
   ※ utils.js (isExtensionContextValid, sleep, showLfpConfirm) に依存
   ※ license.js (loadLicenseData, showSubscriptionAlert) に依存
   ※ worktime.js (createPauseResumeButton, updatePauseResumeButtonUI, stopWorkTimeUpdateTimer) に依存
   ※ content.js (UI, lastPasteAt) に依存
*/

/* ---------- History UI ---------- */

async function refreshHistorySelect(force = false) {
  if (!UI.histSel || !UI.histSel.isConnected) return;

  // ドロップダウンが開いている場合は再構築をスキップ（閉じてしまう問題の防止）
  // ただし force=true の場合はデータ変更があるため強制リフレッシュ
  if (!force) {
    const openDropdown = document.getElementById('lfp-custom-dropdown');
    if (openDropdown && openDropdown.style.display === 'block') return;
  }

  const hist = await loadHistory();

  // 件数カウントを表示
  const count = hist.length;
  const maxCount = 1000;

  // 既存のselectを更新（件数カウント付き）
  UI.histSel.innerHTML = `<option value="">ASIN履歴（直近1000件） ${count}/${maxCount}</option>`;
  for (const entry of hist) {
    const opt = document.createElement("option");
    opt.value = entry.asin;
    opt.textContent = entry.asin;
    UI.histSel.appendChild(opt);
  }

  // カスタムドロップダウンを更新
  refreshCustomDropdown(hist);
  // 注意: ここでrefreshListingCountUIを呼ばない（1秒タイマーと二重になりカクつくため）
}

async function refreshListingCountUI() {
  if (!UI.listingCountLabel || !UI.listingCountLabel.isConnected) return;
  if (!isExtensionContextValid()) return;

  // ライセンス情報を再読み込み（同期用）
  await loadLicenseData();

  try {
    const stats = await chrome.runtime.sendMessage({ type: "LFP_GET_STATS" });
    if (!stats) return;

    // 本日の作業時間（バックグラウンドで計算された累積秒数を使用）
    const totalMs = stats ? (stats.totalWorkTimeToday || 0) : 0;
    let sessionWorkTime = "0時間00分00秒";

    if (totalMs > 0) {
      const totalSec = Math.floor(totalMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      sessionWorkTime = `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;
    }

    // ランク判定
    let rankContent = "";
    let color = "#6c757d";
    let bgColor = "#f8f9fa";

    if (totalMs > 0) {
      const speedVal = (stats.todayListings / (totalMs / 3600000));
      let feedback = "ゆったり";
      let emoji = "🐢";

      if (speedVal >= 120) {
        feedback = "爆速";
        emoji = "🚀";
        color = "#6f42c1";
        bgColor = "#f3e5f5";
      } else if (speedVal >= 60) {
        feedback = "高速";
        emoji = "🏎️";
        color = "#007bff";
        bgColor = "#e7f3ff";
      } else if (speedVal >= 30) {
        feedback = "着実";
        emoji = "💪";
        color = "#28a745";
        bgColor = "#e8f5e9";
      } else if (speedVal >= 10) {
        feedback = "のんびり";
        emoji = "🚲";
        color = "#ffc107";
        bgColor = "#fffde7";
      }

      // トロフィー判定に遊び（バッファ）を持たせる（点滅防止）
      const maxSpeed = stats?.todayMaxSpeed || 0;
      const hasTrophy = speedVal > 0 && speedVal >= (maxSpeed - 2);
      const trophyStr = hasTrophy ? " 🏆" : "";

      rankContent = `${feedback} ${emoji}${trophyStr}`;
    }

    const showPanel = STORE.opt.showWorkTimePanel !== false;
    const panelDisplay = showPanel ? 'inline' : 'none';
    const flexDisplay = showPanel ? 'inline-flex' : 'none';
    const rankDisplay = (showPanel && rankContent) ? 'inline-block' : 'none';

    let planBadgeText = "Free";
    let planBadgeBg = "#6c757d"; // default gray
    let planBadgeDisplay = 'inline-block';

    const currentPlan = (STORE.license.plan || "free").toLowerCase();
    const cancelAt = STORE.license.cancelAt || null;
    let cancelLabel = ''; // (○/○解約予定) を追加
    if (cancelAt) {
      const cd = new Date(cancelAt);
      cancelLabel = ` (${cd.getMonth() + 1}/${cd.getDate()}解約予定)`;
    }

    if (currentPlan === 'pro' && STORE.license.isProTrial) {
      // Pro プランだがトライアル期間中
      const daysLeft = STORE.license.proTrialDaysLeft ?? 30;
      planBadgeText = `Pro (Trial) 残り${daysLeft}日${cancelLabel}`;
      planBadgeBg = "#198754";
      if (cancelAt) planBadgeBg = '#6b7280'; // 解約予定は落ち着いたグレーに
    } else if (currentPlan === 'pro') {
      planBadgeText = `Pro${cancelLabel}`;
      planBadgeBg = "#1a73e8";
    } else if (currentPlan === 'premium') {
      planBadgeText = `Premium${cancelLabel}`;
      planBadgeBg = "#d63384";
    } else if (currentPlan === 'pro-trial' || (currentPlan === 'free' && STORE.license.isProTrial)) {
      const daysLeft = STORE.license.proTrialDaysLeft ?? 30;
      planBadgeText = `Pro (Trial) 残り${daysLeft}日${cancelLabel}`;
      planBadgeBg = "#198754";
      planBadgeDisplay = 'inline-block';
    } else if (currentPlan !== 'free') {
      planBadgeText = STORE.license.plan.charAt(0).toUpperCase() + STORE.license.plan.slice(1);
      planBadgeBg = "#0d6efd";
    } else {
      planBadgeText = "Free";
      planBadgeBg = "#6c757d";
      planBadgeDisplay = 'inline-block';
    }

    // 初回構築
    if (!UI.listingCountLabel.querySelector('.lfp-count-val')) {
      UI.listingCountLabel.innerHTML = `
      <span class="lfp-count-val" style="font-weight: bold; color: #111;">出品完了: ${stats.todayListings || 0}件</span>
      <span class="lfp-time-val" style="margin-left: 15px; color: #111; font-weight: bold; display: ${panelDisplay};">本日の作業時間: ${sessionWorkTime}</span>
      <span id="lfp-pause-resume-btn-placeholder" style="margin-left: 4px; display: ${flexDisplay}; align-items: center;"></span>
      <span class="lfp-rank-badge" style="margin-left: 10px; display: ${rankDisplay}; color: ${color}; background-color: ${bgColor}; border: 1px solid ${color}44; padding: 1px 10px; border-radius: 12px; font-size: 0.85em;">${rankContent}</span>
      <span class="lfp-plan-badge-inline" style="margin-left: 8px; display: ${planBadgeDisplay}; padding: 2px 6px; border-radius: 9px; color: #fff; background-color: ${planBadgeBg}; font-size: 11px; font-weight: bold;">${planBadgeText}</span>
      <span class="lfp-trial-val" style="display: none; margin-left: 12px; font-weight: bold; font-size: 11px; padding: 2px 6px; border: 1px solid transparent; border-radius: 4px;"></span>
      <span class="lfp-admin-val" style="display: none; margin-left: 8px; font-weight: bold; font-size: 11px; padding: 2px 6px; border: 1px solid transparent; border-radius: 4px;"></span>
    `;
      await createPauseResumeButton();
    } else {
      // 部分更新
      const countSpan = UI.listingCountLabel.querySelector('.lfp-count-val');
      const timeSpan = UI.listingCountLabel.querySelector('.lfp-time-val');
      const rankSpan = UI.listingCountLabel.querySelector('.lfp-rank-badge');
      const planSpan = UI.listingCountLabel.querySelector('.lfp-plan-badge-inline');

      if (countSpan) {
        countSpan.textContent = `出品完了: ${stats.todayListings || 0}件`;
        countSpan.style.color = "#111";
        countSpan.style.fontWeight = "bold";
      }
      if (timeSpan) {
        timeSpan.textContent = `本日の作業時間: ${sessionWorkTime}`;
        timeSpan.style.color = "#111";
        timeSpan.style.fontWeight = "bold";
        timeSpan.style.display = panelDisplay;
      }

      // ボタンのコンテナも制御
      const btnPlaceholder = document.getElementById('lfp-pause-resume-btn-placeholder');
      if (btnPlaceholder) {
        btnPlaceholder.style.display = flexDisplay;
      }

      if (rankSpan) {
        rankSpan.style.display = rankDisplay;
        rankSpan.textContent = rankContent;
        rankSpan.style.color = color;
        rankSpan.style.backgroundColor = bgColor;
        rankSpan.style.borderColor = `${color}44`;
      }

      // プランバッジ
      if (planSpan) {
        planSpan.textContent = planBadgeText;
        planSpan.style.backgroundColor = planBadgeBg;
        planSpan.style.display = planBadgeDisplay;
      }

      // トライアル回数の表示
      const trialSpan = UI.listingCountLabel.querySelector('.lfp-trial-val');
      if (trialSpan) {
        if ((STORE.license.plan === "free" || STORE.license.plan === "pro-trial") && STORE.license.isProTrial) {
          // プランバッジ側で「残りXX日」を表示するため、ここでの重複表示は隠す
          trialSpan.style.display = "none";
        } else if (STORE.license.plan === "free" && !STORE.license.isAdmin) {
          trialSpan.style.display = "inline-block";
          const count = STORE.license.usageCount || 0;
          const limit = STORE.license.dailyLimit || 2;
          trialSpan.textContent = `本日の使用状況: ${count} / ${limit}`;

          if (count >= limit) {
            trialSpan.textContent = "試用終了（アップグレードはこちら）";
            trialSpan.style.color = "#fff";
            trialSpan.style.background = "#d32f2f";
            trialSpan.style.borderColor = "#d32f2f";
            trialSpan.style.cursor = "pointer";
            trialSpan.onclick = () => showSubscriptionAlert();
          } else {
            trialSpan.style.color = "#d32f2f";
            trialSpan.style.background = "#fff5f5";
            trialSpan.style.borderColor = "#d32f2f";
            trialSpan.style.cursor = "default";
            trialSpan.onclick = null;
          }
        } else {
          trialSpan.style.display = "none";
        }
      }

      // 管理者モードバッジの表示（CSVボタンの右横に配置）
      const csvBtnEl = document.getElementById('lfp-csv-btn-id');
      const adminBar = csvBtnEl ? csvBtnEl.parentElement : null;

      // まず古い位置（listingCountLabel内）に残っているバッジがあれば削除
      const oldAdminInStats = UI.listingCountLabel.querySelector('.lfp-admin-val');
      if (oldAdminInStats) oldAdminInStats.remove();

      if (STORE.license.isAdmin && adminBar) {
        let adminSpan = adminBar.querySelector('.lfp-admin-val');
        if (!adminSpan) {
          adminSpan = document.createElement('span');
          adminSpan.className = 'lfp-admin-val';
          adminSpan.style.cssText = 'display: inline-block; margin-left: 8px; font-weight: bold; font-size: 11px; padding: 2px 8px; border: 1px solid #28a745; border-radius: 4px; color: #28a745; background: #e8f5e9; cursor: default; white-space: nowrap; vertical-align: middle;';
          adminSpan.textContent = '管理者モード：無制限';
          if (csvBtnEl.nextSibling) {
            adminBar.insertBefore(adminSpan, csvBtnEl.nextSibling);
          } else {
            adminBar.appendChild(adminSpan);
          }
        } else {
          adminSpan.style.display = 'inline-block';
        }
      } else if (adminBar) {
        const existingAdmin = adminBar.querySelector('.lfp-admin-val');
        if (existingAdmin) existingAdmin.style.display = 'none';
      }

      // ランクバッジのクリックイベントを削除（ユーザー要望により試用終了ラベル側に移動）
      if (rankSpan) {
        rankSpan.style.cursor = "default";
        rankSpan.onclick = null;
      }

      // ボタンの状態も同期
      if (UI.pauseResumeBtn) {
        updatePauseResumeButtonUI(UI.pauseResumeBtn, stats.isCounterPaused);
      }
    }

    // 試用終了時の最適化ボタン制御
    if (UI.btnOpt) {
      // 1. 出品NG（警告等）の場合は常に無効化
      if (!STORE.optimizeState.isListable) {
        UI.btnOpt.disabled = true;
        UI.btnOpt.classList.remove('highlight');
      }
      // 2. 試用制限に達している場合
      else {
        const isBasicLimit = !STORE.license.isAdmin && STORE.license.plan === 'free' && STORE.license.usageCount >= (STORE.license.dailyLimit || 2);
        if (isBasicLimit) {
          UI.btnOpt.classList.add('lfp-btn-disabled');
          UI.btnOpt.classList.remove('highlight');
          // disabled属性は付けず、スタイルのみグレーアウトにしてクリックイベントでアラートを出す
          UI.btnOpt.disabled = false;
        } else {
          UI.btnOpt.classList.remove('lfp-btn-disabled');
          UI.btnOpt.disabled = false;
          if (STORE.opt.highlightOptimize) {
            UI.btnOpt.classList.add('highlight');
          }
        }
      }
    }
  } catch (err) {
    if (err.message && (err.message.includes('Extension context invalidated') || err.message.includes('context_invalidated'))) {
      stopWorkTimeUpdateTimer();
    } else if (err.message && err.message.includes('message channel closed')) {
      // transient message channel errors are normal during page transitions/unloads, suppress log
      console.log('[LFP] refreshListingCountUI: Message channel closed (transient)');
    } else {
      console.error('[LFP] refreshListingCountUI error:', err);
    }
  }
}

function refreshCustomDropdown(hist) {
  if (!UI.histSel || !UI.histSel.isConnected) return;

  // 既存のカスタムドロップダウンの状態を取得
  const existingDropdown = document.getElementById('lfp-custom-dropdown');
  let currentDisplay = 'none';
  if (existingDropdown) {
    currentDisplay = existingDropdown.style.display;
    existingDropdown.remove();
  }

  // カスタムドロップダウンを作成
  const dropdown = document.createElement('div');
  dropdown.id = 'lfp-custom-dropdown';
  dropdown.className = 'lfp-custom-dropdown';
  dropdown.style.display = currentDisplay;

  // プレースホルダーは削除（ASINを上に詰める）

  // 履歴アイテム
  for (const entry of hist) {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'lfp-dropdown-item-wrapper';

    const item = document.createElement('div');
    item.className = 'lfp-dropdown-item';
    item.dataset.asin = entry.asin;

    // フラグに応じて表示を変える
    let flagText = '';
    let isBad = false;

    // no_listings または no_item フラグが立っている場合は最優先で表示
    if (entry.flags.no_listings) {
      flagText = 'No listings';
      isBad = true;
    } else if (entry.flags.no_item) {
      flagText = 'No item';
      isBad = true;
    } else {
      // 複数のフラグを配列で収集
      const flagLabels = [];
      if (entry.flags.protected) flagLabels.push("protected");
      if (entry.flags.brand) flagLabels.push("brand");
      if (entry.flags.already_listed) flagLabels.push("already_listed");

      if (flagLabels.length > 0) {
        flagText = flagLabels.join(" / ");
        isBad = true;
      }
    }

    // ASIN表示用のspan
    const asinSpan = document.createElement('span');
    asinSpan.className = 'lfp-dropdown-asin';
    asinSpan.textContent = isBad ? `${entry.flags.no_listings || entry.flags.no_item ? '!' : '×'} ${entry.asin}` : entry.asin;

    item.appendChild(asinSpan);

    // エラータグがある場合は別のspanとして中央に配置
    if (flagText) {
      const flagSpan = document.createElement('span');
      flagSpan.className = 'lfp-dropdown-flag';
      flagSpan.textContent = flagText;
      item.appendChild(flagSpan);
    }

    if (isBad) item.classList.add('lfp-dropdown-item-bad');

    // クリックイベント
    item.addEventListener('click', () => {
      selectHistoryAsin(entry.asin);
      dropdown.style.display = 'none';
    });

    // 削除ボタンを追加
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'lfp-dropdown-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'この履歴を削除';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();

      // 先にDOMからスムーズに消す（視覚的フィードバック即座）
      itemWrapper.style.transition = 'opacity 0.15s ease-out, max-height 0.2s ease-out';
      itemWrapper.style.opacity = '0';
      itemWrapper.style.maxHeight = itemWrapper.offsetHeight + 'px';
      itemWrapper.style.overflow = 'hidden';

      // アニメーション開始
      requestAnimationFrame(() => {
        itemWrapper.style.maxHeight = '0';
        itemWrapper.style.paddingTop = '0';
        itemWrapper.style.paddingBottom = '0';
        itemWrapper.style.marginTop = '0';
        itemWrapper.style.marginBottom = '0';
      });

      // ストレージ更新は非同期で行う（UIをブロックしない）
      await deleteHistoryItemFromContent(entry.asin);

      // アニメーション完了後にDOMから削除
      setTimeout(() => {
        if (itemWrapper.isConnected) itemWrapper.remove();
      }, 200);

      // selectの件数表示も更新（ドロップダウンは再構築しない）
      const currentCount = document.querySelectorAll('.lfp-dropdown-item-wrapper').length - 1;
      if (UI.histSel) {
        UI.histSel.innerHTML = `<option value="">ASIN履歴（直近1000件） ${currentCount}/1000</option>`;
      }
    });

    itemWrapper.appendChild(item);
    itemWrapper.appendChild(deleteBtn);
    dropdown.appendChild(itemWrapper);
  }

  // selectの親要素に追加
  UI.histSel.parentElement.style.position = 'relative';
  UI.histSel.parentElement.appendChild(dropdown);

  // 既存のイベントリスナーを削除（メモリリーク防止）
  if (dropdownMousedownHandler) {
    UI.histSel.removeEventListener('mousedown', dropdownMousedownHandler);
  }
  if (dropdownClickHandler) {
    document.removeEventListener('click', dropdownClickHandler);
  }

  // selectのクリックでカスタムドロップダウンを表示
  dropdownMousedownHandler = (e) => {
    e.preventDefault();
    const currentDropdown = document.getElementById('lfp-custom-dropdown');
    if (!currentDropdown) return;
    const isVisible = currentDropdown.style.display === 'block';
    currentDropdown.style.display = isVisible ? 'none' : 'block';

    // ポジションを調整
    if (UI.histSel) {
      const rect = UI.histSel.getBoundingClientRect();
      currentDropdown.style.top = `${rect.height}px`;
      currentDropdown.style.left = '0';
      currentDropdown.style.width = `${rect.width}px`;
    }
  };
  UI.histSel.addEventListener('mousedown', dropdownMousedownHandler);

  // 外側クリックで閉じる
  dropdownClickHandler = (e) => {
    const currentDropdown = document.getElementById('lfp-custom-dropdown');
    if (!currentDropdown) return;
    if (!UI.histSel?.contains(e.target) && !currentDropdown.contains(e.target)) {
      currentDropdown.style.display = 'none';
    }
  };
  document.addEventListener('click', dropdownClickHandler);
}

async function selectHistoryAsin(asin) {
  // ASIN入力欄にセット
  const btnGet = findButtonByText(/^Get Item$/i);
  const asinInput = findAsinInputSmart(btnGet);
  if (asinInput) {
    // inputイベントリスナー側の重複実行を防止するためタイムスタンプを更新
    lastPasteAt = Date.now();
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
