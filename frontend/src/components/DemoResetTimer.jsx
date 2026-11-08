import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const isDemo = () => {
  try { return localStorage.getItem('is_demo_session') === '1'; }
  catch { return false; }
};

export default function DemoResetTimer() {
  const [left, setLeft] = useState(null);
  const [active, setActive] = useState(isDemo());

  useEffect(() => {
    const t = setInterval(() => setActive(isDemo()), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active) { setLeft(null); return undefined; }
    let end = 0;
    let stop = false;
    const sync = async () => {
      try {
        const { data } = await api.get('/public/demo-reset-info');
        if (!stop) end = Date.now() + data.seconds_left * 1000;
      } catch { /* negeren */ }
    };
    sync();
    const tick = setInterval(() => {
      if (!end) return;
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        end = 0;
        setTimeout(() => window.location.reload(), 4000);
      }
    }, 1000);
    const resync = setInterval(sync, 5 * 60 * 1000);
    return () => { stop = true; clearInterval(tick); clearInterval(resync); };
  }, [active]);

  if (!active || left === null) return null;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div
      data-testid="demo-reset-timer"
      className="fixed left-1/2 -translate-x-1/2 bottom-3 z-[9999] pointer-events-none rounded-full bg-black/80 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      {left === 0 ? 'Demo wordt gereset…' : `Demo reset over ${mm}:${ss}`}
    </div>
  );
}
