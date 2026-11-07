// iOS-PWA statusbalk: met status-bar-style "default" volgt iOS de theme-color.
// Alleen op iOS aanpassen (op Android gaf per-route theme-color flikkering).
import { useEffect } from 'react';

const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

export function setIosStatusBar(color) {
  if (!isIOS) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}

// Schermvullende witte popups: html/body-achtergrond en statusbalk tijdelijk wit,
// anders schemert de oranje pagina erachter door als waas onder de iPhone-klok.
let whiteDepth = 0;
let savedWhite = null;

export function useWhitePageBehindModal(maxWidth = 767) {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia(`(max-width: ${maxWidth}px)`).matches) return undefined;
    const html = document.documentElement;
    const body = document.body;
    if (whiteDepth === 0) {
      savedWhite = {
        htmlBg: html.style.backgroundColor,
        bodyBg: body.style.backgroundColor,
        metas: Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => [m, m.getAttribute('content')]),
      };
      html.style.backgroundColor = '#FFFFFF';
      body.style.backgroundColor = '#FFFFFF';
      setIosStatusBar('#FFFFFF');
    }
    whiteDepth += 1;
    return () => {
      whiteDepth -= 1;
      if (whiteDepth === 0 && savedWhite) {
        html.style.backgroundColor = savedWhite.htmlBg;
        body.style.backgroundColor = savedWhite.bodyBg;
        if (isIOS) savedWhite.metas.forEach(([m, c]) => m.setAttribute('content', c));
        savedWhite = null;
      }
    };
  }, [maxWidth]);
}
