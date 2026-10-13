import { memo, useEffect, useSyncExternalStore } from 'react';
import { subscribeKioskLive, getKioskLiveState, startKioskLive, stopKioskLive, setKioskOverlayOpen } from '../lib/kiosk-live';
import { KioskPrintsOverlay } from './KioskPrintsOverlay';
import { useApprovalNotifySync } from '../lib/approval-notify-sync';

// Statusbolletje (alleen beheerder-kiosk) + bonnen-venster. Rendert los van
// de rest van de kiosk via een externe store.
function KioskLiveStatusInner({ isAdmin }) {
  useEffect(() => {
    startKioskLive(isAdmin ? 'admin' : 'employee');
    return () => stopKioskLive();
  }, [isAdmin]);
  const s = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  useApprovalNotifySync({ enabled: isAdmin });

  if (!isAdmin) return null;
  const label = s.active ? `${s.count} kiosk-medewerker${s.count === 1 ? '' : 's'} actief` : 'Geen kiosk-medewerker actief';
  return (
    <>
      <button type="button" onClick={() => setKioskOverlayOpen(true)} title={label} aria-label={label}
        data-testid="kiosk-presence-dot" data-active={s.active ? 'true' : 'false'}
        className="fixed z-40 p-1.5" style={{ top: 'env(safe-area-inset-top, 0px)', right: 0 }}>
        <span className={`block w-3 h-3 rounded-full ring-2 ring-white/80 transition-colors duration-300 ${s.active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]' : 'bg-slate-400'}`} />
      </button>
      {s.overlayOpen && (
        <KioskPrintsOverlay employees={s.employees} printsVersion={s.printsVersion} onClose={() => setKioskOverlayOpen(false)} />
      )}
    </>
  );
}

export const KioskLiveStatus = memo(KioskLiveStatusInner);
