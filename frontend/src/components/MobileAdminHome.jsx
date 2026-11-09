import { useMemo, useState } from 'react';
import {
  Building2, CheckCircle2, AlertCircle, CreditCard, ScanLine, Printer, BarChart3,
  Search, Filter, ChevronDown, ChevronRight, UserRound, Home, Phone, Handshake, Plus,
} from 'lucide-react';
import { useApiSWR } from '../lib/swr';
import { fmtMoney } from '../lib/api';
import PendingApprovalBell from './PendingApprovalBell';

const FILTERS = [
  { id: 'all', label: 'Alles' },
  { id: 'paid', label: 'Betaald' },
  { id: 'open', label: 'Openstaand' },
  { id: 'vacant', label: 'Vrij' },
];

const goTab = (id) => window.dispatchEvent(new CustomEvent('go-tab', { detail: id }));

function photoSrc(a) {
  const p = a.tenant_avatar_url || a.tenant_id_photo_url;
  if (!p) return '';
  return /^https?:/.test(p) ? p : `${process.env.REACT_APP_BACKEND_URL || ''}${p}`;
}

export default function MobileAdminHome({ user, activeCompany, onOpenMenu }) {
  const { data } = useApiSWR('/admin/mobile-apartments');
  const apartments = Array.isArray(data) ? data : [];
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);

  const occupied = apartments.filter((a) => a.tenant_id);
  const openCount = occupied.filter((a) => a.pay_status !== 'paid').length;
  const paidCount = occupied.length - openCount;

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return apartments.filter((a) => {
      const isOpen = a.tenant_id && a.pay_status !== 'paid';
      if (filter === 'paid' && !(a.tenant_id && !isOpen)) return false;
      if (filter === 'open' && !isOpen) return false;
      if (filter === 'vacant' && a.tenant_id) return false;
      if (!term) return true;
      return `${a.number} ${a.tenant_name || ''} ${a.address || ''} ${a.description || ''}`.toLowerCase().includes(term);
    });
  }, [apartments, q, filter]);

  const name = activeCompany?.name || 'SuriRent';
  const phone = activeCompany?.contact_phone || activeCompany?.whatsapp_number || '';
  const actions = [
    { id: 'payments', label: 'Betalingen', sub: 'Bekijken', Icon: CreditCard, primary: true },
    { id: 'tenants', label: 'Scan ID', Icon: ScanLine },
    { id: 'kasgeld', label: 'Print Bon', Icon: Printer },
    { id: 'invoices', label: 'Rapporten', Icon: BarChart3 },
  ];

  return (
    <div className="-m-3 sm:-m-5 pb-28 bg-[#F7F8FA] min-h-screen" data-testid="mobile-admin-home">
      <div className="relative px-5 pb-24 text-white"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 18px)',
          background: 'radial-gradient(120% 90% at 0% 0%, #FFB066 0%, #FF7A1F 38%, #F05A00 100%)',
        }}>
        <div className="absolute inset-0 opacity-25 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 85% 10%, rgba(255,255,255,0.55), transparent 45%)' }} />
        <div className="relative flex items-center gap-3">
          <div className="w-14 h-14 shrink-0">
            <img src="/kiosk-icons/mark-white.png" alt="" className="w-full h-full object-contain drop-shadow" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-black tracking-tight leading-tight truncate" data-testid="mobile-home-name">{name}</p>
            <p className="text-[13px] font-semibold text-white/90 truncate">Vastgoedbeheer • Suriname</p>
          </div>
          <div className="shrink-0 rounded-full bg-white/15 p-0.5"><PendingApprovalBell /></div>
          <button type="button" onClick={onOpenMenu} aria-label="Menu" data-testid="mobile-home-profile"
            className="w-12 h-12 shrink-0 rounded-full bg-white/25 flex items-center justify-center active:scale-95 transition">
            <UserRound className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>

      <div className="relative -mt-[72px] mx-3 rounded-[28px] bg-white shadow-[0_16px_36px_-14px_rgba(120,40,0,0.45)] overflow-hidden"
        data-testid="mobile-home-stats">
        <div className="absolute inset-y-0 right-0 w-[34%] pointer-events-none"
          style={{ background: 'linear-gradient(90deg, rgba(255,255,255,1) 0%, rgba(255,236,214,0.9) 40%, #FFD9B0 100%)' }} />
        <Building2 className="absolute right-2 bottom-1 w-24 h-24 text-orange-300/70 pointer-events-none" strokeWidth={1.2} />
        <div className="relative grid grid-cols-[1.25fr_1fr_1fr] items-center py-4 pl-4 pr-20">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-9 h-9 text-[#1B2A5C] shrink-0" strokeWidth={1.8} />
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-slate-800 leading-tight">Totaal<br />Appartementen</p>
              <p className="text-4xl font-black text-[#1B2A5C] leading-none mt-0.5" data-testid="mobile-home-total">{apartments.length}</p>
            </div>
          </div>
          <div className="flex flex-col items-center border-l border-slate-200 px-1">
            <CheckCircle2 className="w-8 h-8 text-white fill-emerald-500 rounded-full" />
            <p className="text-[11px] font-bold text-slate-800 mt-0.5">Betaald</p>
            <p className="text-3xl font-black text-[#1B2A5C] leading-none">{paidCount}</p>
          </div>
          <div className="flex flex-col items-center border-l border-slate-200 px-1">
            <AlertCircle className="w-8 h-8 text-white fill-red-500 rounded-full" />
            <p className="text-[11px] font-bold text-slate-800 mt-0.5">Openstaand</p>
            <p className="text-3xl font-black text-[#1B2A5C] leading-none">{openCount}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 px-3 mt-4" data-testid="mobile-home-actions">
        {actions.map(({ id, label, sub, Icon, primary }) => (
          <button key={label} type="button" onClick={() => goTab(id)} data-testid={`mobile-home-action-${id}`}
            className={`rounded-2xl flex flex-col items-center justify-center gap-1.5 py-3.5 min-h-[104px] text-center active:scale-95 transition ${
              primary
                ? 'text-white bg-gradient-to-b from-[#FF8A3D] to-[#F05A00] shadow-[0_10px_22px_-8px_rgba(255,92,0,0.7)]'
                : 'bg-white text-[#1B2A5C] shadow-[0_4px_14px_-8px_rgba(15,23,42,0.25)]'}`}>
            <Icon className="w-8 h-8" strokeWidth={1.9} />
            <span className="text-[13px] font-bold leading-tight">{label}{sub && <><br /><span className="font-semibold text-[12px]">{sub}</span></>}</span>
            <ChevronRight className={`w-4 h-4 -mt-0.5 ${primary ? '' : 'text-[#1B2A5C]'}`} />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 mt-4">
        <label className="flex-1 min-w-0 h-12 rounded-2xl bg-white shadow-[0_4px_14px_-8px_rgba(15,23,42,0.25)] flex items-center gap-2 px-4">
          <Search className="w-5 h-5 text-[#1B2A5C] shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek appartement..."
            data-testid="mobile-home-search"
            className="w-full min-w-0 bg-transparent outline-none text-[15px] text-slate-800 placeholder:text-slate-400" />
        </label>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setFilterOpen((o) => !o)} data-testid="mobile-home-filter"
            className="h-12 rounded-2xl bg-white shadow-[0_4px_14px_-8px_rgba(15,23,42,0.25)] px-4 flex items-center gap-1.5 text-[15px] font-bold text-[#1B2A5C]">
            <Filter className="w-5 h-5" /> {filter === 'all' ? 'Filter' : FILTERS.find((f) => f.id === filter)?.label}
            <ChevronDown className="w-4 h-4" />
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-14 z-20 w-40 rounded-2xl bg-white shadow-xl border border-slate-100 p-1.5">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" onClick={() => { setFilter(f.id); setFilterOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold ${filter === f.id ? 'bg-orange-50 text-[#FF5C00]' : 'text-slate-700'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-3 mt-4 space-y-3" data-testid="mobile-home-list">
        {visible.map((a) => {
          const isOpen = a.tenant_id && a.pay_status !== 'paid';
          const src = photoSrc(a);
          const owed = Number(a.owed || 0);
          return (
            <button key={a.id} type="button" onClick={() => goTab('apartments')} data-testid={`mobile-home-apt-${a.number}`}
              className="w-full rounded-[22px] bg-white shadow-[0_6px_18px_-10px_rgba(15,23,42,0.3)] flex items-center gap-3 p-3 pr-4 text-left active:scale-[0.99] transition">
              <div className="w-[76px] h-[76px] shrink-0 rounded-full p-[3px] bg-gradient-to-br from-[#FF8A3D] to-[#FFC999]">
                <div className="w-full h-full rounded-full overflow-hidden bg-orange-50 flex items-center justify-center">
                  {src
                    ? <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    : <Home className="w-8 h-8 text-orange-300" />}
                </div>
              </div>
              <div className="w-px self-stretch my-1 bg-orange-300/70" />
              <div className="min-w-0 flex-1">
                <p className="text-xl font-black text-[#1B2A5C] leading-tight truncate">Huis {a.number}</p>
                <p className="flex items-center gap-1.5 text-[14px] text-slate-700 truncate mt-0.5">
                  <UserRound className="w-4 h-4 shrink-0 text-[#1B2A5C]" />
                  <span className="truncate">{a.tenant_name || 'Geen huurder'}</span>
                </p>
                <p className="flex items-center gap-1.5 text-[13px] text-slate-600 truncate">
                  <Home className="w-4 h-4 shrink-0 text-[#1B2A5C]" />
                  <span className="truncate">{a.description || a.address || '—'}</span>
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-center gap-1">
                {a.tenant_id ? (
                  <>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-bold text-white ${isOpen ? 'bg-red-600' : 'bg-emerald-600'}`}>
                      {isOpen ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      {isOpen ? 'Openstaand' : 'Betaald'}
                    </span>
                    <span className={`text-xl font-black tabular-nums ${isOpen ? 'text-red-600' : 'text-emerald-600'}`}>
                      {fmtMoney(isOpen ? owed : 0, a.currency || 'SRD')}
                    </span>
                  </>
                ) : (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[13px] font-bold text-slate-500">Vrij</span>
                )}
              </div>
              <ChevronRight className="w-5 h-5 shrink-0 text-[#1B2A5C]" />
            </button>
          );
        })}
        {!visible.length && (
          <p className="text-center text-sm font-semibold text-slate-400 py-8">Geen appartementen gevonden.</p>
        )}
      </div>

      <div className="mx-3 mt-4 rounded-2xl bg-[#FFE9D2] flex items-center gap-3 p-3" data-testid="mobile-home-contact">
        <Handshake className="w-10 h-10 text-[#F05A00] shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-black text-[#1B2A5C] leading-tight">Samen sterk in vastgoedbeheer</p>
          <p className="text-xs text-slate-700 truncate">{name} – Uw betrouwbare partner</p>
        </div>
        {phone && (
          <a href={`tel:${phone}`} className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#F05A00] px-4 py-2.5 text-sm font-bold text-white">
            <Phone className="w-4 h-4" /> Contact
          </a>
        )}
      </div>

      <button type="button" onClick={onOpenMenu} aria-label="Nieuw" data-testid="mobile-home-fab"
        className="fixed right-4 z-40 w-16 h-16 rounded-full bg-gradient-to-br from-[#FF8A3D] to-[#F05A00] text-white flex items-center justify-center shadow-[0_12px_26px_-6px_rgba(255,92,0,0.7)] active:scale-95 transition"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}>
        <Plus className="w-8 h-8" strokeWidth={2.6} />
      </button>
    </div>
  );
}
