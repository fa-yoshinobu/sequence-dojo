import { PLC_CATALOG } from './plc-catalog-data.js';

const range = n => Array.from({ length: n }, (_, i) => i);
const oct = (p, k) => p + k.toString(8).toUpperCase();
const hex = (p, k) => p + k.toString(16).toUpperCase().padStart(2, '0');
const pins = p => p === 'TB16' ? range(16).map(i => `TB${i + 1}`) :
  p === 'PINS32' ? [...range(16).map(i => `B${20 - i}`), ...range(16).map(i => `A${20 - i}`)] : p;
const splitPins = p => (Array.isArray(p) ? p : [p]).flatMap(s => s.split('/')).filter(Boolean);

function base(model, series, inputCount, outputCount, outputType) {
  return { title: model, series, inputCount, outputCount, outputType, powerSupply: 'AC100～240V',
    name: `${model}（入力${inputCount}/出力${outputCount}・${outputType === 'relay' ? 'リレー' : 'NPN'}）`,
    terminals: { input: [], output: [] }, aliases: [], inputCommons: [], outputPower: [], groups: [],
    service: false, powerLabels: [], sources: [] };
}

// Duplicate physical contacts share a net but retain their own selectable terminal.
function terminal(m, side, net, label, pin = '') {
  const existing = [...m.terminals.input, ...m.terminals.output].filter(t => t.net === net && net).length;
  const key = net && (existing ? `${net}@${existing}` : net);
  if (existing) m.aliases.push([key, net]);
  m.terminals[side].push({ key, net, label, pin });
}

function cpu(d) {
  const count = d.outputs.reduce((n, g) => n + g[2], 0);
  const m = base(d.model, d.series, d.inputs, count, d.output_type);
  m.layout = d.series === 'FX5UC' ? 'slim' : d.series === 'MX-F' ? 'mxf' : 'compact';
  m.connector = d.series === 'FX5UC' && !d.model.endsWith('-TS');
  m.spring = d.model.endsWith('-TS') || d.series === 'MX-F';
  m.terminalType = m.spring ? '差し込み式' : 'ねじ止め式';
  m.x = k => d.series === 'MX-F' ? hex('X', k) : oct('X', k);
  m.y = k => d.series === 'MX-F' ? hex('Y', k) : oct('Y', k);
  m.service = d.service;
  m.powerLabels = d.series === 'MX-F' ? ['+24V', '24G', '⏚'] :
    d.model.endsWith('/ES') ? ['L', 'N', '⏚'] : ['+', '-', '⏚'];
  m.sources = [d.source];
  const physical = d.physical_io;
  const commonDefs = physical?.input_commons ?? [{ name: d.in_common, start: '0', points: d.inputs, contacts: d.series === 'MX-F' ? 2 : 1 }];
  commonDefs.forEach((g, i) => {
    const key = i ? `P:INCOM${i}` : 'P:INCOM';
    const indices = range(g.points).map(k => parseInt(g.start, 8) + k).filter(k => k < 16);
    if (indices.length) m.inputCommons.push({ key, label: g.name, indices });
    for (let c = 0; c < g.contacts; c++) terminal(m, 'input', indices.length ? key : null, g.name);
  });
  if (m.service) { terminal(m, 'input', 'P:0V', '0V'); terminal(m, 'input', 'P:24V', '24V'); }
  for (let i = 0; i < d.inputs; i++) {
    for (let c = 0; c < (physical?.input_signal_contacts ?? 1); c++) terminal(m, 'input', i < 16 ? `P:IN${i}` : null, m.x(i));
  }
  const comLabels = [];
  d.outputs.forEach(([gi, start, points]) => {
    const indices = range(points).map(k => parseInt(start, d.series === 'MX-F' ? 16 : 8) + k);
    const active = indices.filter(k => k < 16);
    const group = physical?.output_commons.find(g => g.group === gi);
    const name = group?.name ?? `COM${gi}`;
    if (active.length) { m.groups.push(active); comLabels.push(name); }
    for (let c = 0; c < (group?.contacts ?? (d.series === 'MX-F' ? 2 : 1)); c++) terminal(m, 'output', active.length ? `P:COM${gi}` : null, name);
    for (const i of indices) for (let c = 0; c < (physical?.output_signal_contacts ?? 1); c++) terminal(m, 'output', i < 16 ? `P:OUT${i}` : null, m.y(i));
  });
  m.comLabel = i => comLabels[i];
  m.inCommon = m.inputCommons.map(g => g.label).join(' / ');
  const size = d.inputs + count;
  m.width = d.series === 'FX5S' ? ({30:100,40:130,60:175,80:235})[size] :
    d.series === 'FX5UJ' ? ({40:130,60:175})[size] :
    d.series === 'FX5U' ? ({32:150,64:220,80:285})[size] :
    d.series === 'MX-F' ? 91 : m.spring ? (d.output_type === 'relay' ? 68.2 : 48.1) : ({32:42.1,64:62.2,96:82.3})[size];
  m.depth = d.series === 'FX5S' ? 79 : d.series === 'FX5UC' ? 89.1 : d.series === 'MX-F' ? 105 : 83;
  return m;
}

function rack(input, output, series, mixed = null) {
  const title = mixed ?? `${input.model} + ${output.model}`;
  const m = base(title, series === 'q' ? 'Q' : 'iQ-R', input.points, output.points, output.out);
  m.layout = 'modules'; m.modules = mixed ? [mixed] : [input.model, output.model];
  m.displayPower = series === 'q' ? 'Q61P' : 'R61P';
  m.displayCpu = series === 'q' ? 'Q03UDECPU' : 'R04CPU';
  m.terminalType = `入出力とも${input.model?.endsWith('-TS') ? '差し込み式' : 'ねじ止め式'}`;
  m.x = k => hex('X', (input.start_offset ?? 0) + k);
  m.y = k => hex('Y', (output.start_offset ?? input.points) + k);
  m.sources = [input.source, output.source].filter(Boolean);
  m.inputConnector = !pins(input.pins)[0].startsWith('TB');
  m.outputConnector = !pins(output.pins)[0].startsWith('TB');
  pins(input.pins).forEach((pin, i) => terminal(m, 'input', i < 16 ? `P:IN${i}` : null, m.x(i), pin));
  const commonPins = splitPins(input.common);
  const groupPoints = input.common_group_points ?? input.points;
  for (let first = 0; first < 16; first += groupPoints) {
    const gi = first / groupPoints, key = gi ? `P:INCOM${gi}` : 'P:INCOM';
    const relevant = input.common_group_points ? [commonPins[gi]] : commonPins.filter(p => !/^2[A-B]/.test(p));
    m.inputCommons.push({ key, label: `COM (${relevant.join('/')})`, indices: range(Math.min(groupPoints, 16 - first)).map(k => first + k) });
    relevant.forEach(pin => terminal(m, 'input', key, 'COM', pin));
  }
  pins(output.pins).forEach((pin, i) => terminal(m, 'output', i < 16 ? `P:OUT${i}` : null, m.y(i), pin));
  m.groups = [range(16)];
  const firstConnector = list => splitPins(list).filter(p => !/^2[A-B]/.test(p) || mixed);
  const comPins = firstConnector(output.com);
  comPins.forEach(pin => terminal(m, 'output', 'P:COM0', 'COM', pin));
  const vplus = firstConnector(output.vplus ?? '');
  if (vplus.length) {
    m.outputPower = [{ key: 'P:VPLUS0', group: 0, label: `+V (${vplus.join('/')})` }];
    vplus.forEach(pin => terminal(m, 'output', 'P:VPLUS0', '+V', pin));
  }
  m.comLabel = () => `COM (${comPins.join('/')})`;
  m.inCommon = m.inputCommons.map(g => g.label).join(' / ');
  // Physical TB order is independent of the device's address (especially -TS).
  for (const side of ['input', 'output']) if (m.terminals[side][0].pin.startsWith('TB'))
    m.terminals[side].sort((a, b) => parseInt(a.pin.slice(2)) - parseInt(b.pin.slice(2)));
  return m;
}

export const PLC_MODELS = {};
for (const d of PLC_CATALOG.cpus) {
  const id = d.model === 'FX5S-30MR/ES' ? 'fx5s' : d.model === 'FX5U-32MR/ES' ? 'fx5u' : d.model;
  PLC_MODELS[id] = cpu(d);
}
for (const [series, { inputs, outputs }] of Object.entries(PLC_CATALOG.racks)) {
  for (const input of inputs) for (const output of outputs) {
    if (input.model.endsWith('-TS') !== output.model.endsWith('-TS')) continue;
    const id = input.model === 'QX40' && output.model === 'QY10' ? 'q' :
      input.model === 'RX40C7' && output.model === 'RY10R2' ? 'iqr' : `${input.model}+${output.model}`;
    PLC_MODELS[id] = rack(input, output, series);
  }
}
for (const d of PLC_CATALOG.mixed) PLC_MODELS[d.model] = rack(
  { ...d.input, source: d.source }, { ...d.output, source: d.source }, d.series, d.model);
export const DEFAULT_MODEL = 'fx5s';

export function terminalDetails(m, key) {
  const t = [...m.terminals.input, ...m.terminals.output].find(t => t.key === key);
  if (!t) return null;
  const signal = /^P:(IN|OUT)(\d+)$/.exec(t.net);
  const common = signal ? signal[1] === 'IN'
    ? m.inputCommons.find(g => g.indices.includes(+signal[2]))?.label
    : m.comLabel(m.groups.findIndex(g => g.includes(+signal[2]))) : null;
  return { label: t.label, pin: t.pin || '番号なし', common: common || '—' };
}

export function unsupportedModelReason(id) {
  if (typeof id !== 'string' || !id) return '型式が指定されていません';
  if (id.includes('-EC')) return 'EC仕様は対象外です';
  if (/\/D|^FX5UC|^MXF/.test(id)) return 'DC電源の本体は対象外です（本体電源はAC100V対応に限定）';
  const modules = id.split('+');
  if (modules.length === 2 && modules[0].trim().endsWith('-TS') !== modules[1].trim().endsWith('-TS'))
    return '入力と出力の接続方式が混在しています（両方ねじ止め式、または両方差し込み式に限定）';
  return '現在の対応一覧にありません（入力16点・出力14〜16点、AC100V電源、ねじ止め式／差し込み式が対象）';
}

// SH-082451Q 5.9: physical row/column order, independent of logical I/O order.
export function terminalLayout(m, side) {
  const terms = [...m.terminals.input, ...m.terminals.output];
  const t = key => terms.find(t => t.key === key) ?? { key:null, label:key.startsWith('P:') ? '•' : key, pin:'' };
  let rows;
  if (m.layout === 'compact') {
    const svc = name => m.service ? `P:${name}` : '•';
    if (side === 'input' && m.series === 'FX5S') rows = [
      ['⏚','P:INCOM', ...range(8).map(i => `P:IN${i * 2 + 1}`)],
      [m.powerLabels[0],m.powerLabels[1], ...range(8).map(i => `P:IN${i * 2}`)],
    ];
    else if (side === 'input') rows = [
      ['⏚','P:INCOM',svc('0V'), ...range(8).map(i => `P:IN${i * 2}`),'•'],
      [m.powerLabels[0],m.powerLabels[1],'•',svc('24V'), ...range(8).map(i => `P:IN${i * 2 + 1}`)],
    ];
    else if (m.series === 'FX5S') rows = [
      [svc('0V'),'P:OUT0','P:OUT2','P:COM1','P:OUT5','P:OUT7','P:OUT8','P:OUT10','P:OUT11','P:OUT13'],
      [svc('24V'),'P:COM0','P:OUT1','P:OUT3','P:OUT4','P:OUT6','P:COM2','P:OUT9','P:COM3','P:OUT12'],
    ];
    else rows = [
      ['P:OUT0','P:OUT2','•','P:OUT4','P:OUT6','•','P:OUT8','P:OUT10','•','P:OUT12','P:OUT14','•'],
      ['P:COM0','P:OUT1','P:OUT3','P:COM1','P:OUT5','P:OUT7','P:COM2','P:OUT9','P:OUT11','P:COM3','P:OUT13','P:OUT15'],
    ];
    return rows.map(row => row.map(t));
  }
  if (m.layout === 'modules') {
    const data = m.terminals[side];
    const byPin = pin => data.find(t => t.pin === `TB${pin}`) ?? {key:null,label:'NC',pin:`TB${pin}`};
    const spring = m.modules[side === 'input' ? 0 : 1].endsWith('-TS');
    return spring ? range(9).map(i => [byPin(i + 1),byPin(i + 10)]) : range(18).map(i => [byPin(i + 1)]);
  }
  const prefix = side === 'input' ? 'P:IN' : 'P:OUT';
  const relay = m.series === 'FX5UC' && m.outputType === 'relay';
  rows = range(8).map(i => relay ? [prefix+i,prefix+i+'@1',prefix+(i+8),prefix+(i+8)+'@1'] : [prefix+i,prefix+(i+8)]);
  const common = side === 'input' ? 'P:INCOM' : 'P:COM0';
  const second = side === 'input' ? 'P:INCOM1' : 'P:COM1';
  rows.push(relay ? [common,common+'@1',second,second+'@1'] : [common,common+'@1']);
  return rows.map(row => row.map(t));
}
