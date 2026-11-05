import { lazy, Suspense, useEffect, useState } from 'react';
import { FileSignature, Loader2, ArrowLeft, CreditCard, Users, MapPin, Home, FileText, CalendarClock, Wrench, UserCog, Bell, ShieldCheck, LayoutDashboard, Settings, Zap } from 'lucide-react';

// Volledige beheer-pagina's die in de kiosk (hamburgermenu) geopend kunnen worden.
export const KIOSK_ADMIN_PAGES = {
  overzicht: { label: 'Overzicht', Icon: LayoutDashboard, Page: lazy(() => import('../pages/vastgoed/AdminDashboard').then((m) => ({ default: m.Overview }))) },
  locaties: { label: 'Locaties', Icon: MapPin, Page: lazy(() => import('../pages/vastgoed/admin/Locations')) },
  appartementen: { label: 'Appartementen', Icon: Home, Page: lazy(() => import('../pages/vastgoed/AdminDashboard').then((m) => ({ default: m.Apartments }))) },
  huurders: { label: 'Huurders', Icon: Users, Page: lazy(() => import('../pages/vastgoed/AdminDashboard').then((m) => ({ default: m.Tenants }))) },
  contracten: { label: 'Contracten', Icon: FileText, Page: lazy(() => import('../pages/vastgoed/admin/Contracts')) },
  betalingen: { label: 'Betalingen', Icon: CreditCard, Page: lazy(() => import('../pages/vastgoed/admin/Payments')) },
  regelingen: { label: 'Betalingsregelingen', Icon: CalendarClock, Page: lazy(() => import('../pages/vastgoed/admin/PaymentPlans')) },
  facturen: { label: 'Facturen', Icon: FileSignature, custom: true, Page: lazy(() => import('./KioskInvoicesPage')) },
  onderhoud: { label: 'Onderhoud', Icon: Wrench, Page: lazy(() => import('../pages/vastgoed/admin/Maintenance')) },
  werknemers: { label: 'Werknemers', Icon: UserCog, Page: lazy(() => import('../pages/vastgoed/admin/Employees')) },
  notificaties: { label: 'Notificaties', Icon: Bell, Page: lazy(() => import('../pages/vastgoed/admin/Notifications')) },
  borg: { label: 'Borg', Icon: ShieldCheck, Page: lazy(() => import('../pages/vastgoed/admin/Deposits')) },
  stroom: { label: 'Stroom', Icon: Zap, Page: lazy(() => import('../pages/vastgoed/admin/PowerControl')) },
  instellingen: { label: 'Instellingen', Icon: Settings, Page: lazy(() => import('../pages/vastgoed/admin/InstellingenHub')) },
};

const KIOSK_ADMIN_NEW_EVENTS = {
  locaties: 'kiosk-loc-new',
  appartementen: 'kiosk-apt-new',
  huurders: 'kiosk-tenant-new',
  contracten: 'kiosk-contract-new',
  betalingen: 'quick-pay-open',
  regelingen: 'kiosk-plan-new',
  onderhoud: 'kiosk-maint-new',
  borg: 'kiosk-dep-new',
};

export function KioskAdminPageTile({ id, onOpen }) {
  const { label, Icon } = KIOSK_ADMIN_PAGES[id];
  return (
    <button type="button" role="menuitem" onClick={() => onOpen(id)} data-testid={`kiosk-admin-menu-${id}`}
      className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-50 hover:bg-orange-50 ring-1 ring-slate-100 p-5 text-sm font-bold text-slate-800 transition-colors">
      <span className="w-12 h-12 rounded-xl bg-orange-100 text-[#FF5C00] flex items-center justify-center"><Icon className="w-6 h-6" /></span>
      {label}
    </button>
  );
}

export function KioskAdminPage({ id, onBack, kioskLayout = false }) {
  const { Page, custom } = KIOSK_ADMIN_PAGES[id];
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  // Vensters (portals) die vanaf deze pagina openen krijgen ook de kiosk-stijl.
  useEffect(() => {
    document.body.classList.add('kiosk-admin-active');
    return () => document.body.classList.remove('kiosk-admin-active');
  }, []);
  useEffect(() => {
    const updateIsMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', updateIsMobile);
    return () => window.removeEventListener('resize', updateIsMobile);
  }, []);
  if (kioskLayout) {
    if (isMobile && !custom) {
      const startEvent = KIOSK_ADMIN_NEW_EVENTS[id];
      return (
        <div className="h-full min-h-0 bg-[#F4F5F7] flex flex-col" data-testid={`kiosk-admin-page-${id}`}>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
            <div className="kiosk-admin-skin mx-auto w-full max-w-[1500px] bg-white rounded-3xl shadow-[0_10px_30px_-14px_rgba(15,23,42,0.25)] ring-1 ring-slate-100 px-4 sm:px-6 pt-4 pb-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <button type="button" onClick={onBack} data-testid="kiosk-admin-page-back"
                  className="inline-flex items-center gap-2 text-[#FF5C00] font-bold bg-orange-50 hover:bg-orange-100 rounded-xl px-3 py-2 transition-colors">
                  <ArrowLeft className="w-5 h-5" /> Terug
                </button>
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-base font-black text-slate-900">{KIOSK_ADMIN_PAGES[id].label}</h1>
                  {startEvent && (
                    <button type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent(startEvent))}
                      data-testid={`kiosk-admin-page-new-${id}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#FF5C00] px-3 py-2 text-xs font-black text-white">
                      <span className="text-base leading-none">+</span> Nieuw
                    </button>
                  )}
                </div>
              </div>
              <Suspense fallback={<Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}>
                <Page embedded />
              </Suspense>
            </div>
          </div>
        </div>
      );
    }
    return (
      <Suspense fallback={<Loader2 className="w-8 h-8 text-white animate-spin mx-auto my-16" />}>
        <div className="h-full min-h-0 kiosk-admin-skin">
          <Page kioskLayout onBack={onBack} />
        </div>
      </Suspense>
    );
  }
  if (custom) {
    return (
      <Suspense fallback={<Loader2 className="w-8 h-8 text-white animate-spin mx-auto my-16" />}>
        <Page onBack={onBack} />
      </Suspense>
    );
  }
  return (
    <div className="h-full bg-[#F4F5F7] flex flex-col" data-testid={`kiosk-admin-page-${id}`}>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6">
      <div className="kiosk-admin-skin mx-auto w-full max-w-[1500px] bg-white rounded-3xl shadow-[0_10px_30px_-14px_rgba(15,23,42,0.25)] ring-1 ring-slate-100 px-5 sm:px-8 pt-5 pb-8">
        <div className="mb-4 flex items-center justify-between gap-2">
          <button onClick={onBack} data-testid="kiosk-admin-page-back"
            className="inline-flex items-center gap-2 text-[#FF5C00] font-bold bg-orange-50 hover:bg-orange-100 rounded-xl px-4 transition-colors">
            <ArrowLeft className="w-5 h-5" /> Terug
          </button>
          {isMobile && KIOSK_ADMIN_NEW_EVENTS[id] && (
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(KIOSK_ADMIN_NEW_EVENTS[id]))}
              data-testid={`kiosk-admin-page-new-${id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#FF5C00] px-3 py-2 text-xs font-black text-white">
              <span className="text-base leading-none">+</span> Nieuw
            </button>
          )}
        </div>
        <Suspense fallback={<Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}>
          <Page embedded={id === 'instellingen' || (isMobile && ['onderhoud', 'werknemers', 'borg'].includes(id))} />
        </Suspense>
      </div>
      </div>
    </div>
  );
}
