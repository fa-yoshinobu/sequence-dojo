import { sleep } from './timers.js';
// 課題モード: 課題 JSON の読み込み、試験タイマー、シナリオによる自動判定
//
// シナリオのステップ（1ステップ1命令）
//   { "reset": true }                         盤を初期状態に（電源ON・スイッチ戻し・ワーク撤去）
//   { "press": "PB1", "ms": 300 }             押して離す
//   { "hold": "PB5", "on": true }             押したまま / 離す
//   { "ss0": true } { "ss1": false } { "dsw": 3 }
//   { "work": { "at": "left", "screws": [1,0,1,1] } }   ワークを置く（screws = LS5,LS4,LS3,端）
//   { "clearWorks": true }
//   { "wait": 500 }
//   { "expect": { "PL1": true, "DPL1": 5, "conveyor": "right" }, "msg": "…" }
//   { "waitFor": { "LS1": true }, "timeout": 8000, "msg": "…" }
//   { "expectFor": { "conveyor": "stop" }, "ms": 1000, "msg": "…" }   ms の間ずっと成立
//   { "note": "…" }
// 条件キー: PL1〜PL4, RY1, RY2, DPL1, DPL2(数値), conveyor(left/right/stop), LS1〜LS5

export const GRADE_TIME = { // 製作等作業試験 [標準, 打切り] 分
  1: [130, 150],
  2: [120, 140],
  3: [95, 115],
};

export const MAX_TASK_BYTES = 5 * 1024 * 1024;
const commands = ['reset','press','hold','ss0','ss1','dsw','work','clearWorks','wait','note','expect','waitFor','expectFor'];
const boolConditions = /^(PL[1-4]|RY[12]|LS[1-5])$/;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export function validateTask(task) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  if (!object(task)) return ['$: 課題はオブジェクトにしてください'];
  if (typeof task.title !== 'string' || !task.title.trim()) fail('title', '課題名が必要です');
  if ('grade' in task && !integer(task.grade,1,3)) fail('grade', '1〜3 の整数にしてください');
  if ('description' in task && typeof task.description !== 'string') fail('description', '文字列にしてください');
  if (!Array.isArray(task.scenario) || !task.scenario.length) { fail('scenario', '1手順以上の配列が必要です'); return errors; }
  task.scenario.forEach((step,i) => {
    const path = `scenario[${i}]`;
    if (!object(step)) { fail(path,'手順はオブジェクトにしてください'); return; }
    const keys = commands.filter(k => k in step), command = keys[0], v = step[command];
    if (keys.length !== 1) { fail(path,'1手順には命令を1つだけ指定してください'); return; }
    const allowed = [command, 'msg', ...(command === 'press' || command === 'expectFor' ? ['ms'] : []), ...(command === 'hold' ? ['on'] : []), ...(command === 'waitFor' ? ['timeout'] : [])];
    if (Object.keys(step).some(k => !allowed.includes(k))) fail(path,'不明な項目があります');
    if ('msg' in step && typeof step.msg !== 'string') fail(path+'.msg','文字列にしてください');
    for (const k of ['ms','timeout']) if (k in step && !integer(step[k],1,2147483647)) fail(path+'.'+k,'1〜2147483647 の整数にしてください');
    if (command === 'expectFor' && !('ms' in step)) fail(path+'.ms','継続時間が必要です');
    if (['reset','clearWorks'].includes(command) && v !== true) fail(path+'.'+command,'true にしてください');
    if (['ss0','ss1'].includes(command) && typeof v !== 'boolean') fail(path+'.'+command,'true / false にしてください');
    if (['press','hold'].includes(command) && !/^PB[1-5]$/.test(typeof v === 'string' ? v : '')) fail(path+'.'+command,'PB1〜PB5 を指定してください');
    if (command === 'hold' && typeof step.on !== 'boolean') fail(path+'.on','true / false が必要です');
    if (command === 'dsw' && !integer(v,0,9)) fail(path+'.dsw','0〜9 の整数にしてください');
    if (command === 'wait' && !integer(v,1,2147483647)) fail(path+'.wait','1〜2147483647 の整数にしてください');
    if (command === 'note' && typeof v !== 'string') fail(path+'.note','文字列にしてください');
    if (command === 'work' && (!object(v) || !['left','center','right'].includes(v.at) || !Array.isArray(v.screws) || v.screws.length !== 4 || !v.screws.every(b => typeof b === 'boolean' || b === 0 || b === 1))) fail(path+'.work','位置と4本のビス（0 / 1 または boolean）が必要です');
    if (['expect','waitFor','expectFor'].includes(command)) {
      if (!object(v) || !Object.keys(v).length) fail(path+'.'+command,'1つ以上の条件が必要です');
      else for (const [key,value] of Object.entries(v)) {
        const valid = boolConditions.test(key) ? typeof value === 'boolean' : /^DPL[12]$/.test(key) ? integer(value,-1,9) : key === 'conveyor' && ['left','right','stop'].includes(value);
        if (!valid) fail(path+'.'+command+'.'+key,'条件キーまたは値の型・範囲が不正です');
      }
    }
  });
  return errors;
}

export function parseTask(text) {
  if (new TextEncoder().encode(text).length > MAX_TASK_BYTES) throw new Error('5 MB 以下の課題ファイルを選んでください');
  const task = JSON.parse(text), errors = validateTask(task);
  if (errors.length) {
    // Locate scenario objects without treating quoted brackets or braces as structure.
    const lines = []; let depth = 0, scenario = false, arrayDepth = -1;
    for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
      const token = match[0];
      if (!scenario && depth === 1 && token === '"scenario"' && /^\s*:/.test(text.slice(match.index + token.length))) scenario = true;
      else if (scenario && arrayDepth < 0 && token === '[') arrayDepth = depth;
      if (token === '{' && arrayDepth >= 0 && depth === arrayDepth + 1) lines.push(text.slice(0,match.index).split('\n').length);
      if (token === '{' || token === '[') depth++;
      else if (token === '}' || token === ']') depth--;
    }
    throw new Error(errors.map(e => { const index = /^scenario\[(\d+)\]/.exec(e); return `行 ${index ? lines[+index[1]] ?? 1 : 1}: ${e}`; }).join('\n'));
  }
  return { grade:3, description:'', ...task };
}


export class TaskRunner {
  constructor(sim) {
    this.sim = sim;     // app.js が渡す操作・観測 API
    this.running = false;
    this.abort = false;
  }

  static async loadList(onError = () => {}) {
    const tasks = [];
    let files = [];
    try { files = await (await fetch('tasks/index.json')).json(); }
    catch (e) { onError(`同梱課題一覧: ${e.message}`); }
    for (const file of files) {
      try {
        const response = await fetch(`tasks/${file}`);
        if (response.ok === false) throw new Error(`HTTP ${response.status}`);
        tasks.push({ file, ...parseTask(await response.text()) });
      } catch (e) { onError(`${file}: ${e.message}`); }
    }
    try {
      const response = await fetch('api/tasks');
      if (response.ok === false) throw new Error(`HTTP ${response.status}`);
      const user = await response.json();
      for (const error of user.errors ?? []) onError(error);
      for (const item of user.items ?? []) {
        try { tasks.push({ file:item.file, ...parseTask(item.content) }); }
        catch (e) { onError(`${item.file}: ${e.message}`); }
      }
    } catch (e) { onError(`追加課題: ${e.message}`); }
    return tasks;
  }

  check(cond) {
    const obs = this.sim.observe();
    const bad = [];
    for (const [k, v] of Object.entries(cond)) {
      if (obs[k] !== v) bad.push(`${k}=${fmt(obs[k])}（期待 ${fmt(v)}）`);
    }
    return bad;
  }

  async run(task, log) {
    this.running = true;
    this.abort = false;
    let pass = 0, total = 0;
    const s = this.sim;
    try {
      for (const [idx, step] of task.scenario.entries()) {
        if (this.abort) { log('stop', '中断しました'); break; }
        const label = step.msg ?? '';
        if (step.reset) { s.reset(); await sleep(400); }
        else if (step.note) log('note', step.note);
        else if (step.press) { s.setPb(step.press, true); await sleep(step.ms ?? 300); s.setPb(step.press, false); await sleep(100); }
        else if (step.hold) { s.holdPb(step.hold, step.on); await sleep(100); }
        else if ('ss0' in step) { s.setSs(0, step.ss0); await sleep(150); }
        else if ('ss1' in step) { s.setSs(1, step.ss1); await sleep(150); }
        else if ('dsw' in step) { s.setDsw(step.dsw); await sleep(150); }
        else if (step.work) { s.placeWork(step.work.at, step.work.screws.map(Boolean)); await sleep(200); }
        else if (step.clearWorks) { s.clearWorks(); await sleep(100); }
        else if (step.wait) await sleep(step.wait);
        else if (step.expect) {
          total++;
          const bad = this.check(step.expect);
          if (!bad.length) { pass++; log('ok', label || desc(step.expect)); }
          else log('ng', `${label || desc(step.expect)} → ${bad.join(', ')}`);
        } else if (step.waitFor) {
          total++;
          const t0 = performance.now();
          let bad = this.check(step.waitFor);
          while (bad.length && performance.now() - t0 < (step.timeout ?? 5000) && !this.abort) {
            await sleep(20);
            bad = this.check(step.waitFor);
          }
          if (!bad.length) { pass++; log('ok', `${label || desc(step.waitFor)}（${((performance.now() - t0) / 1000).toFixed(1)}秒）`); }
          else log('ng', `${label || desc(step.waitFor)} → 時間切れ ${bad.join(', ')}`);
        } else if (step.expectFor) {
          total++;
          const t0 = performance.now();
          let bad = [];
          while (performance.now() - t0 < step.ms && !bad.length && !this.abort) {
            bad = this.check(step.expectFor);
            await sleep(20);
          }
          if (!bad.length) { pass++; log('ok', label || `${desc(step.expectFor)} を ${step.ms}ms 維持`); }
          else log('ng', `${label || desc(step.expectFor)} → ${bad.join(', ')}`);
        } else {
          log('note', `不明なステップ #${idx + 1}`);
        }
      }
    } finally {
      s.releaseAll();
      this.running = false;
    }
    return { pass, total };
  }
}

function fmt(v) { return typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : String(v); }
function desc(cond) { return Object.entries(cond).map(([k, v]) => `${k}=${fmt(v)}`).join(' '); }
