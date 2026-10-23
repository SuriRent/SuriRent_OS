import { lazy, Suspense } from 'react';
import { ArrowLeft, Loader2, CalendarPlus, FilePlus2 } from 'lucide-react';
import { MONTHS_NL } from '../lib/api';

const AdminInvoices = lazy(() => import('../pages/vastgoed/admin/Invoices'));
const CARD = 'bg-white rounded-2xl shadow-[0_10px_30px_-10px_rgba(120,40,0,0.45)] flex flex-col min-h-0 overflow-hidden';

// Kiosk-Facturen in de stijl van het Financieel overzicht: links de Facturen uit de beheeromgeving
// (lijst + detailpagina in hetzelfde vak), rechts alleen de knoppen.
export default function KioskInvoicesPage({ onBack }) {
  const month = MONTHS_NL[new Date().getMonth()];
  const fire = (name) => window.dispatchEvent(new CustomEvent(name));
  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 1.5vh' }} data-testid="kiosk-admin-page-facturen">
      <div className="kiosk-chrome flex items-center gap-3 px-1 sm:px-2 py-2 shrink-0">
        <button onClick={onBack} data-testid="kiosk-admin-page-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-sm">Terug</span>
        </button>
        <span className="text-xl sm:text-2xl font-black text-white tracking-tight">Facturen</span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 sm:gap-4">
        <div className={`${CARD} md:flex-[3]`} data-testid="kiosk-inv-list">
          <div className="kiosk-admin-skin flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
            <Suspense fallback={<Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}>
              <AdminInvoices kiosk />
            </Suspense>
          </div>
        </div>
        <div className={`${CARD} md:flex-[1] md:max-w-[380px] p-5 sm:p-6 gap-4 justify-start`} data-testid="kiosk-inv-actions">
          <button type="button" onClick={() => fire('invoices-generate')} data-testid="kiosk-inv-generate"
            className="h-20 rounded-2xl bg-white border-2 border-[#FF5C00] text-[#FF5C00] text-xl font-black inline-flex items-center justify-center gap-3 hover:bg-orange-50 transition-colors">
            <CalendarPlus className="w-7 h-7" /> Genereer {month}
          </button>
          <button type="button" onClick={() => fire('invoices-new')} data-testid="kiosk-inv-new"
            className="h-20 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white text-xl font-black inline-flex items-center justify-center gap-3 shadow-[0_12px_28px_-10px_rgba(255,92,0,0.7)] transition-colors">
            <FilePlus2 className="w-7 h-7" /> Nieuwe factuur
          </button>
        </div>
      </div>
    </div>
  );
}
