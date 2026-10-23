import { useState } from 'react';
import { ScanLine, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import { api, formatError } from '../lib/api';
import { getKioskUserKey } from '../lib/kiosk-live';

// Telefoon: SCAN ID → camera → OCR op de server → desktop van dezelfde gebruiker opent Nieuwe huurder.
export function PhoneIdScan({ onClose, CameraModal }) {
  const [phase, setPhase] = useState('camera');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const onCaptured = async (file) => {
    if (!file) { onClose(); return; }
    setPhase('busy'); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('user_key', getKioskUserKey());
      const { data } = await api.post('/kiosk/id-scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data.scan || {});
      setPhase('done');
    } catch (e) { setErr(formatError(e)); setPhase('error'); }
  };

  if (phase === 'camera') return <CameraModal onClose={onClose} onCaptured={onCaptured} />;

  return (
    <div className="fixed inset-0 z-[10000] bg-black/60 flex items-end sm:items-center justify-center p-4" data-testid="phone-id-scan">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl text-center" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <button type="button" onClick={onClose} aria-label="Sluiten" data-testid="phone-id-scan-close"
          className="ml-auto -mt-2 -mr-2 w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-5 h-5" /></button>
        {phase === 'busy' && (
          <div className="py-6" data-testid="phone-id-scan-busy">
            <Loader2 className="w-10 h-10 text-[#FF5C00] animate-spin mx-auto mb-3" />
            <p className="font-black text-lg text-slate-900">ID-kaart wordt gelezen…</p>
          </div>
        )}
        {phase === 'done' && (
          <div className="py-4" data-testid="phone-id-scan-done">
            <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
            <p className="font-black text-lg text-slate-900">Verzonden naar je desktop</p>
            <p className="text-slate-600 mt-1" data-testid="phone-id-scan-name">{result?.name || 'Naam niet herkend'}</p>
            {result?.id_number && <p className="text-sm text-slate-500">ID {result.id_number}</p>}
          </div>
        )}
        {phase === 'error' && (
          <div className="py-4" data-testid="phone-id-scan-error">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="font-black text-lg text-slate-900">Scannen mislukt</p>
            <p className="text-sm text-red-600 mt-1">{err}</p>
          </div>
        )}
        {phase !== 'busy' && (
          <div className="flex gap-3 mt-5">
            <button type="button" onClick={() => setPhase('camera')} data-testid="phone-id-scan-again"
              className="flex-1 h-12 rounded-xl bg-orange-50 text-[#FF5C00] font-bold inline-flex items-center justify-center gap-2">
              <ScanLine className="w-5 h-5" /> Nog een scan
            </button>
            <button type="button" onClick={onClose} data-testid="phone-id-scan-finish"
              className="flex-1 h-12 rounded-xl bg-[#FF5C00] text-white font-bold">Klaar</button>
          </div>
        )}
      </div>
    </div>
  );
}
