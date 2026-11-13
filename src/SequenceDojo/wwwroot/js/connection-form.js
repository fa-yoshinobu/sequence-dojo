
export function createConnectionForm(st, hooks, store, restore) {
  const buildIoTables = () => hooks.buildIoTables();
  const send = obj => hooks.send(obj);
  const setBadge = (...args) => hooks.setBadge(...args);
  // ---------------------------------------------------------------- 接続フォーム（通信先 PLC）
  // 通信方式ごとの既定値。方式を切り替えたときにポートと先頭デバイスをこの値にする
  const PROTOCOLS = {
    melsec: { port: 5000, profile: 'melsec:iq-f', inputStart: 'X0', outputStart: 'Y0',
      hint: '例: X0 / Y0（iQ-F は 8 進、その他は 16 進）、M100 など' },
    keyence: { port: 8501, profile: 'keyence:kv-8000', inputStart: 'MR000', outputStart: 'MR100',
      hint: '例: MR000 / MR100、R000 / R500（XYM 表記の機種は X0 / Y0）' },
    modbus: { port: 502, profile: '', inputStart: 'C0', outputStart: 'C16',
      hint: '0 起点。入力先頭は C（16 コイル）か HR（1 レジスタの 16 ビット）、出力先頭は C / DI / HR / IR' },
  };
  const LEGACY_PROFILE = { IqF: 'melsec:iq-f', IqR: 'melsec:iq-r', IqL: 'melsec:iq-l', QnU: 'melsec:qnu', QnUDV: 'melsec:qnudv', LCpu: 'melsec:lcpu' };
  let catalog = {
    melsec: [{ name: 'melsec:iq-f', displayName: 'MELSEC iQ-F' }, { name: 'melsec:iq-r', displayName: 'MELSEC iQ-R' }],
    keyence: [{ name: 'keyence:kv-8000', displayName: 'KEYENCE KV-8000' }],
    gxSimulator: ['melsec:iq-r', 'melsec:iq-l'], kvSimulator: ['keyence:kv-8000', 'keyence:kv-x500'],
  };
  const catalogReady = fetch('api/profiles').then(r => r.json()).then(c => { catalog = c; }).catch(() => { });

  const form = document.getElementById('connForm');
  const F = form.elements;

  // 保存された設定・ファイルの設定に足りない項目を既定値で補う
  function normalizeConfig(c) {
    const cfg = { protocol: 'melsec', host: '192.168.3.250', transport: 'Tcp', intervalMs: 30, unitId: 1, simulator: false, ...c };
    if (LEGACY_PROFILE[cfg.profile]) cfg.profile = LEGACY_PROFILE[cfg.profile];
    if (!PROTOCOLS[cfg.protocol]) cfg.protocol = 'melsec';
    const d = PROTOCOLS[cfg.protocol];
    cfg.port ||= d.port;
    cfg.inputStart ||= d.inputStart;
    cfg.outputStart ||= d.outputStart;
    return cfg;
  }
  function fillProfiles(protocol, selected) {
    const list = catalog[protocol] ?? [];
    F.profile.innerHTML = list.map(p => `<option value="${p.name}">${p.displayName}</option>`).join('');
    F.profile.value = list.some(p => p.name === selected) ? selected : (PROTOCOLS[protocol].profile || list[0]?.name || '');
  }
  // 通信方式・機種に応じて項目を出し分ける
  function updateFormVisibility() {
    const protocol = F.protocol.value;
    form.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(protocol); });
    const simList = protocol === 'melsec' ? catalog.gxSimulator : protocol === 'keyence' ? catalog.kvSimulator : [];
    const canSim = simList.includes(F.profile.value);
    form.querySelector('[data-sim]').hidden = !canSim;
    if (!canSim) F.simulator.checked = false;
    document.getElementById('simLabel').textContent = protocol === 'melsec'
      ? 'GX Simulator 3 に接続（127.0.0.1:5511）' : 'KV STUDIO シミュレータに接続（127.0.0.1:8501）';
    form.querySelectorAll('[data-net] input, [data-net] select').forEach(el => { el.disabled = F.simulator.checked; });
    document.getElementById('addrHint').textContent = PROTOCOLS[protocol].hint;
  }
  async function fillForm() {
    await catalogReady;
    const cfg = normalizeConfig({ ...st.config, ...restore('config', {}) });
    F.protocol.value = cfg.protocol;
    fillProfiles(cfg.protocol, cfg.profile);
    for (const k of ['host', 'port', 'transport', 'inputStart', 'outputStart', 'intervalMs', 'unitId'])
      if (cfg[k] != null) F[k].value = cfg[k];
    if (!F.unitId.value) F.unitId.value = 1;
    F.simulator.checked = !!cfg.simulator;
    updateFormVisibility();
    st.config = readForm();
    buildIoTables();
  }
  function readForm() {
    return {
      protocol: F.protocol.value, profile: F.profile.value, simulator: F.simulator.checked,
      host: F.host.value.trim(), port: +F.port.value, transport: F.transport.value, unitId: +F.unitId.value || 0,
      inputStart: F.inputStart.value.trim().toUpperCase(), outputStart: F.outputStart.value.trim().toUpperCase(),
      intervalMs: +F.intervalMs.value || 30,
    };
  }
  F.protocol.addEventListener('change', () => {
    const d = PROTOCOLS[F.protocol.value];
    fillProfiles(F.protocol.value, d.profile);
    F.port.value = d.port;
    F.inputStart.value = d.inputStart;
    F.outputStart.value = d.outputStart;
    F.simulator.checked = false;
  });
  form.addEventListener('change', () => { updateFormVisibility(); st.config = readForm(); buildIoTables(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    st.config = readForm();
    store('config', st.config);
    buildIoTables();
    setBadge('接続中…', 'off');
    send({ type: 'connect', config: st.config });
  });
  document.getElementById('btnDisconnect').onclick = () => send({ type: 'disconnect' });

  // I/O モニタに出す通信先のデバイス名（先頭デバイスから offset 点目）
  function deviceName(start, offset) {
    const cfg = st.config ?? {};
    const m = /^([A-Z]+)([0-9A-F]+)$/.exec(start ?? '');
    if (!m) return '?';
    const [, dev, num] = m;
    if (cfg.protocol === 'modbus') {
      if (dev === 'C' || dev === 'DI') return dev + (parseInt(num, 10) + offset);
      return `${dev}${parseInt(num, 10)}.${offset}`;             // HR / IR はレジスタ内のビット
    }
    if (cfg.protocol === 'keyence') {
      if (['R', 'MR', 'LR', 'CR'].includes(dev)) {                 // チャンネル＋ビット（R000〜R015、R100〜）
        const n = parseInt(num, 10), idx = Math.floor(n / 100) * 16 + (n % 100) + offset;
        return dev + Math.floor(idx / 16) + String(idx % 16).padStart(2, '0');
      }
      if (dev === 'X' || dev === 'Y') {                            // XYM 表記: 末尾 1 桁が 16 進
        const idx = parseInt(num.slice(0, -1) || '0', 10) * 16 + parseInt(num.slice(-1), 16) + offset;
        return dev + (Math.floor(idx / 16) || '') + (idx % 16).toString(16).toUpperCase();
      }
      if (dev === 'B' || dev === 'VB') return dev + (parseInt(num, 16) + offset).toString(16).toUpperCase();
      return dev + (parseInt(num, 10) + offset);
    }
    // MELSEC: iQ-F の X/Y は 8 進、その他の X/Y・B は 16 進、M などは 10 進
    const iqf = (cfg.profile ?? '').startsWith('melsec:iq-f');
    const base = dev === 'X' || dev === 'Y' ? (iqf ? 8 : 16) : dev === 'B' ? 16 : 10;
    return dev + (parseInt(num, base) + offset).toString(base).toUpperCase();
  }


  return { form, readForm, fillForm, normalizeConfig, deviceName };
}
