// Directe links uit meldingen: /admin/<tab>?open=<type>:<id>
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useDeepLink(type, onOpen) {
  const location = useLocation();
  const navigate = useNavigate();
  const ref = useRef(onOpen);
  ref.current = onOpen;
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const [t, id] = (p.get('open') || '').split(':');
    if (t !== type || !id) return;
    ref.current(id, p);
    p.delete('open'); p.delete('tenant');
    const qs = p.toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true });
  }, [location.search, location.pathname, type, navigate]);
}

// Highlight + scroll naar een element (wacht tot het gerenderd is).
export function flashElement(selector, tries = 20) {
  const el = document.querySelector(selector);
  if (!el) { if (tries > 0) setTimeout(() => flashElement(selector, tries - 1), 250); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-4', 'ring-amber-400', 'ring-offset-2');
  setTimeout(() => el.classList.remove('ring-4', 'ring-amber-400', 'ring-offset-2'), 2600);
}
