import { Suspense, useEffect } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { KioskFxCtx } from './KioskFx';
import { UiBar, UiHero } from './KioskInvoicesUi';

export const UI_NEW = {
  onderhoud: { label: 'Nieuw ticket', event: 'kiosk-maint-new' },
  borg: { label: 'Nieuwe borg', event: 'kiosk-dep-new' },
  contracten: { label: 'Nieuw contract', event: 'kiosk-contract-new' },
  regelingen: { label: 'Nieuwe regeling', event: 'kiosk-plan-new' },
  betalingen: { label: 'Nieuwe betaling', event: 'quick-pay-open' },
  appartementen: { label: 'Nieuw appartement', event: 'kiosk-apt-new' },
  huurders: { label: 'Nieuwe huurder', event: 'kiosk-tenant-new' },
  werknemers: { label: 'Nieuw toevoegen', event: 'kiosk-emp-new' },
  kasgeld: { label: 'Nieuwe mutatie', event: 'kiosk-kasgeld-new' },
};

const CASH_MASK = 'linear-gradient(to right, transparent 0%, #000 45%)';

// Kasgeld-illustratie (munten + bankbiljet) in plaats van de villa.
const CashArt = () => (
  <svg viewBox="0 0 220 140" className="absolute -right-2 bottom-0 h-[92%] w-auto max-w-none pointer-events-none" aria-hidden="true"
    style={{ WebkitMaskImage: CASH_MASK, maskImage: CASH_MASK }}>
    <g fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="22" y="38" width="124" height="66" rx="8" transform="rotate(-8 84 71)" fill="#fff" fillOpacity="0.18" />
      <circle cx="84" cy="71" r="16" transform="rotate(-8 84 71)" />
      <path d="M40 54h10M118 88h10" transform="rotate(-8 84 71)" />
      <ellipse cx="170" cy="112" rx="30" ry="9" fill="#fff" fillOpacity="0.28" />
      <ellipse cx="170" cy="98" rx="30" ry="9" fill="#fff" fillOpacity="0.28" />
      <ellipse cx="170" cy="84" rx="30" ry="9" fill="#fff" fillOpacity="0.28" />
      <ellipse cx="170" cy="70" rx="30" ry="9" fill="#fff" fillOpacity="0.4" />
      <path d="M170 64v12M165 67h8" />
    </g>
  </svg>
);

// Volledige-pagina in UI-Thema: balk met terug-knop, oranje hero, "Nieuw"-knop en de bestaande inhoud.
export default function KioskUiAdminPage({ title, label, subtitle = 'Beheer deze gegevens', Icon, newItem, newItemFixed = false, onBack, onClose, testId, children, art, bare }) {
  useEffect(() => {
    document.body.classList.add('kiosk-popup-active');
    return () => document.body.classList.remove('kiosk-popup-active');
  }, []);
  return (
    <div className={`${newItemFixed ? 'pb-28' : 'pb-8'} overflow-x-hidden`} data-testid={testId}>
      {!bare && (onClose ? (
        <div className="flex items-center justify-between gap-3 px-5 pb-4 bg-white border-b border-slate-100"
          style={{ paddingTop: 'max(var(--kiosk-sat), 16px)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-orange-100 flex items-center justify-center">
              {Icon && <Icon className="w-7 h-7 text-orange-600" strokeWidth={2.5} />}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-black leading-tight text-slate-900">{`${label || title} Overzicht`}</h2>
              <p className="mt-1 truncate text-sm leading-tight text-slate-500">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} data-testid={`${testId}-close`} aria-label="Sluiten"
            className="w-14 h-14 shrink-0 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
            <X className="w-7 h-7 text-slate-700" strokeWidth={2.5} />
          </button>
        </div>
      ) : <UiBar title={title} onBack={onBack} testId="kiosk-admin-page-back" />)}
      {!bare && !onClose && <UiHero art={art === 'cash' ? <CashArt /> : undefined} icon={Icon ? <Icon className="w-7 h-7" strokeWidth={2} /> : null} title={`${label || title} Overzicht`} />}
      {newItem && !bare && (
        <div className={newItemFixed
          ? 'fixed inset-x-0 bottom-0 z-[130] border-t border-slate-100 bg-white px-4 pt-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.22)]'
          : 'mt-3 px-2'}
          style={newItemFixed ? { paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' } : undefined}>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(newItem.event))} data-testid={`${testId}-new`}
            className={`w-full inline-flex ${newItemFixed ? 'h-12' : 'h-11'} items-center justify-center gap-1.5 rounded-2xl bg-[#FF5C00] text-xs font-black text-white shadow-[0_10px_22px_-10px_rgba(255,92,0,0.8)]`}>
            <Plus className="h-4 w-4" /> {newItem.label}
          </button>
        </div>
      )}
      <div className={bare ? '' : 'mt-3 px-2'}>
        <Suspense fallback={<Loader2 className="mx-auto my-16 h-7 w-7 animate-spin text-[#FF5C00]" />}>
          <KioskFxCtx.Provider value><div className="kiosk-fx kiosk-ui-admin space-y-3">{children}</div></KioskFxCtx.Provider>
        </Suspense>
      </div>
    </div>
  );
}
