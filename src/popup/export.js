const KEY_HIST = "lfp_asin_history_v1";

document.addEventListener('DOMContentLoaded', async () => {
  await loadAndRenderHistory();
  setupEventListeners();
});

async function loadAndRenderHistory() {
  const tableBody = document.getElementById('historyTableBody');
  if (!tableBody) return;
  
  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    const history = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];

    if (history.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4">履歴がありません</td></tr>';
      return;
    }

    const sortedHistory = [...history].reverse();

    tableBody.innerHTML = '';
    sortedHistory.forEach(item => {
      const tr = document.createElement('tr');
      const date = item.timestamp ? new Date(item.timestamp) : new Date();
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

      let resultText = '出品完了';
      let resultClass = 'status-success';
      let dateCol1 = dateStr;
      let dateCol2 = '';

      if (item.flags?.protected || item.flags?.brand || item.flags?.already_listed || item.flags?.no_listings || item.flags?.no_item) {
        const flags = [];
        if (item.flags.protected) flags.push('Protected');
        if (item.flags.brand) flags.push('Brand');
        if (item.flags.already_listed) flags.push('Already listed');
        if (item.flags.no_listings) flags.push('No listings');
        if (item.flags.no_item) flags.push('No item');
        
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
      let col3 = cells[2].textContent.trim() || '　';
      let col4 = cells[3].textContent.trim() || '　';
      copyText += `${col3}\t${col4}\n`;
    }
  });

  try {
    await navigator.clipboard.writeText(copyText);
    const btn = document.getElementById('copyTwoColumnsBtn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="icon">✅</span> コピー完了！';
    setTimeout(() => { btn.innerHTML = originalContent; }, 2000);
  } catch (err) {
    alert('コピーに失敗しました');
  }
}

function downloadCsv() {
  const rows = document.querySelectorAll('#historyTable tr');
  let csvContent = "\uFEFF";

  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData = Array.from(cols).map(col => `"${col.textContent.trim().replace(/"/g, '""')}"`).join(",");
    csvContent += rowData + "\r\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `LFP_ASIN履歴_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
  link.click();
}
