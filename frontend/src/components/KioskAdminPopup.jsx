import { Suspense, useEffect } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { KIOSK_ADMIN_PAGES } from './KioskAdminInvoices';

const NEW = {
  locaties: { label: 'Nieuwe locatie', event: 'kiosk-loc-new' },
  appartementen: { label: 'Nieuw appartement', event: 'kiosk-apt-new' },
  betalingen: { label: 'Nieuwe betaling', event: 'quick-pay-open' },
  huurders: { label: 'Nieuwe huurder', event: 'kiosk-tenant-new' },
};

// Betalingen / Huurders als popup in de stijl van Facturen — volledige beheer-module erin.
export function KioskAdminPopup({ id, Shell, onClose }) {
  const { Page, label, Icon } = KIOSK_ADMIN_PAGES[id];
  const nw = NEW[id];
  useEffect(() => {
    document.body.classList.add('kiosk-admin-active');
    return () => document.body.classList.remove('kiosk-admin-active');
  }, []);
  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(nw.event))} data-testid={`kiosk-popup-${id}-new`}
        className="h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> {nw.label}
      </button>
      <button type="button" onClick={onClose} data-testid={`kiosk-popup-${id}-footer-close`}
        className="h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Sluiten</button>
    </div>
  );
  return (
    <Shell title={label} Icon={Icon} testId={`kiosk-popup-${id}`} onClose={onClose} footer={footer} wide tall>
      <Suspense fallback={<Loader2 className="w-7 h-7 text-[#FF5C00] animate-spin mx-auto my-16" />}>
        <Page embedded />
      </Suspense>
    </Shell>
  );
}
