import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * KeyboardSafeModal
 * =================
 * Universele modal wrapper die correct omgaat met het virtuele toetsenbord
 * op iOS en Android. De modal blijft **op één plaats** — er wordt niets
 * verschoven, geen slide-animaties. Alleen de body scrollt indien nodig.
 *
 * Werking:
 *  - Modal wordt via React Portal in `document.body` gerenderd.
 *  - Op mobiel: outer wrapper = solid wit (geen dark overlay achter sheet)
 *    zodat er nooit een andere kleur zichtbaar is achter de footer.
 *  - Sheet-hoogte = `visualViewport.height`, positie = `visualViewport.offsetTop`.
 *    Krimpt automatisch mee als toetsenbord opent; header blijft bovenaan,
 *    footer blijft direct boven het toetsenbord.
 *  - Body scroll-lock via `position: fixed` op body → voorkomt underlying
 *    page scroll. `window.scrollTo(0,0)` blokkeert iOS auto-scroll-into-view.
 *  - Op desktop (>= sm breakpoint): gecentreerde card met max-width en
 *    max-height 90vh boven een halfdoorzichtige donkere backdrop.
 */
export default function KeyboardSafeModal({ onClose, testId, children, className = '', maxWidthClass = 'sm:max-w-md' }) {
  const [vh, setVh] = useState(() =>
    typeof window !== 'undefined' && window.visualViewport
      ? window.visualViewport.height
      : (typeof window !== 'undefined' ? window.innerHeight : 0),
  );
  const [vTop, setVTop] = useState(0);
  const [layoutH, setLayoutH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 0));
  const bodyStyleRef = useRef({});

  // Sync sheet-hoogte + top met visualViewport zodat modal automatisch mee
  // krimpt/verplaatst als toetsenbord opent of iOS pinch-zoomt.
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      setVh(vv.height);
      setVTop(vv.offsetTop || 0);
      setLayoutH(window.innerHeight);
      // Reset window scroll — voorkomt dat iOS de layout viewport omhoog schuift.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  // Body scroll-lock — voorkomt scrollen van de underlying page.
  // NB: theme-color wordt NIET meer per-modal overschreven — dat gaf
  // flikker op Android. De centrale waarde (#FFFFFF) uit index.html
  // blijft dus consistent.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    bodyStyleRef.current = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      bodyBg: body.style.backgroundColor,
      htmlBg: html.style.backgroundColor,
    };

    const y = window.scrollY;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    body.style.backgroundColor = '#ffffff';
    html.style.backgroundColor = '#ffffff';

    return () => {
      const s = bodyStyleRef.current;
      body.style.overflow = s.overflow;
      body.style.position = s.position;
      body.style.top = s.top;
      body.style.width = s.width;
      body.style.backgroundColor = s.bodyBg;
      html.style.backgroundColor = s.htmlBg;
      window.scrollTo(0, y);
    };
  }, []);

  return createPortal((
    <div
      className={`fixed inset-0 z-[9999] bg-white sm:bg-slate-900/40 sm:backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4 ${className}`}
      onClick={onClose}
      data-testid={testId || 'ksm-modal'}>
      <div
        className={`absolute left-0 right-0 sm:static sm:inset-auto bg-white sm:w-full ${maxWidthClass} sm:rounded-3xl sm:shadow-2xl flex flex-col overflow-hidden sm:h-auto sm:max-h-[90vh]`}
        style={{ top: `${vTop}px`, bottom: `${Math.max(0, layoutH - vTop - vh)}px` }}
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
 *  de visualViewport-gedreven hoogte van de sheet. */
KeyboardSafeModal.Footer = function KsmFooter({ children, className = '' }) {
  return (
    <div
      className={`shrink-0 border-t border-slate-100 bg-white px-6 sm:px-8 py-3 ${className}`}
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  );
};
