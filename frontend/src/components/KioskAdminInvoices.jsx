import { lazy, Suspense, useEffect } from 'react';
import { FileSignature, Loader2, ArrowLeft, CreditCard, Users } from 'lucide-react';

// Volledige beheer-pagina's die in de kiosk (hamburgermenu) geopend kunnen worden.
export const KIOSK_ADMIN_PAGES = {
  facturen: { label: 'Facturen', Icon: FileSignature, Page: lazy(() => import('../pages/vastgoed/admin/Invoices')) },
  betalingen: { label: 'Betalingen', Icon: CreditCard, Page: lazy(() => import('../pages/vastgoed/admin/Payments')) },
  huurders: { label: 'Huurders', Icon: Users, Page: lazy(() => import('../pages/vastgoed/AdminDashboard').then((m) => ({ default: m.Tenants }))) },
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

export function KioskAdminPage({ id, onBack }) {
  const { Page } = KIOSK_ADMIN_PAGES[id];
  // Vensters (portals) die vanaf deze pagina openen krijgen ook de kiosk-stijl.
  useEffect(() => {
    document.body.classList.add('kiosk-admin-active');
    return () => document.body.classList.remove('kiosk-admin-active');
  }, []);
  return (
    <div className="h-full bg-[#F4F5F7] flex flex-col" data-testid={`kiosk-admin-page-${id}`}>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6">
      <div className="kiosk-admin-skin mx-auto w-full max-w-[1300px] bg-white rounded-3xl shadow-[0_10px_30px_-14px_rgba(15,23,42,0.25)] ring-1 ring-slate-100 px-5 sm:px-8 pt-5 pb-8">
        <button onClick={onBack} data-testid="kiosk-admin-page-back"
          className="mb-4 inline-flex items-center gap-2 text-[#FF5C00] font-bold bg-orange-50 hover:bg-orange-100 rounded-xl px-4 transition-colors">
          <ArrowLeft className="w-5 h-5" /> Terug
        </button>
        <Suspense fallback={<Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}>
          <Page />
        </Suspense>
      </div>
      </div>
    </div>
  );
}
