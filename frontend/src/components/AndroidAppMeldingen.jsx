import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Smartphone, Trash2 } from 'lucide-react';
import { api, formatError } from '../lib/api';
import { isApkApp, requestFcmToken } from '../lib/fcm-apk';

const TYPES = [
  { key: 'payment', label: 'Nieuwe betaling' },
  { key: 'overdue', label: 'Achterstallige huur' },
  { key: 'approval', label: 'Goedkeuring nodig' },
  { key: 'kasgeld', label: 'Kasgeld' },
  { key: 'employee', label: 'Medewerker in/uitgelogd' },
  { key: 'maintenance', label: 'Onderhoud' },
  { key: 'invoices', label: 'Facturen' },
];

function Switch({ on, onClick, testid, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={disabled} data-testid={testid}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 disabled:opacity-60 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`inline-block h-5 w-5 bg-white rounded-full shadow transform transition ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function DeviceList({ devices, onRemove }) {
  if (!devices.length) {
    return <p className="text-sm text-slate-400" data-testid="fcm-devices-empty">Nog geen Android-toestel gekoppeld. Log in de Android-app in als beheerder om te koppelen.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100" data-testid="fcm-devices">
      {devices.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-2.5" data-testid={`fcm-device-${d.id}`}>
          <Smartphone className="w-4 h-4 text-slate-400" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-bold text-slate-900 truncate">{d.device_name}</span>
            <span className="text-xs text-slate-500">{d.user_name} · {new Date(d.updated_at).toLocaleString('nl-NL')}</span>
          </span>
          <button onClick={() => onRemove(d)} title="Ontkoppelen" data-testid={`fcm-device-remove-${d.id}`}
            className="h-9 w-9 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
        </li>
      ))}
    </ul>
  );
}

// "Android App Meldingen": per soort aan/uit (hele bedrijf), alleen voor FCM-push.
export function AndroidAppMeldingen() {
  const [prefs, setPrefs] = useState(null);
  const [devices, setDevices] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  const loadDevices = useCallback(() => api.get('/push/fcm/devices')
    .then(({ data }) => { setDevices(data.devices || []); setConfigured(!!data.configured); }).catch(() => {}), []);
  useEffect(() => {
    api.get('/settings').then(({ data }) => setPrefs(data?.fcm_prefs || {})).catch(() => setPrefs({}));
    loadDevices();
    window.addEventListener('fcm-registered', loadDevices);
    return () => window.removeEventListener('fcm-registered', loadDevices);
  }, [loadDevices]);

  const toggle = async (key) => {
    const prev = prefs; const next = { ...prefs, [key]: !(prefs[key] ?? true) };
    setPrefs(next); setBusy(key);
    try { await api.put('/settings/fcm_prefs', next); } catch (e) { setPrefs(prev); setMsg({ ok: false, text: formatError(e) }); }
    finally { setBusy(''); }
  };
  const remove = async (d) => {
    if (!window.confirm(`"${d.device_name}" ontkoppelen? Het ontvangt geen Android-meldingen meer.`)) return;
    try { await api.delete(`/push/fcm/devices/${d.id}`); loadDevices(); } catch (e) { setMsg({ ok: false, text: formatError(e) }); }
  };
  const test = async () => {
    setBusy('test'); setMsg(null);
    try {
      const { data } = await api.post('/push/fcm/test');
      setMsg({ ok: data.sent > 0, text: data.sent > 0 ? `Testmelding verstuurd naar ${data.sent} toestel(len)` : 'Geen toestel bereikt' });
      loadDevices();
    } catch (e) { setMsg({ ok: false, text: formatError(e) }); } finally { setBusy(''); }
  };

  return (
    <div className="mt-4 bg-white border border-orange-100 rounded-2xl p-6 space-y-4" data-testid="fcm-section">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><Smartphone className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-black text-slate-900">Android App Meldingen</h3>
          <p className="text-xs text-slate-500">Pushmeldingen naar de Android-app van alle beheerders. Geldt voor het hele bedrijf; PWA-meldingen blijven ongewijzigd.</p>
        </div>
      </div>
      {!configured && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-testid="fcm-not-configured">Firebase is nog niet ingesteld op de server.</p>}
      {prefs === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl px-4" data-testid="fcm-prefs">
          {TYPES.map((t) => (
            <li key={t.key} className="flex items-center justify-between py-3">
              <span className="text-sm font-bold text-slate-800">{t.label}</span>
              <Switch on={prefs[t.key] ?? true} onClick={() => toggle(t.key)} disabled={busy === t.key} testid={`fcm-pref-${t.key}`} />
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">Gekoppelde Android-toestellen</p>
        <DeviceList devices={devices} onRemove={remove} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={test} disabled={busy === 'test' || !devices.length} data-testid="fcm-test-btn"
          className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm inline-flex items-center gap-2 disabled:opacity-50">
          {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Testmelding
        </button>
        {isApkApp() && (
          <button onClick={requestFcmToken} data-testid="fcm-pair-btn"
            className="h-10 px-4 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50">Koppel dit toestel</button>
        )}
      </div>
      {msg && <p className={`text-sm font-bold ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`} data-testid="fcm-status">{msg.text}</p>}
    </div>
  );
}
