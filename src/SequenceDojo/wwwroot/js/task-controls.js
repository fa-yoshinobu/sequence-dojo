import { TaskRunner, GRADE_TIME } from './tasks.js';
export function createTaskControls(st, sim, store, restore) {
  const runner = new TaskRunner(sim);
  let taskList = [];
  const taskSelect = document.getElementById('taskSelect');
  const timerEl = document.getElementById('timer');
  let timerStart = null;

  async function loadTasks() {
    try { taskList = await TaskRunner.loadList(); } catch (e) { taskList = []; }
    taskSelect.innerHTML = taskList.map((t, i) => `<option value="${i}">${t.title}（${t.grade}級相当）</option>`).join('');
    taskSelect.value = restore('task', 0);
    showTask();
  }
  function currentTask() { return taskList[+taskSelect.value]; }
  function showTask() {
    const t = currentTask();
    if (!t) return;
    store('task', +taskSelect.value);
    document.getElementById('taskDesc').textContent = t.description;
    const [std, cut] = GRADE_TIME[t.grade] ?? GRADE_TIME[3];
    const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    document.getElementById('timerLimit').textContent = `標準 ${hm(std)} / 打切り ${hm(cut)}`;
  }
  taskSelect.addEventListener('change', showTask);
  document.getElementById('btnTimerStart').onclick = () => { timerStart = Date.now(); };
  document.getElementById('btnTimerStop').onclick = () => { timerStart = null; };
  setInterval(() => {
    if (timerStart == null) return;
    const s = Math.floor((Date.now() - timerStart) / 1000);
    timerEl.textContent = [s / 3600, (s / 60) % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':');
    const [std, cut] = GRADE_TIME[currentTask()?.grade] ?? GRADE_TIME[3];
    timerEl.className = s > cut * 60 ? 'over2' : s > std * 60 ? 'over1' : '';
  }, 250);

  document.getElementById('btnJudge').onclick = async () => {
    const t = currentTask();
    if (!t || runner.running) return;
    if (!st.connected && !confirm('PLC が未接続です。このまま判定しますか？（手動出力のまま判定されます）')) return;
    const ul = document.getElementById('judgeLog');
    const score = document.getElementById('judgeScore');
    ul.innerHTML = '';
    score.textContent = '判定中…';
    const log = (level, text) => {
      const li = document.createElement('li');
      li.className = level;
      li.textContent = text;
      ul.appendChild(li);
      li.scrollIntoView({ block: 'nearest' });
    };
    const { pass, total } = await runner.run(t, log);
    score.textContent = `結果: ${pass} / ${total} 合格${pass === total ? ' 🎉' : ''}`;
  };
  document.getElementById('btnJudgeStop').onclick = () => { runner.abort = true; };


  return { runner, loadTasks };
}
