import { useState, useEffect, useCallback } from 'react';
import { Zap, Check, AlertCircle, Loader2, Save, Trash2, Plus } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

const CARD = 'bg-white rounded-2xl border border-orange-100';
const INPUT = 'w-full h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-sm';
const LBL = 'block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1';

// Instellingen voor Stroom: Tuya-koppeling, automatisch afsluiten en schakelaars koppelen.
// Het aan- en uitzetten zelf gebeurt in Beheer → Stroom en in de kiosk.
export default function PowerSettings() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [devices, setDevices] = useState([]);
  const [apts, setApts] = useState([]);
  const [log, setLog] = useState([]);
  const [ids, setIds] = useState({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });
  const say = useCallback((type, text) => setMsg({ type, text }), []);

  const loadDevices = useCallback(async () => {
    const [d, l] = await Promise.all([api.get('/power/devices'), api.get('/power/log')]);
    setDevices(d.data); setLog(l.data);
  }, []);
  const load = useCallback(async () => {
    const [c, a] = await Promise.all([api.get('/power/config'), api.get('/apartments')]);
    setCfg(c.data);
    setForm({ access_id: c.data.access_id, access_secret: '', region: c.data.region, auto_cutoff: c.data.auto_cutoff, months: c.data.months, grace_days: c.data.grace_days });
    setApts(Array.isArray(a.data) ? a.data : a.data?.items || []);
    await loadDevices();
  }, [loadDevices]);
  useEffect(() => { load().catch((e) => say('err', formatError(e))); }, [load, say]);

  const run = async (kind, fn, ok) => {
    setBusy(kind); say('', '');
    try { await fn(); say('ok', ok); } catch (e) { say('err', formatError(e)); } finally { setBusy(''); }
  };
  const save = () => run('save', async () => { await api.put('/power/config', form); await load(); }, 'Stroominstellingen opgeslagen.');
  const test = () => run('test', () => api.post('/power/config/test'), 'Verbonden met Tuya.');
  const unlink = (d) => {
    if (!window.confirm(`Schakelaar van ${d.apartment_number} ontkoppelen?`)) return;
    run('unlink', async () => { await api.delete(`/power/devices/${d.id}`); await loadDevices(); }, 'Schakelaar ontkoppeld.');
  };

  if (!cfg) return <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const free = apts.filter((a) => !devices.some((d) => d.apartment_id === a.id));
  return (
    <div className="space-y-4 max-w-4xl" data-testid="power-settings">
      {msg.text && (
        <div className={`rounded-xl p-2.5 text-xs flex items-center gap-2 border ${msg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {msg.type === 'ok' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} {msg.text}
        </div>
      )}

      <div className={`${CARD} p-5 space-y-3`}>
        <p className="text-sm font-black text-slate-900">Tuya-koppeling</p>
        <p className="text-xs text-slate-500">Maak een project aan op iot.tuya.com, koppel uw Tuya Smart-app aan dat project en vul hier de Access ID en Access Secret in.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={LBL}>Access ID</label>
            <input className={`${INPUT} font-mono`} value={form.access_id || ''} onChange={(e) => set('access_id', e.target.value)} data-testid="power-access-id" /></div>
          <div><label className={LBL}>{cfg.secret_set ? `Access Secret — ingesteld: ${cfg.secret_masked}` : 'Access Secret'}</label>
            <input type="password" className={`${INPUT} font-mono`} value={form.access_secret || ''} placeholder={cfg.secret_set ? 'Laat leeg om te behouden' : ''}
              onChange={(e) => set('access_secret', e.target.value)} data-testid="power-access-secret" /></div>
          <div><label className={LBL}>Data center</label>
            <select className={INPUT} value={form.region} onChange={(e) => set('region', e.target.value)}>
              {cfg.regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select></div>
        </div>
        <button type="button" onClick={test} disabled={!!busy}
          className="h-11 px-4 rounded-xl bg-white border-2 border-orange-200 hover:bg-orange-50 text-[#FF6A1A] font-bold text-sm flex items-center gap-2 disabled:opacity-50">
          {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Test verbinding
        </button>
      </div>

      <div className={`${CARD} p-5 space-y-3`}>
        <p className="text-sm font-black text-slate-900">Automatisch afsluiten bij achterstand</p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={!!form.auto_cutoff} onChange={(e) => set('auto_cutoff', e.target.checked)} className="w-5 h-5 accent-[#FF5C00]" data-testid="power-auto" />
          <span className="text-sm text-slate-700">Stroom automatisch uitzetten, en weer aanzetten zodra de achterstand is betaald</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LBL}>Achterstand (maanden)</label>
            <input type="number" min={1} max={12} className={INPUT} value={form.months} onChange={(e) => set('months', Number(e.target.value))} /></div>
          <div><label className={LBL}>Uitstel na aankondiging (dagen)</label>
            <input type="number" min={0} max={30} className={INPUT} value={form.grace_days} onChange={(e) => set('grace_days', Number(e.target.value))} /></div>
        </div>
        <p className="text-xs text-slate-500">De huurder krijgt eerst een bericht (WhatsApp/SMS). Pas na het uitstel gaat de stroom uit. U ziet elke handeling in het logboek.</p>
        <button type="button" onClick={save} disabled={!!busy} data-testid="power-save"
          className="h-11 px-5 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Opslaan
        </button>
      </div>

      <div className={`${CARD} divide-y divide-orange-50`} data-testid="power-links">
        <div className="p-5">
          <p className="text-sm font-black text-slate-900">Schakelaars koppelen</p>
          <p className="text-xs text-slate-500 mt-1">Koppel per appartement het Tuya device-id van de schakelaar. Aan- en uitzetten doet u in Beheer → Stroom.</p>
        </div>
        {devices.map((d) => (
          <div key={d.id} className="p-4 flex items-center gap-3" data-testid={`power-device-${d.id}`}>
            <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-emerald-100 text-emerald-600"><Zap className="w-5 h-5" /></span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-900">{d.apartment_number}</p>
              <p className="text-[11px] text-slate-500 font-mono truncate">{d.tuya_device_id}</p>
            </div>
            <button type="button" onClick={() => unlink(d)} aria-label="Ontkoppelen"
              className="h-10 w-10 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {free.map((a) => (
          <div key={a.id} className="p-4 flex flex-wrap items-center gap-3" data-testid={`power-free-${a.id}`}>
            <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-slate-100 text-slate-300"><Zap className="w-5 h-5" /></span>
            <div className="flex-1 min-w-[120px]">
              <p className="text-sm font-black text-slate-900">{a.number}</p>
              <p className="text-[11px] text-slate-400">Niet gekoppeld</p>
            </div>
            <input className={`${INPUT} font-mono !w-56`} placeholder="Tuya device-id"
              value={ids[a.id] || ''} onChange={(e) => setIds((m) => ({ ...m, [a.id]: e.target.value }))} />
            <button type="button" disabled={!!busy || !(ids[a.id] || '').trim()}
              onClick={() => run('add', async () => {
                await api.post('/power/devices', { apartment_id: a.id, tuya_device_id: ids[a.id].trim(), exempt: false });
                setIds((m) => ({ ...m, [a.id]: '' }));
                await loadDevices();
              }, `Schakelaar van ${a.number} gekoppeld.`)}
              className="h-11 px-4 rounded-xl bg-[#FF5C00] text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
              <Plus className="w-4 h-4" /> Koppelen
            </button>
          </div>
        ))}
        {devices.length === 0 && free.length === 0 && <p className="p-5 text-sm text-slate-500">Geen appartementen gevonden.</p>}
      </div>

      {log.length > 0 && (
        <div className={`${CARD} p-5`}>
          <p className="text-sm font-black text-slate-900 mb-2">Logboek</p>
          <ul className="text-xs text-slate-600 space-y-1 max-h-60 overflow-auto">
            {log.map((l) => (
              <li key={l.id}>{new Date(l.at).toLocaleString('nl-NL')} — <b>{l.action}</b> ({l.by}){l.reason ? ` — ${l.reason}` : ''}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
