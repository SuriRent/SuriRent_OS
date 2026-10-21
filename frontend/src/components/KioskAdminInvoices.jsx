import { lazy, Suspense } from 'react';
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
  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }} data-testid={`kiosk-admin-page-${id}`}>
      <div className="kiosk-chrome flex items-center gap-2 px-1 sm:px-2 py-2 shrink-0">
        <button onClick={onBack} data-testid="kiosk-admin-page-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F7F8FA] rounded-2xl p-4 sm:p-6 mb-3">
        <Suspense fallback={<Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}>
          <Page />
        </Suspense>
      </div>
    </div>
  );
}
