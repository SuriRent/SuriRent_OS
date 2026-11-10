import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Search, X } from 'lucide-react';
import { api } from '../lib/api';

// Eén gedeelde huurderslijst (foto's komen uit Huurders) voor alle beheerpagina's.
let tenantPhotoCache = null;
let tenantPhotoPromise = null;
if (typeof window !== 'undefined') {
  window.addEventListener('surirent:live-change', () => {
    tenantPhotoCache = null;
    tenantPhotoPromise = null;
    window.dispatchEvent(new Event('kiosk-tenant-photos-change'));
  });
}
function loadTenantPhotos() {
  if (tenantPhotoCache) return Promise.resolve(tenantPhotoCache);
  if (!tenantPhotoPromise) {
    tenantPhotoPromise = api.get('/tenants').then(({ data }) => {
      const map = {};
      (data || []).forEach((t) => { map[t.id] = { name: t.name, photo: t.avatar_url || t.id_photo_url || '' }; });
      tenantPhotoCache = map;
      return map;
    }).catch(() => { tenantPhotoPromise = null; return {}; });
  }
  return tenantPhotoPromise;
}

export function TenantPhoto({ tenantId, name, photoUrl, size = 40 }) {
  const [map, setMap] = useState(tenantPhotoCache || {});
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (photoUrl) return undefined;
    let alive = true;
    const load = () => loadTenantPhotos().then((m) => { if (alive) setMap(m); });
    load();
    window.addEventListener('kiosk-tenant-photos-change', load);
    return () => {
      alive = false;
      window.removeEventListener('kiosk-tenant-photos-change', load);
    };
  }, [photoUrl]);
  const info = map[tenantId] || {};
  const photo = photoUrl || info.photo;
  const src = photo && !/^https?:/.test(photo) ? `${process.env.REACT_APP_BACKEND_URL}${photo}` : photo;
  useEffect(() => { setBad(false); }, [src]);
  const ini = (name || info.name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="shrink-0 rounded-full overflow-hidden bg-orange-100 flex items-center justify-center text-[#FF5C00] font-black"
      style={{ width: size, height: size, fontSize: size * 0.38 }} data-testid="tenant-photo">
      {src && !bad ? <img src={src} alt="" className="w-full h-full object-cover" onError={() => setBad(true)} /> : ini}
    </span>
  );
}

// Bouwstenen in exact dezelfde opmaak als de Kiosk Facturen-popup.
export const KioskFxCtx = createContext(false);
export const useKioskFx = () => useContext(KioskFxCtx);
export const FX_ICON_BTN = 'w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center transition-colors shrink-0';
export const FX_TONE = { red: 'text-red-600', amber: 'text-amber-600', orange: 'text-orange-600', green: 'text-emerald-600', slate: 'text-slate-500', blue: 'text-blue-600' };

export function FxStats({ items, testId }) {
  return (
    <div className="fx-stats grid grid-cols-3 gap-2" data-testid={testId}>
      {items.map(([l, v, tone], i) => (
        <div key={l} className="fx-stat rounded-xl bg-slate-50 px-3.5 py-4 sm:px-3 sm:py-2 min-w-0" data-testid={`${testId}-${i}`}>
                  <div className="text-xs sm:text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">{l}</div>
                  <div className={`text-lg sm:text-sm mt-0.5 sm:mt-0 font-black truncate ${FX_TONE[tone] || 'text-slate-900'}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

export function FxTabs({ tabs, value, onChange, testPrefix }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto" data-testid={`${testPrefix}-filter-bar`}>
      {tabs.map((t) => (
        <button key={t.v} type="button" onClick={() => onChange(t.v)} data-testid={`${testPrefix}-filter-${t.v}`}
          className={`flex-1 min-w-max px-3 h-10 rounded-xl text-xs font-black transition-colors ${value === t.v ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-600'}`}>
          {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>
  );
}

export function FxSearch({ value, onChange, placeholder, testId }) {
  return (
    <label className="fx-search flex items-center gap-2 h-11 rounded-xl border border-slate-200 px-3">
      <Search className="w-4 h-4 text-slate-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId}
        className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
      {value && <button type="button" onClick={() => onChange('')} aria-label="Wissen"><X className="w-4 h-4 text-slate-400" /></button>}
    </label>
  );
}

// Lijst-rij: naam / sub / meta links, bedrag + status rechts, chevron.
export function FxRow({ title, sub, meta, badge, amount, status, tone, onClick, actions, testId, tenantId, tenantPhotoUrl, photoUrl }) {
  const Tag = actions ? 'div' : 'button';
  const extra = actions
    ? { role: onClick ? 'button' : undefined, tabIndex: onClick ? 0 : undefined, onKeyDown: (e) => { if (e.key === 'Enter' && onClick) onClick(); } }
    : { type: 'button' };
  const photoPath = photoUrl?.includes('/api/landing/asset/')
    ? `${photoUrl}${photoUrl.includes('?') ? '&' : '?'}thumb=1`
    : photoUrl;
  const photoSrc = photoPath
    ? `${photoPath.startsWith('/') ? process.env.REACT_APP_BACKEND_URL || '' : ''}${photoPath}`
    : '';
  return (
    <Tag onClick={onClick} data-testid={testId} {...extra}
      className={`kiosk-fx-row w-full text-left rounded-xl border border-slate-200 ${onClick ? 'hover:border-orange-300 cursor-pointer' : ''} px-4 py-3 flex ${actions ? 'flex-wrap sm:flex-nowrap' : ''} items-center justify-between gap-x-3 gap-y-2 transition-colors bg-white`}>
      {photoSrc && (
        <span data-apartment-photo="true" className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-slate-100">
          <img src={photoSrc} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} />
        </span>
      )}
      {tenantId && <TenantPhoto tenantId={tenantId} name={typeof title === 'string' ? title : ''} photoUrl={tenantPhotoUrl} size={40} />}
      <div className="kiosk-fx-row-content min-w-0 flex-1">
        <div className="text-sm font-black text-slate-900 truncate">{title}</div>
        {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
        {badge}
        {meta && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{meta}</div>}
      </div>
      <div className="kiosk-fx-row-value text-right shrink-0 flex items-center gap-2">
        {(amount !== undefined || status) && (
          <div>
            {amount !== undefined && <div className="text-sm font-black text-slate-900 whitespace-nowrap">{amount}</div>}
            {status && <div className={`text-[11px] font-bold uppercase tracking-wide ${FX_TONE[tone] || 'text-slate-500'}`}>{status}</div>}
          </div>
        )}
        {onClick && !actions && <ChevronRight className="w-4 h-4 text-slate-300" />}
      </div>
      {actions && (
        <div className="basis-full sm:basis-auto flex items-center justify-end gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {actions}
          {onClick && <ChevronRight className="w-4 h-4 text-slate-300" />}
        </div>
      )}
    </Tag>
  );
}

export function FxIconBtn({ onClick, href, title, testId, danger, children }) {
  const cls = `${FX_ICON_BTN} ${danger ? 'text-slate-400 hover:bg-red-50 hover:text-red-600' : 'text-slate-500 hover:bg-orange-50 hover:text-[#FF5C00]'}`;
  if (href) return <a href={href} target="_blank" rel="noreferrer" title={title} aria-label={title} data-testid={testId} className={cls}>{children}</a>;
  return <button type="button" onClick={onClick} title={title} aria-label={title} data-testid={testId} className={cls}>{children}</button>;
}

export function FxEmpty({ text, testId }) {
  return <div className="text-center text-slate-500 py-10 text-sm" data-testid={testId}>{text}</div>;
}

export function FxBack({ onClick, label, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className="fx-back inline-flex items-center gap-1.5 text-sm font-black text-[#FF5C00]"><ArrowLeft className="w-4 h-4" /> {label}</button>
  );
}

// Kopkaart van een detailpagina (zoals huurder-kop in Facturen).
export function FxHeader({ title, sub, label, amount, tone, children, testId }) {
  return (
    <div className="fx-header rounded-xl bg-slate-50 px-4 py-3 flex items-center justify-between gap-3" data-testid={testId}>
      <div className="min-w-0">
        <div className="text-base font-black text-slate-900 truncate">{title}</div>
        {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
        {children}
      </div>
      {(label || amount !== undefined) && (
        <div className="text-right shrink-0">
          {label && <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>}
          {amount !== undefined && <div className={`text-lg font-black ${FX_TONE[tone] || 'text-slate-900'}`}>{amount}</div>}
        </div>
      )}
    </div>
  );
}
