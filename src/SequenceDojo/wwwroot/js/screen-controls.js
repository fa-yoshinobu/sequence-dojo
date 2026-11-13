import { PLC_MODELS } from './wiring-circuit.js';
import { terminalDetails, unsupportedModelReason } from './plc-models.js';
import { recordPlcEvent, showPlcEvents } from './plc-diagnostics.js';
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
  const plcPicker = document.getElementById('plcPicker');
  const plcSummary = document.getElementById('plcPickerSummary');
  plcSummary.title = '↑↓で型式と3D表示を切替／クリックで一覧';
  plcSummary.addEventListener('keydown', e => {
    if (plcPicker.open || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || plcModelSel.disabled) return;
    const ids = [...plcModelSel.options].filter(o => !o.disabled).map(o => o.value);
    const current = ids.indexOf(wiring.modelId);
    const next = current < 0 ? (e.key === 'ArrowDown' ? 0 : ids.length - 1)
      : current + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= ids.length) return;
    plcModelSel.value = ids[next];
    applyPlcModel();
  });
  plcPicker.addEventListener('toggle', () => {
    if (plcPicker.open && !plcModelSel.disabled) plcModelSel.focus();
  });
  const seriesFilter = document.getElementById('plcSeries');
  const outputFilter = document.getElementById('plcOutput');
  const terminalFilter = document.getElementById('plcTerminal');
  const seriesNames = [...new Set(Object.values(PLC_MODELS).map(m => m.series))];
  seriesFilter.innerHTML = '<option value="">すべて</option>' + seriesNames.map(s => `<option>${s}</option>`).join('');
  function renderPlcChoices() {
    const choices = Object.entries(PLC_MODELS).filter(([, m]) =>
      (!seriesFilter.value || m.series === seriesFilter.value) &&
      (!outputFilter.value || m.outputType === outputFilter.value) &&
      (!terminalFilter.value || m.terminalType.includes(terminalFilter.value === 'spring' ? '差し込み' : 'ねじ止め')));
    plcModelSel.innerHTML = `<option value="" disabled>${choices.length ? '型式を選択' : '該当する型式がありません'}</option>` +
      seriesNames.map(series => {
        const items = choices.filter(([, m]) => m.series === series);
        return items.length ? `<optgroup label="${series}">${items.map(([id, m]) => `<option value="${id}">${m.title}</option>`).join('')}</optgroup>` : '';
      }).join('');
    plcModelSel.disabled = !choices.length;
    plcModelSel.value = choices.some(([id]) => id === wiring.modelId) ? wiring.modelId : '';
    document.getElementById('plcModelCount').textContent = `${choices.length}件` +
      (plcModelSel.value ? '' : '（現在の型式は変更していません）');
  }
  function syncPlcModel() {
    seriesFilter.value = outputFilter.value = terminalFilter.value = '';
    renderPlcChoices();
  }
  for (const el of [seriesFilter, outputFilter, terminalFilter]) el.addEventListener('change', () => {
    renderPlcChoices();
    recordPlcEvent('絞り込み', `${seriesFilter.value || '全系列'} / ${outputFilter.value || '全出力'} / ${terminalFilter.value || '全端子'}`);
  });
  document.getElementById('btnResetPlcFilter').onclick = syncPlcModel;
  syncPlcModel();
  function showPlcDetails() {
    const m = wiring.model;
    plcSummary.textContent = m.title;
    document.getElementById('plcSelectedName').textContent = `現在：${m.title}`;
    document.getElementById('plcModelInfo').textContent = `${m.title}：本体電源${m.powerSupply}（AC100V使用可）。DC24V入力${m.inputCount}点／${m.outputType === 'relay' ? '接点' : 'DC24V NPNシンク'}出力${m.outputCount}点。${m.terminalType}。${m.displayCpu ? `表示用構成：${m.displayPower}＋${m.displayCpu}。` : ''}練習では16入力・14出力を使用。形状と端子配置は練習用の簡略表示です。`;
    const rows = ['input', 'output'].map(side => {
      const terms = m.terminals[side].filter(t => t.key);
      return `<p>${side === 'input' ? '入力' : '出力'}</p><table class="io"><thead><tr><th>端子名</th><th>端子番号</th><th>コモン</th></tr></thead><tbody>${terms.map(t => {
        const { common } = terminalDetails(m, t.key);
        return `<tr><td>${t.label}</td><td>${t.pin || '—'}</td><td>${common}</td></tr>`;
      }).join('')}</tbody></table>`;
    }).join('');
    document.getElementById('plcTerminalList').innerHTML = rows;
  }
  showPlcDetails();
  showPlcEvents();
  recordPlcEvent('画面初期化', wiring.modelId);
  const savedModel = restore('plcModel', wiring.modelId);
  if (!PLC_MODELS[savedModel]) setWireMsg(`以前の型式「${savedModel}」は対象外です。${unsupportedModelReason(savedModel)}。現在は${wiring.model.title}を表示しています。`);
  plcModelSel.addEventListener('pointerdown', () => recordPlcEvent('一覧を操作', `現在=${wiring.modelId} 配線=${wiring.wires.length}本`));
  plcModelSel.addEventListener('keydown', e => {
    if (!e.repeat && ['Enter',' ','ArrowUp','ArrowDown'].includes(e.key)) recordPlcEvent('一覧のキー操作', e.key);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) applyPlcModel();
    }
  });
  plcModelSel.addEventListener('blur', () => recordPlcEvent('一覧からフォーカス移動', `選択=${plcModelSel.value} 表示=${wiring.modelId}`));
  // size付きの一覧はWebView2の別ウィンドウのポップアップを使わない。
  // 矢印キーで候補を移動しただけでは、型式や配線を変更しない。
  plcModelSel.addEventListener('click', e => {
    if (e.target.tagName === 'OPTION' && !e.target.disabled) applyPlcModel();
  });
  function applyPlcModel() {
    if (plcModelSel.disabled || !Object.hasOwn(PLC_MODELS, plcModelSel.value)) return;
    const from = wiring.modelId, to = plcModelSel.value, savedWires = wiring.toJSON();
    recordPlcEvent('切替開始', `${from} → ${to} 配線=${savedWires.length}本`);
    try {
      const dropped = wiring.setModel(to);
      view.goView('plc');
      store('plcModel', wiring.modelId);
      plcPicker.open = false;
      plcSummary.focus({ preventScroll: true });
      setWireMsg(dropped ? `機種を切り替えました（配線 ${dropped} 本を外しました）` : '機種を切り替えました');
      recordPlcEvent('切替完了', `${from} → ${wiring.modelId} 外した配線=${dropped}本`);
    } catch (error) {
      recordPlcEvent('切替エラー', `${from} → ${to}: ${error?.stack || error}`);
      try {
        wiring.setModel(from);
        wiring.load(savedWires);
        renderPlcChoices();
      } catch (restoreError) { recordPlcEvent('切替の復元エラー', String(restoreError)); }
      setWireMsg('型式を切り替えられませんでした。「型式切替の記録」を確認してください。');
    }
  }
  wiring.onChange = () => {
    showPlcDetails();
    markDirty();
    store('wires', wiring.toJSON());
    document.getElementById('wireCount').textContent = wiring.wires.length;
    buildIoTables();
  };
  document.getElementById('btnViewWiring').onclick = () => view.goView('wiring');
  document.getElementById('btnViewPlc').onclick = () => view.goView('plc');
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


  return { runSplash, toggleHelp, helpOpen: () => helpDlg.open, showTab, screwBoxes, updateHinban, setMultiWork, multiWorkBox, setWiringMode, wiringModeBox, plcModelSel, syncPlcModel, setWireMsg, selectWork(w) { if (w) screwBoxes.forEach((b, i) => { b.checked = w.screws[i]; }); updateHinban(); } };
}
