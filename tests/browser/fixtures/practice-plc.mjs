// Deterministic PLC programs implementing the three bundled practice specifications.
export function createPracticePlc(task) {
  let latched = false, dir = 0, pl1 = false, pl2 = false, part = 0, arrived = null, match = false;
  return (x, now) => {
    const y = Array(16).fill(false), safe = x[9];
    if (task === 1) {
      latched = safe && !x[6] && (latched || x[5]);
      y[2] = latched; y[5] = latched && Math.floor(now / 500) % 2 === 0;
    } else if (task === 2) {
      if (!safe) dir = 0;
      else if (!x[11]) dir = x[7] && !x[1] ? -1 : x[8] && !x[0] ? 1 : 0;
      else {
        if (dir === 1 && x[0]) { dir = 0; pl2 = true; }
        if (dir === -1 && x[1]) { dir = 0; pl1 = true; }
        if (x[5] && x[1]) { dir = 1; pl1 = pl2 = false; }
        else if (x[6] && x[0]) { dir = -1; pl1 = pl2 = false; }
      }
      y[0] = dir < 0; y[1] = dir > 0; y[2] = pl1; y[3] = pl2;
    } else {
      const dsw = x.slice(12,16).reduce((v,b,i) => v + (b ? 1 << i : 0), 0);
      if (!safe) dir = 0;
      else if (x[11]) {
        if (dir === 1 && x[0]) { dir = 0; arrived = now; match = part === dsw; }
        if (dir === -1 && x[1]) dir = 0;
        if (x[5] && x[1]) { part = +x[2] + 2 * x[3] + 4 * x[4]; dir = 1; arrived = null; }
        else if (arrived !== null && x[10] && now - arrived >= 2000) { dir = -1; arrived = null; }
      }
      y[0] = dir < 0; y[1] = dir > 0;
      y[4] = arrived !== null && match; y[5] = arrived !== null && !match;
      for (let i=0; i<4; i++) { y[6+i] = !!(part & 1<<i); y[10+i] = !!(dsw & 1<<i); }
    }
    return y;
  };
}
