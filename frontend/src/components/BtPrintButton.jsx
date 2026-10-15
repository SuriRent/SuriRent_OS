import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bluetooth, Check, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { btSupport, getSavedPrinter, printLinesBluetooth } from '../lib/bt-printer';

// Bon naar de gekoppelde Bluetooth printer van dit toestel (auto + handmatig opnieuw).
export function BtPrintButton({ paymentId, autoSend = false }) {
  const printer = getSavedPrinter();
  const usable = !!printer && btSupport() !== 'none';
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState('');
  const autoDone = useRef(false);

  const send = async () => {
    setStatus('sending'); setMsg('');
    try {
      const { data } = await api.get(`/kiosk/payments/${paymentId}/print-data`);
      await printLinesBluetooth(data.lines || []);
      setStatus('done'); setMsg(`Geprint op ${printer.name}`);
    } catch (e) { setStatus('error'); setMsg(e?.message || 'Printen mislukt'); }
  };

  useEffect(() => {
    if (!autoSend || autoDone.current || !usable || !paymentId) return;
    autoDone.current = true;
    send();
  }, [autoSend, usable, paymentId]);

  if (!usable) return null;
  return (
    <div className="flex-1 min-w-0" data-testid="receipt-bt-print">
      <button onClick={send} disabled={status === 'sending'} data-testid="receipt-bt-print-btn" title={`Print via ${printer.name}`}
        className="w-full h-10 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors">
        {status === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : status === 'done' ? <Check className="w-4 h-4" /> : <Bluetooth className="w-4 h-4" />}
        <span className="whitespace-nowrap">Bluetooth</span>
      </button>
      {status && status !== 'sending' && (
        <p className={`mt-1 text-[11px] font-bold flex items-center gap-1 ${status === 'done' ? 'text-emerald-600' : 'text-red-500'}`} data-testid="receipt-bt-print-status">
          {status === 'error' && <AlertCircle className="w-3 h-3" />}{msg}
        </p>
      )}
    </div>
  );
}
