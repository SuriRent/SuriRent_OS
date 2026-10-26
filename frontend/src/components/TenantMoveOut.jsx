import { useEffect, useState } from 'react';
import { Archive, Check, Loader2, LogOut, RotateCcw, Trash2, Wallet, X } from 'lucide-react';
import { api, formatError, fmtMoney } from '../lib/api';
import { useApiSWR } from '../lib/swr';
import { useAuth } from '../lib/auth';
import { PrintChoiceMenu } from './PrintChoiceMenu';
import { getKioskEmployee } from './KioskEmployee';
import KeyboardSafeModal from './KeyboardSafeModal';
import { DepositReceiptScreen } from './KasgeldReceipt';
import { DamageRows, SumRow } from '../pages/vastgoed/admin/Deposits';

const today = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('nl-NL') : '—');

function ArrearsList({ preview, excluded, setExcluded, cur }) {
  if (!preview) return <Loader2 className="w-4 h-4 animate-spin text-slate-400" />;
  if (!preview.arrears_items.length) return <p className="text-slate-500">Geen openstaande facturen</p>;
  const toggle = (id, on) => setExcluded(on ? excluded.filter((x) => x !== id) : [...excluded, id]);
  return preview.arrears_items.map((i) => (
    <label key={i.invoice_id} className="flex items-center gap-2 cursor-pointer" data-testid={`moveout-arrears-item-${i.invoice_id}`}>
      <input type="checkbox" checked={!excluded.includes(i.invoice_id)} onChange={(e) => toggle(i.invoice_id, e.target.checked)}
        className="w-4 h-4 accent-[#FF5C00]" data-testid={`moveout-arrears-check-${i.invoice_id}`} />
      <span className="flex-1 text-slate-600">{i.label}</span>
      <span className="font-semibold text-slate-900">{fmtMoney(i.amount, cur)}</span>
    </label>
  ));
}

function ResultBox({ net, cur }) {
  return net < 0 ? (
    <div className="bg-red-50 border border-red-200 rounded-xl p-3 row-label-value" data-testid="moveout-result-due">
      <span className="text-xs font-bold uppercase tracking-widest text-red-700">Huurder moet nog betalen</span>
      <span className="text-2xl font-black text-red-600" data-testid="moveout-amount-due">{fmtMoney(-net, cur)}</span>
    </div>
  ) : (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 row-label-value" data-testid="moveout-result-back">
      <span className="text-xs font-bold uppercase tracking-widest text-emerald-700">Borg terug aan huurder</span>
      <span className="text-2xl font-black text-slate-900" data-testid="moveout-amount-back">{fmtMoney(net, cur)}</span>
    </div>
  );
}

export function TenantMoveOutModal({ tenant, onClose, onDone }) {
  const [date, setDate] = useState(today());
  const [preview, setPreview] = useState(null);
  const [items, setItems] = useState([{ description: '', amount: '' }]);
  const [excluded, setExcluded] = useState([]);
  const [note, setNote] = useState('');
  const [step, setStep] = useState('form');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  useEffect(() => {
    if (!date) return;
    setPreview(null);
    api.get(`/tenants/${tenant.id}/move-out-preview`, { params: { move_out_date: date } })
      .then(({ data }) => setPreview(data)).catch((e) => setError(formatError(e)));
  }, [tenant.id, date]);
  const cur = preview?.currency || tenant.currency || 'SRD';
  const damage = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const arrears = (preview?.arrears_items || []).filter((i) => !excluded.includes(i.invoice_id)).reduce((s, i) => s + i.amount, 0);
  const borg = preview?.deposit_amount || 0;
  const net = borg - arrears - damage;
  const submit = async () => {
    setStep('saving'); setError('');
    try {
      const { data } = await api.post(`/tenants/${tenant.id}/move-out`, {
        move_out_date: date, exclude_invoice_ids: excluded, refund_note: note,
        damage_items: items.filter((i) => parseFloat(i.amount) > 0).map((i) => ({ description: i.description, amount: parseFloat(i.amount) })),
      });
      setDone(data.deposit);
    } catch (e) { setError(formatError(e)); setStep('confirm'); }
  };
  if (done) {
    return (
      <KeyboardSafeModal onClose={onDone} testId="moveout-receipt-modal">
        <KeyboardSafeModal.Body>
          <DepositReceiptScreen deposit={done} onDone={onDone} />
          <p className="text-xs text-center text-slate-500 mt-3" data-testid="moveout-archived-note">Appartement staat weer op beschikbaar · huurder is gearchiveerd</p>
        </KeyboardSafeModal.Body>
      </KeyboardSafeModal>
    );
  }
  return (
    <KeyboardSafeModal onClose={onClose} testId="moveout-modal">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">Uitgang huurder</h3>
          <button onClick={onClose} data-testid="moveout-close" className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-slate-500 mt-1">{tenant.name}{tenant.apartment_number ? ` — Appt. ${tenant.apartment_number}` : ''}</p>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="moveout-error">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Vertrekdatum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="moveout-date"
              className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            {preview?.future_invoices_removed > 0 && (
              <p className="text-xs text-amber-700 mt-1" data-testid="moveout-future-note">{preview.future_invoices_removed} factuur/facturen na de vertrekmaand worden verwijderd.</p>
            )}
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">1. Openstaande facturen (verrekend met borg)</label>
            <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1 text-sm" data-testid="moveout-arrears-list">
              <ArrearsList preview={preview} excluded={excluded} setExcluded={setExcluded} cur={cur} />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">2. Schadekosten</label>
            <div className="mt-1"><DamageRows items={items} setItems={setItems} /></div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Toelichting</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="moveout-note"
              className="w-full mt-1 px-4 py-2 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none resize-none" />
          </div>
          <div className="rounded-xl border border-slate-200 p-3 space-y-1 text-sm" data-testid="moveout-summary">
            <SumRow label="Borg" value={fmtMoney(borg, cur)} testId="moveout-sum-deposit" />
            <SumRow label="Openstaande facturen" value={`− ${fmtMoney(arrears, cur)}`} testId="moveout-sum-arrears" cls="text-red-600" />
            <SumRow label="Schade" value={`− ${fmtMoney(damage, cur)}`} testId="moveout-sum-damage" cls="text-red-600" />
          </div>
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="space-y-3">
        <ResultBox net={net} cur={cur} />
        {step === 'form' ? (
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
            <button onClick={() => setStep('confirm')} disabled={!preview || !date} data-testid="moveout-next"
              className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              <LogOut className="w-4 h-4" /> Afrekenen
            </button>
          </div>
        ) : (
          <div className="space-y-2" data-testid="moveout-confirm">
            <p className="text-xs text-slate-600 text-center">Facturen worden verrekend, de bon wordt geprint, het appartement komt vrij en de huurder wordt gearchiveerd.</p>
            <div className="flex gap-3">
              <button onClick={() => setStep('form')} disabled={step === 'saving'} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Terug</button>
              <button onClick={submit} disabled={step === 'saving'} data-testid="moveout-submit"
                className="flex-1 h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {step === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Bevestig uitgang
              </button>
            </div>
          </div>
        )}
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

function ReactivateModal({ tenant, onClose, onDone }) {
  const { data: apts } = useApiSWR('/apartments');
  const free = (apts || []).filter((a) => ['vacant', 'available'].includes(a.status) && !a.tenant_id);
  const origFree = free.some((a) => a.id === tenant.archived_apartment_id);
  const [aid, setAid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (origFree) setAid(tenant.archived_apartment_id); }, [origFree, tenant.archived_apartment_id]);
  const go = async () => {
    setBusy(true); setError('');
    try { await api.post(`/tenants/${tenant.id}/reactivate`, { apartment_id: aid || null }); onDone(); }
    catch (e) { setError(formatError(e)); } finally { setBusy(false); }
  };
  return (
    <KeyboardSafeModal onClose={onClose} testId="reactivate-modal">
      <KeyboardSafeModal.Header><h3 className="text-xl font-black text-slate-900">Huurder heractiveren</h3></KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="reactivate-error">{error}</div>}
        <p className="text-sm text-slate-600 mb-3">{tenant.name} wordt weer actief. Een nieuwe borg is nodig voordat facturen starten.</p>
        <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Appartement (alleen vrije)</label>
        <select value={aid} onChange={(e) => setAid(e.target.value)} data-testid="reactivate-apartment"
          className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
          <option value="">— Zonder appartement —</option>
          {free.map((a) => <option key={a.id} value={a.id}>{a.number}{a.id === tenant.archived_apartment_id ? ' (vorig appartement)' : ''}</option>)}
        </select>
        {!origFree && tenant.archived_apartment_number && <p className="text-xs text-amber-700 mt-1" data-testid="reactivate-orig-taken">Vorig appartement {tenant.archived_apartment_number} is niet meer vrij.</p>}
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={go} disabled={busy} data-testid="reactivate-confirm"
          className="flex-1 h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Heractiveren
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

const MONTHS = ['', 'jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const PAY_METHODS = [['contant', 'Contant'], ['pin', 'Pinnen'], ['bank', 'Overschrijving']];

function SettleDebtModal({ tenant, onClose, onDone }) {
  const due = tenant.outstanding_after_move_out || 0;
  const cur = tenant.currency_at_move_out || 'SRD';
  const [method, setMethod] = useState('contant');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [paid, setPaid] = useState(null);
  const [printMsg, setPrintMsg] = useState('');
  const printUrl = (pid) => `${process.env.REACT_APP_BACKEND_URL}/api/payments/${pid}/print.html?format=thermal`;
  const pay = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/kiosk/tenants/${tenant.id}/settle-debt`, { method, operator_name: getKioskEmployee()?.name || null });
      setPaid(data);
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };
  if (paid) {
    return (
      <KeyboardSafeModal onClose={onDone} testId="settle-debt-receipt">
        <KeyboardSafeModal.Body>
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-lg font-black text-slate-900">Restschuld betaald</p>
            <p className="text-2xl font-black text-emerald-600" data-testid="settle-debt-paid-amount">{fmtMoney(paid.amount, paid.currency)}</p>
            <iframe title="Bon" src={`${process.env.REACT_APP_BACKEND_URL}/api/payments/${paid.payment_id}/print.html?preview=1&format=thermal`}
              sandbox="allow-same-origin" className="w-[260px] h-[380px] bg-white border border-dashed border-slate-200 rounded" data-testid="settle-debt-receipt-preview" />
            <PrintChoiceMenu paymentId={paid.payment_id} showLabel onLocal={() => window.open(printUrl(paid.payment_id), '_blank')}
              onStatus={(st) => setPrintMsg(typeof st === 'string' ? st : (st?.message || st?.status || ''))} />
            {printMsg && <p className="text-xs text-slate-500" data-testid="settle-debt-print-status">{printMsg}</p>}
            <a href={printUrl(paid.payment_id)} target="_blank" rel="noreferrer" data-testid="settle-debt-print"
              className="w-full h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold inline-flex items-center justify-center">Bon printen</a>
            <button onClick={onDone} data-testid="settle-debt-done" className="w-full h-12 rounded-xl bg-slate-900 text-white font-black">Klaar</button>
          </div>
        </KeyboardSafeModal.Body>
      </KeyboardSafeModal>
    );
  }
  return (
    <KeyboardSafeModal onClose={onClose} testId="settle-debt-modal">
      <KeyboardSafeModal.Header><h3 className="text-xl font-black text-slate-900">Restschuld innen</h3><p className="text-sm text-slate-500">{tenant.name}</p></KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {err && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="settle-debt-error">{err}</div>}
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-red-700">Te betalen (volledig)</p>
          <p className="text-3xl font-black text-red-600" data-testid="settle-debt-amount">{fmtMoney(due, cur)}</p>
        </div>
        <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Betaalmethode</label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {PAY_METHODS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setMethod(v)} data-testid={`settle-debt-method-${v}`}
              className={`h-12 rounded-xl font-black text-sm border-2 transition-colors ${method === v ? 'border-[#FF5C00] bg-orange-50 text-[#FF5C00]' : 'border-slate-200 text-slate-600'}`}>{l}</button>
          ))}
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-slate-100 text-slate-700 font-bold">Annuleren</button>
        <button onClick={pay} disabled={busy} data-testid="settle-debt-confirm"
          className="flex-1 h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Betaling ontvangen
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

function ArchivedInvoices({ tenantId, rk }) {
  const { data } = useApiSWR(`/tenants/${tenantId}/archived-invoices?r=${rk}`);
  if (!data) return <Loader2 className="w-4 h-4 animate-spin text-slate-400 my-2" />;
  if (!data.length) return <p className="text-xs text-slate-500 py-2" data-testid={`archived-invoices-empty-${tenantId}`}>Geen facturen.</p>;
  return (
    <div className="mt-3 space-y-1" data-testid={`archived-invoices-${tenantId}`}>
      {data.map((i) => {
        const paid = i.status === 'paid';
        const rest = Math.max(Number(i.amount_due || i.amount || 0) - Number(i.paid_amount || 0), 0);
        return (
          <div key={i.id} className="flex items-center justify-between gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2" data-testid={`archived-invoice-${i.id}`}>
            <span className="text-slate-700 font-semibold">{i.invoice_number} · {MONTHS[i.period_month] || ''} {i.period_year || ''}</span>
            <span className={`font-bold ${paid ? 'text-emerald-600' : 'text-red-600'}`}>
              {paid ? `Betaald ${fmtMoney(i.amount_due || i.amount, i.currency)}` : `Open ${fmtMoney(rest, i.currency)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ArchivedRow({ t, onReactivate, onDelete, onSettle }) {
  const due = t.outstanding_after_move_out || 0;
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4" data-testid={`archived-tenant-${t.id}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><Archive className="w-4 h-4" /></div>
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 min-w-0 text-left" data-testid={`archived-toggle-${t.id}`}>
          <p className="font-black text-slate-900 truncate">{t.name}</p>
          <p className="text-xs text-slate-500">
            {t.archived_apartment_number ? `Appt. ${t.archived_apartment_number} · ` : ''}vertrokken {fmtDate(t.move_out_date)} · <span className="text-[#FF5C00] font-bold">{open ? 'facturen verbergen' : 'facturen tonen'}</span>
          </p>
          {due > 0 && <p className="text-xs font-bold text-red-600" data-testid={`archived-due-${t.id}`}>Nog te betalen: {fmtMoney(due, t.currency_at_move_out || 'SRD')}</p>}
        </button>
        {due > 0 && (
          <button onClick={onSettle} data-testid={`archived-settle-${t.id}`}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs">
            <Wallet className="w-3.5 h-3.5" /> Innen
          </button>
        )}
        <button onClick={onReactivate} data-testid={`archived-reactivate-${t.id}`}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs">
          <RotateCcw className="w-3.5 h-3.5" /> Heractiveren
        </button>
        {onDelete && (
          <button onClick={onDelete} data-testid={`archived-delete-${t.id}`} aria-label="Permanent verwijderen" title="Permanent verwijderen"
            className="shrink-0 w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && <ArchivedInvoices tenantId={t.id} rk={t.outstanding_after_move_out || 0} />}
    </div>
  );
}

export function ArchivedTenants({ onChanged }) {
  const { data, mutate } = useApiSWR('/tenants/archived');
  const [react, setReact] = useState(null);
  const [settle, setSettle] = useState(null);
  const [err, setErr] = useState('');
  const { user } = useAuth();
  const canDelete = ['admin', 'superadmin'].includes(user?.role);
  const remove = async (t) => {
    if (!window.confirm(`${t.name} permanent verwijderen? Facturen, contracten, borg en foto's worden gewist. Ontvangen betalingen blijven in kasgeld staan.`)) return;
    setErr('');
    try { await api.delete(`/tenants/${t.id}/permanent`); mutate(); onChanged?.(); } catch (e) { setErr(formatError(e)); }
  };
  if (!data) return <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto my-6" />;
  return (
    <div className="space-y-2" data-testid="archived-tenants-list">
      {err && <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="archived-error">{err}</div>}
      {data.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm text-slate-500 font-semibold" data-testid="archived-empty">Archief is leeg.</div>
      ) : data.map((t) => <ArchivedRow key={t.id} t={t} onReactivate={() => setReact(t)} onSettle={() => setSettle(t)} onDelete={canDelete ? () => remove(t) : null} />)}
      {settle && <SettleDebtModal tenant={settle} onClose={() => setSettle(null)} onDone={() => { setSettle(null); mutate(); }} />}
      {react && <ReactivateModal tenant={react} onClose={() => setReact(null)}
        onDone={() => { setReact(null); mutate(); onChanged?.(); }} />}
    </div>
  );
}
