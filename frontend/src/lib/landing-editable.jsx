// Inline editing primitives voor de Landing Page.
//
// • `useLandingContent()`        — fetch published content + defaults uit /api/landing/content
// • `<EditableProvider>`         — provides edit state (off/draft/publish) + collected patches
// • `<EditableText path=…>`      — toont tekst, in editMode contenteditable + autosave via postMessage
// • `<EditableImage path=…>`     — toont <img>, in editMode klikbaar voor uploaden
// • PostMessage protocol:        { type: 'landing-edit-patch', path, value }
//
// De landing page draait in een iframe binnen LiveLandingEditor; parent collect
// patches en POST't ze in batch naar /api/superadmin/landing/content (draft).
// `?edit=1` query param activeert edit mode; ouder dan dat checkt de iframe NIET
// of er een superadmin-token is — de backend is de echte gatekeeper.

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';

const EditableContext = createContext({
  editMode: false,
  content: {},
  setContent: () => {},
  patch: () => {},
});

export function useEditable() {
  return useContext(EditableContext);
}

/** Dot-path getter: getPath({a:{b:1}}, 'a.b') === 1 */
export function getPath(obj, path, fallback) {
  if (!path) return fallback;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return fallback;
    // numerieke indices voor lists ondersteunen
    cur = Array.isArray(cur) ? cur[Number(p)] : cur[p];
  }
  return cur == null ? fallback : cur;
}

/** Dot-path setter (immutable): produceert nieuw object. */
export function setPath(obj, path, value) {
  if (!path) return obj;
  const parts = path.split('.');
  const out = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cur[k];
    const isArr = Array.isArray(next);
    cur[k] = isArr ? [...next] : { ...(next || {}) };
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return out;
}

/**
 * EditableProvider — beheert content + edit mode.
 *
 * Props:
 *  - editMode (bool): toggle inline edit UI
 *  - initialContent (obj): initial state (vaak van /api/landing/content)
 *  - onPatch (fn): callback ({path, value}) na elke wijziging (gebruikt voor postMessage naar parent)
 */
export function EditableProvider({ editMode, initialContent, onPatch, children }) {
  const [content, setContent] = useState(initialContent || {});

  // Sync wanneer parent een ander content-object binnenstuurt (bv. na publish).
  useEffect(() => {
    if (initialContent) setContent(initialContent);
  }, [initialContent]);

  // Luister naar parent → child reset-events (parent stuurt nieuwe state na publish/discard).
  useEffect(() => {
    if (!editMode) return undefined;
    const handler = (ev) => {
      const data = ev?.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'landing-edit-reset' && data.content) {
        setContent(data.content);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [editMode]);

  const patch = useCallback((path, value) => {
    setContent((prev) => setPath(prev, path, value));
    if (typeof onPatch === 'function') onPatch({ path, value });
  }, [onPatch]);

  const ctx = { editMode, content, setContent, patch };
  return <EditableContext.Provider value={ctx}>{children}</EditableContext.Provider>;
}

/**
 * EditableText — toont een tekst die in editMode contenteditable wordt.
 * - `path` is dot-notatie naar de waarde in content
 * - `fallback` is de hardcoded standaardtekst (gebruikt als content[path] leeg is)
 * - `as` is de HTML tag (default 'span')
 * - `multiline` staat enter toe en bewaart als één string
 */
export function EditableText({ path, fallback, as: Tag = 'span', multiline = false, className = '', placeholder = '', ...rest }) {
  const { editMode, content, patch } = useEditable();
  const ref = useRef(null);
  const value = getPath(content, path, fallback) ?? '';

  // Sync DOM bij externe state-wijzigingen (anders herschrijft React de cursor mid-typing weg).
  // Daarom dompelen we onze update via blur — niet via key per key — en gebruiken `defaultValue`-pattern.
  useEffect(() => {
    if (!editMode || !ref.current) return;
    if (ref.current.innerText !== String(value)) {
      ref.current.innerText = String(value);
    }
  }, [editMode, value]);

  if (!editMode) {
    return <Tag className={className} {...rest}>{value}</Tag>;
  }

  const onBlur = () => {
    const nv = ref.current?.innerText ?? '';
    if (nv !== String(value)) {
      patch(path, nv);
    }
  };
  const onKeyDown = (e) => {
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      ref.current?.blur();
    }
  };

  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      data-edit-path={path}
      data-edit-placeholder={placeholder}
      className={`${className} outline outline-2 outline-dashed outline-orange-300/0 hover:outline-orange-400 focus:outline-orange-500 focus:outline-solid rounded transition-[outline-color] cursor-text`}
      {...rest}
    />
  );
}

/**
 * EditableImage — bestaand <img> dat in editMode een upload-overlay toont.
 *
 * Vereenvoudigde versie: bij klik in editMode triggeren we een postMessage
 * naar de parent. De parent toont de Asset Library / file picker en stuurt
 * het resultaat (URL) terug via `landing-edit-image-reply`.
 */
export function EditableImage({ path, fallback, alt = '', className = '', ...imgProps }) {
  const { editMode, content, patch } = useEditable();
  const src = getPath(content, path, fallback);

  useEffect(() => {
    if (!editMode) return undefined;
    const handler = (ev) => {
      const data = ev?.data;
      if (!data || data.type !== 'landing-edit-image-reply') return;
      if (data.path === path && data.url) {
        patch(path, data.url);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [editMode, path, patch]);

  const requestUpload = () => {
    try {
      window.parent?.postMessage({ type: 'landing-edit-image-request', path, current: src }, '*');
    } catch { /* no-op */ }
  };

  if (!editMode) {
    return <img src={src} alt={alt} className={className} {...imgProps} />;
  }

  return (
    <button type="button" onClick={requestUpload}
      className="relative inline-block group cursor-pointer"
      data-edit-path={path}
      title="Klik om afbeelding te wijzigen">
      <img src={src} alt={alt} className={className} {...imgProps} />
      <span className="absolute inset-0 bg-orange-500/0 group-hover:bg-orange-500/30 transition-colors flex items-center justify-center">
        <span className="opacity-0 group-hover:opacity-100 bg-white/90 backdrop-blur-sm text-xs font-extrabold text-orange-700 px-3 py-1.5 rounded-md transition-opacity">
          Wijzig afbeelding
        </span>
      </span>
    </button>
  );
}

/**
 * useLandingContent — fetch published content + defaults.
 * Voor de PUBLIC landing page. Voor edit-mode binnen iframe gebruiken we
 * `/superadmin/landing/content?mode=draft` (zie LiveLandingEditor).
 *
 * Stale-while-revalidate: leest eerst de laatst gecachede content uit
 * localStorage (synchronously → géén flicker bij herhaalbezoek), zet die
 * meteen als initial state, en revalidate in de achtergrond. Als het
 * netwerk-antwoord identiek is aan de cache doen we GEEN setState,
 * waardoor React niet re-rendert en de fade-in animaties niet opnieuw
 * afspelen. Bij afwijking wordt cache overschreven.
 */
const LANDING_CACHE_KEY = 'sr_landing_content_v2';
// TTL: cache ouder dan 10 min wordt als "stale" beschouwd. Dan gebruiken
// we hem NIET meer als initial state (voorkomt "oude tekst → juiste tekst"
// flicker) — we tonen daarvoor in de plaats een subtiele skeleton totdat
// de fresh API-response binnen is. Zo weinig mogelijk flash.
const LANDING_CACHE_TTL_MS = 10 * 60 * 1000;

function readLandingCache(editMode) {
  // Edit-mode = draft, nooit cachen (superadmin wil altijd de laatste versie)
  if (editMode) return null;
  // 1) BUILD-TIME INLINE — bij `yarn build` injecteert
  //    scripts/inline-landing-content.js de gepubliceerde content in
  //    `build/index.html` als `window.__LANDING_CONTENT__`. Als die
  //    aanwezig is dan is dit de "server-side rendered" versie: geen
  //    API round-trip nodig en geen flicker op eerste bezoek ooit.
  try {
    if (typeof window !== 'undefined' && window.__LANDING_CONTENT__) {
      return window.__LANDING_CONTENT__;
    }
  } catch { /* noop */ }
  // 2) RUNTIME CACHE — vorig bezoek heeft content bewaard, MET TTL check.
  try {
    const raw = localStorage.getItem(LANDING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed._ts || (Date.now() - parsed._ts) > LANDING_CACHE_TTL_MS) return null;
    return parsed.content || null;
  } catch { return null; }
}

function writeLandingCache(content) {
  try {
    localStorage.setItem(LANDING_CACHE_KEY, JSON.stringify({
      _ts: Date.now(),
      content: content || {},
    }));
  } catch { /* quota / private mode — negeren */ }
}

export function useLandingContent(editMode = false) {
  // Init state direct met cache zodat de eerste render al de "juiste"
  // content laat zien i.p.v. hardcoded fallbacks (voorkomt de flicker
  // van fallback → server-content).
  const initial = useMemo(() => readLandingCache(editMode), [editMode]);
  const [content, setContent] = useState(() => initial);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  // `hasInstantContent` = true wanneer we bij mount al content hadden
  // (inline injectie of verse localStorage cache < TTL). Zo weet de
  // consumer of hij direct kan renderen of eerst een skeleton moet tonen.
  const hasInstantContent = !!initial;

  useEffect(() => {
    let abort = false;
    const load = async () => {
      try {
        const backend = process.env.REACT_APP_BACKEND_URL || '';
        // In edit-mode laden we draft (superadmin auth nodig via cookie/token in api lib).
        const url = editMode
          ? `${backend}/api/superadmin/landing/content?mode=draft`
          : `${backend}/api/landing/content`;
        const init = editMode
          ? { credentials: 'include', headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` } }
          : {};
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (abort) return;
        const next = data.content || {};
        // Skip setState wanneer server-content exact gelijk is aan de
        // huidige (uit cache geladen) state — dit voorkomt re-render en
        // flicker bij herhaalbezoek zonder wijzigingen.
        setContent((prev) => {
          try {
            if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev;
          } catch { /* fall through — vervang */ }
          return next;
        });
        if (!editMode) writeLandingCache(next);
      } catch (e) {
        if (!abort) setErr(e);
      } finally {
        if (!abort) setLoading(false);
      }
    };
    load();
    return () => { abort = true; };
  }, [editMode]);

  return { content, loading, err, hasInstantContent };
}
