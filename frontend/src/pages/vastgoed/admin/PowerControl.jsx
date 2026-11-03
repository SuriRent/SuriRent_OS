import { useState, useEffect, useCallback } from 'react';
import { Zap, Power, Loader2, X, AlertCircle } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

function Rocker({ on, busy, onToggle }) {
  return (
    <button type="button" onClick={onToggle} disabled={busy} role="switch" aria-checked={!!on} data-testid="power-rocker"
      className={`relative w-44 h-24 rounded-full p-2 transition-colors duration-300 shadow-inner disabled:opacity-70 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-2 left-2 w-20 h-20 rounded-full bg-white shadow-lg flex items-center justify-center transition-transform duration-300 ${on ? 'translate-x-[80px]' : 'translate-x-0'}`}>
        {busy ? <Loader2 className="w-8 h-8 animate-spin text-slate-500" /> : <Power className={`w-8 h-8 ${on ? 'text-emerald-600' : 'text-slate-400'}`} strokeWidth={2.6} />}
      </span>
      <span className={`absolute top-1/2 -translate-y-1/2 text-white font-black text-lg ${on ? 'left-6' : 'right-6 !text-slate-500'}`}>{on ? 'AAN' : 'UIT'}</span>
    </button>
  );
}

function SwitchDialog({ dev, onClose, onChanged }) {
  const [on, setOn] = useState(dev.on);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get(`/power/devices/${dev.id}/status`).then(({ data }) => { setSt(data); if (data.on != null) setOn(data.on); }).catch(() => {});
  }, [dev.id]);
  const toggle = async () => {
    setBusy(true); setErr('');
    try {
      const next = !on;
      await api.post(`/power/devices/${dev.id}/switch`, { on: next });
      setOn(next); onChanged();
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={onClose} data-testid="power-dialog">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Sluiten" className="absolute right-4 top-4 w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
          <X className="w-5 h-5 text-slate-600" />
        </button>
        <p className="text-2xl font-black text-slate-900 pr-10 text-left">{dev.apartment_number}</p>
        <p className="text-sm text-slate-500 text-left mb-6">{dev.tenant_name || 'Geen huurder'}</p>
        <div className="flex justify-center mb-4"><Rocker on={on} busy={busy} onToggle={toggle} /></div>
        <p className={`font-black text-lg ${on ? 'text-emerald-600' : 'text-slate-500'}`}>{on ? 'Stroom staat aan' : on === false ? 'Stroom staat uit' : 'Status onbekend'}</p>
        {st && (st.power_w != null || st.energy_kwh != null) && (
          <p className="mt-2 text-xs text-slate-500 tabular-nums">
            {st.power_w != null && `${st.power_w} W`}{st.power_w != null && st.energy_kwh != null && ' · '}{st.energy_kwh != null && `${st.energy_kwh} kWh`}
          </p>
        )}
        {dev.notice_at && on !== false && <p className="mt-2 text-xs font-bold text-amber-600">Afsluiting aangekondigd</p>}
        {err && <p className="mt-3 text-xs text-red-600 flex items-center justify-center gap-1"><AlertCircle className="w-4 h-4" /> {err}</p>}
      </div>
    </div>
  );
}

// Stroom bedienen per appartement: kies een tegel, zet de schakelaar aan of uit.
export default function PowerControl({ kiosk = false }) {
  const [devices, setDevices] = useState([]);
  const [apts, setApts] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([api.get('/power/devices'), api.get('/apartments')]);
    setDevices(d.data);
    setApts(Array.isArray(a.data) ? a.data : a.data?.items || []);
  }, []);
  useEffect(() => {
    load().catch((e) => setErr(formatError(e))).finally(() => setLoading(false));
  }, [load]);

  const all = async (on) => {
    const label = on ? 'Alles aan' : 'Alles uit';
    if (!window.confirm(`${label} voor ${devices.length} appartement(en)?`)) return;
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/power/switch-all', { on });
      await load();
      if (data.failed?.length) setErr(`${data.done} gelukt, ${data.failed.length} mislukt: ${data.failed[0].error}`);
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };

  const linked = new Set(devices.map((d) => d.apartment_id));
  const free = apts.filter((a) => !linked.has(a.id));
  const light = kiosk ? 'text-white' : 'text-slate-900';

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className={`w-8 h-8 animate-spin ${kiosk ? 'text-white' : 'text-orange-500'}`} /></div>;
  return (
    <div className={kiosk ? 'px-3 sm:px-4 pt-3 pb-32 md:pb-28' : 'space-y-4'} data-testid="power-control">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">{devices.filter((d) => d.on === true).length} aan</span>
        <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-red-100 text-red-600">{devices.filter((d) => d.on === false).length} uit</span>
        <span className="flex-1" />
        {devices.length > 0 && (
          <>
            <button type="button" disabled={busy} onClick={() => all(true)} data-testid="power-all-on"
              className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
              <Power className="w-4 h-4" /> Alles aan
            </button>
            <button type="button" disabled={busy} onClick={() => all(false)} data-testid="power-all-off"
              className="h-10 px-4 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
              <Power className="w-4 h-4" /> Alles uit
            </button>
          </>
        )}
      </div>
      {err && <div className="mb-3 rounded-xl bg-white/95 text-red-600 text-sm font-semibold p-3">{err}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3 md:gap-4">
        {devices.map((d) => (
          <button key={d.id} type="button" onClick={() => setOpen(d)} data-testid={`power-tile-${d.id}`}
            className={`rounded-2xl p-4 flex flex-col items-center text-center gap-2 shadow-lg border-2 transition active:scale-95 bg-white hover:-translate-y-0.5 ${d.on === true ? 'border-emerald-400' : d.on === false ? 'border-red-300' : 'border-transparent'}`}>
            <span className={`w-12 h-12 rounded-2xl flex items-center justify-center ${d.on === true ? 'bg-emerald-100 text-emerald-600' : d.on === false ? 'bg-red-100 text-red-500' : 'bg-slate-100 text-slate-400'}`}>
              <Zap className="w-6 h-6" />
            </span>
            <span className="font-black text-slate-900 text-base leading-tight">{d.apartment_number}</span>
            <span className="text-xs text-slate-500 truncate max-w-full">{d.tenant_name || 'Geen huurder'}</span>
            <span className={`text-[11px] font-black rounded-full px-2.5 py-0.5 ${d.on === true ? 'bg-emerald-100 text-emerald-700' : d.on === false ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
              {d.on === true ? 'AAN' : d.on === false ? 'UIT' : 'ONBEKEND'}
            </span>
          </button>
        ))}
        {free.map((a) => (
          <div key={a.id} className="rounded-2xl p-4 flex flex-col items-center text-center gap-2 bg-white/70 border-2 border-dashed border-slate-300 opacity-80" data-testid={`power-free-${a.id}`}>
            <span className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center"><Zap className="w-6 h-6" /></span>
            <span className="font-black text-slate-700 text-base leading-tight">{a.number}</span>
            <span className="text-[11px] text-slate-400">Niet gekoppeld</span>
          </div>
        ))}
      </div>
      {devices.length === 0 && free.length === 0 && <p className={`text-sm ${light}`}>Geen appartementen gevonden.</p>}
      {devices.length === 0 && free.length > 0 && (
        <p className={`mt-4 text-sm ${kiosk ? 'text-white/90' : 'text-slate-500'}`}>Koppel eerst een schakelaar per appartement via Instellingen → Stroom.</p>
      )}
      {open && <SwitchDialog dev={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}
