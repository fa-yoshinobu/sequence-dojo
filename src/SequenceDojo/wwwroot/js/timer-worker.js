const timers = new Map();
self.onmessage = ({data}) => {
  const {type,id,ms,deadline} = data;
  if (type === 'cancel') {
    const timer = timers.get(id);
    if (timer) { if (timer.interval) clearInterval(timer.handle); else clearTimeout(timer.handle); }
    timers.delete(id);
  } else if (type === 'interval') {
    timers.set(id,{interval:true,handle:setInterval(() => self.postMessage({type:'tick',id}),ms)});
  } else if (type === 'sleep') {
    const delay = Math.max(0,deadline-(performance.timeOrigin+performance.now()));
    timers.set(id,{interval:false,handle:setTimeout(() => { timers.delete(id); self.postMessage({type:'wake',id}); },delay)});
  }
};
