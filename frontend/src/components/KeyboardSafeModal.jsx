import { createContext, useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useVisualViewportPosition from '../lib/use-visual-viewport-position';
import { setIosStatusBar } from '../lib/ios-status-bar';

/**
 * KeyboardSafeModal
 * =================
 * Universele modal wrapper voor het virtuele toetsenbord op iOS en Android.
 * De backing blijft vast staan; alleen de sheet volgt de zichtbare viewport.
 *
 * Werking:
 *  - Modal wordt via React Portal in `document.body` gerenderd.
 *  - Op mobiel blijft een vaste, ondoorzichtige backing achter het
 *    doorschijnende iOS-toetsenbord; alleen het formulier volgt de viewport.
 *  - De sheet volgt visualViewport direct via DOM-styles, zonder React-renders
 *    tijdens de toetsenbordanimatie.
 *  - Body scroll-lock voorkomt dat de onderliggende pagina meescrollt.
 *  - Op desktop (>= sm breakpoint): gecentreerde card met max-width en
 *    max-height 90vh boven een halfdoorzichtige donkere backdrop.
 */
// Binnen een host (bv. kiosk-popup) opent het venster ín die popup i.p.v. over het hele scherm.
export const ModalHostContext = createContext(null);

export default function KeyboardSafeModal({ onClose, testId, children, className = '', maxWidthClass = 'sm:max-w-md' }) {
  const host = useContext(ModalHostContext);
  const kioskForm = Boolean(host || (typeof document !== 'undefined' && (
    document.body.classList.contains('kiosk-mode')
    || document.body.classList.contains('kiosk-admin-active')
    || document.body.classList.contains('kiosk-popup-active')
  )));
  const sheetRef = useRef(null);
  useVisualViewportPosition(sheetRef);
  const bodyStyleRef = useRef({});

  // Body scroll-lock — voorkomt scrollen van de underlying page.
  // NB: theme-color wordt NIET meer per-modal overschreven — dat gaf
  // flikker op Android. De centrale waarde (#FFFFFF) uit index.html
  // blijft dus consistent.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    bodyStyleRef.current = {
      overflow: body.style.overflow,
      bodyBg: body.style.backgroundColor,
      htmlBg: html.style.backgroundColor,
    };

    body.style.overflow = 'hidden';
    body.style.backgroundColor = '#ffffff';
    html.style.backgroundColor = '#ffffff';
    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => [m, m.getAttribute('content')]);
    setIosStatusBar('#FFFFFF');

    return () => {
      const s = bodyStyleRef.current;
      body.style.overflow = s.overflow;
      body.style.backgroundColor = s.bodyBg;
      html.style.backgroundColor = s.htmlBg;
      metas.forEach(([m, c]) => m.setAttribute('content', c));
    };
  }, []);

  if (host) {
    return createPortal((
      <div className={`ksm-root ${kioskForm ? 'kiosk-form' : ''} absolute inset-0 z-[60] bg-white flex flex-col overflow-hidden ${className}`} data-testid={testId || 'ksm-modal'}>
        {children}
      </div>
    ), host);
  }
  return createPortal((
    <div
      className={`ksm-root ${kioskForm ? 'kiosk-form' : ''} keyboard-opaque-backdrop fixed inset-0 z-[9999] overflow-hidden bg-white sm:bg-slate-900/40 sm:backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4 ${className}`}
      onClick={onClose}
      data-testid={testId || 'ksm-modal'}>
      <div
      ref={sheetRef}
      className={`absolute inset-x-0 top-0 h-full bg-white sm:static sm:inset-auto sm:w-full ${maxWidthClass} sm:rounded-3xl sm:shadow-2xl flex flex-col overflow-hidden sm:h-auto sm:max-h-[90vh]`}
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
      className={`ksm-header shrink-0 px-5 sm:px-8 pb-4 border-b border-slate-100 bg-white ${className}`}
      style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}>
      {children}
    </div>
  );
};

/** Scrollbare body — enige gebied dat scrollt wanneer content langer is
 *  dan viewport (of wanneer toetsenbord opent). */
KeyboardSafeModal.Body = function KsmBody({ children, className = '' }) {
  return (
    <div className={`ksm-body flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-4 ${className}`}>
      {children}
    </div>
  );
};

/** Sticky footer — stays inside the visible, keyboard-resized sheet. */
KeyboardSafeModal.Footer = function KsmFooter({ children, className = '' }) {
  return (
    <div
      className={`ksm-footer shrink-0 border-t border-slate-100 bg-white px-5 sm:px-8 py-3 ${className}`}
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  );
};
