import { useState } from 'react';
import { Banknote, CreditCard, Landmark, Loader2, ShieldCheck } from 'lucide-react';
import { api, formatError, fmtMoney } from '../lib/api';
import { DepositReceiptScreen } from './KasgeldReceipt';

const METHODS = [
  { id: 'cash', label: 'Contant', Icon: Banknote },
  { id: 'pin', label: 'Pinpas', Icon: CreditCard },
  { id: 'bank', label: 'Bankoverschrijving', Icon: Landmark },
];

// Verplichte eerste stap voor een nieuwe huurder: borg ontvangen → contract actief → facturen starten.
export function KioskDepositModal({ Shell, tenant, onClose, onPaid }) {
  const [amount, setAmount] = useState(String(tenant.rent_amount || ''));
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const cur = tenant.currency || 'SRD';

  const submit = async () => {
    const v = parseFloat(String(amount).replace(',', '.'));
    if (!v || v <= 0) { setErr('Vul een geldig bedrag in'); return; }
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/kiosk/tenants/${tenant.id}/deposit-payment`, { amount: v, currency: cur, method });
      setDone(data);
      onPaid?.(data);
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };

  return (
    <Shell title="Borg betalen" Icon={ShieldCheck} testId="kiosk-deposit" onClose={onClose}>
      {done ? (
        <DepositReceiptScreen deposit={done.deposit} invoicesCreated={done.invoices_created} onDone={onClose} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4" data-testid="kiosk-deposit-info">
            <p className="text-xs font-bold uppercase tracking-widest text-[#FF5C00]">Verplichte eerste stap</p>
            <p className="text-lg font-black text-slate-900">{tenant.name}</p>
            {tenant.apartment_number && <p className="text-sm text-slate-600">Appt. {tenant.apartment_number}</p>}
            <p className="text-xs text-slate-600 mt-1">Het contract wordt actief en de maandfacturen starten pas na het registreren van de borg.</p>
          </div>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Borgbedrag ({cur})</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" data-testid="kiosk-deposit-amount"
              className="w-full mt-1 h-14 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-2xl font-black" />
            {tenant.rent_amount ? <span className="text-xs text-slate-500">Standaard één maand huur: {fmtMoney(tenant.rent_amount, cur)}</span> : null}
          </label>
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Betaalmethode</span>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {METHODS.map(({ id, label, Icon }) => (
                <button key={id} type="button" onClick={() => setMethod(id)} data-testid={`kiosk-deposit-method-${id}`}
                  className={`h-20 rounded-xl border-2 flex flex-col items-center justify-center gap-1 text-xs font-bold transition-colors ${method === id ? 'border-[#FF5C00] bg-orange-50 text-[#FF5C00]' : 'border-slate-200 text-slate-700 hover:border-orange-200'}`}>
                  <Icon className="w-6 h-6" /> {label}
                </button>
              ))}
            </div>
          </div>
          {err && <p className="text-sm font-bold text-red-600" data-testid="kiosk-deposit-error">{err}</p>}
          <button type="button" onClick={submit} disabled={busy} data-testid="kiosk-deposit-submit"
            className="w-full h-14 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-black text-base inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />} Borg registreren
          </button>
          <button type="button" onClick={onClose} data-testid="kiosk-deposit-later"
            className="w-full h-11 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm">Later — huurder wacht op borg</button>
        </div>
      )}
    </Shell>
  );
}
