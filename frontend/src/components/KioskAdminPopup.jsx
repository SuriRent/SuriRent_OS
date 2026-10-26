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
  werknemers: { label: 'Nieuw toevoegen', event: 'kiosk-emp-new' },
};

// Beheer-pagina's als popup in exact dezelfde opmaak als Facturen.
export function KioskAdminPopup({ id, Shell, onClose }) {
  const inst = id.startsWith('inst-') ? INSTELLINGEN_SECTIONS.find((x) => x.id === id.slice(5)) : null;
  const { Page, label, Icon } = inst
    ? { Page: KIOSK_ADMIN_PAGES.instellingen.Page, label: inst.label, Icon: inst.icon }
    : KIOSK_ADMIN_PAGES[id];
  const nw = NEW[id];
  const bodyCls = inst ? 'kiosk-admin-active' : 'kiosk-popup-active';
  useEffect(() => {
    document.body.classList.add(bodyCls);
    return () => document.body.classList.remove(bodyCls);
  }, [bodyCls]);
  const footer = (
    <div className="grid grid-cols-2 gap-2">
      {nw && (
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(nw.event))} data-testid={`kiosk-popup-${id}-new`}
          className="col-span-2 h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> {nw.label}
        </button>
      )}
      <button type="button" onClick={onClose} data-testid={`kiosk-popup-${id}-footer-close`}
        className="col-span-2 h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Sluiten</button>
    </div>
  );
  return (
    <Shell title={label} Icon={Icon} testId={`kiosk-popup-${id}`} onClose={onClose} footer={footer} wide xwide={!!inst} tall>
      <Suspense fallback={<Loader2 className="w-7 h-7 text-[#FF5C00] animate-spin mx-auto my-16" />}>
        {inst ? <Page embedded section={inst.id} /> : (
          <div className="kiosk-fx" data-testid={`kiosk-popup-${id}-content`}><Page embedded /></div>
        )}
      </Suspense>
    </Shell>
  );
}
