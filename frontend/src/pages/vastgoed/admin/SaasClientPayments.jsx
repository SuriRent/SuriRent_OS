/**
 * SaaS Klant-betaalstatus overzicht — per klant: plan, laatste factuur,
 * laatste betaling, betaalstatus.
 */
import { useEffect, useState } from 'react';
import { Loader2, CreditCard, Building2, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { api } from '../../../lib/api';

const STATUS_COLORS = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  trial: 'bg-sky-100 text-sky-700 border-sky-200',
  expired: 'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function SaasClientPayments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true); setErr('');
      try {
        const { data } = await api.get('/superadmin/client-payment-status');
        setRows(data || []);
      } catch (e) {
        setErr(e?.response?.data?.detail || 'Kon gegevens niet laden.');
      } finally { setLoading(false); }
    })();
  }, []);

  const fmt = (a, c) => `${c || 'SRD'} ${Number(a || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Betaalstatus per klant</h1>
        <p className="text-sm text-slate-500 mt-1">Overzicht van actieve abonnementen, laatste factuur en laatste betaling per klant.</p>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4" data-testid="payments-err">
          <AlertCircle className="w-5 h-5 inline mr-2" /> {err}
        </div>
      )}

      {loading && (
        <div className="py-12 text-center" data-testid="payments-loading">
          <Loader2 className="w-8 h-8 text-slate-300 mx-auto animate-spin" />
          <p className="text-sm text-slate-400 font-semibold mt-2">Laden…</p>
        </div>
      )}

      {!loading && !err && rows.length === 0 && (
        <div className="py-12 text-center text-slate-400">
          <Building2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>Nog geen klanten.</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" data-testid="payments-table">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-slate-500">Klant</th>
                  <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-slate-500">Plan</th>
                  <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-slate-500">Status</th>
                  <th className="text-right px-4 py-3 font-black text-xs uppercase tracking-widest text-slate-500">Maandbedrag</th>
                  <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-slate-500">Laatste factuur</th>
                  <th className="text-left px-4 py-3 font-black text-xs uppercase tracking-widest text-slate-500">Laatste betaling</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.company_id} data-testid={`payment-row-${r.company_id}`}>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900">{r.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{r.slug}</p>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-700 font-semibold">{r.plan || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold capitalize ${STATUS_COLORS[r.billing_status] || 'bg-slate-100 text-slate-500'}`}>
                        {r.billing_status === 'active' && <CheckCircle className="w-3 h-3" />}
                        {r.billing_status === 'trial' && <Clock className="w-3 h-3" />}
                        {r.billing_status === 'expired' && <AlertCircle className="w-3 h-3" />}
                        {r.billing_status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">{fmt(r.monthly_amount, r.currency)}</td>
                    <td className="px-4 py-3">
                      {r.last_invoice ? (
                        <>
                          <p className="font-mono text-xs text-slate-700">#{r.last_invoice.number || r.last_invoice.id.slice(0, 8)}</p>
                          <p className="text-xs text-slate-400">{fmtDate(r.last_invoice.created_at)} · <span className={r.last_invoice.status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}>{r.last_invoice.status}</span></p>
                        </>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.last_payment ? (
                        <>
                          <p className="font-semibold text-slate-700 inline-flex items-center gap-1">
                            <CreditCard className="w-3 h-3" /> {r.last_payment.method}
                          </p>
                          <p className="text-xs text-slate-400">{fmtDate(r.last_payment.paid_at)} · {fmt(r.last_payment.amount, r.currency)}</p>
                        </>
                      ) : <span className="text-slate-400">Nog niet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {rows.map((r) => (
              <div key={r.company_id} className="p-4" data-testid={`payment-card-${r.company_id}`}>
                <div className="row-label-value mb-2">
                  <p className="font-black text-slate-900">{r.name}</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold capitalize ${STATUS_COLORS[r.billing_status] || 'bg-slate-100 text-slate-500'}`}>
                    {r.billing_status || '—'}
                  </span>
                </div>
                <div className="row-label-value text-sm">
                  <span className="text-slate-500 capitalize">{r.plan || '—'}</span>
                  <span className="font-bold tabular-nums">{fmt(r.monthly_amount, r.currency)}</span>
                </div>
                {r.last_payment && (
                  <div className="row-label-value text-xs mt-2 text-slate-500">
                    <span>Laatste: {r.last_payment.method}</span>
                    <span>{fmtDate(r.last_payment.paid_at)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
