import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * KeyboardSafeModal
 * =================
 * Universele mobile-first modal wrapper die correct omgaat met het virtuele
 * toetsenbord op iOS en Android — zonder dat de content omhoog schuift.
 *
 * Werking:
 *  - Modal wordt via React Portal in document.body gerenderd.
 *  - Op mobiel: full-screen sheet met `height: 100dvh` (dynamic viewport).
 *    Wanneer het toetsenbord opent, krimpt de dvh automatisch → header
 *    blijft bovenaan, footer blijft boven het toetsenbord, body scrollt.
 *  - iOS-specifiek: body scroll-lock + reset van elke `window.scrollTo`
 *    poging → voorkomt dat iOS Safari het layout-viewport verschuift.
 *  - Op desktop (>= sm breakpoint): centered card met max-width en max-height.
 *
 * Gebruik:
 *   <KeyboardSafeModal onClose={close} testId="my-modal">
 *     <KeyboardSafeModal.Header>...</KeyboardSafeModal.Header>
 *     <KeyboardSafeModal.Body>...</KeyboardSafeModal.Body>
 *     <KeyboardSafeModal.Footer>...</KeyboardSafeModal.Footer>
 *   </KeyboardSafeModal>
 */
export default function KeyboardSafeModal({ onClose, testId, children, className = '', maxWidthClass = 'sm:max-w-md' }) {
  const scrollLockRef = useRef({});

  // Body-scroll lock — voorkomt dat iOS de hele pagina scrollt wanneer een
  // input focust. Ook `overscroll-behavior` blokkeert scroll-chaining.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    scrollLockRef.current = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
    };
    const scrollY = window.scrollY;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';

    // iOS Safari kan alsnog de visual viewport scrollen bij input-focus.
    // We forceren window.scrollTo(0,0) telkens iOS iets probeert.
    const vv = window.visualViewport;
    const restore = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    vv?.addEventListener('scroll', restore);

    return () => {
      const s = scrollLockRef.current;
      html.style.overflow = s.htmlOverflow;
      body.style.overflow = s.bodyOverflow;
      body.style.position = s.bodyPosition;
      body.style.top = s.bodyTop;
      body.style.width = s.bodyWidth;
      vv?.removeEventListener('scroll', restore);
      window.scrollTo(0, scrollY);
    };
  }, []);

  return createPortal((
    <div
      className={`ksm-root fixed inset-0 z-[9999] bg-black/50 sm:bg-slate-900/40 sm:backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4 ${className}`}
      onClick={onClose}
      data-testid={testId || 'ksm-modal'}>
      <div
        className={`ksm-sheet absolute inset-0 sm:static sm:inset-auto bg-white sm:w-full ${maxWidthClass} sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden sm:h-auto sm:max-h-[90vh]`}
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
    <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 sm:px-8 pb-3 ${className}`}>
      {children}
    </div>
  );
};

/** Sticky footer — blijft altijd zichtbaar boven het toetsenbord dankzij
 *  de dynamische viewport-hoogte van de sheet. */
KeyboardSafeModal.Footer = function KsmFooter({ children, className = '' }) {
  return (
    <div
      className={`shrink-0 border-t border-slate-100 bg-white px-6 sm:px-8 py-3 ${className}`}
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  );
};
