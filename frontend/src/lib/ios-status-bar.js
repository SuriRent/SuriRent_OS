// iOS-PWA statusbalk: met status-bar-style "default" volgt iOS de theme-color.
// Alleen op iOS aanpassen (op Android gaf per-route theme-color flikkering).
const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

export function setIosStatusBar(color) {
  if (!isIOS) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}
