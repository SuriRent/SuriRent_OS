import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle } from 'lucide-react';

// Bevestiging binnen de kiosk-popup (embedded); daarbuiten de gewone browser-bevestiging.
export function useEmbedConfirm(embedded) {
  const [msg, setMsg] = useState(null);
  const resolver = useRef(null);
  const ask = useCallback((text) => {
    if (!embedded) return Promise.resolve(window.confirm(text));
    setMsg(text);
    return new Promise((res) => { resolver.current = res; });
  }, [embedded]);
  const done = (ok) => { setMsg(null); resolver.current?.(ok); };
  const node = msg ? (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" data-testid="embed-confirm" onClick={() => done(false)}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 text-center" onClick={(e) => e.stopPropagation()}>
        <AlertTriangle className="w-9 h-9 text-red-500 mx-auto" />
        <p className="text-base font-black text-slate-900">{msg}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => done(false)} data-testid="embed-confirm-cancel"
            className="h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Annuleren</button>
          <button type="button" onClick={() => done(true)} data-testid="embed-confirm-ok"
            className="h-12 rounded-xl bg-red-500 text-white font-black text-sm">Bevestigen</button>
        </div>
      </div>
    </div>
  ) : null;
  return [ask, node];
}

// Imperatief: in een kiosk-popup (data-kiosk-host) of de kiosk zelf een eigen bevestiging, anders window.confirm.
export function hostConfirm(text) {
  const host = document.querySelector('[data-kiosk-host]');
  const inKiosk = host || document.body.classList.contains('kiosk-admin-active') || /\/kiosk/.test(window.location.pathname);
  if (!inKiosk) return Promise.resolve(window.confirm(text));
  return new Promise((resolve) => {
    const el = document.createElement('div');
    (host || document.body).appendChild(el);
    const root = createRoot(el);
    const done = (ok) => { root.unmount(); el.remove(); resolve(ok); };
    root.render(<ConfirmBox msg={text} onDone={done} hosted={!!host} />);
  });
}

function ConfirmBox({ msg, onDone, hosted }) {
  return (
    <div className={`${hosted ? 'absolute' : 'fixed'} inset-0 z-[10050] bg-black/50 flex items-center justify-center p-4`} data-testid="embed-confirm" onClick={() => onDone(false)}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 text-center" onClick={(e) => e.stopPropagation()}>
        <AlertTriangle className="w-9 h-9 text-red-500 mx-auto" />
        <p className="text-base font-black text-slate-900 whitespace-pre-line">{msg}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onDone(false)} data-testid="embed-confirm-cancel"
            className="h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Annuleren</button>
          <button type="button" onClick={() => onDone(true)} data-testid="embed-confirm-ok"
            className="h-12 rounded-xl bg-red-500 text-white font-black text-sm">Bevestigen</button>
        </div>
      </div>
    </div>
  );
}
