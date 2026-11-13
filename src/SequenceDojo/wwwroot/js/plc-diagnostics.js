const storageKey = 'seqdojo.plcEvents';
let entries = [];
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (Array.isArray(saved)) entries = saved.filter(x => typeof x === 'string').slice(-40);
} catch { /* 記録の読込み失敗で操作を止めない。 */ }

export function showPlcEvents() {
  const el = document.getElementById('plcEvents');
  if (el) el.textContent = entries.join('\n') || '型式の選択・切替をここに記録します。';
}

export function recordPlcEvent(action, detail = '') {
  const line = `${new Date().toISOString()} ${action} ${detail}`.slice(0, 1800);
  entries.push(line);
  entries = entries.slice(-40);
  try { localStorage.setItem(storageKey, JSON.stringify(entries)); } catch { /* 容量・権限エラーでも操作を続ける。 */ }
  showPlcEvents();
  try {
    void fetch('/api/client-errors', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'event', message: `PLC型式: ${line}` }),
    }).catch(() => {});
  } catch { /* 診断記録の通信失敗は再送ループにしない。 */ }
}
