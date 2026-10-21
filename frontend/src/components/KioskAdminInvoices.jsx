import { lazy, Suspense } from 'react';
import { FileSignature, Loader2, ArrowLeft } from 'lucide-react';


const AdminInvoicesPage = lazy(() => import('../pages/vastgoed/admin/Invoices'));

// Beheer-tegel "Facturen" in het hamburgermenu — opent de volledige Facturen-pagina.
export function KioskAdminInvoicesTile({ onOpen }) {
  return (
    <button type="button" role="menuitem" onClick={onOpen} data-testid="kiosk-admin-menu-invoices"
      className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-50 hover:bg-orange-50 ring-1 ring-slate-100 p-5 text-sm font-bold text-slate-800 transition-colors">
      <span className="w-12 h-12 rounded-xl bg-orange-100 text-[#FF5C00] flex items-center justify-center"><FileSignature className="w-6 h-6" /></span>
      Facturen
    </button>
  );
}

// Volledige Facturen-pagina uit de beheeromgeving, binnen de kiosk.
export function KioskAdminInvoicesPage({ onBack }) {
  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }} data-testid="kiosk-admin-invoices-page">
      <div className="kiosk-chrome flex items-center gap-2 px-1 sm:px-2 py-2 shrink-0">
        <button onClick={onBack} data-testid="kiosk-admin-invoices-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F7F8FA] rounded-2xl p-4 sm:p-6 mb-3">
        <Suspense fallback={<Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}>
          <AdminInvoicesPage />
        </Suspense>
      </div>
    </div>
  );
}
