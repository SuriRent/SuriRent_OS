import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * KeyboardSafeModal
 * =================
 * Universele mobile-first modal wrapper die correct omgaat met het virtuele
 * toetsenbord op iOS en Android — zonder dat de content omhoog schuift.
 *
 * Werking:
 *  - Modal wordt via React Portal in document.body gerenderd zodat geen
 *    enkele parent CSS de positionering kan beïnvloeden.
 *  - Op mobiel: `position: fixed; top: 0; left: 0` en hoogte gelijk aan
 *    `window.visualViewport.height`. Wanneer het toetsenbord opent, wordt
 *    de hoogte direct aangepast → header blijft bovenaan, footer blijft
 *    boven het toetsenbord, body scrollt binnen de modal.
 *  - Op desktop (>= sm breakpoint): centered card met max-width en max-height.
 *  - Body-scroll wordt gelockt terwijl de modal open is en iOS
 *    "scroll-to-input" wordt geneutraliseerd via `visualViewport.scroll`.
 *
 * Gebruik:
 *   <KeyboardSafeModal onClose={close} testId="my-modal">
 *     <KeyboardSafeModal.Header>...</KeyboardSafeModal.Header>
 *     <KeyboardSafeModal.Body>...</KeyboardSafeModal.Body>
 *     <KeyboardSafeModal.Footer>...</KeyboardSafeModal.Footer>
 *   </KeyboardSafeModal>
 */
export default function KeyboardSafeModal({ onClose, testId, children, className = '', maxWidthClass = 'sm:max-w-md' }) {
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 0));
  const scrollLockRef = useRef({ overflow: '', position: '', top: '', width: '' });

  // Sync met visualViewport zodat modal-hoogte = zichtbaar deel van scherm
  // (viewport minus toetsenbord).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setVh(vv.height);
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  // Body-scroll lock — voorkomt dat iOS de hele pagina omhoog schuift wanneer
  // de gebruiker een input focust.
  useEffect(() => {
    const body = document.body;
    scrollLockRef.current = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    const scrollY = window.scrollY;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      const s = scrollLockRef.current;
      body.style.overflow = s.overflow;
      body.style.position = s.position;
      body.style.top = s.top;
      body.style.width = s.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return createPortal((
    <div
      className={`fixed inset-0 z-[9999] bg-black/40 sm:bg-slate-900/40 sm:backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4 ${className}`}
      style={{ width: '100vw' }}
      onClick={onClose}
      data-testid={testId || 'ksm-modal'}>
      <div
        className={`absolute top-0 left-0 right-0 sm:static sm:inset-auto bg-white sm:w-full ${maxWidthClass} sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden sm:h-auto sm:max-h-[90vh]`}
        style={{ height: vh ? `${vh}px` : '100vh' }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  ), document.body);
}

/** Sticky header — respecteert iOS safe-area-inset-top zodat titel niet
 *  onder de status bar valt. */
KeyboardSafeModal.Header = function KsmHeader({ children, className = '' }) {
  return (
    <div
      className={`shrink-0 px-6 sm:px-8 pb-3 bg-white ${className}`}
      style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}>
      {children}
    </div>
  );
};

/** Scrollbare body — enige gebied dat scrollt wanneer content langer is
 *  dan viewport (of wanneer toetsenbord opent). */
KeyboardSafeModal.Body = function KsmBody({ children, className = '' }) {
  return (
    <div className={`flex-1 overflow-y-auto px-6 sm:px-8 pb-3 ${className}`}>
      {children}
    </div>
  );
};

/** Sticky footer — blijft altijd zichtbaar boven het toetsenbord dankzij
 *  de dynamische viewport-hoogte van de wrapper. */
KeyboardSafeModal.Footer = function KsmFooter({ children, className = '' }) {
  return (
    <div
      className={`shrink-0 border-t border-slate-100 bg-white px-6 sm:px-8 py-3 ${className}`}
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  );
};
