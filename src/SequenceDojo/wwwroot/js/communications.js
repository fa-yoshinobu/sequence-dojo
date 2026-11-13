
export function createCommunications(st, hooks) {
  // ---------------------------------------------------------------- 通信
  let ws = null;
  function connectWs() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { hooks.onOpen(); };
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') applyServerState(m.state);
    };
    ws.onclose = () => { st.connected = false; setBadge('サーバ切断', 'err'); setTimeout(connectWs, 1500); };
  }
  function send(obj) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

  function applyServerState(s) {
    const wasConnected = st.connected;
    st.connected = s.connected;
    st.serverY = s.outputs;
    if (!st.config) { st.config = s.config; hooks.buildIoTables(); }
    document.getElementById('connMsg').textContent = s.error ?? '';
    if (s.connected) setBadge(`接続中 ${s.scanMs.toFixed(0)}ms`, 'on');
    else setBadge(s.error ? 'エラー' : '未接続', s.error ? 'err' : 'off');
    document.getElementById('connBadge').title = s.endpoint ?? '';
    if (wasConnected !== s.connected) {
      document.querySelector('#ioOut').closest('table').classList.toggle('manual', !s.connected);
      document.getElementById('outHint').style.display = s.connected ? 'none' : '';
    }
  }
  function setBadge(text, cls) {
    const b = document.getElementById('connBadge');
    b.textContent = text;
    b.className = `badge ${cls}`;
  }


  return { connectWs, send, setBadge };
}
