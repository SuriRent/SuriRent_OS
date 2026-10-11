import { useState } from 'react';
import { Printer, Check, Loader2, MapPin, Bluetooth, Smartphone, Cpu, ReceiptText } from 'lucide-react';
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

// Proefbon: in de APK via de print-bridge, in de browser via het printvenster.
async function testPrint(loc) {
  const pr = loc.printer;
  if (window.ReactNativeWebView?.postMessage) {
    const msg = { type: 'PRINT_RECEIPT', command: pr.command, printer: pr, test: true, data: {
      naam: 'Proefbon Huurder', appartement: 'A-101', bedrag: 'SRD 1.250,00', methode: 'Contant',
      datum: new Date().toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }).replace(',', ''),
      kwitantie: 'TEST-0001', locatie: loc.name } };
    console.log('[APK PRINT_RECEIPT]', msg);
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    return 'Proefbon verstuurd naar de printer';
  }
  const w = window.open('', '_blank', 'width=420,height=700');
  const { data } = await api.get(`/locations/${loc.id}/test-print.html`, { responseType: 'text' });
  if (!w) throw new Error('Pop-up geblokkeerd — sta pop-ups toe om de proefbon te printen');
  w.document.open(); w.document.write(data); w.document.close();
  return 'Proefbon geopend in het printvenster';
}

function LocationPrinterCard({ loc, onSaved }) {
  const [type, setType] = useState(loc.printer.type);
  const [paper, setPaper] = useState(loc.printer.paper);
  const [width, setWidth] = useState(loc.printer.paper === 'custom' ? String(loc.printer.width_mm) : '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testing, setTesting] = useState(false);
  const runTest = async () => {
    setTesting(true); setMsg(null);
    try { setMsg({ ok: true, t: await testPrint(loc) }); }
    catch (e) { setMsg({ ok: false, t: e?.response ? formatError(e) : e.message }); }
    finally { setTesting(false); }
  };
  const dirty = type !== loc.printer.type || paper !== loc.printer.paper
    || (paper === 'custom' && Number(width) !== loc.printer.width_mm);
  const save = async () => {
    if (paper === 'custom' && !(Number(width) >= 30 && Number(width) <= 120)) {
      setMsg({ ok: false, t: 'Vul een papierbreedte tussen 30 en 120 mm in' }); return;
    }
    setSaving(true); setMsg(null);
    try {
      await api.put(`/locations/${loc.id}/printer`, { type, paper, width_mm: paper === 'custom' ? Number(width) : null });
      setMsg({ ok: true, t: 'Printerinstellingen opgeslagen' });
      onSaved();
    } catch (e) { setMsg({ ok: false, t: formatError(e) }); }
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
      <div className="mt-5 flex flex-col sm:flex-row gap-2">
        <button onClick={save} disabled={saving} data-testid={`printer-save-${loc.id}`}
          className="w-full sm:w-auto h-11 px-6 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Opslaan
        </button>
        <button onClick={runTest} disabled={testing || dirty} data-testid={`printer-test-${loc.id}`}
          title={dirty ? 'Sla eerst de wijzigingen op' : 'Print een proefbon met deze instellingen'}
          className="w-full sm:w-auto h-11 px-6 rounded-xl border-2 border-slate-200 hover:border-[#FF5C00] text-slate-800 font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ReceiptText className="w-4 h-4" />} Testbon printen
        </button>
      </div>
      {dirty && <p className="mt-2 text-xs text-slate-500">Sla eerst op om met de nieuwe instellingen te testen.</p>}
      {msg && (
        <p data-testid={`printer-msg-${loc.id}`}
          className={`mt-3 text-sm font-semibold rounded-xl px-3 py-2 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.t}</p>
      )}
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
