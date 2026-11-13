// Normal ticks preserve their single dt; only delayed ticks are subdivided, with a one-second cap.
export function advanceElapsed(elapsed, step) {
  if (!Number.isFinite(elapsed) || elapsed < 0) return;
  if (elapsed <= 0.1) { step(elapsed); return; }
  const capped = Math.min(elapsed,1), count = Math.floor((capped+1e-12)/0.02);
  for (let i=0;i<count;i++) step(0.02);
  const remainder = capped-count*0.02;
  if (remainder > 1e-12) step(remainder);
}

export function createSimulationClock(step, now = () => performance.now()) {
  let last = now();
  return () => {
    const current = now(), elapsed = (current-last)/1000;
    last = current;
    advanceElapsed(elapsed,step);
  };
}
