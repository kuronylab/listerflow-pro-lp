const KEY_HIST = "lfp_asin_history_v1";

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  await loadAndRenderHistory();
  setupEventListeners();
});

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (!msg) return;
    if (el.tagName === 'TITLE') {
      document.title = msg;
    } else if (el.id === 'copyTwoColumnsBtn') {
      el.innerHTML = `<span class="icon">📋</span> ${msg}`;
    } else if (el.id === 'downloadCsvBtn') {
      el.innerHTML = `<span class="icon">📥</span> ${msg}`;
    } else {
      el.textContent = msg;
    }
  });
}

async function loadAndRenderHistory() {
  const tableBody = document.getElementById('historyTableBody');
  if (!tableBody) return;

  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    const history = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];

    if (history.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4">${chrome.i18n.getMessage("msgNoHistory")}</td></tr>`;
      return;
    }

    // 新しい順に表示
    const sortedHistory = [...history].reverse();

    tableBody.innerHTML = '';
    sortedHistory.forEach(item => {
      const tr = document.createElement('tr');
      const date = item.timestamp ? new Date(item.timestamp) : new Date();
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

      let resultText = chrome.i18n.getMessage("uiCompleted");
      let resultClass = 'status-success';
      let dateCol1 = dateStr;
      let dateCol2 = '';

      // エラー判定
      const isError = item.flags?.protected || item.flags?.brand || item.flags?.already_listed || item.flags?.no_listings || item.flags?.no_item;

      if (isError) {
        const flags = [];
        if (item.flags.protected) flags.push('Protected');
        if (item.flags.brand) flags.push('Brand');
        if (item.flags.already_listed) flags.push('Already listed');
        if (item.flags.no_listings) flags.push('No listings');
        if (item.flags.no_item) flags.push('No item');

        resultText = flags.length > 0 ? flags.join(', ') : chrome.i18n.getMessage("msgHistoryClearErrorTitle");
        resultClass = 'status-error';
        dateCol1 = ''; // 正常列は空
        dateCol2 = dateStr; // エラー列に日付
      }

      tr.innerHTML = `
        <td><a href="https://www.amazon.com/dp/${item.asin}" target="_blank" rel="noopener noreferrer" style="color: #007bff; text-decoration: none;">${item.asin}</a></td>
        <td class="${resultClass}">${resultText}</td>
        <td>${dateCol1}</td>
        <td>${dateCol2}</td>
      `;
      tableBody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load history:', err);
    tableBody.innerHTML = `<tr><td colspan="4">${chrome.i18n.getMessage("msgHistoryLoadError")}</td></tr>`;
  }
}

function setupEventListeners() {
  document.getElementById('copyTwoColumnsBtn')?.addEventListener('click', copyTwoColumns);
  document.getElementById('downloadCsvBtn')?.addEventListener('click', downloadCsv);
}

async function copyTwoColumns() {
  const rows = document.querySelectorAll('#historyTableBody tr');
  let copyText = '';

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 4) {
      // スプレッドシートへの貼り付け用にタブ区切り。
      // 表示上の「出品完了」を内部値の「-」に変換
      let col3 = cells[2].textContent.trim();
      let col4 = cells[3].textContent.trim();

      // 空の場合は「-」に変換
      if (!col3) col3 = '-';
      if (!col4) col4 = '-';

      copyText += `${col3}\t${col4}\n`;
    }
  });

  if (!copyText) {
    alert(chrome.i18n.getMessage("msgNoHistoryToCopy"));
    return;
  }

  try {
    await navigator.clipboard.writeText(copyText);
    const btn = document.getElementById('copyTwoColumnsBtn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<span class="icon">✅</span> ${chrome.i18n.getMessage("exportCopyDone")}`;
    setTimeout(() => { btn.innerHTML = originalContent; }, 2000);
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    alert(chrome.i18n.getMessage("exportCopyFailed"));
  }
}

function downloadCsv() {
  const rows = document.querySelectorAll('#historyTable tr');
  if (rows.length <= 1) {
    alert(chrome.i18n.getMessage("msgNoHistoryToExport"));
    return;
  }

  let csvContent = "\uFEFF"; // BOM for Japanese Excel

  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData = Array.from(cols).map(col => `"${col.textContent.trim().replace(/"/g, '""')}"`).join(",");
    csvContent += rowData + "\r\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `LFP_ASIN_History_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
