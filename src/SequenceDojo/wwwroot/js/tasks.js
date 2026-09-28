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

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class TaskRunner {
  constructor(sim) {
    this.sim = sim;     // app.js が渡す操作・観測 API
    this.running = false;
    this.abort = false;
  }

  static async loadList() {
    const files = await (await fetch('tasks/index.json')).json();
    return Promise.all(files.map(async f => ({ file: f, ...(await (await fetch(`tasks/${f}`)).json()) })));
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
