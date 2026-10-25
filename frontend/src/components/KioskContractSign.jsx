import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, CheckCircle2, FileSignature, Loader2, PenLine, QrCode } from 'lucide-react';
import { api, formatError, fmtMoney } from '../lib/api';
import SignaturePad from './SignaturePad';

const signUrl = (token) => `${window.location.origin}/onderteken/${token}`;

function ContractSummary({ info }) {
  const { contract: c, apartment: a } = info;
  const rows = [
    ['Contract', c.contract_number], ['Appartement', a.number], ['Huur per maand', a.rent_amount ? fmtMoney(a.rent_amount, a.currency) : '—'],
    ['Borg', c.deposit_amount ? fmtMoney(c.deposit_amount, a.currency) : '—'], ['Ingangsdatum', c.start_date || '—'],
    ['Betaaldag', c.payment_day ? `${c.payment_day}e van de maand` : '—'],
  ];
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1" data-testid="contract-sign-summary">
      {rows.map(([l, v]) => (
        <div key={l} className="flex justify-between gap-3"><span className="text-slate-500">{l}</span><span className="font-bold text-slate-900 text-right">{v}</span></div>
      ))}
      {c.terms && <p className="pt-2 text-xs text-slate-600 whitespace-pre-line max-h-28 overflow-y-auto border-t border-slate-200" data-testid="contract-sign-terms">{c.terms}</p>}
    </div>
  );
}

function SignHere({ info, onSigned }) {
  const [name, setName] = useState(info.tenant?.name || '');
  const [sig, setSig] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = name.trim().length >= 2 && sig && accept;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api.post(`/contracts/sign/${info.contract.sign_token}`, { signed_by: name.trim(), accept: true, signature_png: sig, signed_via: 'kiosk' });
      onSigned();
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Volledige naam huurder" data-testid="contract-sign-name"
        className="w-full h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base" />
      <div data-testid="contract-sign-pad"><SignaturePad height={160} onChange={(url, has) => setSig(has ? url : '')} /></div>
      <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#FF5C00]" data-testid="contract-sign-accept" />
        Ik heb het huurcontract gelezen en ga akkoord met de voorwaarden.
      </label>
      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="contract-sign-err">{err}</p>}
      <button type="button" onClick={submit} disabled={!ok || busy} data-testid="contract-sign-submit"
        className="w-full h-12 rounded-xl bg-[#FF5C00] text-white font-black inline-flex items-center justify-center gap-2 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Contract ondertekenen
      </button>
    </div>
  );
}

function SignByQr({ info, onSigned }) {
  const token = info.contract.sign_token;
  useEffect(() => {
    const t = setInterval(() => {
      api.get(`/contracts/sign/${token}`).then(({ data }) => { if (data.already_signed) onSigned(); }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [token, onSigned]);
  return (
    <div className="flex flex-col items-center gap-3 py-2" data-testid="contract-sign-qr">
      <div className="p-3 bg-white rounded-2xl ring-1 ring-slate-200"><QRCodeSVG value={signUrl(token)} size={200} level="M" /></div>
      <p className="text-sm text-slate-600 text-center">Laat de huurder deze QR-code scannen en het contract op de eigen telefoon tekenen.</p>
      <p className="text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Wachten op handtekening…</p>
    </div>
  );
}

// Na de borgbetaling: huurder tekent het contract direct (scherm of QR-code).
export function KioskContractSignModal({ Shell, tenantId, onClose }) {
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState('here');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    api.get(`/kiosk/tenants/${tenantId}/contract-to-sign`).then(({ data }) => {
      if (!data.contract) { closeRef.current(); return; }
      setInfo(data);
    }).catch((e) => setErr(formatError(e)));
  }, [tenantId]);
  const markDone = useCallback(() => setDone(true), []);
  const footer = (
    <button type="button" onClick={onClose} data-testid="contract-sign-later"
      className="w-full h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">{done ? 'Klaar' : 'Later tekenen'}</button>
  );
  return (
    <Shell title="Contract tekenen" Icon={FileSignature} testId="contract-sign" onClose={onClose} footer={footer}>
      {err && <p className="text-sm text-red-600" data-testid="contract-sign-load-err">{err}</p>}
      {!info && !err && <Loader2 className="w-6 h-6 animate-spin text-[#FF5C00] mx-auto my-8" />}
      {info && done && (
        <div className="text-center py-6 space-y-2" data-testid="contract-sign-done">
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
          <p className="text-lg font-black text-slate-900">Contract ondertekend</p>
          <p className="text-sm text-slate-500">{info.contract.contract_number} is nu actief.</p>
        </div>
      )}
      {info && !done && (
        <div className="space-y-3">
          <ContractSummary info={info} />
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
            {[['here', 'Hier tekenen', PenLine], ['qr', 'Via QR-code', QrCode]].map(([v, l, I]) => (
              <button key={v} type="button" onClick={() => setMode(v)} data-testid={`contract-sign-mode-${v}`}
                className={`h-10 rounded-lg text-sm font-black inline-flex items-center justify-center gap-1.5 ${mode === v ? 'bg-white text-[#FF5C00] shadow-sm' : 'text-slate-500'}`}>
                <I className="w-4 h-4" /> {l}
              </button>
            ))}
          </div>
          {mode === 'here' ? <SignHere info={info} onSigned={markDone} /> : <SignByQr info={info} onSigned={markDone} />}
        </div>
      )}
    </Shell>
  );
}
