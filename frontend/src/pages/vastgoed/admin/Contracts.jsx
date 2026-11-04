import { useState, useEffect, useCallback, useRef } from 'react';
import { FxStats, FxTabs, FxSearch, FxRow, FxEmpty, FxIconBtn } from '../../../components/KioskFx';
import { useEmbedConfirm } from '../../../components/EmbedConfirm';
import { Plus, Trash2, X, Check, Loader2, FileText, ExternalLink, Copy, Pencil, Mail, ArrowLeft, UserRound, Home, BadgeCheck } from 'lucide-react';
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
  const [paymentDayLoading, setPaymentDayLoading] = useState(true);
  const paymentDayEdited = useRef(false);

  // When tenant changes, auto-suggest apartment if tenant has one
  useEffect(() => {
    if (data.tenant_id && !data.apartment_id) {
      const t = tenants.find((x) => x.id === data.tenant_id);
      if (t?.apartment_id) setData((d) => ({ ...d, apartment_id: t.apartment_id }));
    }
  }, [data.tenant_id, data.apartment_id, tenants]);

  useEffect(() => {
    let alive = true;
    api.get('/settings')
      .then(({ data: settings }) => {
        const configuredDay = Number(settings?.invoicing?.contract_payment_day);
        if (alive && !paymentDayEdited.current) {
          setData((current) => ({ ...current, payment_day: Number.isInteger(configuredDay) && configuredDay >= 1 && configuredDay <= 31 ? configuredDay : 1 }));
        }
      })
      .catch((e) => {
        if (alive) {
          setData((current) => ({ ...current, payment_day: null }));
          setError(formatError(e));
        }
      })
      .finally(() => { if (alive) setPaymentDayLoading(false); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setLoading(true); setError('');
    try {
      const { data: r } = await api.post('/contracts', {
        ...data,
        deposit_amount: parseFloat(data.deposit_amount) || 0,
        payment_day: data.payment_day ? parseInt(data.payment_day) : undefined,
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
        payment_day: data.payment_day ? parseInt(data.payment_day) : undefined,
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
              <input type="number" min={1} max={31} value={data.payment_day ?? ''} disabled={paymentDayLoading}
                onChange={(e) => { paymentDayEdited.current = true; setData({ ...data, payment_day: e.target.value }); }}
                data-testid="contract-payday"
                className="w-full mt-1 h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
              <p className="mt-1 text-[11px] text-slate-500">
                {paymentDayLoading ? 'Standaard betaaldag laden…' : 'Standaard overgenomen van de vervaldag bij Facturen automatisering; per contract aanpasbaar.'}
              </p>
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

export default function Contracts({ embedded = false, kioskLayout = false, onBack }) {
  const [askConfirm, confirmNode] = useEmbedConfirm(embedded || kioskLayout);
  const { data: itemsRaw, error: errorC, mutate: refetchC, isLoading: loadingC } = useApiSWR('/contracts');
  const { data: tenantsRaw, error: errorT, mutate: refetchT, isLoading: loadingT } = useApiSWR('/tenants');
  const { data: apartmentsRaw, error: errorA, mutate: refetchA, isLoading: loadingA } = useApiSWR('/apartments');
  const items = itemsRaw || [];
  const tenants = tenantsRaw || [];
  const apartments = apartmentsRaw || [];
  const settled = [
    [itemsRaw, errorC],
    [tenantsRaw, errorT],
    [apartmentsRaw, errorA],
  ].every(([data, error]) => data !== undefined || !!error);
  const loadErrors = [
    errorC && itemsRaw === undefined ? errorC : null,
    errorT && tenantsRaw === undefined ? errorT : null,
    errorA && apartmentsRaw === undefined ? errorA : null,
  ].filter(Boolean);
  const [creating, setCreating] = useState(false);
  const [emailing, setEmailing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | signed | draft
  const [fxQ, setFxQ] = useState('');

  const load = useCallback(async () => {
    await Promise.all([refetchC(), refetchT(), refetchA()]);
  }, [refetchC, refetchT, refetchA]);
  // POLLING VERWIJDERD (2026-02-28): SWR + SSE dekken alle updates.
  // useAutoRefresh(load, { interval: 45000, ... }) uitgeschakeld.

  const del = async (id) => {
    if (!(await askConfirm('Contract verwijderen?'))) return;
    await api.delete(`/contracts/${id}`);
    setDetailId(null);
    load();
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

  if (kioskLayout) {
    const query = fxQ.trim().toLowerCase();
    const rows = filtered.filter((contract) => !query
      || `${contract.tenant_name || ''} ${contract.contract_number || ''} ${contract.apartment_number || ''}`.toLowerCase().includes(query));
    const selected = items.find((contract) => contract.id === detailId);
    if (selected) {
      const tenant = tenants.find((item) => item.id === selected.tenant_id);
      const apartment = apartments.find((item) => item.id === selected.apartment_id);
      return (
        <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
          style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-contract-detail">
          <div className="flex-1 min-h-0 overflow-y-auto py-3">
            <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-3">
              <ContractDetail contract={selected} tenant={tenant} apartment={apartment}
                apiBase={apiBase} signed={!!selected.signed_at}
                onBack={() => setDetailId(null)}
                onEmail={() => setEmailing(selected)}
                onCopyLink={() => copyLink(selected.sign_token)}
                onDelete={() => del(selected.id)} />
            </div>
          </div>
          {confirmNode}
          {creating && <ContractForm tenants={tenants} apartments={apartments}
            onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
          {emailing && <ContractSendDialog contract={emailing} tenants={tenants}
            onClose={() => setEmailing(null)} />}
        </div>
      );
    }

    return (
      <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
        style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-contracts-panel">
        <div className="kiosk-chrome md:hidden flex items-center justify-between gap-2 px-1 sm:px-2 py-2 shrink-0">
          <button type="button" onClick={onBack} data-testid="contracts-panel-back"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 font-bold text-white active:scale-95">
            <ArrowLeft className="h-4 w-4" /> Terug
          </button>
          <p className="text-right text-xs font-semibold text-white">Contractbeheer</p>
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden pb-3 md:flex-row md:gap-3 md:pt-3">
          <section className="order-2 flex min-h-0 min-w-0 flex-[3] flex-col overflow-hidden rounded-2xl bg-white p-3 sm:p-5 md:order-1"
            data-testid="kiosk-contracts-list">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-black tracking-tight text-slate-900 sm:text-xl">Alle contracten</h1>
                <p className="text-xs font-semibold text-slate-500">{counts.all} geregistreerd</p>
              </div>
              <span className="shrink-0 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500"
                data-testid="kiosk-contracts-count">{counts.all} contracten</span>
            </div>
            {loadErrors.length > 0 && (
              <div role="alert" className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>Contractgegevens konden niet volledig worden geladen: {formatError(loadErrors[0])}</span>
                <button type="button" onClick={load} className="rounded-lg bg-white px-3 py-2 font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100">
                  Opnieuw proberen
                </button>
              </div>
            )}
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1" data-testid="contract-filter-bar">
              {[
                { value: 'all', label: 'Alle contracten', count: counts.all },
                { value: 'signed', label: 'Ondertekend', count: counts.signed },
                { value: 'draft', label: 'Concept', count: counts.draft },
              ].map((item) => (
                <button key={item.value} type="button" onClick={() => setFilter(item.value)}
                  data-testid={`contract-filter-${item.value}`}
                  className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition ${
                    filter === item.value ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}>
                  {item.label} ({item.count})
                </button>
              ))}
            </div>
            <div className="relative mb-3 shrink-0">
              <FileText className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={fxQ} onChange={(event) => setFxQ(event.target.value)}
                placeholder="Zoek huurder, contract of appartement…" data-testid="contract-search"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium outline-none focus:border-[#FF5C00]" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
              {!settled ? (
                <ListSkeleton rows={5} testid="contracts-skeleton" />
              ) : rows.length === 0 ? (
                <div className="py-10 text-center" data-testid="contracts-empty">
                  <FileText className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">Geen contracten gevonden.</p>
                </div>
              ) : rows.map((contract) => (
                <KioskContractRow key={contract.id} contract={contract}
                  onOpen={() => setDetailId(contract.id)}
                  onPdf={() => window.open(`${apiBase}/contracts/${contract.id}/pdf`, '_blank', 'noopener,noreferrer')}
                  onEmail={() => setEmailing(contract)}
                  onCopyLink={() => copyLink(contract.sign_token)}
                  onDelete={() => del(contract.id)} />
              ))}
            </div>
          </section>
          <aside className="order-1 flex shrink-0 flex-col rounded-2xl bg-white p-4 sm:p-6 md:order-2 md:flex-[2] md:overflow-y-auto"
            data-testid="kiosk-contracts-summary">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Contracten</h2>
              <FileText className="h-5 w-5 text-[#FF5C00]" />
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-orange-50 p-3">
                <p className="text-xs font-bold text-slate-500">Totaal</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{counts.all}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-3">
                <p className="text-xs font-bold text-slate-500">Ondertekend</p>
                <p className="mt-1 text-2xl font-black text-emerald-800">{counts.signed}</p>
              </div>
            </div>
            <div className="mb-4 rounded-2xl bg-amber-50 p-3">
              <p className="text-xs font-bold text-slate-500">Concept</p>
              <p className="mt-1 text-xl font-black text-amber-800">{counts.draft}</p>
            </div>
            <button type="button" onClick={() => setCreating(true)} data-testid="contract-new-btn"
              className="mb-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5C00] text-sm font-black text-white shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)] hover:bg-[#E05200]">
              <Plus className="h-5 w-5" /> Nieuw contract
            </button>
            <button type="button" onClick={onBack} data-testid="contracts-exit"
              className="mt-auto hidden h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200 md:inline-flex">
              <ArrowLeft className="h-4 w-4" /> Terug naar kiosk
            </button>
          </aside>
        </div>
        {confirmNode}
        {creating && <ContractForm tenants={tenants} apartments={apartments}
          onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
        {emailing && <ContractSendDialog contract={emailing} tenants={tenants}
          onClose={() => setEmailing(null)} />}
      </div>
    );
  }

  if (embedded) {
    const n = fxQ.trim().toLowerCase();
    const rows = filtered.filter((c) => !n || `${c.tenant_name || ''} ${c.contract_number || ''} ${c.apartment_number || ''}`.toLowerCase().includes(n));
    return (
      <div className="space-y-4" data-testid="contracts-page">
        {confirmNode}
        {loadErrors.length > 0 && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>Contractgegevens konden niet volledig worden geladen: {formatError(loadErrors[0])}</span>
            <button type="button" onClick={load} className="rounded-lg bg-white px-3 py-2 font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100">
              Opnieuw proberen
            </button>
          </div>
        )}
        <FxStats testId="contract-fx-stats" items={[['Contracten', counts.all, 'orange'], ['Ondertekend', counts.signed, 'green'], ['Concept', counts.draft, 'amber']]} />
        <FxTabs testPrefix="contract" value={filter} onChange={setFilter} tabs={[
          { v: 'all', label: 'Alles', count: counts.all }, { v: 'signed', label: 'Ondertekend', count: counts.signed }, { v: 'draft', label: 'Concept', count: counts.draft }]} />
        <FxSearch value={fxQ} onChange={setFxQ} placeholder="Zoek huurder, contract of appartement…" testId="contract-search" />
        {!settled ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-[#FF5C00] animate-spin" /></div> : rows.length === 0 ? <FxEmpty text="Geen contracten gevonden." testId="contracts-empty" /> : rows.map((c) => {
          const signed = !!c.signed_at;
          return <FxRow key={c.id} testId={`contract-row-${c.id}`} tenantId={c.tenant_id} title={c.apartment_number || 'Geen appartement'}
            sub={[c.tenant_name || 'Onbekende huurder', c.contract_number].filter(Boolean).join(' · ')}
            meta={c.start_date ? `${c.start_date}${c.end_date ? ` → ${c.end_date}` : ''}` : undefined}
            status={signed ? 'Ondertekend' : 'Concept'} tone={signed ? 'green' : 'amber'}
            actions={<>
              <FxIconBtn href={`${apiBase}/contracts/${c.id}/pdf`} title="PDF openen" testId={`contract-pdf-${c.id}`}><FileText className="w-4 h-4" /></FxIconBtn>
              <FxIconBtn onClick={() => setEmailing(c)} title="Verstuur via e-mail" testId={`contract-email-${c.id}`}><Mail className="w-4 h-4" /></FxIconBtn>
              {!signed && <FxIconBtn onClick={() => copyLink(c.sign_token)} title="Ondertekenlink kopiëren" testId={`contract-link-${c.id}`}><Copy className="w-4 h-4" /></FxIconBtn>}
              <FxIconBtn onClick={() => del(c.id)} danger title="Verwijderen" testId={`contract-delete-${c.id}`}><Trash2 className="w-4 h-4" /></FxIconBtn>
            </>} />;
        })}
        {creating && <ContractForm tenants={tenants} apartments={apartments}
          onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
        {emailing && (
          <SendDialog documentType="contract" documentId={emailing.id} documentLabel="contract"
            title={`Contract ${emailing.contract_number} verzenden`}
            tenantEmail={tenants.find((t) => t.id === emailing.tenant_id)?.email || ''}
            tenantPhone={tenants.find((t) => t.id === emailing.tenant_id)?.phone || ''}
            tenantName={emailing.tenant_name} onClose={() => setEmailing(null)} />
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${embedded ? '' : 'pb-24 sm:pb-6'}`} data-testid="contracts-page">
      {confirmNode}
      {loadErrors.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Contractgegevens konden niet volledig worden geladen: {formatError(loadErrors[0])}</span>
          <button type="button" onClick={load} className="rounded-lg bg-white px-3 py-2 font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100">
            Opnieuw proberen
          </button>
        </div>
      )}
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

      {!settled ? (
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
          <p className="font-black text-slate-900 truncate">{c.apartment_number || 'Geen appartement'}</p>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
            isSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {isSigned ? 'Ondertekend' : 'Concept'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 font-mono truncate">
          {c.tenant_name || 'Onbekende huurder'} · {c.contract_number}
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

function ContractSendDialog({ contract, tenants, onClose }) {
  const tenant = tenants.find((item) => item.id === contract.tenant_id);
  return (
    <SendDialog documentType="contract" documentId={contract.id} documentLabel="contract"
      title={`Contract ${contract.contract_number} verzenden`}
      tenantEmail={tenant?.email || ''}
      tenantPhone={tenant?.phone || ''}
      tenantName={contract.tenant_name}
      onClose={onClose} />
  );
}

function KioskContractRow({ contract, onOpen, onPdf, onEmail, onCopyLink, onDelete }) {
  const signed = !!contract.signed_at;
  const stop = (handler) => (event) => {
    event.stopPropagation();
    handler();
  };
  return (
    <article className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 text-left transition hover:bg-slate-50 sm:p-4"
      data-testid={`contract-row-${contract.id}`}>
      <button type="button" onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          signed ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-[#FF5C00]'
        }`}>
          {signed ? <BadgeCheck className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-black text-slate-900">{contract.contract_number || 'Contract'}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              signed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>{signed ? 'Ondertekend' : 'Concept'}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-slate-600">
            {contract.tenant_name || 'Onbekende huurder'} · {contract.apartment_number || 'Geen appartement'}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {contract.start_date || 'Geen startdatum'}{contract.end_date ? ` → ${contract.end_date}` : ''}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={stop(onPdf)} data-testid={`contract-pdf-${contract.id}`}
          aria-label="PDF openen" title="PDF openen"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
          <FileText className="h-4 w-4" />
        </button>
        <button type="button" onClick={stop(onEmail)} data-testid={`contract-email-${contract.id}`}
          aria-label="Verstuur via e-mail" title="Verstuur via e-mail"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100">
          <Mail className="h-4 w-4" />
        </button>
        {!signed && (
          <button type="button" onClick={stop(onCopyLink)} data-testid={`contract-link-${contract.id}`}
            aria-label="Ondertekenlink kopiëren" title="Ondertekenlink kopiëren"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#FF5C00] hover:bg-orange-100">
            <Copy className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={stop(onDelete)} data-testid={`contract-delete-${contract.id}`}
          aria-label="Contract verwijderen" title="Verwijderen"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function ContractDetail({ contract, tenant, apartment, apiBase, signed, onBack, onEmail, onCopyLink, onDelete }) {
  const [detailTab, setDetailTab] = useState('overzicht');
  const photoUrl = tenant?.avatar_url || apartment?.photo_url || '';
  return (
    <div className="flex min-h-full flex-col gap-3 pb-3" data-testid="contract-detail-page">
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {photoUrl ? (
            <img src={photoUrl} alt={tenant?.name || apartment?.number || 'Contract'}
              className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 bg-slate-100 object-cover"
              onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          ) : (
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
              signed ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-[#FF5C00]'
            }`}>
              {signed ? <BadgeCheck className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-[#FF5C00]">Huurcontract</p>
            <h1 className="mt-0.5 truncate text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
              {contract.contract_number || 'Contract'}
            </h1>
            <p className="truncate text-sm font-semibold text-slate-500">
              {contract.tenant_name || 'Onbekende huurder'} · {contract.apartment_number || 'Geen appartement'}
            </p>
          </div>
          <span className={`hidden shrink-0 rounded-full px-3 py-1 text-xs font-black sm:inline-flex ${
            signed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>{signed ? 'Ondertekend' : 'Concept'}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={onBack} data-testid="contract-detail-back"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" /> Terug
          </button>
          <a href={`${apiBase}/contracts/${contract.id}/pdf`} target="_blank" rel="noreferrer"
            data-testid={`contract-pdf-${contract.id}`}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700 hover:bg-slate-200">
            <FileText className="h-4 w-4" /> PDF
          </a>
          <button type="button" onClick={onEmail} data-testid={`contract-email-${contract.id}`}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-50 px-3 text-sm font-bold text-blue-700 hover:bg-blue-100">
            <Mail className="h-4 w-4" /> E-mail
          </button>
          {!signed && (
            <button type="button" onClick={onCopyLink} data-testid={`contract-link-${contract.id}`}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-orange-50 px-3 text-sm font-bold text-[#FF5C00] hover:bg-orange-100">
              <Copy className="h-4 w-4" /> Kopieer link
            </button>
          )}
          <button type="button" onClick={onDelete} data-testid={`contract-delete-${contract.id}`}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 text-sm font-bold text-red-600 hover:bg-red-100">
            <Trash2 className="h-4 w-4" /> Verwijder
          </button>
        </div>
      </section>

      <div className="flex shrink-0 gap-2 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-sm"
        role="tablist" aria-label="Contractdetails">
        {[
          ['overzicht', 'Overzicht'],
          ['document', 'Contract & voorwaarden'],
        ].map(([tab, label]) => (
          <button key={tab} type="button" role="tab" aria-selected={detailTab === tab}
            onClick={() => setDetailTab(tab)} data-testid={`contract-detail-tab-${tab}`}
            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold transition ${
              detailTab === tab ? 'bg-[#FF5C00] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {detailTab === 'overzicht' && (
        <div className="grid min-w-0 gap-3 xl:grid-cols-[1.4fr_1fr]" data-testid="contract-detail-overview">
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900">Contractgegevens</h2>
              <FileText className="h-5 w-5 text-[#FF5C00]" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <ContractInfo label="Contractnummer" value={contract.contract_number || '—'} />
              <ContractInfo label="Status" value={signed ? 'Ondertekend' : 'Concept'} />
              <ContractInfo label="Startdatum" value={contract.start_date || '—'} />
              <ContractInfo label="Einddatum" value={contract.end_date || 'Onbepaalde tijd'} />
              <ContractInfo label="Betaaldag" value={contract.payment_day ? `Dag ${contract.payment_day} van de maand` : '—'} />
              <ContractInfo label="Borg" value={fmtMoney(contract.deposit_amount || 0, apartment?.currency || 'SRD')} />
            </div>
            {signed && (
              <div className="mt-2 rounded-xl bg-emerald-50 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Ondertekening</p>
                <p className="mt-1 font-bold text-emerald-900">{contract.signed_by || contract.tenant_name || 'Ondertekend'}</p>
                {contract.signed_at && <p className="mt-0.5 text-sm text-emerald-800">{contract.signed_at}</p>}
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900">Huurder & appartement</h2>
              <Home className="h-5 w-5 text-[#FF5C00]" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <UserRound className="h-5 w-5 shrink-0 text-[#FF5C00]" />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Huurder</p>
                  <p className="truncate font-black text-slate-900">{contract.tenant_name || 'Onbekende huurder'}</p>
                  <p className="truncate text-sm text-slate-500">{tenant?.phone || tenant?.email || 'Geen contactgegevens'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <Home className="h-5 w-5 shrink-0 text-[#FF5C00]" />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Appartement</p>
                  <p className="truncate font-black text-slate-900">{contract.apartment_number || 'Geen appartement'}</p>
                  <p className="truncate text-sm text-slate-500">{fmtMoney(apartment?.rent_amount || 0, apartment?.currency || 'SRD')} / maand</p>
                </div>
              </div>
              {photoUrl && <img src={photoUrl} alt={contract.tenant_name || contract.apartment_number || 'Foto'}
                className="h-36 w-full rounded-xl bg-slate-100 object-cover" />}
            </div>
          </section>
        </div>
      )}

      {detailTab === 'document' && (
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" data-testid="contract-detail-document">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Contractdocument</h2>
              <p className="text-sm text-slate-500">{contract.contract_number} · {signed ? 'Ondertekend' : 'Wacht op ondertekening'}</p>
            </div>
            <a href={`${apiBase}/contracts/${contract.id}/pdf`} target="_blank" rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#FF5C00] px-4 text-sm font-bold text-white hover:bg-[#E05200]">
              <ExternalLink className="h-4 w-4" /> Contract PDF openen
            </a>
          </div>
          {contract.terms ? (
            <div className="rounded-xl bg-slate-50 p-4" data-testid="contract-detail-terms">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Voorwaarden</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{contract.terms}</p>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600" data-testid="contract-detail-terms">
              Er zijn geen eigen voorwaarden toegevoegd. De standaardvoorwaarden staan in het contract-PDF.
            </div>
          )}
          {photoUrl && <img src={photoUrl} alt={tenant?.name || apartment?.number || 'Foto'}
            className="mt-3 max-h-[35vh] w-full rounded-xl bg-slate-100 object-contain" />}
        </section>
      )}
    </div>
  );
}

function ContractInfo({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 truncate font-bold text-slate-900">{value}</p>
    </div>
  );
}
