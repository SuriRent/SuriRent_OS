import { lazy, Suspense, useEffect, useState } from 'react';
import { FileSignature, CalendarPlus, FilePlus2, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { api, formatError, MONTHS_NL } from '../lib/api';

const InvoiceForm = lazy(() => import('../pages/vastgoed/admin/invoices/InvoiceForm'));

const ACTION = 'flex-1 h-11 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-bold transition-colors disabled:opacity-60';

// Beheer-tegel "Facturen": zelfde functies als Beheer → Facturen (Genereer maand + Nieuwe factuur).
export function KioskAdminInvoicesTile({ onNewInvoice }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const today = new Date();
  const label = `${MONTHS_NL[today.getMonth()]} ${today.getFullYear()}`;

  const generateMonth = async () => {
    if (!window.confirm(`Maandfacturen voor ${label} aanmaken voor alle bezette appartementen?`)) return;
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post('/invoices/generate-month', {
        period_month: today.getMonth() + 1, period_year: today.getFullYear(),
      });
      setMsg({ ok: true, text: `${data.created} aangemaakt, ${data.skipped} overgeslagen` });
    } catch (e) { setMsg({ ok: false, text: formatError(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="col-span-full rounded-2xl bg-slate-50 ring-1 ring-slate-100 p-4" data-testid="kiosk-admin-menu-invoices">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-10 h-10 rounded-xl bg-orange-100 text-[#FF5C00] flex items-center justify-center"><FileSignature className="w-5 h-5" /></span>
        <div>
          <p className="font-black text-slate-900">Facturen</p>
          <p className="text-xs text-slate-500">Maandfacturen voor {label} of een losse factuur</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={generateMonth} disabled={busy} data-testid="kiosk-admin-invoices-generate"
          className={`${ACTION} bg-white ring-1 ring-slate-200 text-slate-800 hover:bg-orange-50 hover:text-[#FF5C00]`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />} Genereer maand
        </button>
        <button type="button" onClick={onNewInvoice} data-testid="kiosk-admin-invoices-new"
          className={`${ACTION} bg-[#FF5C00] hover:bg-[#E05200] text-white`}>
          <FilePlus2 className="w-4 h-4" /> Nieuwe factuur
        </button>
      </div>
      {msg && (
        <p data-testid="kiosk-admin-invoices-msg"
          className={`mt-3 flex items-center gap-2 text-sm font-semibold rounded-xl px-3 py-2 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {msg.text}
        </p>
      )}
    </div>
  );
}

// "Nieuwe factuur" venster uit Beheer → Facturen, met de huurderslijst van de beheerder.
export function KioskAdminInvoiceForm({ onClose }) {
  const [tenants, setTenants] = useState(null);
  useEffect(() => {
    api.get('/tenants').then(({ data }) => setTenants(data || [])).catch(() => setTenants([]));
  }, []);
  if (!tenants) return null;
  return (
    <Suspense fallback={null}>
      <InvoiceForm tenants={tenants} onCancel={onClose} onSaved={onClose} />
    </Suspense>
  );
}
