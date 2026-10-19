import { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer, Pencil, Trash2 } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

function PrinterList() {
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get('/settings/kiosk-printers').then(({ data }) => setList(data)).catch(() => setList([])), []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const rename = async (p) => {
    const name = window.prompt('Nieuwe naam voor deze KT-V520', p.name);
    if (!name?.trim()) return;
    try { await api.patch(`/settings/kiosk-printers/${p.id}`, { name }); load(); } catch (e) { window.alert(formatError(e)); }
  };
  const remove = async (p) => {
    if (!window.confirm(`${p.name} ontkoppelen? Het toestel moet daarna opnieuw gekoppeld worden.`)) return;
    try { await api.delete(`/settings/kiosk-printers/${p.id}`); load(); } catch (e) { window.alert(formatError(e)); }
  };

  return (
    <div className="bg-white rounded-2xl border border-orange-100 p-5" data-testid="kiosk-printers">
      <p className="font-black text-slate-900">Gekoppelde KT-V520 toestellen</p>
      <p className="text-sm text-slate-500 mt-0.5">Een KT-V520 koppelt zichzelf zodra iemand er één keer op de kiosk inlogt. Daarna print hij ook als niemand is ingelogd.</p>
      {list === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400 mt-3" /> : list.length === 0 ? (
        <p className="text-sm text-slate-400 mt-3" data-testid="kiosk-printers-empty">Nog geen KT-V520 gekoppeld.</p>
      ) : (
        <ul className="divide-y divide-slate-100 mt-3">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5" data-testid={`kiosk-printer-${p.id}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${p.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm text-slate-900 truncate">{p.name}</span>
                <span className="text-xs text-slate-500">{p.online ? 'Online' : 'Offline'}</span>
                {p.kiosk_ids?.length > 0 && (
                  <span className="block text-[11px] text-slate-400 truncate" data-testid={`kiosk-printer-ids-${p.id}`}>Achtergrondservice: {p.kiosk_ids.join(', ')}</span>
                )}
              </span>
              <button onClick={() => rename(p)} data-testid={`kiosk-printer-rename-${p.id}`} title="Hernoemen"
                className="h-9 w-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center"><Pencil className="w-4 h-4" /></button>
              <button onClick={() => remove(p)} data-testid={`kiosk-printer-remove-${p.id}`} title="Ontkoppelen"
                className="h-9 w-9 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {list?.length > 0 && <UnboundDevices printers={list} onLinked={load} />}
    </div>
  );
}

// APK-achtergrondservices die met ?device=KIOSK-ID verbinden maar nog aan geen printer gekoppeld zijn.
function UnboundDevices({ printers, onLinked }) {
  const [items, setItems] = useState([]);
  const [pick, setPick] = useState({});
  const load = useCallback(() => api.get('/settings/kiosk-unbound-devices').then(({ data }) => setItems(data || [])).catch(() => setItems([])), []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);
  const link = async (kid) => {
    const pid = pick[kid] || printers[0].id;
    try { await api.post(`/settings/kiosk-printers/${pid}/link-device`, { kiosk_id: kid }); load(); onLinked(); } catch (e) { window.alert(formatError(e)); }
  };
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="kiosk-unbound-devices">
      <p className="text-sm font-bold text-amber-900">Achtergrondservice wacht op koppeling</p>
      <p className="text-xs text-amber-800 mt-0.5">Deze KT-V520-service probeert te verbinden. Koppel hem aan de juiste printer.</p>
      <ul className="mt-2 space-y-2">
        {items.map((d) => (
          <li key={d.kiosk_id} className="flex flex-wrap items-center gap-2" data-testid={`kiosk-unbound-${d.kiosk_id}`}>
            <code className="text-xs font-bold text-slate-800 bg-white rounded px-1.5 py-1">{d.kiosk_id}</code>
            <select value={pick[d.kiosk_id] || printers[0].id} onChange={(e) => setPick((s) => ({ ...s, [d.kiosk_id]: e.target.value }))}
              data-testid={`kiosk-unbound-select-${d.kiosk_id}`} className="h-9 rounded-lg border border-slate-200 bg-white text-sm px-2">
              {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={() => link(d.kiosk_id)} data-testid={`kiosk-unbound-link-${d.kiosk_id}`}
              className="h-9 px-3 rounded-lg bg-[#FF5C00] hover:bg-[#E05200] text-white text-sm font-bold">Koppelen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const Flag = ({ ok, label }) => (
  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{label}</span>
);
const ROLE_NL = { admin: 'Beheerder', employee: 'Medewerker', printer: 'Printer-modus' };

function DevicesSeen() {
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get('/settings/kiosk-devices-seen').then(({ data }) => setList(data)).catch(() => setList([])), []);
  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);
  return (
    <div className="bg-white rounded-2xl border border-orange-100 p-5" data-testid="kiosk-devices-seen">
      <p className="font-black text-slate-900">Kiosk-toestellen (diagnose, laatste 7 dagen)</p>
      <p className="text-sm text-slate-500 mt-0.5">Wat elk toestel meldt bij het verbinden. Een KT-V520 heeft een APK-brug nodig; staat "KT-V520 herkend" uit, koppel hem dan handmatig via de knop op de beheerder-kiosk.</p>
      {list === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400 mt-3" /> : list.length === 0 ? (
        <p className="text-sm text-slate-400 mt-3">Nog geen toestellen gezien.</p>
      ) : (
        <ul className="divide-y divide-slate-100 mt-3">
          {list.map((d) => (
            <li key={d.key} className="py-2.5 space-y-1" data-testid={`kiosk-device-seen-${d.key}`}>
              <p className="text-sm font-bold text-slate-900">{d.name || 'Onbekend'} <span className="text-xs font-semibold text-slate-400">· {ROLE_NL[d.role] || d.role} · {new Date(d.last_seen).toLocaleString('nl-NL')}</span></p>
              <div className="flex flex-wrap gap-1">
                <Flag ok={d.rn_bridge} label="React Native brug" />
                <Flag ok={d.android_bridge} label="Android-brug" />
                <Flag ok={d.ktp_flag} label="KTP-vlag" />
                <Flag ok={d.ktp_detected} label="KT-V520 herkend" />
                <Flag ok={d.paired} label="Gekoppeld" />
              </div>
              <p className="text-[11px] text-slate-400 break-all font-mono">{d.ua || '(geen user-agent)'}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function KioskDevices() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3" data-testid="kiosk-devices-printer-hint">
        Het printertype (KT-V520 of Bluetooth) kies je nu onder <a href="#bon-printer" className="font-bold text-[#FF5C00] underline">Instellingen → Bon printer</a>.
      </p>
      <PrinterList />
      <DevicesSeen />
    </div>
  );
}
