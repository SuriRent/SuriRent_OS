import { useState, useEffect, useCallback } from 'react';
import { useEmbedConfirm } from '../../../components/EmbedConfirm';
import { Plus, Trash2, X, Check, Loader2, FileText, ExternalLink, Copy, Pencil, Mail } from 'lucide-react';
import { api, formatError, fmtMoney } from '../../../lib/api';
import { EmailDialog, SendDialog } from '../../../components/EmailDialog';
import { ListSkeleton } from '../../../components/ListSkeleton';
import KeyboardSafeModal from '../../../components/KeyboardSafeModal';
import { useAutoRefresh } from '../../../lib/auto-refresh';
import { useApiSWR } from '../../../lib/swr';

function ContractForm({ tenants, apartments, onCancel, onSaved }) {
  const [data, setData] = useState({
    tenant_id: '', apartment_id: '', start_date: new Date().toISOString().split('T')[0],
    end_date: '', payment_day: 1, deposit_amount: 0, terms: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // When tenant changes, auto-suggest apartment if tenant has one
  useEffect(() => {
    if (data.tenant_id && !data.apartment_id) {
      const t = tenants.find((x) => x.id === data.tenant_id);
      if (t?.apartment_id) setData((d) => ({ ...d, apartment_id: t.apartment_id }));
    }
  }, [data.tenant_id, data.apartment_id, tenants]);

  const save = async () => {
    setLoading(true); setError('');
    try {
      const { data: r } = await api.post('/contracts', {
        ...data,
        deposit_amount: parseFloat(data.deposit_amount) || 0,
        payment_day: parseInt(data.payment_day) || 1,
      });
      onSaved(r);
    } catch (e) { setError(formatError(e)); }
    finally { setLoading(false); }
  };

  // Live PDF-preview — POST naar preview endpoint (geen DB write), converteer
  // response naar blob URL en open in nieuw tabblad. Werkt met de axios
  // instance die de auth-token al meestuurt.
  const [previewing, setPreviewing] = useState(false);
  const openPreview = async () => {
    if (!data.tenant_id || !data.apartment_id) return;
    setPreviewing(true); setError('');
    try {
      const res = await api.post('/contracts/preview.pdf', {
        tenant_id: data.tenant_id,
        apartment_id: data.apartment_id,
        start_date: data.start_date,
        end_date: data.end_date,
        payment_day: parseInt(data.payment_day) || 1,
        deposit_amount: parseFloat(data.deposit_amount) || 0,
        terms: data.terms || '',
      }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const w = window.open(url, '_blank');
      // Fallback voor popup-blockers: gebruik een tijdelijke anchor
      if (!w) {
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noreferrer';
        document.body.appendChild(a); a.click(); a.remove();
      }
      // Cleanup blob url na 60s
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(formatError(e)); }
    finally { setPreviewing(false); }
  };

  return (
    <KeyboardSafeModal onClose={onCancel} testId="contract-modal" maxWidthClass="sm:max-w-xl">
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">Nieuw contract</h3>
          <button onClick={onCancel} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        {error && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Huurder *</label>
            <select value={data.tenant_id} onChange={(e) => setData({ ...data, tenant_id: e.target.value })} data-testid="contract-tenant" required
              className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
              <option value="">— Kies huurder —</option>
              {[...tenants]
                .sort((a, b) => {
                  const aptA = (a.apartment_number || '').toString();
                  const aptB = (b.apartment_number || '').toString();
                  if (!aptA && !aptB) return (a.name || '').localeCompare(b.name || '', 'nl', { sensitivity: 'base' });
                  if (!aptA) return 1;
                  if (!aptB) return -1;
                  return aptA.localeCompare(aptB, 'nl', { numeric: true, sensitivity: 'base' });
                })
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.apartment_number ? `${t.apartment_number} — ${t.name}` : t.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Appartement *</label>
            <select value={data.apartment_id} onChange={(e) => setData({ ...data, apartment_id: e.target.value })} data-testid="contract-apt" required
              className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white">
              <option value="">— Kies appartement —</option>
              {apartments.map((a) => <option key={a.id} value={a.id}>{a.number} ({fmtMoney(a.rent_amount, a.currency)})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Startdatum *</label>
              <input type="date" value={data.start_date} onChange={(e) => setData({ ...data, start_date: e.target.value })}
                data-testid="contract-start" required
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Einddatum</label>
              <input type="date" value={data.end_date} onChange={(e) => setData({ ...data, end_date: e.target.value })}
                data-testid="contract-end"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Betaaldag</label>
              <input type="number" min={1} max={28} value={data.payment_day} onChange={(e) => setData({ ...data, payment_day: e.target.value })}
                data-testid="contract-payday"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Borg</label>
              <input type="number" step="0.01" value={data.deposit_amount} onChange={(e) => setData({ ...data, deposit_amount: e.target.value })}
                data-testid="contract-deposit"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Eigen voorwaarden (optioneel)</label>
            <textarea value={data.terms} onChange={(e) => setData({ ...data, terms: e.target.value })} rows={3}
              data-testid="contract-terms" placeholder="Laat leeg voor standaard voorwaarden"
              className="w-full mt-1 px-3 py-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none resize-none" />
          </div>
        </div>
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-3">
        <button onClick={onCancel} className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleren</button>
        <button onClick={openPreview}
          disabled={previewing || !data.tenant_id || !data.apartment_id}
          data-testid="contract-preview"
          className="flex-1 h-12 rounded-xl bg-slate-900 hover:bg-black text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Preview PDF
        </button>
        <button onClick={save} disabled={loading || !data.tenant_id || !data.apartment_id} data-testid="contract-save"
          className="flex-1 h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Aanmaken
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

export default function Contracts({ embedded = false }) {
  const [askConfirm, confirmNode] = useEmbedConfirm(embedded);
  const { data: itemsRaw, mutate: refetchC, isLoading: loadingC } = useApiSWR('/contracts');
  const { data: tenantsRaw, mutate: refetchT, isLoading: loadingT } = useApiSWR('/tenants');
  const { data: apartmentsRaw, mutate: refetchA, isLoading: loadingA } = useApiSWR('/apartments');
  const items = itemsRaw || [];
  const tenants = tenantsRaw || [];
  const apartments = apartmentsRaw || [];
  const loaded = !loadingC && !loadingT && !loadingA;
  const [creating, setCreating] = useState(false);
  const [emailing, setEmailing] = useState(null);
  const [filter, setFilter] = useState('all'); // all | signed | draft

  const load = useCallback(async () => {
    await Promise.all([refetchC(), refetchT(), refetchA()]);
  }, [refetchC, refetchT, refetchA]);
  // POLLING VERWIJDERD (2026-02-28): SWR + SSE dekken alle updates.
  // useAutoRefresh(load, { interval: 45000, ... }) uitgeschakeld.

  const del = async (id) => {
    if (!(await askConfirm('Contract verwijderen?'))) return;
    await api.delete(`/contracts/${id}`); load();
  };

  useEffect(() => {
    const onNew = () => setCreating(true);
    window.addEventListener('kiosk-contract-new', onNew);
    return () => window.removeEventListener('kiosk-contract-new', onNew);
  }, []);

  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;
  const signLink = (token) => `${window.location.origin}/onderteken/${token}`;
  const copyLink = async (token) => {
    try {
      await navigator.clipboard.writeText(signLink(token));
      alert('Link gekopieerd');
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      alert('Kopieren mislukt — kopieer de link handmatig');
    }
  };

  const filtered = items.filter((c) => {
    if (filter === 'signed') return !!c.signed_at;
    if (filter === 'draft') return !c.signed_at;
    return true;
  });
  const counts = {
    all: items.length,
    signed: items.filter((c) => !!c.signed_at).length,
    draft: items.filter((c) => !c.signed_at).length,
  };

  return (
    <div className={`space-y-4 ${embedded ? '' : 'pb-24 sm:pb-6'}`} data-testid="contracts-page">
      {confirmNode}
      {/* Header — inline titel + subtitel + oranje "Nieuw contract" knop.
          Zelfde patroon als Betalingsregelingen zodat de app consistent voelt. */}
      <div className={`${embedded ? 'hidden' : 'flex'} items-center justify-between gap-3 flex-nowrap`}>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 truncate">Contracten</h1>
          <p className="text-sm text-slate-500 mt-0.5 truncate">{counts.all} contracten · {counts.signed} ondertekend.</p>
        </div>
        <button onClick={() => setCreating(true)} data-testid="contract-new-btn"
          className="shrink-0 inline-flex items-center justify-center gap-2 px-3 sm:px-5 py-2.5 sm:py-3 bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold rounded-2xl text-sm shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)]">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Nieuw contract</span>
          <span className="sm:hidden">Nieuw</span>
        </button>
      </div>

      {/* Filter pillen */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="contract-filter-bar">
        {[
          { v: 'all', l: 'Alles', c: counts.all },
          { v: 'signed', l: 'Ondertekend', c: counts.signed },
          { v: 'draft', l: 'Concept', c: counts.draft },
        ].map((f) => (
          <button key={f.v} onClick={() => setFilter(f.v)}
            data-testid={`contract-filter-${f.v}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              filter === f.v
                ? 'bg-[#FF5C00] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}>
            {f.l}
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
              filter === f.v ? 'bg-white/20 text-white' : 'bg-white text-slate-500'
            }`}>{f.c}</span>
          </button>
        ))}
      </div>

      {!loaded ? (
        <ListSkeleton rows={5} testid="contracts-skeleton" />
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm" data-testid="contracts-empty">
          <FileText className="w-12 h-12 mx-auto text-slate-300 mb-2" />
          <p className="text-slate-500 font-semibold">Geen contracten gevonden.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <ContractRow key={c.id} c={c} apiBase={apiBase}
              onEmail={() => setEmailing(c)}
              onCopyLink={() => copyLink(c.sign_token)}
              onDelete={() => del(c.id)} />
          ))}
        </div>
      )}

      {creating && <ContractForm tenants={tenants} apartments={apartments}
        onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {emailing && (
        <SendDialog
          documentType="contract"
          documentId={emailing.id}
          documentLabel="contract"
          title={`Contract ${emailing.contract_number} verzenden`}
          tenantEmail={tenants.find((t) => t.id === emailing.tenant_id)?.email || ''}
          tenantPhone={tenants.find((t) => t.id === emailing.tenant_id)?.phone || ''}
          tenantName={emailing.tenant_name}
          onClose={() => setEmailing(null)} />
      )}
    </div>
  );
}

// =====================================================================
// ContractRow — klikbare card in de stijl van PlanRow (Betalingsregelingen).
// Icoon-avatar links, contract-nummer + huurder + status, actie-iconen rechts.
// =====================================================================
function ContractRow({ c, apiBase, onEmail, onCopyLink, onDelete }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const isSigned = !!c.signed_at;
  return (
    <div data-testid={`contract-row-${c.id}`}
      className="w-full bg-white hover:bg-slate-50 rounded-2xl shadow-sm p-4 flex items-center gap-3 border border-slate-100 transition">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
        isSigned ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-[#FF5C00]'
      }`}>
        <FileText className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-black text-slate-900 truncate">{c.tenant_name || 'Onbekende huurder'}</p>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
            isSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {isSigned ? 'Ondertekend' : 'Concept'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 font-mono truncate">
          {c.contract_number} · Appt. {c.apartment_number || '—'}
          {c.start_date ? ` · ${c.start_date}` : ''}{c.end_date ? ` → ${c.end_date}` : ''}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <a href={`${apiBase}/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          data-testid={`contract-pdf-${c.id}`}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600" title="PDF openen">
          <FileText className="w-3.5 h-3.5" />
        </a>
        <button onClick={stop(onEmail)} data-testid={`contract-email-${c.id}`}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700" title="Verstuur via e-mail">
          <Mail className="w-3.5 h-3.5" />
        </button>
        {!isSigned && (
          <button onClick={stop(onCopyLink)} data-testid={`contract-link-${c.id}`}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-orange-50 hover:bg-orange-100 text-[#FF5C00]" title="Ondertekenlink kopiëren">
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={stop(onDelete)} data-testid={`contract-delete-${c.id}`}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500" title="Verwijderen">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
