import { X, Sparkles } from 'lucide-react';
import SetupWizard from './SetupWizard';

/** Full-screen wrapper around the setup wizard. */
export default function SetupWizardSheet({ open, onClose, zClass = 'z-50' }) {
  if (!open) return null;

  const handleClose = () => {
    onClose?.();
  };

  return (
    <div
      className={`fixed inset-0 ${zClass} h-[100dvh] w-full overflow-hidden bg-[#F7F8FA] modal-open`}
      data-testid="setup-wizard-sheet"
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
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

        <div className="min-h-0 flex-1 overflow-y-auto px-3 md:px-7 py-4 md:py-6">
          <SetupWizard onFinish={handleClose} />
        </div>
      </div>
    </div>
  );
}
