import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Printer, Receipt, X } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';
import { printReceipt } from '../lib/kiosk-print';
import { isKtpDevice } from '../lib/ktp-printer';
import { KtpPrintButton } from './KtpPrintButton';

const noop = () => {};
const todayStartIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const fmtTime = (s) => (s ? new Date(s).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '');

// Bonkaart in een chatbericht.
export function ChatReceiptCard({ receipt, mine, onOpen }) {
  return (
    <button type="button" onClick={onOpen} data-testid={`kiosk-chat-receipt-${receipt.payment_id}`}
      className={`w-full text-left rounded-xl p-2.5 flex items-center gap-2.5 ${mine ? 'bg-white/15 hover:bg-white/25' : 'bg-orange-50 hover:bg-orange-100'} transition-colors`}>
      <Receipt className={`w-5 h-5 shrink-0 ${mine ? 'text-white' : 'text-[#FF5C00]'}`} />
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm truncate">{receipt.tenant_name}</span>
        <span className={`block text-[11px] truncate ${mine ? 'text-white/70' : 'text-slate-500'}`}>{receipt.receipt_number} · {fmtTime(receipt.paid_at)}</span>
      </span>
      <span className="font-black text-sm whitespace-nowrap">{fmtMoney(receipt.amount, receipt.currency)}</span>
    </button>
  );
}

// Bon groot bekijken + printen (Afdruk / Print via KT-V520).
export function ChatReceiptViewer({ receipt, onClose }) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    try { await printReceipt({ paymentId: receipt.payment_id, apiGet: api.get, relay: false }); } catch { /* geannuleerd */ }
    finally { setBusy(false); }
  };
  return createPortal((
    <div className="fixed inset-0 z-[10002] bg-slate-900/90 flex flex-col items-center p-3" data-testid="kiosk-chat-receipt-viewer"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
      <div className="w-full max-w-sm flex items-center justify-between text-white mb-2">
        <p className="font-black">Bon · {receipt.tenant_name}</p>
        <button onClick={onClose} data-testid="kiosk-chat-receipt-close" aria-label="Sluiten" className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 min-h-0 w-full max-w-sm bg-white rounded-2xl overflow-hidden flex justify-center">
        <iframe title="Bon" sandbox="allow-same-origin" className="w-[240px] h-full"
          src={`${process.env.REACT_APP_BACKEND_URL}/api/payments/${receipt.payment_id}/print.html?preview=1&format=thermal`} />
      </div>
      <div className="w-full max-w-sm flex items-start gap-2 mt-3">
        {!isKtpDevice() && (
          <div className="flex-1 min-w-0"><KtpPrintButton log={{ id: `chat-${receipt.payment_id}`, payment_id: receipt.payment_id }} onPrinted={noop} fetchPrinters /></div>
        )}
        <button onClick={print} disabled={busy} data-testid="kiosk-chat-receipt-print"
          className="flex-1 h-10 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60 transition-colors">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Afdruk
        </button>
      </div>
    </div>
  ), document.body);
}

// Beheerder kiest een bon van vandaag om in de chat te sturen.
export function ChatReceiptPicker({ onPick, onClose }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    api.get('/kiosk/print-log', { params: { since: todayStartIso() } }).then(({ data }) => setList(data)).catch(() => setList([]));
  }, []);
  return (
    <div className="absolute inset-0 z-10 bg-white flex flex-col" data-testid="kiosk-chat-receipt-picker">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-slate-100">
        <Receipt className="w-4 h-4 text-[#FF5C00]" />
        <p className="flex-1 font-black text-sm text-slate-900">Kies een bon van vandaag</p>
        <button onClick={onClose} data-testid="kiosk-chat-receipt-picker-close" aria-label="Sluiten" className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {list === null ? <Loader2 className="w-5 h-5 animate-spin text-slate-400 m-6" /> : list.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">Nog geen bonnen vandaag.</p>
        ) : list.map((l) => (
          <button key={l.id} onClick={() => onPick(l)} data-testid={`kiosk-chat-receipt-pick-${l.payment_id}`}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-50 hover:bg-orange-50 text-left transition-colors">
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm text-slate-900 truncate">{l.payment.tenant_name || 'Huurder'}</span>
              <span className="block text-xs text-slate-500 truncate">
                {l.payment.receipt_number} · {fmtTime(l.printed_at)}{l.employee_name ? ` · ${l.employee_name}` : ''}{l.admin_printed_at ? ' · Afgedrukt' : ''}
              </span>
            </span>
            <span className="font-black text-sm text-slate-900 whitespace-nowrap">{fmtMoney(l.payment.amount, l.payment.currency)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const receiptFromLog = (l) => ({
  payment_id: l.payment_id, receipt_number: l.payment.receipt_number, amount: l.payment.amount,
  currency: l.payment.currency || 'SRD', tenant_name: l.payment.tenant_name || 'Huurder', paid_at: l.payment.paid_at,
});
