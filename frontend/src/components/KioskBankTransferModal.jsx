import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Landmark, X, Loader2, Copy, Check, AlertCircle } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';

function CopyRow({ label, value, testId }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {});
  };
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p className="font-bold text-slate-900 break-words" data-testid={testId}>{value}</p>
      </div>
      <button type="button" onClick={copy} aria-label={`${label} kopiëren`} data-testid={`${testId}-copy`}
        className="w-9 h-9 rounded-lg hover:bg-white flex items-center justify-center text-slate-400 hover:text-[#FF5C00] shrink-0 transition-colors">
        {done ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

export function KioskBankTransferModal({ amount, currency, description, onClose, onDone }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/kiosk/bank-details').then(({ data: d }) => setData(d)).catch(() => setData({ accounts: [] }));
  }, []);
  const amountTxt = fmtMoney(amount, currency);
  const accounts = data?.accounts || [];
  const qrText = [
    data?.company_name && `Ontvanger: ${data.company_name}`,
    ...accounts.map((a) => `Rekening (${a.label}): ${a.value}`),
    `Bedrag: ${amountTxt}`,
    `Omschrijving: ${description}`,
  ].filter(Boolean).join('\n');

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose} data-testid="bank-transfer-modal">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
          <span className="w-11 h-11 rounded-full bg-orange-50 text-[#FF5C00] flex items-center justify-center"><Landmark className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-black text-slate-900">Bankoverschrijving</h3>
            <p className="text-sm text-slate-500">Maak het bedrag over met deze gegevens</p>
          </div>
          <button type="button" onClick={onClose} data-testid="bank-transfer-close" aria-label="Sluiten"
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {!data ? <Loader2 className="w-7 h-7 text-[#FF5C00] animate-spin mx-auto my-10" /> : (
            <div className="flex flex-col sm:flex-row gap-5">
              <div className="flex-1 min-w-0 space-y-2.5">
                <div className="rounded-2xl bg-orange-50 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-orange-600">Te betalen</p>
                  <p className="text-3xl font-black text-slate-900" data-testid="bank-transfer-amount">{amountTxt}</p>
                </div>
                {data.company_name && <CopyRow label="Ten name van" value={data.company_name} testId="bank-transfer-company" />}
                {accounts.map((a, i) => (
                  <CopyRow key={a.label} label={`Rekening ${a.label}`} value={a.value} testId={`bank-transfer-account-${i}`} />
                ))}
                {accounts.length === 0 && (
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 bg-amber-50 rounded-xl px-4 py-3" data-testid="bank-transfer-no-accounts">
                    <AlertCircle className="w-4 h-4 shrink-0" /> Nog geen bankrekening ingesteld bij Instellingen → Bedrijf.
                  </p>
                )}
                <CopyRow label="Omschrijving" value={description} testId="bank-transfer-description" />
              </div>
              <div className="sm:w-52 flex flex-col items-center justify-center rounded-2xl border border-slate-100 p-4 shrink-0">
                <QRCodeSVG value={qrText} size={168} level="M" data-testid="bank-transfer-qr" />
                <p className="text-xs text-slate-500 text-center mt-2">Scan voor alle gegevens</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} data-testid="bank-transfer-cancel"
            className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 transition-colors">Annuleren</button>
          <button type="button" onClick={onDone} disabled={!data} data-testid="bank-transfer-done"
            className="flex-[2] h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] font-bold text-white transition-colors disabled:opacity-50">Overboeking gedaan → verder</button>
        </div>
      </div>
    </div>
  );
}
