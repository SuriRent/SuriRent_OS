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

export function BankTransferDetails({ data, amount, currency, description }) {
  const amountTxt = fmtMoney(amount, currency);
  return (
    <div className="min-w-0 space-y-2.5">
      <div className="rounded-2xl bg-orange-50 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-orange-600">Te betalen</p>
        <p className="text-3xl font-black text-slate-900" data-testid="bank-transfer-amount">{amountTxt}</p>
      </div>
      {data.company_name && <CopyRow label="Ten name van" value={data.company_name} testId="bank-transfer-company" />}
      {data.accounts.map((account, index) => (
        <CopyRow key={account.label} label={`Rekening ${account.label}`} value={account.value} testId={`bank-transfer-account-${index}`} />
      ))}
      {!data.accounts.length && (
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 bg-amber-50 rounded-xl px-4 py-3" data-testid="bank-transfer-no-accounts">
          <AlertCircle className="w-4 h-4 shrink-0" /> Nog geen bankrekening ingesteld bij Instellingen → Bedrijf.
        </p>
      )}
      <CopyRow label="Omschrijving" value={description} testId="bank-transfer-description" />
    </div>
  );
}

export function KioskBankTransferModal({ amount, currency, description, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [detailsError, setDetailsError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    setData(null);
    setQrUrl('');
    setQrError('');
    setDetailsError('');
    api.get('/kiosk/bank-details', { signal }).then(async ({ data: details }) => {
      if (signal.aborted) return;
      setData(details);
      if (!details.accounts.length) return;
      if (loopback) {
        setQrError('Deze lokale kiosk is niet bereikbaar vanaf je telefoon. Gebruik de bankgegevens hiernaast.');
        return;
      }
      try {
        const { data: share } = await api.post('/kiosk/bank-details/share', { amount, currency, description }, { signal });
        if (signal.aborted) return;
        const url = new URL('/bankgegevens', window.location.origin);
        url.hash = share.token;
        setData(share.bank_details);
        setQrUrl(url.toString());
      } catch {
        if (!signal.aborted) setQrError('De QR-code kon niet worden gemaakt. Je kunt de bankgegevens handmatig kopiëren.');
      }
    }).catch(() => {
      if (!signal.aborted) setDetailsError('De bankgegevens konden niet worden geladen.');
    });
    return () => controller.abort();
  }, [amount, currency, description]);

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
          {detailsError ? <p role="alert" className="text-red-700">{detailsError}</p> : !data ? <Loader2 className="w-7 h-7 text-[#FF5C00] animate-spin mx-auto my-10" aria-label="Bankgegevens laden" /> : (
            <div className="flex flex-col sm:flex-row gap-5">
              <div className="flex-1 min-w-0">
                <BankTransferDetails data={data} amount={amount} currency={currency} description={description} />
              </div>
              {data.accounts.length > 0 && (
                <div className="sm:w-56 flex flex-col items-center justify-center rounded-2xl border border-slate-100 p-3 shrink-0">
                  {qrError ? <p role="alert" className="text-sm text-slate-600">{qrError}</p> : qrUrl ? (
                    <>
                      <QRCodeSVG value={qrUrl} size={196} level="M" marginSize={4}
                        title="Open bankgegevens op je telefoon" data-testid="bank-transfer-qr" />
                      <p className="text-xs text-slate-500 text-center mt-2">Scan met de camera van je telefoon. De link is 15 minuten geldig.</p>
                    </>
                  ) : <Loader2 className="w-6 h-6 text-orange-600 animate-spin" aria-label="QR-code maken" />}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} data-testid="bank-transfer-cancel"
            className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 transition-colors">Annuleren</button>
          <button type="button" onClick={onDone} disabled={!data || Boolean(detailsError)} data-testid="bank-transfer-done"
            className="flex-[2] h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] font-bold text-white transition-colors disabled:opacity-50">Overboeking gedaan → verder</button>
        </div>
      </div>
    </div>
  );
}
