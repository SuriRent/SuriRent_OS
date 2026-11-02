import { X, Sparkles } from 'lucide-react';
import SetupWizard from './SetupWizard';

/** Bottom-sheet (mobiel) + center-modal (desktop) wrapper rond SetupWizard.
 *  Op telefoon: slide-up van onderaan met pull-handle.
 *  Op desktop: gecentreerde overlay met max-width.
 *  De wizard zelf blijft volledig functioneel; deze wrapper voegt alleen
 *  een sluit-knop + dismiss-handling toe. */
export default function SetupWizardSheet({ open, onClose, zClass = 'z-50' }) {
  if (!open) return null;

  const handleClose = () => {
    onClose?.();
  };

  // Sluit via overlay-klik op desktop, maar NIET op mobiel (sheets sluit
  // je daar via de X-knop of pull-down — voorkomt per-ongeluk weg-tikken).
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && window.innerWidth >= 768) {
      handleClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 ${zClass} bg-[#0B1B3F]/55 backdrop-blur-md flex items-end md:items-center justify-center md:p-6 modal-open`}
      data-testid="setup-wizard-sheet"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-[#F7F8FA] w-full md:max-w-7xl rounded-t-3xl md:rounded-3xl shadow-[0_24px_80px_-20px_rgba(11,27,63,0.5)] pt-3 pb-4 px-0 md:p-0 animate-slide-up-sheet md:animate-slide-up max-h-[96dvh] md:max-h-[92dvh] overflow-hidden flex flex-col"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pull-handle (mobiel) */}
        <div className="md:hidden flex justify-center pb-2 shrink-0">
          <span className="w-10 h-1.5 rounded-full bg-[#FF8A3D]" />
        </div>

        {/* Sticky header met close-knop */}
        <div className="flex items-center justify-between px-5 md:px-7 py-3 md:py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF8A3D] to-[#E05200] flex items-center justify-center text-white shadow-sm shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-black text-[#C74600]">SuriRent · Kiosk Beheer</p>
              <h2 className="text-base md:text-lg font-black text-[#0B1B3F] leading-tight">
                Setupwizard
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            data-testid="setup-wizard-sheet-close"
            className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-orange-100 hover:text-[#C74600] text-slate-600 flex items-center justify-center transition shrink-0"
            aria-label="Sluiten"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable wizard inhoud */}
        <div className="flex-1 overflow-y-auto px-3 md:px-7 py-4 md:py-6">
          <SetupWizard onFinish={handleClose} />
        </div>

        {/* Footer-knop "Later voltooien" (alleen mobiel — desktop heeft X) */}
        <div className="md:hidden border-t border-slate-200 bg-white px-5 pt-3 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            data-testid="setup-wizard-sheet-later"
            className="w-full h-11 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-orange-50 hover:text-[#C74600] transition"
          >
            Later voltooien
          </button>
        </div>
      </div>
    </div>
  );
}
