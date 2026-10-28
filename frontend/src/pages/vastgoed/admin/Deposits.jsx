import { useState, useCallback, useEffect } from 'react';
import { FxStats, FxTabs, FxSearch, FxRow, FxEmpty } from '../../../components/KioskFx';
import { useEmbedConfirm } from '../../../components/EmbedConfirm';
import { Plus, X, Check, Loader2, ShieldCheck, FileText, Trash2, ChevronRight, ArrowLeft } from 'lucide-react';
import { api, formatError, fmtMoney } from '../../../lib/api';
import { useApiSWR } from '../../../lib/swr';
import KeyboardSafeModal from '../../../components/KeyboardSafeModal';
import { DepositReceiptScreen } from '../../../components/KasgeldReceipt';
import { TenantMoveOutModal } from '../../../components/TenantMoveOut';

function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function DepositForm({ tenants, onCancel, onSaved }) {
  const [data, setData] = useState({ tenant_id: '', amount: 0, currency: 'SRD', note: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setLoading(true); setError('');
    try {
      const { data: r } = await api.post('/deposits', { ...data, amount: parseFloat(data.amount) || 0 });
      onSaved(r);
    } catch (e) { setError(formatError(e)); }
    finally { setLoading(false); }
  };
  return (
    <KeyboardSafeModal onClose={onCancel} testId="deposit-modal">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">Nieuwe borg</h3>
          <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Huurder *</label>
            <select value={data.tenant_id} onChange={(e) => setData({ ...data, tenant_id: e.target.value })}
              data-testid="dep-tenant" required
              className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
              <option value="">— Kies huurder —</option>
              {[...tenants]
                .sort((a, b) => (a.apartment_number || '').localeCompare(b.apartment_number || '', 'nl', { numeric: true, sensitivity: 'base' }))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.apartment_number ? `${t.apartment_number} — ${t.name}` : t.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Bedrag *</label>
              <input type="number" step="0.01" value={data.amount} onChange={(e) => setData({ ...data, amount: e.target.value })}
                data-testid="dep-amount" required inputMode="decimal"
                className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Valuta</label>
              <select value={data.currency} onChange={(e) => setData({ ...data, currency: e.target.value })} data-testid="dep-currency"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
                <option value="SRD">SRD</option><option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Notitie</label>
            <input value={data.note} onChange={(e) => setData({ ...data, note: e.target.value })} data-testid="dep-note"
              className="w-full mt-1 h-12 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
          </div>
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={save} disabled={loading || !data.tenant_id || !data.amount} data-testid="dep-save"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Registreer
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

export const DEPOSIT_STATUS = {
  held: { label: 'Ontvangen', cls: 'bg-amber-100 text-amber-700' },
  refunded: { label: 'Gerestitueerd', cls: 'bg-emerald-100 text-emerald-700' },
  partial: { label: 'Deels verrekend', cls: 'bg-sky-100 text-sky-700' },
};

export function SumRow({ label, value, testId, strong, cls = 'text-slate-900' }) {
  return (
    <div className="row-label-value">
      <span className={strong ? 'font-black text-slate-900' : 'text-slate-600'}>{label}</span>
      <span className={`${strong ? 'font-black' : 'font-semibold'} ${cls}`} data-testid={testId}>{value}</span>
    </div>
  );
}

export function DamageRows({ items, setItems }) {
  const upd = (i, k, v) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2" data-testid={`refund-damage-row-${i}`}>
          <input value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} placeholder="Omschrijving (bijv. deur kapot)"
            data-testid={`refund-damage-desc-${i}`}
            className="flex-1 min-w-0 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-sm" />
          <input type="number" step="0.01" inputMode="decimal" value={it.amount} onChange={(e) => upd(i, 'amount', e.target.value)} placeholder="Bedrag"
            data-testid={`refund-damage-amount-${i}`}
            className="w-28 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-sm" />
          <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} data-testid={`refund-damage-remove-${i}`}
            className="w-11 h-11 shrink-0 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 flex items-center justify-center">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setItems([...items, { description: '', amount: '' }])} data-testid="refund-damage-add"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-[#FF5C00] hover:text-[#E05200]">
        <Plus className="w-4 h-4" /> Schadepost toevoegen
      </button>
    </div>
  );
}

function ReprintRefund({ deposit, onClose }) {
  return (
    <KeyboardSafeModal onClose={onClose} testId="refund-reprint-modal">
      <KeyboardSafeModal.Body><DepositReceiptScreen deposit={deposit} onDone={onClose} /></KeyboardSafeModal.Body>
    </KeyboardSafeModal>
  );
}

export default function Deposits({ embedded = false }) {
  const [askConfirm, confirmNode] = useEmbedConfirm(embedded);
  // SWR — instant cache-hit bij tabwissel; SSE-broadcast invalideert
  // deze keys automatisch zodra een borg wordt gewijzigd op een ander
  // apparaat. Geen polling.
  const { data: itemsRaw, mutate: refetchDeposits } = useApiSWR('/deposits');
  const { data: tenantsRaw, mutate: refetchTenants } = useApiSWR('/tenants');
  const items = itemsRaw || [];
  const tenants = tenantsRaw || [];
  const [creating, setCreating] = useState(false);
  const [refunding, setRefunding] = useState(null);
  const [reprint, setReprint] = useState(null);
  const [detail, setDetail] = useState(null);
  const [fxTab, setFxTab] = useState('all');
  const [fxQ, setFxQ] = useState('');
  const load = useCallback(async () => {
    await Promise.all([refetchDeposits(), refetchTenants()]);
  }, [refetchDeposits, refetchTenants]);
  const del = async (id) => {
    if (!(await askConfirm('Borg verwijderen?'))) return false;
    await api.delete(`/deposits/${id}`); load();
    return true;
  };
  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;
  useEffect(() => {
    const onNew = () => { setDetail(null); setCreating(true); };
    window.addEventListener('kiosk-dep-new', onNew);
    return () => window.removeEventListener('kiosk-dep-new', onNew);
  }, []);

  // Detail-pagina met terug-knop, analoog aan PlanDetail in Betalingsregelingen.
  if (detail) {
    const isHeld = detail.status === 'held';
    return (
      <div className={`space-y-4 ${embedded ? '' : 'pb-24 sm:pb-6'}`} data-testid={`deposit-detail-page-${detail.id}`}>
        {confirmNode}
        {/* TERUG-PIL */}
        <div className="flex items-center gap-2">
          <button onClick={() => { setDetail(null); load(); }} data-testid="deposit-detail-back"
            className="flex items-center gap-1.5 text-slate-700 font-bold bg-white hover:bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
            <ArrowLeft className="w-4 h-4" /> Terug
          </button>
        </div>

        {/* HOOFDCARD */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-black text-slate-900 truncate">{detail.tenant_name || 'Borg'}</h1>
              {detail.apartment_number && <p className="text-xs text-slate-500">Appt. {detail.apartment_number}</p>}
              {detail.note && <p className="text-sm text-slate-600 mt-2">{detail.note}</p>}
              <div className="flex items-center gap-2 flex-wrap mt-3">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${(DEPOSIT_STATUS[detail.status] || DEPOSIT_STATUS.held).cls}`}
                  data-testid="deposit-detail-status">{(DEPOSIT_STATUS[detail.status] || DEPOSIT_STATUS.held).label}</span>
                {detail.receipt_no && <span className="text-[10px] font-bold text-slate-500">{detail.receipt_no}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Borg</p>
              <p className="text-2xl font-black text-slate-900">{fmtMoney(detail.amount, detail.currency)}</p>
              {!isHeld && detail.refund_amount !== undefined && detail.refund_amount !== null && (
                <p className="text-[11px] text-slate-500">terug: {fmtMoney(detail.refund_amount, detail.currency)}</p>
              )}
              {detail.deduction_damage > 0 && <p className="text-[11px] text-slate-500">schade: {fmtMoney(detail.deduction_damage, detail.currency)}</p>}
              {detail.deduction_arrears > 0 && <p className="text-[11px] text-slate-500">achterstand: {fmtMoney(detail.deduction_arrears, detail.currency)}</p>}
              {detail.amount_due > 0 && <p className="text-[11px] font-bold text-red-600" data-testid="deposit-detail-amount-due">nog te betalen: {fmtMoney(detail.amount_due, detail.currency)}</p>}
            </div>
          </div>
        </div>

        {/* SUB-CARD: DETAILS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Borggegevens</h2>
          </div>
          <div className="p-4 space-y-1.5 text-sm">
            <div className="row-label-value">
              <span className="text-slate-500">Huurder</span>
              <span className="text-slate-900 font-semibold">{detail.tenant_name || '—'}</span>
            </div>
            <div className="row-label-value">
              <span className="text-slate-500">Appartement</span>
              <span className="text-slate-900 font-semibold">{detail.apartment_number || '—'}</span>
            </div>
            <div className="row-label-value">
              <span className="text-slate-500">Valuta</span>
              <span className="text-slate-900 font-semibold">{detail.currency}</span>
            </div>
            {!isHeld && detail.refund_amount !== undefined && detail.refund_amount !== null && (
              <div className="row-label-value">
                <span className="text-slate-500">Terugbetaald</span>
                <span className="text-slate-900 font-semibold">{fmtMoney(detail.refund_amount, detail.currency)}</span>
              </div>
            )}
          </div>
        </div>

        {/* SUB-CARD: ACTIES */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Acties</h2>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {isHeld ? (
              <button onClick={() => setRefunding(detail)} data-testid={`dep-refund-${detail.id}`}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-xs sm:text-sm">
                <Check className="w-4 h-4" /> Restitueer
              </button>
            ) : (
              <a href={`${apiBase}/deposits/${detail.id}/refund-pdf`} target="_blank" rel="noreferrer"
                data-testid={`dep-pdf-${detail.id}`}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white border-2 border-slate-200 hover:border-slate-400 text-slate-700 font-bold rounded-xl text-xs sm:text-sm">
                <FileText className="w-4 h-4" /> PDF bewijs
              </a>
            )}
            {!isHeld && (
              <button onClick={() => setReprint(detail)} data-testid={`dep-print-refund-${detail.id}`}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs sm:text-sm">
                <FileText className="w-4 h-4" /> Print afrekeningsbon
              </button>
            )}
            <button onClick={async () => { if (await del(detail.id)) setDetail(null); }}
              data-testid={`dep-delete-${detail.id}`}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white border-2 border-red-300 hover:bg-red-500 hover:text-white text-red-600 font-bold rounded-xl text-xs sm:text-sm transition">
              <Trash2 className="w-4 h-4" /> Verwijder
            </button>
          </div>
        </div>

        {refunding && <TenantMoveOutModal tenant={{ id: refunding.tenant_id, name: refunding.tenant_name, apartment_number: refunding.apartment_number, currency: refunding.currency }}
          onClose={() => setRefunding(null)}
          onDone={() => { setRefunding(null); setDetail(null); load(); }} />}
        {reprint && <ReprintRefund deposit={reprint} onClose={() => setReprint(null)} />}
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-4' : ''}>
      {confirmNode}
      {embedded && (() => {
        const held = items.filter((d) => d.status === 'held');
        const n = fxQ.trim().toLowerCase();
        const rows = items.filter((d) => (fxTab === 'all' || (fxTab === 'held' ? d.status === 'held' : d.status !== 'held'))
          && (!n || `${d.tenant_name || ''} ${d.apartment_number || ''}`.toLowerCase().includes(n)));
        const TONE = { held: 'orange', refunded: 'green', partial: 'blue' };
        return (
          <>
            <FxStats testId="dep-fx-stats" items={[
              ['Ontvangen', held.length, 'orange'],
              ['In beheer', fmtMoney(held.reduce((s, d) => s + Number(d.amount || 0), 0), items[0]?.currency), 'green'],
              ['Afgehandeld', items.length - held.length, 'slate']]} />
            <FxTabs testPrefix="dep" value={fxTab} onChange={setFxTab} tabs={[
              { v: 'all', label: 'Alle', count: items.length }, { v: 'held', label: 'Ontvangen', count: held.length }, { v: 'closed', label: 'Afgehandeld', count: items.length - held.length }]} />
            <FxSearch value={fxQ} onChange={setFxQ} placeholder="Zoek huurder of appartement…" testId="dep-search" />
            {rows.length === 0 ? <FxEmpty text="Geen borgen gevonden." testId="deposits-empty" /> : rows.map((d) => {
              const st = DEPOSIT_STATUS[d.status] || DEPOSIT_STATUS.held;
              const meta = d.status !== 'held' && d.amount_due > 0 ? `Nog te betalen: ${fmtMoney(d.amount_due, d.currency)}`
                : d.status !== 'held' && d.refund_amount != null ? `Terugbetaald: ${fmtMoney(d.refund_amount, d.currency)}` : d.receipt_no || undefined;
              return <FxRow key={d.id} testId={`dep-row-${d.id}`} onClick={() => setDetail(d)} title={d.tenant_name}
                sub={d.apartment_number ? `Appt. ${d.apartment_number}` : 'Geen appartement'} meta={meta}
                amount={fmtMoney(d.amount, d.currency)} status={st.label} tone={TONE[d.status] || 'orange'} />;
            })}
          </>
        );
      })()}
      {!embedded && <PageHeader title="Borg / Deposits" subtitle={`${items.filter((d) => d.status === 'held').length} actief, ${items.filter((d) => d.status !== 'held').length} gerestitueerd/verrekend`}
        action={
          <button onClick={() => setCreating(true)} data-testid="dep-new-btn"
            className="inline-flex items-center gap-2 px-5 py-3 bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold rounded-xl shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)]">
            <Plus className="w-4 h-4" /> Nieuwe borg
          </button>
        }
      />}
      {!embedded && <div>
        {items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center" data-testid="deposits-empty">
            <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-semibold">Geen borgen.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((d) => {
              const isHeld = d.status === 'held';
              const iconTint = isHeld ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';
              const statusCls = (DEPOSIT_STATUS[d.status] || DEPOSIT_STATUS.held).cls;
              const statusLabel = (DEPOSIT_STATUS[d.status] || DEPOSIT_STATUS.held).label;
              return (
                <button key={d.id} data-testid={`dep-row-${d.id}`}
                  onClick={() => setDetail(d)}
                  type="button"
                  className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconTint}`}>
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-slate-900 truncate">{d.tenant_name}</p>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusCls}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {d.apartment_number ? `Appt. ${d.apartment_number}` : 'Geen appartement'}
                      {!isHeld && d.amount_due > 0 && (
                        <span className="text-red-600 font-semibold"> · nog te betalen: {fmtMoney(d.amount_due, d.currency)}</span>
                      )}
                      {!isHeld && !(d.amount_due > 0) && d.refund_amount !== undefined && d.refund_amount !== null && (
                        <span> · terugbetaald: {fmtMoney(d.refund_amount, d.currency)}</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-slate-900">{fmtMoney(d.amount, d.currency)}</p>
                    <p className="text-[10px] text-slate-400">borg</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>}
      {creating && <DepositForm tenants={tenants}
        onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {refunding && <TenantMoveOutModal tenant={{ id: refunding.tenant_id, name: refunding.tenant_name, apartment_number: refunding.apartment_number, currency: refunding.currency }}
          onClose={() => setRefunding(null)}
          onDone={() => { setRefunding(null);  load(); }} />}
    </div>
  );
}
