import { useState } from 'react';
import { Printer, Check, Loader2, MapPin, Bluetooth, Smartphone, Cpu } from 'lucide-react';
import { toast } from 'sonner';
import { api, formatError } from '../../../lib/api';
import { useApiSWR } from '../../../lib/swr';

const TYPES = [
  { v: 'ktp', l: 'KTP Print SDK', d: 'KTP-terminal via SDK', I: Cpu },
  { v: 'sunmi', l: 'Sunmi ingebouwd', d: 'Ingebouwde Sunmi-printer', I: Smartphone },
  { v: 'bluetooth', l: 'Bluetooth printer', d: 'Losse printer via Bluetooth', I: Bluetooth },
];
const PAPERS = [{ v: '58mm', l: '58 mm' }, { v: '80mm', l: '80 mm' }, { v: 'custom', l: 'Aangepast' }];

function Choice({ active, onClick, children, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`text-left rounded-xl border-2 p-3 transition-colors ${active ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}>
      {children}
    </button>
  );
}

function LocationPrinterCard({ loc, onSaved }) {
  const [type, setType] = useState(loc.printer.type);
  const [paper, setPaper] = useState(loc.printer.paper);
  const [width, setWidth] = useState(loc.printer.paper === 'custom' ? String(loc.printer.width_mm) : '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (paper === 'custom' && !(Number(width) >= 30 && Number(width) <= 120)) {
      toast.error('Vul een papierbreedte tussen 30 en 120 mm in'); return;
    }
    setSaving(true);
    try {
      await api.put(`/locations/${loc.id}/printer`, { type, paper, width_mm: paper === 'custom' ? Number(width) : null });
      toast.success(`Printerinstellingen opgeslagen voor ${loc.name}`);
      onSaved();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6" data-testid={`printer-card-${loc.id}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0"><MapPin className="w-5 h-5 text-[#FF5C00]" /></div>
          <div className="min-w-0">
            <p className="font-black text-slate-900 truncate">{loc.name}</p>
            {loc.address && <p className="text-xs text-slate-500 truncate">{loc.address}</p>}
          </div>
        </div>
        {!loc.printer.configured && <span className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full bg-amber-50 text-amber-700">Standaard</span>}
      </div>
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Printertype</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {TYPES.map(({ v, l, d, I }) => (
          <Choice key={v} active={type === v} onClick={() => setType(v)} testId={`printer-type-${loc.id}-${v}`}>
            <div className="flex items-center gap-2"><I className="w-4 h-4 text-[#FF5C00]" /><span className="font-bold text-sm text-slate-900">{l}</span></div>
            <p className="text-xs text-slate-500 mt-0.5">{d}</p>
          </Choice>
        ))}
      </div>
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Papierformaat</p>
      <div className="grid grid-cols-3 gap-2">
        {PAPERS.map(({ v, l }) => (
          <Choice key={v} active={paper === v} onClick={() => setPaper(v)} testId={`printer-paper-${loc.id}-${v}`}>
            <span className="font-bold text-sm text-slate-900">{l}</span>
          </Choice>
        ))}
      </div>
      {paper === 'custom' && (
        <div className="mt-3 flex items-center gap-2">
          <input type="number" inputMode="numeric" min={30} max={120} value={width} onChange={(e) => setWidth(e.target.value)}
            data-testid={`printer-width-${loc.id}`} placeholder="bv. 72"
            className="w-32 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none font-bold" />
          <span className="text-sm text-slate-500 font-semibold">mm breed</span>
        </div>
      )}
      <button onClick={save} disabled={saving} data-testid={`printer-save-${loc.id}`}
        className="mt-5 w-full sm:w-auto h-11 px-6 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Opslaan
      </button>
    </div>
  );
}

export default function PrinterSettings() {
  const { data, mutate } = useApiSWR('/locations/printer-settings');
  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>;
  if (!data.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center" data-testid="printer-empty">
        <Printer className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="font-semibold text-slate-500">Maak eerst een locatie aan om printerinstellingen te kiezen.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="printer-settings">
      {data.map((loc) => <LocationPrinterCard key={loc.id} loc={loc} onSaved={mutate} />)}
    </div>
  );
}
