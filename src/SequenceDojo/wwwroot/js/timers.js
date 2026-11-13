// One same-origin Worker drives both simulation ticks and task waits while the window is hidden.
export function createTimers(makeWorker = () => typeof Worker === 'undefined' ? null
  : new Worker(new URL('./timer-worker.js', import.meta.url), { type:'module' })) {
  let worker = null, attempted = false, failed = false, nextId = 0;
  const pending = new Map();
  function native(entry) {
    if (entry.native !== undefined) return;
    if (entry.type === 'interval') entry.native = setInterval(entry.callback, entry.ms);
    else entry.native = setTimeout(() => { pending.delete(entry.id); entry.callback(); }, Math.max(0, entry.deadline - performance.now()));
  }
  function fallback(error) {
    if (failed) return;
    failed = true;
    const previous = worker; worker = null;
    if (previous) {
      previous.onmessage = null; previous.onerror = null; previous.onmessageerror = null;
      previous.terminate();
    }
    for (const entry of pending.values()) native(entry);
    globalThis.__dojoReportClientError?.(`バックグラウンドタイマーを利用できません（通常タイマーを使用）: ${error?.message ?? error}`);
  }
  function getWorker() {
    if (attempted) return worker;
    attempted = true;
    try {
      worker = makeWorker();
      if (worker) {
        worker.onmessage = ({data}) => {
          const entry = pending.get(data.id);
          if (!entry || (entry.type === 'interval' ? data.type !== 'tick' : data.type !== 'wake')) return;
          if (entry.type !== 'interval') pending.delete(entry.id);
          entry.callback();
        };
        worker.onerror = error => { error.preventDefault?.(); fallback(error); };
        worker.onmessageerror = fallback;
      }
    } catch (error) { fallback(error); }
    return worker;
  }
  function schedule(type, callback, ms) {
    const current = getWorker();
    const entry = {id:++nextId,type,callback,ms,deadline:performance.now()+ms};
    pending.set(entry.id,entry);
    if (current) {
      try { current.postMessage({type,id:entry.id,ms,deadline:performance.timeOrigin+entry.deadline}); }
      catch (error) { fallback(error); }
    } else native(entry);
    return () => {
      pending.delete(entry.id);
      if (entry.native !== undefined) {
        if (type === 'interval') clearInterval(entry.native); else clearTimeout(entry.native);
      } else if (worker) {
        try { worker.postMessage({type:'cancel',id:entry.id}); }
        catch (error) { fallback(error); }
      }
    };
  }
  return {
    startInterval: (callback,ms) => schedule('interval',callback,ms),
    sleep(ms) {
      // Keep the ordinary timer path dynamic so headless TaskRunner replay can mock setTimeout.
      if (!getWorker()) return new Promise(resolve => setTimeout(resolve,ms));
      return new Promise(resolve => schedule('sleep',resolve,ms));
    },
  };
}
const shared = createTimers();
export const startInterval = (callback,ms) => shared.startInterval(callback,ms);
export const sleep = ms => shared.sleep(ms);
