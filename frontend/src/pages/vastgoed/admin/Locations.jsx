import { useState, useEffect, useCallback } from 'react';
import { FxStats, FxTabs, FxSearch, FxRow, FxEmpty } from '../../../components/KioskFx';
import { UiBar, UiHero, UiStat } from '../../../components/KioskInvoicesUi';
import { useEmbedConfirm } from '../../../components/EmbedConfirm';
import { MapPin, Plus, Pencil, Trash2, X, Check, Loader2, Building2, Image as ImageIcon, Search, ChevronRight, ArrowLeft } from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';
import { useApiSWR } from '../../../lib/swr';
import PhotoUpload from '../../../components/PhotoUpload';
import KeyboardSafeModal from '../../../components/KeyboardSafeModal';

function LocationForm({ initial, onCancel, onSaved }) {
  const [data, setData] = useState(initial || { name: '', address: '', photo_url: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!data.name.trim()) { setError('Naam is verplicht'); return; }
    setLoading(true); setError('');
    try {
      const payload = {
        name: data.name.trim(),
        address: (data.address || '').trim(),
        photo_url: (data.photo_url || '').trim(),
      };
      if (initial?.id) {
        const { data: r } = await api.put(`/locations/${initial.id}`, payload);
        onSaved(r);
      } else {
        const { data: r } = await api.post('/locations', payload);
        onSaved(r);
      }
    } catch (e) {
      setError(formatError(e));
    } finally { setLoading(false); }
  };

  return (
    <KeyboardSafeModal onClose={onCancel}>
      <KeyboardSafeModal.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900">{initial?.id ? 'Locatie bewerken' : 'Nieuwe locatie'}</h3>
          <button onClick={onCancel} data-testid="loc-form-close"
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
      </KeyboardSafeModal.Header>
      <KeyboardSafeModal.Body>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Naam *</label>
            <input value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })}
              placeholder="bv. Hoofdlocatie"
              data-testid="loc-name"
              className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Adres</label>
            <input value={data.address || ''} onChange={(e) => setData({ ...data, address: e.target.value })}
              placeholder="bv. Paramaribo Noord"
              data-testid="loc-address"
              className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none" />
          </div>
          <PhotoUpload
            value={data.photo_url}
            onChange={(url) => setData({ ...data, photo_url: url })}
            testId="loc-photo"
          />
        </div>
        {error && <p className="text-sm text-red-600 mt-3" data-testid="loc-form-error">{error}</p>}
      </KeyboardSafeModal.Body>
      <KeyboardSafeModal.Footer className="flex gap-2">
        <button onClick={onCancel} disabled={loading}
          className="flex-1 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">Annuleer</button>
        <button onClick={save} disabled={loading} data-testid="loc-form-save"
          className="flex-1 h-11 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-black flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Opslaan
        </button>
      </KeyboardSafeModal.Footer>
    </KeyboardSafeModal>
  );
}

export default function Locations({ embedded = false, kioskLayout = false, ui = false, page = false, onBack }) {
  const [askConfirm, confirmNode] = useEmbedConfirm(embedded || kioskLayout);
  // SWR cache — tabwissel toont instant vanuit cache
  const { data: itemsRaw, mutate: refetch, isLoading } = useApiSWR('/locations');
  const { data: apartmentsRaw, error: apartmentsError, isLoading: apartmentsLoading } = useApiSWR('/apartments');
  const items = itemsRaw || [];
  const apartments = apartmentsRaw || [];
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | active | empty
  const loading = isLoading && items.length === 0;

  const load = useCallback(async () => { await refetch(); }, [refetch]);
  // POLLING VERWIJDERD (2026-02-28): SWR + SSE dekken updates.
  // useAutoRefresh(load, { interval: 45000, ... }) uitgeschakeld.

  const del = async (loc) => {
    if (!(await askConfirm(`Locatie "${loc.name}" verwijderen? Appartementen worden ontkoppeld.`))) return;
    await api.delete(`/locations/${loc.id}`);
    setDetailId(null);
    load();
  };

  // Shared modals — ook in detail-view zichtbaar zodat Bewerk-actie meteen
  // opent (i.p.v. pas na Terug).
  useEffect(() => {
    const onNew = () => { setDetailId(null); setCreating(true); };
    window.addEventListener('kiosk-loc-new', onNew);
    return () => window.removeEventListener('kiosk-loc-new', onNew);
  }, []);
  const sharedModals = (
    <>
      {(creating || editing) && (
        <LocationForm initial={editing} onCancel={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }} />
      )}
      {confirmNode}
    </>
  );

  // Detail-view — dezelfde patroon als Appartementen/Huurders.
  if (detailId && !kioskLayout) {
    const loc = items.find((x) => x.id === detailId);
    if (!loc) { setDetailId(null); return null; }
    return (
      <>
        <LocationDetail loc={loc}
          onBack={() => setDetailId(null)}
          onEdit={() => setEditing(loc)}
          onDelete={() => del(loc)} />
        {sharedModals}
      </>
    );
  }

  const bySearch = items.filter((l) => !q
    || (l.name || '').toLowerCase().includes(q.toLowerCase())
    || (l.address || '').toLowerCase().includes(q.toLowerCase()));
  const filtered = bySearch.filter((l) => {
    if (filter === 'all') return true;
    if (filter === 'active') return (l.apartments_total || 0) > 0;
    return (l.apartments_total || 0) === 0;
  });
  const counts = {
    all: bySearch.length,
    active: bySearch.filter((l) => (l.apartments_total || 0) > 0).length,
    empty: bySearch.filter((l) => (l.apartments_total || 0) === 0).length,
  };

  if (kioskLayout) {
    const totalApts = items.reduce((sum, location) => sum + (location.apartments_total || 0), 0);
    const occupiedApts = items.reduce((sum, location) => sum + (location.apartments_occupied || 0), 0);
    if (detailId) {
      const location = items.find((item) => item.id === detailId);
      if (!location) return null;
      const locationApartments = apartments.filter((apartment) =>
        String(apartment.location_id ?? '') === String(location.id)
      );
      return (
        <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
          style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }}
          data-testid="kiosk-location-detail">
          <div className="flex-1 min-h-0 overflow-y-auto py-3">
            <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-3">
              <LocationDetail loc={location}
                apartments={locationApartments}
                apartmentsLoading={apartmentsLoading}
                apartmentsError={apartmentsError}
                onBack={() => setDetailId(null)}
                onEdit={() => setEditing(location)}
                onDelete={() => del(location)}
                kioskMode />
            </div>
          </div>
          {sharedModals}
        </div>
      );
    }

    return (
      <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
        style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-locations-panel">
        <div className="kiosk-chrome md:hidden flex items-center justify-between gap-2 px-1 sm:px-2 py-2 shrink-0">
          <button type="button" onClick={onBack} data-testid="locations-panel-back"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 font-bold text-white active:scale-95">
            <ArrowLeft className="h-4 w-4" /> Terug
          </button>
          <p className="text-right text-xs font-semibold text-white">Locatiebeheer</p>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden pb-3 md:flex-row md:gap-3 md:pt-3">
          <section className="kiosk-admin-list order-2 flex min-h-0 min-w-0 flex-[3] flex-col overflow-hidden rounded-2xl bg-white p-2.5 sm:p-5 md:order-1"
            data-testid="kiosk-locations-list">
            <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3 sm:gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-black tracking-tight text-slate-900 sm:text-xl">Alle locaties</h1>
                <p className="text-xs font-semibold text-slate-500">{items.length} geregistreerd</p>
              </div>
              <span className="shrink-0 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500"
                data-testid="kiosk-locations-count">{counts.all} locaties</span>
            </div>

            <button type="button" onClick={() => setCreating(true)} data-testid="loc-new-btn-mobile"
              className="kiosk-admin-mobile-action mb-2 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-3 py-2.5 font-black text-white">
              <Plus className="h-4 w-4" /> Nieuwe locatie
            </button>

            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:mb-3 sm:gap-2 sm:pb-1" data-testid="loc-filter-bar">
              {[
                { value: 'all', label: 'Alle locaties', count: counts.all },
                { value: 'active', label: 'Actief', count: counts.active },
                { value: 'empty', label: 'Leeg', count: counts.empty },
              ].map((item) => (
                <button key={item.value} type="button" onClick={() => setFilter(item.value)}
                  data-testid={`loc-filter-${item.value}`}
                  className={`shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-bold transition sm:px-3 sm:py-2 sm:text-xs ${
                    filter === item.value ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}>
                  {item.label} ({item.count})
                </button>
              ))}
            </div>

            <div className="relative mb-2 shrink-0 sm:mb-3">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(event) => setQ(event.target.value)}
                placeholder="Zoek locatie of adres…" data-testid="loc-search"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-xs font-medium outline-none focus:border-[#FF5C00] sm:h-11 sm:text-sm" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto space-y-1.5 pb-14 pr-1 sm:space-y-2 md:pb-0">
              {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-[#FF5C00]" /></div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center" data-testid="loc-empty">
                  <MapPin className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">Geen locaties gevonden.</p>
                </div>
              ) : filtered.map((location) => (
                <LocationRow key={location.id} loc={location} onOpen={() => setDetailId(location.id)} />
              ))}
            </div>
          </section>

          <aside className="kiosk-admin-summary order-1 flex shrink-0 flex-col rounded-2xl bg-white p-2.5 sm:p-6 md:order-2 md:flex-[2] md:overflow-y-auto"
            data-testid="kiosk-locations-summary">
            <div className="kiosk-admin-summary-heading mb-2 flex items-center justify-between gap-3 sm:mb-4">
              <h2 className="text-base font-black tracking-tight text-slate-900 sm:text-2xl">Locaties</h2>
              <MapPin className="h-4 w-4 text-[#FF5C00] sm:h-5 sm:w-5" />
            </div>
            <div className="kiosk-admin-summary-stats mb-2 grid grid-cols-2 gap-1.5 sm:mb-3 sm:gap-2">
              <div className="rounded-2xl bg-orange-50 p-2 sm:p-3">
                <p className="text-[10px] font-bold text-slate-500 sm:text-xs">Locaties</p>
                <p className="mt-0.5 text-lg font-black text-slate-900 sm:mt-1 sm:text-2xl" data-testid="loc-stat-total">{items.length}</p>
              </div>
              <div className="rounded-2xl bg-slate-100 p-2 sm:p-3">
                <p className="text-[10px] font-bold text-slate-500 sm:text-xs">Appartementen</p>
                <p className="mt-0.5 text-lg font-black text-slate-900 sm:mt-1 sm:text-2xl">{totalApts}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-2 sm:p-3">
                <p className="text-[10px] font-bold text-slate-500 sm:text-xs">Bezet</p>
                <p className="mt-0.5 text-base font-black text-emerald-800 sm:mt-1 sm:text-xl" data-testid="loc-stat-occupied">
                  {occupiedApts} <span className="text-xs font-bold text-emerald-700 sm:text-sm">van {totalApts}</span>
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setCreating(true)} data-testid="loc-new-btn"
              className="kiosk-admin-summary-action mb-2 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF5C00] text-xs font-black text-white shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)] hover:bg-[#E05200] sm:mb-3 sm:h-12 sm:gap-2 sm:rounded-2xl sm:text-sm">
              <Plus className="h-4 w-4 sm:h-5 sm:w-5" /> Nieuwe locatie
            </button>
            <button type="button" onClick={onBack} data-testid="locations-exit"
              className="mt-auto hidden h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200 md:inline-flex">
              <ArrowLeft className="h-4 w-4" /> Terug naar kiosk
            </button>
          </aside>
        </div>
        {sharedModals}
      </div>
    );
  }

  if (embedded && ui) {
    const totalApts = items.reduce((s, l) => s + (l.apartments_total || 0), 0);
    const occ = items.reduce((s, l) => s + (l.apartments_occupied || 0), 0);
    const tabs = [{ v: 'all', label: 'Alle' }, { v: 'active', label: 'Actief' }, { v: 'empty', label: 'Leeg' }];
    return (
      <div className="space-y-3 pb-8" data-testid="locations-page">
        <UiBar title="Locaties" onBack={onBack} testId="kiosk-admin-page-back" />
        <UiHero icon={<MapPin className="w-7 h-7" strokeWidth={2} />} title="Locaties Overzicht" sub={`Totaal: ${items.length} locaties`} />
        <div className="grid grid-cols-[1fr_1fr_1.45fr] gap-1.5 px-2">
          <UiStat Icon={MapPin} tone="bg-orange-100 text-[#FF5C00]" label="Locaties" value={items.length} />
          <UiStat Icon={Check} tone="bg-emerald-500 text-white" label="Bezet" value={`${occ} / ${totalApts}`}
            bar={`${totalApts ? Math.min(100, Math.round((occ / totalApts) * 100)) : 0}%`} barTone="bg-emerald-500" />
          <UiStat Icon={Building2} tone="bg-sky-100 text-sky-600" label="Appartementen" value={totalApts} />
        </div>
        <div className="px-2">
          <button type="button" onClick={() => { setDetailId(null); setCreating(true); }} data-testid="kiosk-loc-new-mobile"
            className="w-full inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-[#FF5C00] text-xs font-black text-white shadow-[0_10px_22px_-10px_rgba(255,92,0,0.8)]">
            <Plus className="h-4 w-4" /> Nieuwe locatie
          </button>
        </div>
        <div className="px-2">
        <label className="flex items-center gap-3 h-12 rounded-2xl bg-white px-4 shadow-[0_8px_22px_-14px_rgba(15,23,42,0.35)]">
          <Search className="w-5 h-5 text-[#1B2A5C]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek locatie of adres…" data-testid="loc-search"
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Wissen"><X className="w-4 h-4 text-slate-400" /></button>}
        </label>
        </div>
        <div className="px-2 flex gap-1.5">
          {tabs.map((f) => (
            <button key={f.v} type="button" onClick={() => setFilter(f.v)} data-testid={`loc-filter-${f.v}`}
              className={`flex-1 min-w-max px-3 h-10 rounded-2xl text-xs font-black transition-colors ${filter === f.v ? 'bg-[#FF5C00] text-white shadow' : 'bg-white text-[#1B2A5C] shadow-sm'}`}>
              {f.label} ({counts[f.v]})
            </button>
          ))}
        </div>
        <div className="px-2 space-y-3">
        {loading ? <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin text-[#FF5C00]" /> : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm font-semibold text-slate-500" data-testid="loc-empty">Geen locaties gevonden.</p>
        ) : filtered.map((l) => {
          const act = (l.apartments_total || 0) > 0;
          return (
            <div key={l.id} role="button" tabIndex={0} onClick={() => setDetailId(l.id)} onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(l.id); }}
              data-testid={`loc-row-${l.id}`}
              className="flex items-center gap-3 rounded-3xl bg-white p-3 shadow-[0_10px_26px_-16px_rgba(15,23,42,0.4)] cursor-pointer">
              {l.photo_url ? (
                <img src={l.photo_url} alt={l.name} className="h-[52px] w-[52px] shrink-0 rounded-2xl object-cover bg-slate-100" loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF5C00]"><MapPin className="h-6 w-6" /></span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate                 text-[17px] font-extrabold leading-tight text-[#1B2A5C]">{l.name}</p>
                                <p className="truncate text-[14px] text-slate-500">{l.address || '—'}</p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className={`rounded-full px-3 py-1.5 text-[12px] font-extrabold whitespace-nowrap ${act ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{act ? 'Actief' : 'Leeg'}</span>
                <span className="text-[10px] font-bold text-slate-500">{l.apartments_occupied || 0} / {l.apartments_total || 0} bezet</span>
              </div>
              <span className="shrink-0 w-9 h-9 rounded-full bg-[#F1F3F9] flex items-center justify-center"><ChevronRight className="w-4 h-4 text-[#1B2A5C]" /></span>
            </div>
          );
        })}
        </div>
        {sharedModals}
      </div>
    );
  }

  if (embedded) {
    const totalApts = items.reduce((s, l) => s + (l.apartments_total || 0), 0);
    const occ = items.reduce((s, l) => s + (l.apartments_occupied || 0), 0);
    return (
      <div className="space-y-4" data-testid="locations-page">
        <FxStats testId="loc-fx-stats" items={[['Locaties', items.length, 'orange'], ['Appartementen', totalApts, 'slate'], ['Bezet', `${occ} van ${totalApts}`, 'green']]} />
        <FxTabs testPrefix="loc" value={filter} onChange={setFilter} tabs={[
          { v: 'all', label: 'Alles', count: counts.all }, { v: 'active', label: 'Actief', count: counts.active }, { v: 'empty', label: 'Leeg', count: counts.empty }]} />
        <FxSearch value={q} onChange={setQ} placeholder="Zoek locatie of adres…" testId="loc-search" />
        {loading ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-[#FF5C00] animate-spin" /></div> : filtered.length === 0 ? <FxEmpty text="Geen locaties gevonden." testId="loc-empty" /> : filtered.map((l) => {
          const act = (l.apartments_total || 0) > 0;
          return <FxRow key={l.id} testId={`loc-row-${l.id}`} onClick={() => setDetailId(l.id)} title={l.name} sub={l.address || '—'}
            photoUrl={l.photo_url}
            meta={`${l.apartments_total || 0} appartementen`} amount={`${l.apartments_occupied || 0} / ${l.apartments_total || 0} bezet`}
            status={act ? 'Actief' : 'Leeg'} tone={act ? 'green' : 'slate'} />;
        })}
        {sharedModals}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${embedded ? '' : 'pb-24 sm:pb-6'}`} data-testid="locations-page">
      <div className={`${embedded ? 'hidden' : 'flex'} items-center justify-between gap-3 flex-nowrap`}>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 truncate">Locaties</h1>
          <p className="text-sm text-slate-500 mt-0.5 truncate">
            {items.length} locaties · {counts.active} actief
          </p>
        </div>
        <button onClick={() => setCreating(true)} data-testid="loc-new-btn"
          className="shrink-0 inline-flex items-center justify-center gap-2 px-3 sm:px-5 py-2.5 sm:py-3 bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold rounded-2xl text-sm shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)]">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Nieuwe locatie</span>
          <span className="sm:hidden">Nieuw</span>
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek op naam of adres"
          data-testid="loc-search"
          className="w-full h-11 pl-11 pr-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none bg-white text-sm" />
      </div>
      <div className="flex items-center gap-2 flex-wrap" data-testid="loc-filter-bar">
        {[
          { v: 'all', l: 'Alles', c: counts.all },
          { v: 'active', l: 'Actief', c: counts.active },
          { v: 'empty', l: 'Leeg', c: counts.empty },
        ].map((f) => (
          <button key={f.v} onClick={() => setFilter(f.v)} data-testid={`loc-filter-${f.v}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              filter === f.v ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}>
            {f.l}
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
              filter === f.v ? 'bg-white/20 text-white' : 'bg-white text-slate-500'
            }`}>{f.c}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm" data-testid="loc-empty">
          <MapPin className="w-12 h-12 mx-auto text-slate-300 mb-2" />
          <p className="text-slate-500 font-semibold">Geen locaties gevonden.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((loc) => (
            <LocationRow key={loc.id} loc={loc} onOpen={() => setDetailId(loc.id)} />
          ))}
        </div>
      )}

      {sharedModals}
    </div>
  );
}

// =====================================================================
// LocationRow — compacte klikbare card in dezelfde stijl als Huurders/Appartementen.
// =====================================================================
function LocationRow({ loc, onOpen }) {
  const active = (loc.apartments_total || 0) > 0;
  return (
    <div onClick={onOpen} data-testid={`loc-row-${loc.id}`}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className="w-full text-left bg-white hover:bg-slate-50 active:bg-slate-100 rounded-2xl shadow-sm p-2.5 sm:p-4 flex items-center gap-2 sm:gap-3 border border-slate-100 cursor-pointer transition">
      {loc.photo_url ? (
        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl overflow-hidden shrink-0 bg-slate-100">
          <img src={loc.photo_url} alt={loc.name}
            className="w-full h-full object-cover" loading="lazy"
            onError={(e) => { e.currentTarget.parentElement.classList.add('bg-orange-50'); e.currentTarget.style.display = 'none'; }} />
        </div>
      ) : (
        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl bg-orange-50 text-[#FF5C00] flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 sm:w-6 sm:h-6" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-black text-slate-900 truncate">{loc.name}</p>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
            active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
          }`}>
            {active ? 'Actief' : 'Leeg'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{loc.address || '—'}</p>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
        <p className="text-sm sm:text-base font-black text-slate-900 tracking-tight">{loc.apartments_total || 0}</p>
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          {loc.apartments_occupied || 0} bezet
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
    </div>
  );
}

// =====================================================================
// LocationDetail — full detail-pagina met terug-knop.
// =====================================================================
function LocationDetail({ loc, apartments = [], apartmentsLoading = false, apartmentsError, onBack, onEdit, onDelete, kioskMode = false }) {
  const active = (loc.apartments_total || 0) > 0;
  const [detailTab, setDetailTab] = useState('overzicht');
  const bezettingsPct = loc.apartments_total > 0
    ? Math.round((loc.apartments_occupied / loc.apartments_total) * 100)
    : 0;
  if (kioskMode) {
    return (
      <div className="flex min-h-full flex-col gap-3 pb-3" data-testid="loc-detail-page">
        <section className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {loc.photo_url ? (
              <img src={loc.photo_url} alt={loc.name}
                className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 bg-slate-100 object-cover"
                onError={(event) => { event.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF5C00]">
                <MapPin className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-widest text-[#FF5C00]">Locatie</p>
              <h1 className="mt-0.5 truncate text-xl font-black tracking-tight text-slate-900 sm:text-2xl">{loc.name}</h1>
              <p className="truncate text-sm font-semibold text-slate-500">{loc.address || 'Geen adres opgegeven'}</p>
            </div>
            <span className={`hidden shrink-0 rounded-full px-3 py-1 text-xs font-black sm:inline-flex ${
              active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
            }`}>{active ? 'Actief' : 'Leeg'}</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={onBack} data-testid="loc-detail-back"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" /> Terug
            </button>
            <button type="button" onClick={onEdit} data-testid="loc-detail-edit"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700 hover:bg-slate-200">
              <Pencil className="h-4 w-4" /> Bewerk
            </button>
            <button type="button" onClick={onDelete} data-testid="loc-detail-delete"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 text-sm font-bold text-red-600 hover:bg-red-100">
              <Trash2 className="h-4 w-4" /> Verwijder
            </button>
          </div>
        </section>

        <div className="flex shrink-0 gap-2 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-sm"
          role="tablist" aria-label="Locatiedetails">
          {[
            ['overzicht', 'Overzicht'],
            ['appartementen', `Appartementen (${apartments.length})`],
            ['foto', 'Locatie & foto'],
          ].map(([tab, label]) => (
            <button key={tab} type="button" role="tab" aria-selected={detailTab === tab}
              onClick={() => setDetailTab(tab)} data-testid={`loc-detail-tab-${tab}`}
              className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold transition ${
                detailTab === tab ? 'bg-[#FF5C00] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {detailTab === 'overzicht' && (
          <div className="grid min-w-0 gap-3 xl:grid-cols-[1.4fr_1fr]" data-testid="loc-detail-overview">
            <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-black text-slate-900">Locatiegegevens</h2>
                <MapPin className="h-5 w-5 text-[#FF5C00]" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Naam</p>
                  <p className="mt-1 truncate font-black text-slate-900">{loc.name}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Status</p>
                  <p className={`mt-1 font-black ${active ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {active ? 'Actief' : 'Leeg'}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Adres</p>
                  <p className="mt-1 font-bold text-slate-900">{loc.address || 'Geen adres opgegeven'}</p>
                </div>
              </div>
            </section>
            <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-black text-slate-900">Appartementen</h2>
                <Building2 className="h-5 w-5 text-[#FF5C00]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-orange-50 p-3">
                  <p className="text-xs font-bold text-slate-500">Totaal</p>
                  <p className="mt-1 text-2xl font-black text-slate-900" data-testid="loc-stat-total">{loc.apartments_total || 0}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3">
                  <p className="text-xs font-bold text-slate-500">Bezet</p>
                  <p className="mt-1 text-2xl font-black text-emerald-800" data-testid="loc-stat-occupied">
                    {loc.apartments_occupied || 0}
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-xl bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-500">Bezetting</p>
                  <p className="text-sm font-black text-slate-900">{bezettingsPct}%</p>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#F8C260] to-[#FF5C00]"
                    style={{ width: `${bezettingsPct}%` }} />
                </div>
              </div>
            </section>
          </div>
        )}

        {detailTab === 'foto' && (
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" data-testid="loc-detail-photo">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900">Locatie & foto</h2>
                <p className="text-sm text-slate-500">{loc.address || 'Geen adres opgegeven'}</p>
              </div>
              <button type="button" onClick={onEdit}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-50 px-4 text-sm font-bold text-[#FF5C00] hover:bg-orange-100"
                data-testid="loc-photo-edit"><Pencil className="h-4 w-4" /> Foto wijzigen</button>
            </div>
            {loc.photo_url ? (
              <img src={loc.photo_url} alt={loc.name}
                className="max-h-[42vh] min-h-48 w-full rounded-xl bg-slate-100 object-contain"
                onError={(event) => { event.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="flex min-h-48 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
                <div className="text-center">
                  <ImageIcon className="mx-auto mb-2 h-10 w-10" />
                  <p className="text-sm font-semibold">Geen foto beschikbaar</p>
                </div>
              </div>
            )}
          </section>
        )}

        {detailTab === 'appartementen' && (
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" data-testid="loc-detail-apartments">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900">Appartementen op deze locatie</h2>
                <p className="text-sm text-slate-500">{apartments.length} gekoppeld</p>
              </div>
              <Building2 className="h-5 w-5 text-[#FF5C00]" />
            </div>
            {apartmentsError ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Appartementen konden niet worden geladen.
              </p>
            ) : apartmentsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#FF5C00]" /></div>
            ) : apartments.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-5 text-center">
                <Building2 className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                <p className="text-sm font-semibold text-slate-500">
                  {(loc.apartments_total || 0) > 0
                    ? `${loc.apartments_total} appartementen staan als gekoppeld geregistreerd, maar konden niet in de lijst worden gevonden.`
                    : 'Er zijn nog geen appartementen aan deze locatie gekoppeld.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {apartments.map((apartment) => {
                  const occupied = apartment.status === 'occupied' || !!apartment.tenant_id;
                  const photo = apartment.photo_url
                    ? (apartment.photo_url.includes('/api/landing/asset/')
                      ? `${apartment.photo_url}${apartment.photo_url.includes('?') ? '&' : '?'}thumb=1`
                      : apartment.photo_url)
                    : '';
                  return (
                    <article key={apartment.id}
                      className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3"
                      data-testid={`loc-detail-apartment-${apartment.id}`}>
                      {photo ? (
                        <img src={photo} alt={apartment.number || 'Appartement'}
                          className="h-12 w-12 shrink-0 rounded-xl bg-white object-cover"
                          onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#FF5C00]">
                          <Building2 className="h-5 w-5" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-black text-slate-900">{apartment.number || 'Appartement'}</p>
                        <p className="truncate text-xs text-slate-500">
                          {apartment.tenant_name || 'Geen huurder gekoppeld'}
                        </p>
                        <p className="truncate text-xs font-semibold text-slate-600">
                          {fmtMoney(apartment.rent_amount || 0, apartment.currency || 'SRD')} / maand
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                        occupied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}>{occupied ? 'Bezet' : 'Vrij'}</span>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 sm:pb-6" data-testid="loc-detail-page">
      <div className="flex items-center gap-2">
        <button onClick={onBack} data-testid="loc-detail-back"
          className="flex items-center gap-1.5 text-slate-700 font-bold bg-white hover:bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Terug
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loc.photo_url && (
          <div className="relative w-full h-48 sm:h-64 bg-slate-100">
            <img src={loc.photo_url} alt={loc.name}
              className="w-full h-full object-cover" loading="lazy"
              onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} />
            <span className={`absolute top-3 right-3 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full ring-2 ring-white ${
              active ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-white'
            }`}>
              {active ? 'Actief' : 'Leeg'}
            </span>
          </div>
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#FF5C00]">Locatie</p>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-1 truncate">{loc.name}</h1>
              <p className="text-sm text-slate-500 mt-1 truncate">{loc.address || 'Geen adres'}</p>
              {!loc.photo_url && (
                <span className={`inline-block mt-2 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full ${
                  active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {active ? 'Actief' : 'Leeg'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Statistieken */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Totaal</p>
          <div className="flex items-center gap-2 mt-2">
            <Building2 className="w-5 h-5 text-[#FF5C00]" />
            <p className="text-2xl font-black text-slate-900" data-testid="loc-stat-total">{loc.apartments_total || 0}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bezet</p>
          <p className="text-2xl font-black text-emerald-600 mt-2" data-testid="loc-stat-occupied">
            {loc.apartments_occupied || 0}
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bezetting</p>
          <p className="text-2xl font-black text-slate-900 mt-2">{bezettingsPct}%</p>
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mt-2">
            <div className="h-full bg-gradient-to-r from-[#F8C260] to-[#FF5C00]" style={{ width: `${bezettingsPct}%` }} />
          </div>
        </div>
      </div>

      {/* Acties */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Acties</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onEdit} data-testid="loc-detail-edit"
            className="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Bewerk
          </button>
          <button onClick={onDelete} data-testid="loc-detail-delete"
            className="h-11 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm flex items-center justify-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Verwijder
          </button>
        </div>
      </div>
    </div>
  );
}
