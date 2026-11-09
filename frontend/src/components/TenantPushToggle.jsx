import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Huurder zet meldingen aan op dit toestel (betaling ontvangen, factuur vervalt).
export default function TenantPushToggle() {
  const [supported, setSupported] = useState(true);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setSupported(false);
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setOn(!!sub && Notification.permission === 'granted'))
      .catch(() => {});
  }, []);

  if (!supported) return null;

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
      await api.post('/tenant-portal/push/subscribe', {
        endpoint: j.endpoint, keys: j.keys, user_agent: navigator.userAgent || '',
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
        await api.post('/tenant-portal/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setOn(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 w-full max-w-xs" data-testid="tenant-push-toggle">
      <button type="button" onClick={on ? disable : enable} disabled={busy}
        className={`w-full rounded-xl flex items-center justify-center gap-2 py-2 text-xs sm:text-sm font-bold ${
          on ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        {on ? 'Meldingen aan' : 'Meldingen aanzetten'}
      </button>
      {msg && <p className="mt-1 text-[11px] font-semibold text-red-600">{msg}</p>}
    </div>
  );
}
