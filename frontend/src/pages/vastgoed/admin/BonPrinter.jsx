import { useCallback, useEffect, useState } from 'react';
import { Bluetooth, Loader2, Printer, Ban, Check } from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';
import { BtPrinterCard } from '../../../components/BtPrinterCard';

const MODES = [
  { id: 'none', label: 'Geen bonprinter', desc: 'Bonnen alleen tonen; afdrukken via het gewone printvenster.', Icon: Ban },
  { id: 'kt-v520', label: 'KT-V520 ingebouwde printer', desc: 'Stil printen via de ingebouwde printer van de KingTop KT-V520 (Android-app).', Icon: Printer },
  { id: 'bluetooth', label: 'Bluetooth thermische printer', desc: 'Elk toestel koppelt zijn eigen printer; bonnen gaan na elke betaling automatisch naar die printer.', Icon: Bluetooth },
];

function Choice({ active, onClick, children, testid }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className={`w-full text-left rounded-xl border-2 p-4 flex items-start gap-3 transition-colors ${active ? 'border-[#FF5C00] bg-orange-50/60' : 'border-slate-100 hover:border-slate-200 bg-white'}`}>
      {children}
      <span className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-[#FF5C00] bg-[#FF5C00]' : 'border-slate-300'}`}>
        {active && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </span>
    </button>
  );
}

export default function BonPrinter() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/settings');
      const k = data?.kiosk_devices || {};
      setCfg({ printer_mode: k.printer_mode || (k.kt_v520_enabled ? 'kt-v520' : 'none'), paper_width: Number(k.paper_width) === 80 ? 80 : 58 });
    } catch (e) { setErr(formatError(e)); setCfg((c) => c || { printer_mode: 'none', paper_width: 58 }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const update = async (patch) => {
    const prev = cfg; const next = { ...cfg, ...patch };
    setCfg(next); setSaving(true); setErr('');
    try {
      await api.put('/settings/kiosk_devices', next);
      // Dit toestel direct bijwerken (kiosks krijgen het via de live-verbinding).
      if (next.printer_mode === 'none') localStorage.removeItem('kiosk_printer'); else localStorage.setItem('kiosk_printer', next.printer_mode);
      localStorage.setItem('kiosk_paper_width', String(next.paper_width));
    } catch (e) { setCfg(prev); setErr(formatError(e)); } finally { setSaving(false); }
  };

  if (!cfg) return <div className="flex items-center text-slate-400 text-sm p-10"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Laden...</div>;
  return (
    <div className="space-y-4" data-testid="bon-printer-settings">
      <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-black text-slate-900">Bon printer</p>
            <p className="text-sm text-slate-500 mt-0.5">Standaard voor alle kiosks van je bedrijf.</p>
          </div>
          {saving && <Loader2 className="w-4 h-4 animate-spin text-slate-400" data-testid="bon-printer-saving" />}
        </div>
        {MODES.map(({ id, label, desc, Icon }) => (
          <Choice key={id} active={cfg.printer_mode === id} onClick={() => update({ printer_mode: id })} testid={`bon-printer-mode-${id}`}>
            <span className="w-10 h-10 rounded-xl bg-orange-50 text-[#FF5C00] flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
            <span className="min-w-0"><span className="block font-bold text-sm text-slate-900">{label}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{desc}</span></span>
          </Choice>
        ))}
        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2" data-testid="bon-printer-error">{err}</p>}
      </div>
      {cfg.printer_mode === 'bluetooth' && (
        <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-4" data-testid="bon-printer-bluetooth">
          <div>
            <p className="font-black text-slate-900">Papierbreedte</p>
            <div className="mt-2 inline-flex rounded-xl bg-slate-100 p-1" data-testid="bon-printer-width">
              {[58, 80].map((w) => (
                <button key={w} type="button" onClick={() => update({ paper_width: w })} data-testid={`bon-printer-width-${w}`}
                  className={`h-9 px-5 rounded-lg text-sm font-bold transition-colors ${cfg.paper_width === w ? 'bg-white text-[#FF5C00] shadow-sm' : 'text-slate-500'}`}>{w} mm</button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-black text-slate-900">Printer op dit toestel</p>
            <p className="text-sm text-slate-500 mt-0.5 mb-3">Koppel op elk kiosk-toestel de printer die ernaast staat. Werkt met Bluetooth (BLE) bonprinters in Chrome/Edge op Android en Windows, en in de Android-app.</p>
            <BtPrinterCard />
          </div>
        </div>
      )}
    </div>
  );
}
