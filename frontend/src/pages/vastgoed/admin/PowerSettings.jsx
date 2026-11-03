import { useState, useEffect, useCallback } from 'react';
import { Zap, Power, Check, AlertCircle, Loader2, Save, Trash2, RefreshCw, Plus } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

const CARD = 'bg-white rounded-2xl border border-orange-100';
const INPUT = 'w-full h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-sm';
const LBL = 'block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1';

function DeviceRow({ d, onChanged, onMsg }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => {
    setBusy('read');
    try { const { data } = await api.get(`/power/devices/${d.id}/status`); setSt(data); }
    catch (e) { onMsg('err', formatError(e)); } finally { setBusy(''); }
  }, [d.id, onMsg]);
  const toggle = async () => {
    const next = !(st?.on ?? d.on);
    setBusy('switch');
    try { await api.post(`/power/devices/${d.id}/switch`, { on: next }); await refresh(); onChanged(); }
    catch (e) { onMsg('err', formatError(e)); setBusy(''); }
  };
  const remove = async () => {
    if (!window.confirm(`Schakelaar van ${d.apartment_number} ontkoppelen?`)) return;
    try { await api.delete(`/power/devices/${d.id}`); onChanged(); } catch (e) { onMsg('err', formatError(e)); }
  };
  const on = st?.on ?? d.on;
  return (
    <div className="p-4 flex flex-wrap items-center gap-3" data-testid={`power-device-${d.id}`}>
      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-emerald-100 text-emerald-600' : on === false ? 'bg-red-100 text-red-500' : 'bg-slate-100 text-slate-400'}`}>
        <Zap className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-[140px]">
        <p className="text-sm font-black text-slate-900">{d.apartment_number}{d.tenant_name ? ` — ${d.tenant_name}` : ''}</p>
        <p className="text-[11px] text-slate-500 font-mono truncate">{d.tuya_device_id}</p>
        {d.notice_at && d.on !== false && <p className="text-[11px] font-bold text-amber-600">Afsluiting aangekondigd</p>}
        {d.exempt && <p className="text-[11px] text-slate-500">Uitgezonderd van automatische afsluiting</p>}
      </div>
      {st && (
        <div className="text-xs text-slate-600 grid grid-cols-2 gap-x-4 tabular-nums">
          {st.power_w != null && <span>{st.power_w} W</span>}
          {st.current_a != null && <span>{st.current_a} A</span>}
          {st.voltage_v != null && <span>{st.voltage_v} V</span>}
          {st.energy_kwh != null && <span>{st.energy_kwh} kWh</span>}
        </div>
      )}
      <button type="button" onClick={refresh} disabled={!!busy} aria-label="Verbruik ophalen"
        className="h-10 w-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
        {busy === 'read' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
      </button>
      <button type="button" onClick={toggle} disabled={!!busy} data-testid={`power-toggle-${d.id}`}
        className={`h-10 px-4 rounded-xl font-bold text-sm flex items-center gap-2 text-white ${on ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-600 hover:bg-emerald-700'} disabled:opacity-50`}>
        {busy === 'switch' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
        {on ? 'Uitzetten' : 'Aanzetten'}
      </button>
      <button type="button" onClick={remove} aria-label="Ontkoppelen"
        className="h-10 w-10 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

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

      <div className={`${CARD} divide-y divide-orange-50`} data-testid="power-overview">
        <div className="p-5 space-y-3">
          <p className="text-sm font-black text-slate-900">Alle appartementen</p>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700">{devices.filter((d) => d.on === true).length} aan</span>
            <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-600">{devices.filter((d) => d.on === false).length} uit</span>
            <span className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600">{free.length} niet gekoppeld</span>
          </div>
          {devices.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {[[true, 'Alles aan', 'bg-emerald-600 hover:bg-emerald-700'], [false, 'Alles uit', 'bg-red-500 hover:bg-red-600']].map(([on, label, cls]) => (
                <button key={label} type="button" disabled={!!busy} data-testid={`power-all-${on ? 'on' : 'off'}`}
                  onClick={() => {
                    if (!window.confirm(`${label} voor ${devices.length} appartement(en)?`)) return;
                    run('all', async () => {
                      const { data } = await api.post('/power/switch-all', { on });
                      await loadDevices();
                      if (data.failed?.length) throw new Error(`${data.done} gelukt, ${data.failed.length} mislukt: ${data.failed[0].error}`);
                    }, `${label}: gelukt.`);
                  }}
                  className={`h-10 px-4 rounded-xl text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50 ${cls}`}>
                  {busy === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {devices.map((d) => <DeviceRow key={d.id} d={d} onChanged={loadDevices} onMsg={say} />)}
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
