import { PLC_MODELS } from './wiring-circuit.js';
import { WORK, clamp, resolveWorks } from './simulation.js';
import { unsupportedModelReason } from './plc-models.js';
import { recordPlcEvent } from './plc-diagnostics.js';
export function createProjects(st, view, ui, connection, runner, store) {
  const { wiring, createWork, clearWorks, selectWork } = view;
  const { plcModelSel, setWiringMode, setMultiWork, multiWorkBox, wiringModeBox, screwBoxes } = ui;
  const { form, readForm, fillForm, normalizeConfig } = connection;

  // ---------------------------------------------------------------- プロジェクトファイル（*.sdojo）
  // 保存するもの: 接続設定・配線練習用 PLC・配線モード・配線・ワーク。スイッチ位置や判定結果は保存しない。
  // Windows アプリでは C#（MainForm）がファイル選択と読み書きを行い、ブラウザではダウンロード／ファイル選択で代用する。
  const PROJECT_FORMAT = 'sequence-dojo';
  const APP_TITLE = 'シーケンス道場 3D';
  const host = window.chrome?.webview ?? null;
  const project = { path: null, name: null, dirty: false, applying: false, ready: false };

  function markDirty() {
    if (!project.ready || project.applying || runner.running) return;
    if (!project.dirty) { project.dirty = true; updateTitle(); }
  }
  function updateTitle() {
    const name = project.name ?? (project.dirty ? '無題' : null);
    document.title = name ? `${name}${project.dirty ? ' *' : ''} - ${APP_TITLE}` : APP_TITLE;
    document.getElementById('fileName').textContent = name ? `${name}${project.dirty ? ' *' : ''}` : '';
  }
  function setFileStatus(text) {
    const el = document.getElementById('fileStatus');
    el.textContent = text;
    clearTimeout(setFileStatus.timer);
    setFileStatus.timer = setTimeout(() => { el.textContent = ''; }, 4000);
  }
  window.__dojoDirty = () => project.dirty; // 閉じるときに C# から確認する

  function collectProject() {
    return {
      format: PROJECT_FORMAT, version: 1, app: APP_TITLE, savedAt: new Date().toISOString(),
      connection: readForm(),
      wiring: { model: wiring.modelId, mode: st.wiringMode, wires: wiring.toJSON() },
      works: { multi: st.multiWork, items: st.works.map(w => ({ x: Math.round(w.x * 10) / 10, screws: [...w.screws] })) },
    };
  }

  async function applyProject(p) {
    if (p?.format !== PROJECT_FORMAT) throw new Error('シーケンス道場のファイルではありません。');
    if (p.wiring && !Object.hasOwn(PLC_MODELS, p.wiring.model)) {
      const id = String(p.wiring.model ?? '未指定').slice(0, 160);
      const reason = unsupportedModelReason(p.wiring.model);
      recordPlcEvent('対象外の保存型式', `${id}: ${reason}`);
      throw new Error(`PLC型式「${id}」は読み込めません。\n${reason}\n現在の設定・配線は変更していません。元ファイルも変更していません。`);
    }
    project.applying = true;
    try {
      const wasConnected = st.connected;
      if (p.connection) {
        st.config = normalizeConfig(p.connection);
        store('config', st.config);
        await fillForm();
      }
      if (p.wiring) {
        if (PLC_MODELS[p.wiring.model]) {
          const previous = wiring.modelId;
          wiring.setModel(p.wiring.model);
          plcModelSel.value = wiring.modelId;
          ui.syncPlcModel?.();
          store('plcModel', wiring.modelId);
          recordPlcEvent('保存型式を読込み', `${previous} → ${wiring.modelId}`);
        }
        wiring.load(p.wiring.wires ?? []);
        setWiringMode(!!p.wiring.mode);
      }
      if (p.works) {
        setMultiWork(!!p.works.multi);
        clearWorks();
        const items = (p.works.items ?? []).slice(0, st.multiWork ? 4 : 1);
        for (const it of items) {
          const screws = [0, 1, 2, 3].map(i => !!it.screws?.[i]);
          st.works.push(createWork(clamp(+it.x || 0, WORK.xMin, WORK.xMax), screws));
        }
        resolveWorks(st, 0);
        selectWork(null);
      }
      if (wasConnected) setFileStatus('接続設定を読み込みました。接続し直すと反映されます');
    } finally {
      project.applying = false;
    }
  }

  function saveProject(saveAs = false) {
    const content = JSON.stringify(collectProject(), null, 2);
    const name = project.name ?? 'シーケンス道場.sdojo';
    if (host) {
      host.postMessage({ type: 'file-save', path: saveAs ? null : project.path, name, content });
      return;
    }
    // ブラウザ: ダウンロードで保存
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    onSaved({ path: null, name });
  }
  function onSaved(m) {
    project.path = m.path;
    project.name = m.name;
    project.dirty = false;
    updateTitle();
    setFileStatus(`保存しました: ${m.name}`);
  }
  async function onOpened(m, acknowledge) {
    try {
      if (project.dirty && !confirm('保存されていない変更があります。破棄して開きますか？')) return;
      await applyProject(JSON.parse(m.content));
      project.path = m.path ?? null;
      project.name = m.name;
      project.dirty = false;
      updateTitle();
      setFileStatus(`開きました: ${m.name}`);
    } catch (e) {
      alert(`ファイルを開けませんでした。\n${e.message}`);
    } finally {
      if (m.requestId) acknowledge?.({ type: 'file-open-completed', requestId: m.requestId });
    }
  }
  function openProject() {
    if (host) { host.postMessage({ type: 'file-open' }); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sdojo,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) onOpened({ path: null, name: f.name, content: await f.text() });
    };
    input.click();
  }
  host?.addEventListener('message', e => {
    const m = e.data;
    switch (m?.type) {
      case 'file-saved': onSaved(m); break;
      case 'file-opened': onOpened(m, reply => host.postMessage(reply)); break;
      case 'file-error': alert(m.message); break;
      case 'save-request': saveProject(false); break;   // 閉じる前の「保存する」
    }
  });
  document.getElementById('btnOpen').onclick = openProject;
  document.getElementById('btnSave').onclick = () => saveProject(false);
  document.getElementById('btnSaveAs').onclick = () => saveProject(true);
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); e.stopImmediatePropagation(); saveProject(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); e.stopImmediatePropagation(); openProject(); }
  }, { capture: true });

  // 変更の検知（ワークの移動やスイッチ操作は対象外）
  form.addEventListener('change', markDirty);
  multiWorkBox.addEventListener('change', markDirty);
  wiringModeBox.addEventListener('change', markDirty);
  screwBoxes.forEach(b => b.addEventListener('change', () => { if (st.selWork) markDirty(); }));
  for (const id of ['btnPlaceLeft', 'btnPlaceCenter', 'btnPlaceRight', 'btnRemoveSel', 'btnRemoveAll'])
    document.getElementById(id).addEventListener('click', markDirty);


  return { markDirty, onOpened, isReady: () => project.ready, ready() { project.ready = true; updateTitle(); host?.postMessage({ type: 'ready' }); } };
}
