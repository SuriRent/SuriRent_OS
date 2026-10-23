import { lazy, Suspense, useEffect } from 'react';
import { FileSignature, Loader2, X } from 'lucide-react';

const AdminInvoices = lazy(() => import('../pages/vastgoed/admin/Invoices'));

// Facturen schermvullend in de kiosk — de complete Facturen-module (lijst, details,
// betalingsgeschiedenis, delen/e-mail/WhatsApp, genereren, nieuwe factuur, filters).
export function KioskInvoicesFullscreen({ onClose }) {
  useEffect(() => {
    document.body.classList.add('kiosk-admin-active');
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.ksm-root')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.classList.remove('kiosk-admin-active'); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[115] bg-white sm:bg-black/60 flex sm:items-center sm:justify-center sm:p-6" data-testid="invoices-fullscreen"
      onClick={onClose} style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="bg-white w-full sm:max-w-[1180px] h-full sm:h-[90vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3 px-4 sm:px-5 h-16 bg-white border-b border-slate-100 shrink-0">
        <span className="w-10 h-10 rounded-xl bg-orange-50 text-[#FF5C00] flex items-center justify-center"><FileSignature className="w-5 h-5" /></span>
        <h2 className="text-lg font-black text-slate-900 flex-1">Facturen</h2>
        <button type="button" onClick={onClose} data-testid="invoices-fullscreen-close" aria-label="Sluiten"
          className="w-10 h-10 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="kiosk-inv-skin flex-1 min-h-0 overflow-y-auto bg-[#F7F8FA]">
        <div className="w-full px-3 sm:px-5 py-4">
          <Suspense fallback={<Loader2 className="w-8 h-8 text-[#FF5C00] animate-spin mx-auto my-16" />}>
            <AdminInvoices />
          </Suspense>
        </div>
      </div>
      </div>
    </div>
  );
}
