const KEY_HIST = "lfp_asin_history_v1";

document.addEventListener('DOMContentLoaded', async () => {
  await loadAndRenderHistory();
  setupEventListeners();
});

async function loadAndRenderHistory() {
  const tableBody = document.getElementById('historyTableBody');
  
  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    const history = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];

    if (history.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4">履歴がありません</td></tr>';
      return;
    }

    // 履歴を新しい順に表示
    const sortedHistory = [...history].reverse();

    tableBody.innerHTML = '';
    sortedHistory.forEach(item => {
      const tr = document.createElement('tr');
      
      // 日付のフォーマット (M/D)
      const date = item.timestamp ? new Date(item.timestamp) : new Date();
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

      // ステータス判定
      let resultText = '出品完了';
      let resultClass = 'status-success';
      let dateCol1 = dateStr; // 出品日
      let dateCol2 = '';      // エラーにより出品不可

      if (item.flags?.protected || item.flags?.brand || item.flags?.already_listed || item.flags?.no_listings) {
        const flags = [];
        if (item.flags.protected) flags.push('Protected');
        if (item.flags.brand) flags.push('Brand');
        if (item.flags.already_listed) flags.push('Already listed');
        if (item.flags.no_listings) flags.push('No listings');
        
        resultText = flags.join(', ');
        resultClass = 'status-error';
        dateCol1 = '';
        dateCol2 = dateStr;
      }

      tr.innerHTML = `
        <td>${item.asin}</td>
        <td class="${resultClass}">${resultText}</td>
        <td>${dateCol1}</td>
        <td>${dateCol2}</td>
      `;
      tableBody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load history:', err);
    tableBody.innerHTML = '<tr><td colspan="4">読み込みエラーが発生しました</td></tr>';
  }
}

function setupEventListeners() {
  document.getElementById('copyTwoColumnsBtn').addEventListener('click', copyTwoColumns);
  document.getElementById('downloadCsvBtn').addEventListener('click', downloadCsv);
}

async function copyTwoColumns() {
  const rows = document.querySelectorAll('#historyTableBody tr');
  let copyText = '';

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 4) {
      let col3 = cells[2].textContent.trim(); // 出品日
      let col4 = cells[3].textContent.trim(); // エラーにより出品不可
      
      // 空白セルにスペースを追加（スプレッドシートの選択範囲認識のため）
      if (col3 === '') col3 = ' ';
      if (col4 === '') col4 = ' ';
      
      copyText += `${col3}\t${col4}\n`;
    }
  });

  try {
    await navigator.clipboard.writeText(copyText);
    const btn = document.getElementById('copyTwoColumnsBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="icon">✅</span> コピー完了！';
    setTimeout(() => { btn.innerHTML = originalText; }, 2000);
  } catch (err) {
    alert('コピーに失敗しました');
  }
}

function downloadCsv() {
  const rows = document.querySelectorAll('#historyTable tr');
  let csvContent = "\uFEFF"; // BOM for Excel

  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData = Array.from(cols).map(col => `"${col.textContent.trim()}"`).join(",");
    csvContent += rowData + "\r\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `LFP_ASIN履歴_${new Date().toLocaleDateString()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
