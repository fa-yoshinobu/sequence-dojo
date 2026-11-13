import { TaskRunner, GRADE_TIME, MAX_TASK_BYTES, parseTask } from './tasks.js';
export function createTaskControls(st, sim, store, restore) {
  const runner = new TaskRunner(sim);
  let taskList = [];
  const taskSelect = document.getElementById('taskSelect');
  const timerEl = document.getElementById('timer');
  let timerStart = null;

  const status = document.getElementById('taskImportStatus');
  async function loadTasks(selectedFile) {
    const errors = [];
    taskList = await TaskRunner.loadList(message => errors.push(message));
    taskSelect.textContent = '';
    taskList.forEach((task, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${task.title}（${task.grade}級相当）`;
      taskSelect.appendChild(option);
    });
    const selected = selectedFile ? taskList.findIndex(t => t.file === selectedFile) : +restore('task', 0);
    taskSelect.value = selected >= 0 && selected < taskList.length ? selected : 0;
    status.textContent = errors.join('\n');
    showTask();
  }
  const fileInput = document.getElementById('taskFile');
  document.getElementById('btnImportTask').onclick = () => { if (!runner.running) fileInput.click(); };
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file || runner.running) return;
    try {
      if (file.size > MAX_TASK_BYTES) throw new Error('5 MB 以下の課題ファイルを選んでください');
      const content = await file.text();
      parseTask(content);
      const response = await fetch('api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body:content });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? result.detail ?? `HTTP ${response.status}`);
      await loadTasks(result.file);
      status.textContent = `読み込みました: ${file.name}` + (status.textContent ? '\n'+status.textContent : '');
    } catch (e) { status.textContent = `${file.name}: ${e.message}`; }
    finally { fileInput.value = ''; }
  });
  document.getElementById('btnTaskFolder').onclick = async () => {
    try {
      const response = await fetch('api/tasks/open-folder', { method:'POST' });
      if (!response.ok) throw new Error(`フォルダーを開けませんでした（HTTP ${response.status}）`);
    } catch (e) { status.textContent = e.message; }
  };
  function currentTask() { return taskList[+taskSelect.value]; }
  function showTask() {
    const t = currentTask();
    if (!t) { document.getElementById('taskDesc').textContent = ''; return; }
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
