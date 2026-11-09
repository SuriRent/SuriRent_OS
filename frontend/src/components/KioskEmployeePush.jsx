import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, X } from 'lucide-react';
import { api } from '../lib/api';
import { getKioskEmployee } from './KioskEmployee';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const auth = (emp) => ({ employee_id: emp.id, pin: emp.pin });

// Medewerker zet meldingen aan op dit toestel en kiest welke meldingen binnenkomen.
export default function KioskEmployeePush({ className = '' }) {
  const [emp, setEmp] = useState(getKioskEmployee());
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [cats, setCats] = useState([]);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    const refresh = () => setEmp(getKioskEmployee());
    window.addEventListener('kiosk-employee-changed', refresh);
    return () => window.removeEventListener('kiosk-employee-changed', refresh);
  }, []);

  const loadPrefs = useCallback(async (e) => {
    try {
      const { data } = await api.post('/kiosk/push/preferences', auth(e));
      setCats(data.categories || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!open || !emp || !supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setOn(!!sub && Notification.permission === 'granted'))
      .catch(() => {});
    loadPrefs(emp);
  }, [open, emp, supported, loadPrefs]);

  if (!emp || !supported) return null;

  const enable = async () => {
    setBusy(true); setMsg('');
    try {
      const { data: vapid } = await api.get('/push/vapid-public-key');
      if (!vapid.public_key) throw new Error('Meldingen zijn nog niet beschikbaar.');
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Meldingen zijn geblokkeerd in uw browser.');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid.public_key),
        });
      }
      const j = sub.toJSON();
      await api.post('/kiosk/push/subscribe', {
        ...auth(emp), endpoint: j.endpoint, keys: j.keys, user_agent: navigator.userAgent || '',
      });
      setOn(true);
    } catch (e) {
      setMsg(e?.message || 'Aanzetten mislukt');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post('/kiosk/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setOn(false);
    } finally { setBusy(false); }
  };

  const toggleCat = async (id, enabled) => {
    const next = cats.map((c) => (c.id === id ? { ...c, enabled } : c));
    setCats(next);
    const prefs = Object.fromEntries(next.map((c) => [c.id, c.enabled]));
    await api.post('/kiosk/push/preferences', { ...auth(emp), prefs }).catch(() => loadPrefs(emp));
  };

  const test = async () => {
    setMsg('');
    try {
      const { data } = await api.post('/kiosk/push/test', auth(emp));
      setMsg(data.sent ? 'Testmelding verstuurd.' : 'Geen toestel gevonden; zet meldingen eerst aan.');
    } catch { setMsg('Testmelding mislukt'); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Meldingen" data-testid="kiosk-emp-push-btn"
        className={`w-10 h-10 rounded-full flex items-center justify-center text-white bg-white/15 hover:bg-white/25 ${className}`}>
        {on ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-5 text-slate-900" onClick={(e) => e.stopPropagation()}
            data-testid="kiosk-emp-push-modal">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-black">Meldingen · {emp.name || 'Medewerker'}</h3>
              <button type="button" onClick={() => setOpen(false)} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <button type="button" onClick={on ? disable : enable} disabled={busy}
              className={`w-full rounded-xl flex items-center justify-center gap-2 py-3 text-sm font-bold ${
                on ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-orange-500 text-white hover:bg-orange-600'}`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              {on ? 'Meldingen aan (tik om uit te zetten)' : 'Meldingen aanzetten'}
            </button>
            {on && (
              <button type="button" onClick={test} className="mt-2 w-full text-xs font-bold text-slate-500 hover:text-slate-700">
                Stuur testmelding
              </button>
            )}
            {msg && <p className="mt-2 text-xs font-semibold text-slate-600">{msg}</p>}
            <div className="mt-4 space-y-2">
              {cats.map((c) => (
                <label key={c.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 cursor-pointer">
                  <span>
                    <span className="block text-sm font-bold">{c.label}</span>
                    <span className="block text-[11px] text-slate-500">{c.desc}</span>
                  </span>
                  <input type="checkbox" className="mt-1 w-5 h-5 accent-orange-500" checked={c.enabled}
                    onChange={(e) => toggleCat(c.id, e.target.checked)} />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
