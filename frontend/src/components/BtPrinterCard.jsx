import { useEffect, useState } from 'react';
import { Bluetooth, BluetoothSearching, Loader2, Printer, Trash2, Smartphone, Check } from 'lucide-react';
import { btSupport, forgetPrinter, getSavedPrinter, printLinesBluetooth, saveApkPrinter, scanApk, scanWeb, testLines } from '../lib/bt-printer';

const btn = 'h-10 px-4 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50';

function ApkDeviceList({ devices, onPick }) {
  if (!devices.length) return <p className="text-sm text-slate-400" data-testid="bt-scan-empty">Geen printers gevonden. Zet de printer aan en probeer opnieuw.</p>;
  return (
    <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl" data-testid="bt-scan-results">
      {devices.map((d) => (
        <li key={d.address}>
          <button onClick={() => onPick(d)} data-testid={`bt-scan-pick-${d.address}`}
            className="w-full text-left px-3 py-2.5 hover:bg-orange-50 flex items-center gap-2">
            <Bluetooth className="w-4 h-4 text-blue-500" />
            <span className="flex-1 min-w-0"><span className="block text-sm font-bold text-slate-900 truncate">{d.name || 'Onbekend'}</span>
              <span className="text-[11px] text-slate-400 font-mono">{d.address}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Koppel (per toestel) een Bluetooth bonprinter; bewaard in dit toestel.
export function BtPrinterCard() {
  const support = btSupport();
  const [saved, setSaved] = useState(getSavedPrinter);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [devices, setDevices] = useState(null);

  useEffect(() => {
    const on = () => setSaved(getSavedPrinter());
    window.addEventListener('bt-printer-changed', on);
    return () => window.removeEventListener('bt-printer-changed', on);
  }, []);

  const run = async (kind, fn) => {
    setBusy(kind); setMsg(null);
    try { await fn(); } catch (e) {
      if (e?.name !== 'NotFoundError') setMsg({ ok: false, text: e?.message || 'Er ging iets mis' });
    } finally { setBusy(''); }
  };
  const scan = () => run('scan', async () => {
    if (support === 'apk') { setDevices(await scanApk()); return; }
    const d = await scanWeb();
    setMsg({ ok: true, text: `Gekoppeld: ${d.name || 'Bluetooth printer'}` });
  });
  const pick = (d) => { saveApkPrinter(d); setDevices(null); setMsg({ ok: true, text: `Gekoppeld: ${d.name || d.address}` }); };
  const test = () => run('test', async () => { await printLinesBluetooth(testLines()); setMsg({ ok: true, text: 'Testbon verzonden' }); });

  if (support === 'none') {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 flex gap-3" data-testid="bt-printer-unsupported">
        <Smartphone className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600 leading-relaxed">
          Dit toestel (bijv. iPhone/iPad) laat de browser geen Bluetooth gebruiken. Na een betaling opent hier automatisch
          het printvenster (AirPrint). Koppel de Bluetooth printer op een Android-toestel of Windows-pc met Chrome of Edge.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="bt-printer-card">
      <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${saved ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
          <Bluetooth className="w-5 h-5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-black text-slate-900 truncate" data-testid="bt-printer-name">{saved ? saved.name : 'Nog geen printer gekoppeld'}</span>
          <span className="text-xs text-slate-500">{saved ? `Op dit toestel · via ${saved.via === 'apk' ? 'Android-app' : 'browser'}` : 'Zoek een printer in de buurt'}</span>
        </span>
        {saved && (
          <button onClick={forgetPrinter} title="Ontkoppelen" data-testid="bt-printer-forget"
            className="h-9 w-9 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={scan} disabled={!!busy} data-testid="bt-printer-scan" className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
          {busy === 'scan' ? <Loader2 className="w-4 h-4 animate-spin" /> : <BluetoothSearching className="w-4 h-4" />}
          {saved ? 'Andere printer / opnieuw verbinden' : 'Zoek printers'}
        </button>
        {saved && (
          <button onClick={test} disabled={!!busy} data-testid="bt-printer-test" className={`${btn} bg-slate-900 hover:bg-slate-800 text-white`}>
            {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Testbon
          </button>
        )}
      </div>
      {devices && <ApkDeviceList devices={devices} onPick={pick} />}
      {msg && (
        <p className={`text-sm font-bold flex items-center gap-1.5 ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`} data-testid="bt-printer-status">
          {msg.ok && <Check className="w-4 h-4" />}{msg.text}
        </p>
      )}
    </div>
  );
}
