import { Suspense, useEffect } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { KIOSK_ADMIN_PAGES } from './KioskAdminInvoices';
import { INSTELLINGEN_SECTIONS } from '../pages/vastgoed/admin/instellingenSections';

const NEW = {
  onderhoud: { label: 'Nieuw ticket', event: 'kiosk-maint-new' },
  borg: { label: 'Nieuwe borg', event: 'kiosk-dep-new' },
  contracten: { label: 'Nieuw contract', event: 'kiosk-contract-new' },
  regelingen: { label: 'Nieuwe regeling', event: 'kiosk-plan-new' },
  locaties: { label: 'Nieuwe locatie', event: 'kiosk-loc-new' },
  appartementen: { label: 'Nieuw appartement', event: 'kiosk-apt-new' },
  betalingen: { label: 'Nieuwe betaling', event: 'quick-pay-open' },
  huurders: { label: 'Nieuwe huurder', event: 'kiosk-tenant-new' },
};

// Betalingen / Huurders als popup in de stijl van Facturen — volledige beheer-module erin.
export function KioskAdminPopup({ id, Shell, onClose }) {
  const inst = id.startsWith('inst-') ? INSTELLINGEN_SECTIONS.find((x) => x.id === id.slice(5)) : null;
  const { Page, label, Icon } = inst
    ? { Page: KIOSK_ADMIN_PAGES.instellingen.Page, label: inst.label, Icon: inst.icon }
    : KIOSK_ADMIN_PAGES[id];
  const nw = NEW[id];
  useEffect(() => {
    document.body.classList.add('kiosk-admin-active');
    return () => document.body.classList.remove('kiosk-admin-active');
  }, []);
  const footer = (
    <div className={`grid ${nw ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
      {nw && (
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(nw.event))} data-testid={`kiosk-popup-${id}-new`}
          className="h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> {nw.label}
        </button>
      )}
      <button type="button" onClick={onClose} data-testid={`kiosk-popup-${id}-footer-close`}
        className="h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Sluiten</button>
    </div>
  );
  return (
    <Shell title={label} Icon={Icon} testId={`kiosk-popup-${id}`} onClose={onClose} footer={footer} wide tall>
      <Suspense fallback={<Loader2 className="w-7 h-7 text-[#FF5C00] animate-spin mx-auto my-16" />}>
        <Page embedded section={inst?.id} />
      </Suspense>
    </Shell>
  );
}
