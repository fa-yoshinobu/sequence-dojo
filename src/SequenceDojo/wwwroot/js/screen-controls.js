import { PLC_MODELS } from './wiring-circuit.js';
export function createScreenControls(st, view, hooks, store, restore) {
  const { wiring, placeWork, removeWork, clearWorks } = view;
  const buildIoTables = () => hooks.buildIoTables();
  const markDirty = () => hooks.markDirty();
  // ---------------------------------------------------------------- 起動ロゴ
  // ボタン君が押して PL1 が点灯するまで見せてから消す。クリック・キーでスキップ
  function runSplash() {
    const el = document.getElementById('splash');
    if (!el) return Promise.resolve();
    return new Promise(resolve => {
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        el.classList.add('hide');
        removeEventListener('keydown', end);
        setTimeout(() => { el.remove(); resolve(); }, 500);
      };
      el.addEventListener('click', end);
      addEventListener('keydown', end);
      setTimeout(end, 2600);
    });
  }

  // ---------------------------------------------------------------- ヘルプ
  const helpDlg = document.getElementById('help');
  const helpNoAuto = document.getElementById('helpNoAuto');
  function toggleHelp(open = !helpDlg.open) {
    if (open && !helpDlg.open) helpDlg.showModal();
    else if (!open && helpDlg.open) helpDlg.close();
  }
  document.getElementById('btnHelp').onclick = () => toggleHelp(true);
  helpDlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => toggleHelp(false)));
  helpDlg.addEventListener('click', e => { if (e.target === helpDlg) toggleHelp(false); }); // 枠外クリックで閉じる
  helpDlg.querySelectorAll('.help-nav a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    helpDlg.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  helpNoAuto.checked = restore('helpNoAuto', false);
  helpNoAuto.addEventListener('change', () => store('helpNoAuto', helpNoAuto.checked));

  // ---------------------------------------------------------------- タブ
  const tabs = document.querySelectorAll('.tabs button');
  function showTab(name) {
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
    store('tab', name);
  }
  tabs.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------------------------------------------------------------- ワーク UI
  const screwBoxes = [...document.querySelectorAll('[data-screw]')];
  const readScrews = () => screwBoxes.map(b => b.checked);
  function updateHinban() {
    const s = readScrews();
    document.getElementById('hinban').textContent = (s[2] ? 1 : 0) + (s[1] ? 2 : 0) + (s[0] ? 4 : 0);
  }
  screwBoxes.forEach(b => b.addEventListener('change', () => {
    if (st.selWork) st.selWork.screws = readScrews();
    updateHinban();
  }));
  for (const [id, at] of [['btnPlaceLeft', 'left'], ['btnPlaceCenter', 'center'], ['btnPlaceRight', 'right']])
    document.getElementById(id).onclick = () => { if (!placeWork(at, readScrews())) alert('その位置には既にワークがあります'); };
  document.getElementById('btnRemoveSel').onclick = () => { if (st.selWork) removeWork(st.selWork); };
  document.getElementById('btnRemoveAll').onclick = clearWorks;
  const multiWorkBox = document.getElementById('multiWork');
  function setMultiWork(on) {
    // 検定の範囲外の機能なので、アプリには記憶しない（起動時は常にオフ。*.sdojo を開いたときだけ復元）
    st.multiWork = on;
    multiWorkBox.checked = on;
    // 1個モードに戻したら選択中（なければ最初）のワークだけ残す
    if (!on && st.works.length > 1) {
      const keep = st.selWork ?? st.works[0];
      st.works.filter(w => w !== keep).forEach(removeWork);
    }
  }
  multiWorkBox.addEventListener('change', () => setMultiWork(multiWorkBox.checked));

  // ---------------------------------------------------------------- 配線 UI
  const wiringModeBox = document.getElementById('wiringMode');
  function setWireMsg(t) { document.getElementById('wireMsg').textContent = t ?? ''; }
  function setWiringMode(on) {
    st.wiringMode = on;
    wiringModeBox.checked = on;
    wiring.wireGroup.visible = on;
    if (!on) { wiring.cancel(); wiring.select(null); }
    store('wiringMode', on);
    buildIoTables();
  }
  wiringModeBox.addEventListener('change', () => setWiringMode(wiringModeBox.checked));
  const plcModelSel = document.getElementById('plcModel');
  plcModelSel.innerHTML = Object.entries(PLC_MODELS).map(([id, m]) => `<option value="${id}">${m.name}</option>`).join('');
  plcModelSel.value = wiring.modelId;
  plcModelSel.addEventListener('change', () => {
    const dropped = wiring.setModel(plcModelSel.value);
    store('plcModel', wiring.modelId);
    setWireMsg(dropped ? `機種を切り替えました（切替先に無い端子の配線 ${dropped} 本を外しました）` : '機種を切り替えました');
  });
  wiring.onChange = () => {
    markDirty();
    store('wires', wiring.toJSON());
    document.getElementById('wireCount').textContent = wiring.wires.length;
    buildIoTables();
  };
  document.getElementById('btnViewWiring').onclick = () => view.goView('wiring');
  document.getElementById('btnAutoWire').onclick = () => {
    if (wiring.wires.length && !confirm('今の配線を消して標準配線を作りますか？')) return;
    wiring.autoStandard();
    setWireMsg('標準割付どおりに配線しました');
  };
  document.getElementById('btnDelWire').onclick = () => { if (wiring.selected) wiring.removeWire(wiring.selected); };
  document.getElementById('btnClearWire').onclick = () => { if (confirm('ケーブルを全部外しますか？')) wiring.clear(); };
  document.getElementById('btnCheck').onclick = () => {
    const ul = document.getElementById('checkResult');
    ul.innerHTML = '';
    for (const r of wiring.check()) {
      const li = document.createElement('li');
      li.className = r.level;
      li.textContent = r.text;
      ul.appendChild(li);
    }
  };


  return { runSplash, toggleHelp, helpOpen: () => helpDlg.open, showTab, screwBoxes, updateHinban, setMultiWork, multiWorkBox, setWiringMode, wiringModeBox, plcModelSel, setWireMsg, selectWork(w) { if (w) screwBoxes.forEach((b, i) => { b.checked = w.screws[i]; }); updateHinban(); } };
}
