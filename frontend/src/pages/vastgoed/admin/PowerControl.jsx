import { useState, useEffect, useCallback } from 'react';
import { Zap, Power, Loader2, X, AlertCircle } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

function BreakerTile({ device, orangeMode = false }) {
  const { on, apartment_number: apartmentNumber, tenant_name: tenantName } = device;
  const isOn = on === true;
  const isOff = on === false;
  return (
    <span aria-hidden="true"
      className="relative flex min-h-52 w-full flex-col overflow-hidden rounded-xl border border-slate-400 bg-gradient-to-b from-white via-slate-100 to-slate-300 p-2 shadow-[inset_0_1px_2px_rgba(255,255,255,0.95),0_8px_18px_rgba(15,23,42,0.22)]">
      <span className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full border border-slate-500 bg-slate-300 shadow-inner" />
      <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full border border-slate-500 bg-slate-300 shadow-inner" />
      <span className="absolute bottom-2 left-2 h-1.5 w-1.5 rounded-full border border-slate-500 bg-slate-300 shadow-inner" />
      <span className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full border border-slate-500 bg-slate-300 shadow-inner" />
      <span className="flex flex-none items-center justify-between px-2 py-1 text-[9px] font-bold tracking-widest text-slate-500">
        <span>N&nbsp; INPUT</span><span>L</span>
      </span>
      <span className="mx-1 flex flex-1 flex-col items-center rounded-md border border-slate-300 bg-gradient-to-b from-white to-slate-100 p-1.5 shadow-inner">
        <span className={`flex w-full items-center justify-between rounded px-2 py-1 text-[9px] font-black tracking-[0.16em] text-white ${orangeMode ? 'bg-[#E85D0F]' : 'bg-slate-800'}`}>
          <span>SURIRENT · POWER</span>
          <span className={`h-2 w-2 rounded-full border border-white/40 ${isOn ? 'bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.9)]' : isOff ? 'bg-red-400 shadow-[0_0_7px_rgba(248,113,113,0.7)]' : 'bg-amber-300 shadow-[0_0_7px_rgba(252,211,77,0.7)]'}`} />
        </span>
        <span className="mt-1.5 flex w-full min-w-0 flex-col items-center rounded border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
          <span className="max-w-full truncate text-sm font-black leading-tight text-slate-900">{apartmentNumber}</span>
          <span className="max-w-full truncate text-[10px] font-medium leading-tight text-slate-500">{tenantName || 'Geen huurder'}</span>
        </span>
        <span className="mt-2 flex flex-1 items-center justify-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full border-[3px] shadow-[inset_0_2px_3px_rgba(255,255,255,0.6),0_3px_6px_rgba(15,23,42,0.25)] transition duration-300 ${orangeMode ? 'border-orange-800 bg-gradient-to-b from-orange-300 to-[#F26A12]' : 'border-slate-600 bg-gradient-to-b from-sky-300 to-cyan-600'} ${isOn ? 'ring-2 ring-emerald-300/70' : isOff ? 'opacity-70' : 'opacity-85'}`}>
            <Power className={`h-6 w-6 ${orangeMode ? 'text-white' : 'text-slate-800'}`} strokeWidth={2.6} />
          </span>
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-black tracking-widest ${isOn ? 'bg-emerald-100 text-emerald-800' : isOff ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
          {isOn ? 'AAN' : isOff ? 'UIT' : 'STATUS ONBEKEND'}
        </span>
      </span>
      <span className="flex flex-none items-center justify-between px-2 py-1 text-[9px] font-bold tracking-widest text-slate-500">
        <span>N&nbsp; OUTPUT</span><span>L</span>
      </span>
    </span>
  );
}

function Rocker({ on, busy, onToggle, orangeMode = false }) {
  const isOn = on === true;
  const isOff = on === false;
  const leverPosition = isOn ? '-translate-y-7 -rotate-12' : isOff ? 'translate-y-7 rotate-12' : '';
  return (
    <button type="button" onClick={onToggle} disabled={busy} role="switch" aria-checked={isOn}
      aria-label={`Stroom ${isOn ? 'uitschakelen' : 'inschakelen'}`} data-testid="power-rocker"
      className="relative w-40 h-56 rounded-2xl border border-slate-400 bg-gradient-to-br from-slate-100 via-slate-300 to-slate-400 p-3 shadow-[inset_0_2px_5px_rgba(255,255,255,0.9),0_12px_24px_rgba(15,23,42,0.22)] disabled:opacity-80">
      <span className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-slate-500 shadow-inner" />
      <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-slate-500 shadow-inner" />
      <span className="absolute bottom-2 left-2 h-2.5 w-2.5 rounded-full bg-slate-500 shadow-inner" />
      <span className="absolute bottom-2 right-2 h-2.5 w-2.5 rounded-full bg-slate-500 shadow-inner" />
      <span className={`relative flex h-full flex-col items-center rounded-xl border px-3 py-3 shadow-inner ${orangeMode ? 'border-orange-300 bg-gradient-to-b from-orange-50 to-orange-100' : 'border-slate-500 bg-gradient-to-b from-slate-700 to-slate-900'}`}>
        <span className={`flex w-full items-center justify-between text-[9px] font-black tracking-[0.18em] ${orangeMode ? 'text-orange-800' : 'text-slate-300'}`}>
          <span>BREAKER</span>
          <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-black/30 ${isOn ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : isOff ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.65)]' : 'bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.7)]'}`} />
        </span>
        <span className={`mt-3 text-xs font-black tracking-widest ${isOn ? 'text-emerald-600' : 'text-slate-500'}`}>I&nbsp; ON</span>
        <span className={`relative my-1 flex w-20 flex-1 items-center justify-center rounded-full border shadow-inner ${orangeMode ? 'border-orange-300 bg-orange-200' : 'border-black/50 bg-black/50'}`}>
          <span className={`absolute inset-x-0 top-1/2 h-px ${orangeMode ? 'bg-orange-300' : 'bg-white/10'}`} />
          <span className={`relative z-10 flex h-16 w-12 items-center justify-center rounded-lg border border-slate-400 bg-gradient-to-br from-slate-100 via-white to-slate-400 shadow-[0_5px_8px_rgba(0,0,0,0.45)] transition-transform duration-300 ${leverPosition}`}>
            <span className="h-10 w-2 rounded-full bg-gradient-to-r from-slate-400 via-white to-slate-400 shadow-sm" />
            {busy && <Loader2 className="absolute h-5 w-5 animate-spin text-slate-700" />}
          </span>
        </span>
        <span className={`mb-1 text-xs font-black tracking-widest ${isOff ? 'text-red-500' : 'text-slate-500'}`}>O&nbsp; OFF</span>
        <span className={`text-[8px] font-bold tracking-[0.2em] ${orangeMode ? 'text-orange-700' : 'text-slate-500'}`}>SURI RENT</span>
      </span>
    </button>
  );
}

function SwitchDialog({ dev, onClose, onChanged, orangeMode = false }) {
  const [on, setOn] = useState(dev.on);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const loadStatus = useCallback(() => {
    api.get(`/power/devices/${dev.id}/status`).then(({ data }) => { setSt(data); if (data.on != null) setOn(data.on); }).catch(() => {});
  }, [dev.id]);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    const onChange = (e) => {
      const paths = e.detail?.paths || [e.detail?.path];
      if (paths.some((path) => !path || path.includes('/power'))) loadStatus();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') loadStatus(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadStatus]);
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
        <div className="flex justify-center mb-4"><Rocker on={on} busy={busy} onToggle={toggle} orangeMode={orangeMode} /></div>
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

// Stroomschakelaar van één appartement (kiosk, gekozen huurder).
export function ApartmentPower({ apartmentId, onClose, orangeMode = false }) {
  const [dev, setDev] = useState(undefined);
  const [err, setErr] = useState('');
  const loadDevice = useCallback(() => {
    api.get('/power/devices')
      .then(({ data }) => setDev(data.find((d) => d.apartment_id === apartmentId) || null))
      .catch((e) => { setErr(formatError(e)); setDev(null); });
  }, [apartmentId]);
  useEffect(() => { loadDevice(); }, [loadDevice]);
  useEffect(() => {
    const onChange = (e) => {
      const paths = e.detail?.paths || [e.detail?.path];
      if (paths.some((path) => !path || path.includes('/power'))) loadDevice();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') loadDevice(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadDevice]);
  if (dev === undefined) return null;
  if (dev) return <SwitchDialog dev={dev} onClose={onClose} onChanged={() => {}} orangeMode={orangeMode} />;
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <Zap className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="font-black text-slate-900">{err || 'Geen schakelaar gekoppeld aan dit appartement'}</p>
        <button type="button" onClick={onClose} className="mt-4 h-11 px-6 rounded-xl bg-slate-100 font-bold text-sm">Sluiten</button>
      </div>
    </div>
  );
}

// Stroom bedienen per appartement: kies een tegel, zet de schakelaar aan of uit.
export default function PowerControl({ kiosk = false, orangeMode = false }) {
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
  useEffect(() => {
    const onChange = () => { load().catch((e) => setErr(formatError(e))); };
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
            aria-label={`${d.apartment_number}, ${d.tenant_name || 'Geen huurder'}, stroom ${d.on === true ? 'aan' : d.on === false ? 'uit' : 'onbekend'}. Open bediening.`}
            className="rounded-2xl border-0 bg-transparent p-0 text-left shadow-none transition active:scale-[0.98] hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <BreakerTile device={d} orangeMode={orangeMode} />
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
      {open && <SwitchDialog dev={open} onClose={() => setOpen(null)} onChanged={load} orangeMode={orangeMode} />}
    </div>
  );
}
