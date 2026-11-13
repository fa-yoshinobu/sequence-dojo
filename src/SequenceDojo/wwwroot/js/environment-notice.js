export function showPortNotice(doc = document, page = location) {
  if (!page.port || page.port === '5087') return false;
  const notice = doc.getElementById('portNotice');
  notice.textContent = `ポート ${page.port} で起動しています。接続設定・配線は元のポート（通常5087）と別扱いです。保存した .sdojo ファイルから開いて復元してください。`;
  notice.hidden = false;
  const updateHeight = () => doc.documentElement.style.setProperty('--port-notice-height', `${notice.getBoundingClientRect().height}px`);
  updateHeight();
  globalThis.addEventListener?.('resize', updateHeight);
  return true;
}
