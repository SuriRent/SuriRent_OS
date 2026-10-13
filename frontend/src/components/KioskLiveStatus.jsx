import { memo, useEffect, useSyncExternalStore } from 'react';
import { Printer, X } from 'lucide-react';
import { subscribeKioskLive, getKioskLiveState, startKioskLive, stopKioskLive, clearKioskLiveToast } from '../lib/kiosk-live';
import { printReceipt } from '../lib/kiosk-print';
import { api } from '../lib/api';

// Statusbolletje (alleen beheerder-kiosk) + korte print-melding. Rendert los
// van de rest van de kiosk via een externe store.
function KioskLiveStatusInner({ isAdmin }) {
  useEffect(() => {
    startKioskLive(isAdmin ? 'admin' : 'employee');
    return () => stopKioskLive();
  }, [isAdmin]);
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);

  useEffect(() => {
    if (!s.toast) return undefined;
    const t = setTimeout(clearKioskLiveToast, 8000);
    return () => clearTimeout(t);
  }, [s.toast]);

  if (!isAdmin) return null;
  const label = s.active ? `${s.count} kiosk-medewerker${s.count === 1 ? '' : 's'} actief` : 'Geen kiosk-medewerker actief';
  return (
    <>
      <div className="fixed z-40 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 6px)', right: 6 }}>
        <span title={label} aria-label={label} data-testid="kiosk-presence-dot" data-active={s.active ? 'true' : 'false'}
          className={`block w-3 h-3 rounded-full ring-2 ring-white/80 transition-colors duration-300 ${s.active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]' : 'bg-slate-400'}`} />
      </div>
      {s.toast && (
        <div data-testid="kiosk-print-toast" className="fixed z-40 right-3 bg-white rounded-xl shadow-2xl px-3 py-2 flex items-center gap-3 text-sm"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 30px)' }}>
          <Printer className="w-4 h-4 text-[#FF5C00]" />
          <span className="font-semibold text-slate-800">
            {s.toast.ids.length > 1 ? `${s.toast.ids.length} bonnen` : 'Bon'} afgedrukt{s.toast.who ? ` door ${s.toast.who}` : ''}
          </span>
          <button data-testid="kiosk-print-toast-print" onClick={() => s.toast.ids.forEach((id) => printReceipt({ paymentId: id, apiGet: api.get, relay: false }))}
            className="h-8 px-3 rounded-lg bg-[#FF5C00] text-white font-bold text-xs">Afdrukken</button>
          <button data-testid="kiosk-print-toast-close" onClick={clearKioskLiveToast} className="text-slate-400"><X className="w-4 h-4" /></button>
        </div>
      )}
    </>
  );
}

export const KioskLiveStatus = memo(KioskLiveStatusInner);
