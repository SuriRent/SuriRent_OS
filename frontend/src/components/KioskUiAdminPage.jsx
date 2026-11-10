import { Suspense, useEffect } from 'react';
import { Loader2, Plus } from 'lucide-react';
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

// Volledige-pagina in UI-Thema: balk met terug-knop, oranje hero, "Nieuw"-knop en de bestaande inhoud.
export default function KioskUiAdminPage({ title, label, Icon, newItem, onBack, testId, children }) {
  useEffect(() => {
    document.body.classList.add('kiosk-popup-active');
    return () => document.body.classList.remove('kiosk-popup-active');
  }, []);
  return (
    <div className="pb-8" data-testid={testId}>
      <UiBar title={title} onBack={onBack} testId="kiosk-admin-page-back" />
      <UiHero icon={Icon ? <Icon className="w-7 h-7" strokeWidth={2} /> : null} title={`${label || title} Overzicht`} />
      {newItem && (
        <div className="mt-3 px-2">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(newItem.event))} data-testid={`${testId}-new`}
            className="w-full inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-[#FF5C00] text-xs font-black text-white shadow-[0_10px_22px_-10px_rgba(255,92,0,0.8)]">
            <Plus className="h-4 w-4" /> {newItem.label}
          </button>
        </div>
      )}
      <div className="mt-3 px-2">
        <Suspense fallback={<Loader2 className="mx-auto my-16 h-7 w-7 animate-spin text-[#FF5C00]" />}>
          <KioskFxCtx.Provider value><div className="kiosk-fx kiosk-ui-admin space-y-3">{children}</div></KioskFxCtx.Provider>
        </Suspense>
      </div>
    </div>
  );
}
