import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBrandedNavigate } from '../../lib/branded-nav';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
  Building2, ArrowRight, ArrowLeft, Banknote, Receipt, LogOut, MapPin,
  Check, Loader2, Home, X, Wallet, FileText, Wifi, AlertCircle,
  Smartphone, QrCode, CreditCard, ShieldCheck, Clock as ClockIcon, Printer, Download,
  User, UserRound, Settings as SettingsIcon, Hash, CheckCircle, Calendar,
  MessageCircle, StickyNote, Trash2, Plus, Mic, ChevronLeft, ChevronRight,
  UserPlus, Wrench, Camera,
} from 'lucide-react';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../lib/api';
import { playSuccessPing, playErrorBuzz } from '../../lib/tap-sounds';
import {
  getKioskEmployee, withKioskEmployee,
} from '../../components/KioskEmployee';
import NumPad from '../../components/NumPad';
import { useHidePwaSplash } from '../../lib/use-hide-pwa-splash';
import { printReceipt, openReceiptImage } from '../../lib/kiosk-print';

// Hook: tracked `visualViewport` (iOS/Android). Retourneert de huidige
// hoogte + offsetTop van de VISUELE viewport (het gebied dat niet door
// het toetsenbord wordt bedekt). Modals die deze waardes als `top` +
// `height` gebruiken krimpen automatisch mee met een openend keyboard
// zonder dat iOS de hele pagina omhoog scrollt om de focus-input in
// zicht te brengen.
function useVisualViewport() {
  const [vv, setVV] = useState(() => ({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    top: 0,
    layoutH: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  useEffect(() => {
    const vp = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vp) return undefined;
    const update = () => {
      setVV({ height: vp.height, top: vp.offsetTop || 0, layoutH: window.innerHeight });
      // Reset window-scroll → voorkomt dat iOS de layout viewport omhoog
      // scrollt om een focus-input onder het toetsenbord te onthullen.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    vp.addEventListener('resize', update);
    vp.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vp.removeEventListener('resize', update);
      vp.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return vv;
}


const variants = {
  enter: { opacity: 0, x: 60 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -60 },
};

function getKioskCompany() {
  try {
    const raw = localStorage.getItem('kiosk_company');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Sort apartments by alphabetic prefix + numeric suffix ("A1" < "A2" < "HUIS 7A")
function sortApartments(a, b) {
  const numA = (a.number || '').replace(/[^0-9]/g, '');
  const numB = (b.number || '').replace(/[^0-9]/g, '');
  const prefA = (a.number || '').replace(/[0-9]/g, '');
  const prefB = (b.number || '').replace(/[0-9]/g, '');
  if (prefA !== prefB) return prefA.localeCompare(prefB);
  return (parseInt(numA) || 0) - (parseInt(numB) || 0);
}

// =====================================================================
// Mobiele Kiosk knoppen — 1 rij bovenaan (zoals in ontwerp).
//   Uit · Kasgeld · Beheerder (3 gelijke pills, Kasgeld wit accent)
// De "Nieuwe huurder" en "Nieuw appartement" acties staan op mobiel
// op een floating + menubalk onderaan (`MobileAddFab`), niet meer hier.
// =====================================================================
function MobileHeaderButtons({ onAdmin, onExit, onKasgeld }) {
  const pill =
    'h-12 rounded-full font-bold text-sm inline-flex items-center justify-center gap-2 active:scale-95 transition shadow-sm';
  return (
    <div className="md:hidden px-3 pt-2"
      data-testid="kiosk-mobile-top-buttons">
      <div className="grid grid-cols-3 gap-2">
        {onExit ? (
          <button onClick={onExit} data-testid="kiosk-lock-btn"
            className={`${pill} bg-white/15 text-white backdrop-blur-sm`}>
            <LogOut className="w-4 h-4" /> Uit
          </button>
        ) : <span />}
        {onKasgeld ? (
          <button onClick={onKasgeld} data-testid="kiosk-kasgeld-btn"
            className={`${pill} bg-white text-orange-600`}>
            <Wallet className="w-4 h-4" /> Kasgeld
          </button>
        ) : <span />}
        {onAdmin ? (
          <button onClick={onAdmin} data-testid="kiosk-admin-btn"
            className={`${pill} bg-white/15 text-white backdrop-blur-sm`}>
            <SettingsIcon className="w-4 h-4" /> Beheerder
          </button>
        ) : <span />}
      </div>
    </div>
  );
}

// =====================================================================
// Mobiele "+" FAB — vaste witte menubalk aan de onderkant van het scherm.
// De hele balk is één grote button — klikken op de + of ergens op de balk
// opent het "Snel toevoegen" menu.
//
// Positionering (permanent, per user-spec — GEEN uitzonderingen):
//   • position: fixed
//   • bottom: 0
//   • padding-bottom: env(safe-area-inset-bottom)   → iOS home-indicator
//   • z-[110]                                       → boven alle modals
//
// BEWUST GEEN:
//   • position: absolute
//   • vh / dvh-berekeningen
//   • visualViewport translate-hacks (die veroorzaakten op iPhone PWA
//     juist een oranje strook onder de balk omdat `window.innerHeight`
//     op iOS PWA vaak > `visualViewport.height` is → drift werd positief
//     → FAB werd omhoog geschoven → body.kiosk-mode oranje bg kwam
//     eronder tevoorschijn).
//
// createPortal(document.body) zodat de fixed positioning t.o.v. de layout
// viewport werkt en niet t.o.v. .kiosk-fullscreen (dat op iOS PWA een
// eigen stacking/containing block creëert).
// =====================================================================
function MobileAddFab({ onOpen }) {
  return createPortal((
    <div className="md:hidden fixed inset-x-0 bottom-0 z-[110] bg-white shadow-[0_-6px_24px_rgba(0,0,0,0.12)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      data-testid="kiosk-fab-bar">
      <button onClick={onOpen} type="button"
        data-testid="kiosk-fab-plus"
        aria-label="Menu — Snel toevoegen"
        className="w-full h-6 relative bg-transparent active:bg-slate-50 transition">
        {/* Oranje + knop (visueel, niet klikbaar zelf — hele balk vangt de tap) */}
        <span className="absolute left-1/2 -translate-x-1/2 -top-4 w-11 h-11 rounded-full bg-orange-500 text-white shadow-2xl flex items-center justify-center pointer-events-none">
          <Plus className="w-5 h-5" strokeWidth={3} />
        </span>
      </button>
    </div>
  ), document.body);
}

// =====================================================================
// Apartment select (with optional inline location picker when ≥2 locations)
// =====================================================================
function ApartmentSelect({ onSelect, onAdmin, onExit, onKasgeld }) {
  const navigate = useBrandedNavigate();
  const [apartments, setApartments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/kiosk/apartments'),
      api.get('/kiosk/locations'),
    ]).then(([aRes, lRes]) => {
      setApartments(aRes.data);
      setLocations((lRes.data || []).filter((l) => l.id !== '_none'));
    }).catch((e) => {
      // 401 = token ongeldig / verlopen → wis token en stuur terug naar
      // PIN-login. Voorheen bleef de melding "Ongeldig kiosk token" inline
      // staan en kon de gebruiker niet verder.
      const status = e?.response?.status;
      if (status === 401) {
        try {
          localStorage.removeItem('kiosk_token');
          localStorage.removeItem('kiosk_company');
        } catch { /* noop */ }
        navigate('/login?target=kiosk', { replace: true });
        return;
      }
      setError(formatError(e));
    }).finally(() => setLoading(false));
  }, [navigate]);

  const unassignedCount = useMemo(
    () => apartments.filter((a) => !a.location_id && a.status === 'occupied').length,
    [apartments]
  );
  const totalGroups = locations.length + (unassignedCount > 0 ? 1 : 0);
  const showLocationPicker = totalGroups > 1 && selectedLocationId === null;

  // Auto-skip when there's only one (or zero) groups.
  useEffect(() => {
    if (loading || selectedLocationId !== null) return;
    if (totalGroups <= 1) {
      setSelectedLocationId(locations[0]?.id || '__any__');
    }
  }, [loading, selectedLocationId, totalGroups, locations]);

  if (loading) {
    return (
      <div className="h-full bg-orange-500 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  const currentLocation = selectedLocationId === '__none__'
    ? { name: 'Overige' }
    : selectedLocationId === '__any__'
      ? null
      : locations.find((l) => l.id === selectedLocationId);

  const visible = (showLocationPicker ? [] :
    selectedLocationId === '__none__' ? apartments.filter((a) => !a.location_id) :
    selectedLocationId === '__any__' ? apartments :
    apartments.filter((a) => a.location_id === selectedLocationId)
  ).filter((a) => a.status === 'occupied' && a.tenant_id).sort(sortApartments);

  // ----- Location picker view -----
  if (showLocationPicker) {
    return (
      <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '0 1.5vw 0' }}>
        {/* Mobile: knoppen bovenaan in 1 rij (matcht ontwerp) */}
        <MobileHeaderButtons onAdmin={onAdmin} onExit={onExit} onKasgeld={onKasgeld} />
        {/* Mobile: kleine titel links, onder de knoppen */}
        <div className="md:hidden px-4 pt-3 pb-1">
          <span className="text-2xl font-black text-white tracking-tight">Kies een locatie</span>
        </div>
        {/* Desktop: gecentreerde titel-header */}
        <div className="hidden md:flex items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2" style={{ minHeight: '7vh' }}>
          <div />
          <span className="text-sm sm:text-base font-semibold text-white">Kies een locatie</span>
          <div className="w-16" />
        </div>
        <div className="flex-1 min-h-0 overflow-auto pb-32 md:pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 px-1 sm:px-2 max-w-5xl mx-auto pt-2">
            {locations.map((loc) => {
              const count = apartments.filter((a) => a.location_id === loc.id && a.status === 'occupied').length;
              return (
                <button key={loc.id} onClick={() => setSelectedLocationId(loc.id)}
                  data-testid={`location-${loc.id}`}
                  className="bg-white/90 backdrop-blur-sm flex flex-col items-center text-center rounded-2xl p-6 sm:p-8 hover:-translate-y-1 hover:bg-white transition shadow-lg border-2 border-transparent hover:border-orange-500">
                  {loc.photo_url ? (
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden mb-3 bg-slate-100">
                      <img loading="lazy" src={loc.photo_url} alt={loc.name} className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    </div>
                  ) : (
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-3">
                      <MapPin className="w-7 h-7 sm:w-8 sm:h-8 text-orange-600" />
                    </div>
                  )}
                  <span className="text-lg sm:text-xl font-extrabold text-slate-900 mb-1">{loc.name}</span>
                  {loc.address && <span className="text-xs text-slate-500 mb-2">{loc.address}</span>}
                  <span className="text-xs font-bold text-orange-600 bg-orange-50 rounded-full px-3 py-1">
                    {count} {count === 1 ? 'appartement' : 'appartementen'}
                  </span>
                </button>
              );
            })}
            {unassignedCount > 0 && (
              <button onClick={() => setSelectedLocationId('__none__')}
                data-testid="location-unassigned"
                className="bg-white/80 backdrop-blur-sm flex flex-col items-center text-center rounded-2xl p-6 sm:p-8 hover:-translate-y-1 hover:bg-white transition shadow-lg border-2 border-dashed border-white/40">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                  <Building2 className="w-7 h-7 sm:w-8 sm:h-8 text-slate-500" />
                </div>
                <span className="text-lg sm:text-xl font-extrabold text-slate-700 mb-1">Overige</span>
                <span className="text-xs text-slate-500 mb-2">Zonder locatie</span>
                <span className="text-xs font-bold text-slate-600 bg-slate-50 rounded-full px-3 py-1">
                  {unassignedCount} {unassignedCount === 1 ? 'appartement' : 'appartementen'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ----- Apartment grid view -----
  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '0 1.5vw 0' }}>
      {/* Mobile: knoppen bovenaan in 1 rij */}
      <MobileHeaderButtons onAdmin={onAdmin} onExit={onExit} onKasgeld={onKasgeld} />
      {/* Mobile: kleine titel links, onder de knoppen */}
      <div className="md:hidden px-4 pt-3 pb-1 flex items-center gap-2">
        {totalGroups > 1 && (
          <button onClick={() => setSelectedLocationId(null)} data-testid="back-to-locations-mobile"
            className="flex items-center gap-1 text-white/90 font-bold bg-white/15 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs">
            <ArrowLeft className="w-3.5 h-3.5" /> Locaties
          </button>
        )}
        <span className="text-2xl font-black text-white tracking-tight">
          {currentLocation ? currentLocation.name : 'Kies uw appartement'}
        </span>
      </div>
      {/* Desktop: bestaande header met terug-knop + gecentreerde titel */}
      <div className="hidden md:flex items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2" style={{ minHeight: '7vh' }}>
        <div className="flex items-center gap-2">
          {totalGroups > 1 && (
            <button onClick={() => setSelectedLocationId(null)} data-testid="back-to-locations"
              className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> <span className="text-xs">Locaties</span>
            </button>
          )}
        </div>
        <span className="text-sm sm:text-base font-semibold text-white">
          {currentLocation ? `${currentLocation.name} · Kies uw appartement` : 'Kies uw appartement'}
        </span>
        <div className="w-16" />
      </div>

      {error && (
        <div className="bg-white/95 text-red-600 rounded-lg text-center text-sm font-semibold mx-1 mb-2 py-2 px-3">{error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-auto pb-32 md:pb-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3 px-1 sm:px-2">
          {visible.map((a) => {
            // Conditioneel: als beheerder `show_tenant_photo` heeft
            // aangezet EN er is een pasfoto (avatar of ID-kaart) EN het
            // appartement is bewoond, tonen we die i.p.v. het icoon.
            const photo = a.show_tenant_photo && a.tenant_id
              ? (a.tenant_avatar_url || a.tenant_id_photo_url)
              : null;
            const photoSrc = photo && !/^https?:/.test(photo)
              ? `${process.env.REACT_APP_BACKEND_URL}${photo}`
              : photo;
            return (
            <button key={a.id} onClick={() => onSelect(a)} data-testid={`apt-${a.number}`}
              className="group bg-white/85 backdrop-blur-sm flex flex-col items-center justify-center text-center rounded-xl sm:rounded-2xl p-3 sm:p-4 hover:-translate-y-1 hover:bg-white/95 transition border-2 border-transparent hover:border-orange-500 shadow"
              style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
              {photoSrc ? (
                <div className="rounded-full overflow-hidden w-10 h-10 sm:w-12 sm:h-12 mb-2 bg-orange-50 ring-2 ring-orange-100 group-hover:ring-orange-300">
                  <img src={photoSrc} alt={a.tenant_name || ''}
                    data-testid={`apt-${a.number}-photo`}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
              ) : (
                <div className="rounded-full flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 mb-2 bg-orange-50 group-hover:bg-orange-100">
                  <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />
                </div>
              )}
              <span className="text-base sm:text-lg font-extrabold text-slate-900 mb-0.5">{a.number}</span>
              <div className="flex items-center gap-1 text-slate-400 mb-1">
                <User className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-xs sm:text-sm truncate text-slate-700 font-medium max-w-[100px] sm:max-w-[120px]">{a.tenant_name}</span>
              </div>
              {/* Betaal-status badge — dynamisch per huurder-status:
                   • paid    → Betaald    (groen)
                   • partial → Deels bet. (geel/oranje)
                   • unpaid  → Niet bet.  (rood)
                  Wanneer er geen facturen zijn, valt de backend terug op
                  "paid" (geen achterstand). */}
              {a.pay_status === 'paid' ? (
                <span className="text-xs font-bold text-green-700 bg-green-50 rounded-full px-2.5 py-0.5" data-testid={`apt-${a.number}-paid`}>
                  Betaald
                </span>
              ) : a.pay_status === 'partial' ? (
                <span className="text-xs font-bold text-amber-700 bg-amber-50 rounded-full px-2.5 py-0.5" data-testid={`apt-${a.number}-partial`}>
                  Deels betaald
                </span>
              ) : (
                <span className="text-xs font-bold text-red-700 bg-red-50 rounded-full px-2.5 py-0.5" data-testid={`apt-${a.number}-unpaid`}>
                  Niet betaald
                </span>
              )}
            </button>
            );
          })}
          {visible.length === 0 && (
            <div className="col-span-full bg-white/90 rounded-2xl p-10 text-center">
              <Home className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-semibold">Geen bezette appartementen op deze locatie.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// ShareVoiceButton + Modal — TTS herinnering met bewerkbare tekst
// =====================================================================
// Klik → laadt de default tekst via GET /reminder-voice-text, opent
// een modal met textarea zodat de beheerder de tekst kan aanpassen.
// Bevestigen → POST /reminder-voice.mp3 met {text}, deelt MP3 via
// Web Share API of wa.me fallback.
function ShareVoiceButton({ tenantId, tenantName, tenantPhone, totalDue, currency }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingText, setLoadingText] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const disabled = !(Number(totalDue) > 0);

  const openModal = async () => {
    if (disabled) return;
    setErr('');
    setOpen(true);
    setLoadingText(true);
    try {
      const r = await api.get(`/kiosk/tenants/${tenantId}/reminder-voice-text`);
      setText(r.data?.text || '');
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setLoadingText(false);
    }
  };

  const confirm = async () => {
    const clean = (text || '').trim();
    if (!clean) { setErr('Tekst mag niet leeg zijn'); return; }
    if (clean.length > 2000) { setErr('Tekst is te lang (max 2000 tekens)'); return; }
    setBusy(true);
    setErr('');
    try {
      const resp = await api.post(
        `/kiosk/tenants/${tenantId}/reminder-voice.mp3`,
        { text: clean }, { responseType: 'blob' },
      );
      const blob = resp.data;
      const file = new File(
        [blob],
        `herinnering-${(tenantName || 'huurder').replace(/\s+/g, '-')}.mp3`,
        { type: 'audio/mpeg' },
      );
      const phoneDigits = String(tenantPhone || '').replace(/\D/g, '');
      const totalTxt = Number.isFinite(Number(totalDue))
        ? ` Totaal openstaand: ${fmtMoney(Number(totalDue), currency || 'SRD')}.`
        : '';
      const shareText = `Hallo ${tenantName || ''}, hierbij een gesproken herinnering.${totalTxt}`;
      if (typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file], text: shareText,
          title: 'Betalingsherinnering',
        });
      } else if (phoneDigits.length >= 7) {
        const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(shareText)}`;
        window.open(url, '_blank', 'noopener');
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, '_blank', 'noopener');
      } else {
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, '_blank', 'noopener');
      }
      setOpen(false);
    } catch (e) {
      if (e && e.name !== 'AbortError') {
        setErr(formatError(e) || 'Spraakbericht mislukt');
        // eslint-disable-next-line no-console
        console.error('[share voice] failed:', e);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={openModal} disabled={disabled}
        data-testid="overview-voice-btn"
        title={disabled ? 'Geen openstaand bedrag' : 'Spraakbericht versturen'}
        className="px-3 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
        <Mic className="w-3.5 h-3.5" /> Spraak
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
            data-testid="voice-modal">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic className="w-5 h-5 text-orange-500" />
                <h3 className="font-bold text-slate-900">Spraakbericht</h3>
              </div>
              <button onClick={() => !busy && setOpen(false)}
                data-testid="voice-modal-close"
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="px-5 py-4 flex-1 overflow-auto">
              <p className="text-xs text-slate-500 mb-2">
                Bewerk de tekst hieronder. Deze wordt omgezet naar spraak
                (Nova stem, Nederlands) en gedeeld via WhatsApp.
              </p>
              {loadingText ? (
                <div className="h-40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                </div>
              ) : (
                <textarea
                  data-testid="voice-modal-textarea"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                  rows={7}
                  maxLength={2000}
                  className="w-full text-sm rounded-xl border border-slate-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none p-3 resize-none disabled:opacity-60"
                />
              )}
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[10px] text-slate-400">{(text || '').length} / 2000</p>
                {err && <p data-testid="voice-modal-error" className="text-[10px] text-red-500 font-semibold">{err}</p>}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
              <button onClick={() => !busy && setOpen(false)}
                data-testid="voice-modal-cancel"
                disabled={busy}
                className="flex-1 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm disabled:opacity-60">
                Annuleren
              </button>
              <button onClick={confirm}
                data-testid="voice-modal-confirm"
                disabled={busy || loadingText || !text.trim()}
                className="flex-[2] h-11 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm disabled:opacity-60 flex items-center justify-center gap-2">
                {busy
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Bezig…</>
                  : <><MessageCircle className="w-4 h-4" /> Genereer & Deel</>}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// =====================================================================
// NotesButton — toont badge met aantal notities, opent NotesModal.
// =====================================================================
function NotesButton({ tenantId, tenantName }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(null);
  useEffect(() => {
    let mounted = true;
    api.get(`/kiosk/tenants/${tenantId}/notes`)
      .then((r) => { if (mounted) setCount((r.data || []).length); })
      .catch(() => { if (mounted) setCount(0); });
    return () => { mounted = false; };
  }, [tenantId]);
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="overview-notes-btn"
        className="px-3 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs inline-flex items-center gap-1.5">
        <StickyNote className="w-3.5 h-3.5" />
        Notitie
        {count !== null && count > 0 && (
          <span className="bg-orange-500 text-white rounded-full min-w-[18px] h-[18px] px-1 text-[10px] font-black flex items-center justify-center">{count}</span>
        )}
      </button>
      {open && (
        <NotesModal
          tenantId={tenantId} tenantName={tenantName}
          onClose={() => setOpen(false)}
          onCountChange={setCount} />
      )}
    </>
  );
}

function NotesModal({ tenantId, tenantName, onClose, onCountChange }) {
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState('');
  const [remindAt, setRemindAt] = useState('');   // YYYY-MM-DD, optioneel
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/kiosk/tenants/${tenantId}/notes`);
      setNotes(r.data || []);
      onCountChange && onCountChange((r.data || []).length);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, [tenantId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setSaving(true); setErr('');
    try {
      await api.post(`/kiosk/tenants/${tenantId}/notes`, {
        text: t,
        remind_at: remindAt || null,
      });
      setText(''); setRemindAt('');
      await load();
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Deze notitie verwijderen?')) return;
    try {
      await api.delete(`/kiosk/tenants/${tenantId}/notes/${id}`);
      await load();
    } catch (e) { setErr(formatError(e)); }
  };

  const dismiss = async (id) => {
    try {
      await api.post(`/kiosk/tenants/${tenantId}/notes/${id}/dismiss`);
      await load();
    } catch (e) { setErr(formatError(e)); }
  };

  return createPortal((
    <div onClick={onClose} className="fixed inset-0 z-[100] bg-black/60 flex items-stretch sm:items-center justify-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl flex flex-col h-full sm:h-auto sm:max-h-[85vh] overflow-hidden"
        data-testid="notes-modal">
        <div className="flex-none flex items-center justify-between px-5 pb-3 border-b border-slate-100"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}>
          <div>
            <h3 className="text-lg font-black text-slate-900">Notities</h3>
            <p className="text-xs text-slate-500">{tenantName}</p>
          </div>
          <button onClick={onClose} data-testid="notes-close" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2">
          <div className="bg-slate-50 rounded-xl p-3">
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              data-testid="notes-input"
              rows={3}
              placeholder="Bijv. Gebeld met huurder op 15 aug — belooft rest juli-huur af te maken vóór 20 aug."
              className="w-full text-sm border-2 border-slate-200 rounded-lg p-2 outline-none focus:border-orange-500 resize-none" />
            <label className="block mt-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                Herinner mij op (optioneel)
              </span>
              <input type="date" value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                data-testid="notes-remind-at"
                min={new Date().toISOString().slice(0, 10)}
                className="w-full h-10 px-2 rounded-lg border-2 border-slate-200 focus:border-orange-500 outline-none text-sm" />
              <span className="text-[10px] text-slate-500 block mt-1">
                Zet een datum om popup te tonen wanneer huurder binnenkomt in kiosk.
              </span>
            </label>
            <button onClick={add} disabled={saving || !text.trim()}
              data-testid="notes-add"
              className="mt-2 w-full h-11 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Opslaan…</>
                : <><Plus className="w-4 h-4" /> Notitie toevoegen</>}
            </button>
          </div>

          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : notes.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-6">Nog geen notities voor deze huurder.</p>
          ) : notes.map((n) => {
            const isDue = n.remind_at && !n.dismissed_at && n.remind_at <= new Date().toISOString().slice(0, 10);
            return (
              <div key={n.id}
                className={`border rounded-xl p-3 group ${isDue ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}
                data-testid={`note-${n.id}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1 flex-wrap">
                    {new Date(n.created_at).toLocaleString('nl-NL', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                    {n.created_by && <span className="text-slate-500">· {n.created_by}</span>}
                    {n.remind_at && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold ${n.dismissed_at ? 'bg-slate-100 text-slate-500' : (isDue ? 'bg-amber-500 text-white' : 'bg-blue-100 text-blue-700')}`}>
                        <Calendar className="w-3 h-3" />
                        {n.dismissed_at ? 'Afgesloten' : `Herinner ${n.remind_at}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {isDue && (
                      <button onClick={() => dismiss(n.id)}
                        data-testid={`note-dismiss-${n.id}`}
                        className="text-emerald-600 hover:bg-emerald-100 rounded px-1.5 py-0.5 text-[10px] font-bold">
                        Behandeld
                      </button>
                    )}
                    <button onClick={() => remove(n.id)} data-testid={`note-delete-${n.id}`}
                      className="opacity-60 hover:opacity-100 text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  ), document.body);
}

// =====================================================================
// Tenant overview — split-screen
// =====================================================================
function TenantOverview({ apartment, onBack, onPay }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [dueReminder, setDueReminder] = useState(null);

  const reload = useCallback(() => {
    if (!apartment?.tenant_id) return;
    api.get(`/kiosk/tenants/${apartment.tenant_id}/overview`)
      .then((r) => {
        setData(r.data);
        // Toon de eerste due reminder als popup — zodra de medewerker deze
        // afhandelt (Behandeld/Later), pakken we de volgende.
        const rems = Array.isArray(r.data?.due_reminders) ? r.data.due_reminders : [];
        setDueReminder(rems[0] || null);
      })
      .catch((e) => setErr(formatError(e)))
      .finally(() => setLoading(false));
  }, [apartment]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) return <div className="h-full bg-orange-500 flex items-center justify-center"><Loader2 className="w-10 h-10 text-white animate-spin" /></div>;
  if (err || !data) return <div className="h-full bg-orange-500 flex items-center justify-center text-white p-8">{err || 'Geen data'}</div>;

  const { tenant, apartment: apt, balance, credit_balance: credit = 0 } = data;
  const internet = Number(tenant.internet_amount || 0);
  // Backend levert 3 buckets:
  //   open_invoices      → Achterstallige huur (vervaltermijn + grace verstreken)
  //   current_invoices   → Openstaande huidige maand (lopende periode of nog in grace)
  //   future_invoices    → Vooruit gefactureerd (toekomst, NIET in totaal)
  const openInvoices = Array.isArray(data.open_invoices) ? data.open_invoices : [];
  const openInvoicesTotal = Number(data.open_invoices_total || 0);
  const currentInvoices = Array.isArray(data.current_invoices) ? data.current_invoices : [];
  const currentInvoicesTotal = Number(data.current_invoices_total || 0);
  const futureInvoices = Array.isArray(data.future_invoices) ? data.future_invoices : [];
  const futureInvoicesTotal = Number(data.future_invoices_total || 0);
  // Eerste current factuur voor legacy-display (backwards compat).
  const currentInvoice = data.current_month_invoice || currentInvoices[0] || null;
  // Achterstand — ALTIJD uit het backend bucket (`open_invoices_total`). De
  // oude fallback op `balance.balance` was buggy: `balance.balance` bevat
  // ook current_invoices + internet, waardoor die bij het openstaand bedrag
  // werd opgeteld = dubbeltelling (bv. 2× SRD 7.500 = SRD 15.000 bij één
  // openstaande maand). Backend levert altijd expliciet 0.0 als er geen
  // achterstand is, dus vertrouwen we die.
  const openRent = openInvoicesTotal;
  // Nieuwe huurder = géén betalingen én géén facturen ooit. Backend
  // levert dit als `has_history` (false voor gloednieuw). Wordt gebruikt
  // om de "Vooruit betalen voor eerste maand" knop prominent te tonen
  // i.p.v. het gewone "Alles voldaan" scherm dat verwarrend is voor
  // een nieuwe huurder die nog geen enkele factuur heeft ontvangen.
  const isNewTenant = data.has_history === false;
  const firstMonthRent = Number(apt.rent_amount || 0);
  // Huidige maand: som van alle current_invoices. Wanneer er GEEN openstaande
  // factuur is voor deze maand (want betaald of nog niet gegenereerd) staat
  // dit op 0 — anders zou een reeds voldane factuur nog steeds SRD 7.500
  // als "Maandhuur" tonen (bug pre-2026-02-27).
  const currentMonthAmount = currentInvoices.length > 0
    ? currentInvoicesTotal
    : (currentInvoice ? Number(currentInvoice.outstanding || 0) : 0);
  const currentMonthLabel = currentInvoice && currentInvoice.period_month
    ? `Huidige maandhuur · ${MONTHS_NL[currentInvoice.period_month - 1]} ${currentInvoice.period_year}`
    : 'Maandhuur';
  // Totaal openstaand = achterstand + huidige maand + internet
  // (vooruit gefactureerd NIET meegerekend — dat is toekomst, geen schuld nu)
  const totalDue = currentMonthAmount + openRent + internet;
  const allPaid = totalDue <= 0;
  const cur = balance.currency || apt.currency || 'SRD';

  // Subtitel onder "Achterstallige huur" — toont de maanden compact.
  const monthsCovered = openInvoices.length;
  const openLabel = monthsCovered > 0
    ? `Achterstallige huur (${monthsCovered} maand${monthsCovered === 1 ? '' : 'en'})`
    : 'Achterstallige huur';
  const openSub = openInvoices.length > 0
    ? (() => {
        const months = openInvoices
          .map((inv) => inv.period_month
            ? `${MONTHS_NL[inv.period_month - 1].slice(0, 3)}`
            : null)
          .filter(Boolean);
        const years = [...new Set(openInvoices.map((i) => i.period_year).filter(Boolean))];
        return months.length > 0
          ? `${months.join(', ')}${years.length === 1 ? ` ${years[0]}` : ''}`
          : (balance.next_period
              ? `${MONTHS_NL[balance.next_period.month - 1]} ${balance.next_period.year}`
              : '');
      })()
    : (balance.next_period ? `${MONTHS_NL[balance.next_period.month - 1]} ${balance.next_period.year}` : '');

  // Subtitel onder "Vooruit gefactureerd" — toont toekomstige periodes.
  const futureSub = futureInvoices.length > 0
    ? futureInvoices
        .map((inv) => inv.period_month
          ? `${MONTHS_NL[inv.period_month - 1].slice(0, 3)} ${inv.period_year}`
          : null)
        .filter(Boolean)
        .join(', ')
    : '';

  const items = [
    ...(openRent > 0 ? [{
      key: 'open',
      label: openLabel,
      value: openRent,
      icon: Wallet,
      highlight: true,
      sub: openSub,
    }] : []),
    { key: 'rent', label: currentMonthLabel, value: currentMonthAmount, icon: Home,
      sub: currentInvoice && currentInvoice.due_date
        ? `Vervalt ${new Date(currentInvoice.due_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}`
        : '' },
    { key: 'fines', label: 'Boetes', value: 0, icon: FileText, muted: true },
    { key: 'internet', label: 'Internet', value: internet, icon: Wifi, muted: internet === 0 },
    ...(futureInvoicesTotal > 0 ? [{
      key: 'future',
      label: `Vooruit gefactureerd (${futureInvoices.length} maand${futureInvoices.length === 1 ? '' : 'en'})`,
      value: futureInvoicesTotal,
      icon: Calendar,
      info: true,  // alleen-informatief — telt NIET mee in totaal
      sub: futureSub,
    }] : []),
  ];

  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }}>
      <div className="flex items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2">
        <button onClick={onBack} data-testid="overview-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
        <div className="text-right text-white">
          <p className="text-xs sm:text-sm font-semibold">{tenant.name}</p>
          <p className="text-[10px] sm:text-xs opacity-70">Appt. {apt.number}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 sm:gap-3 pb-3">
        <div className="bg-white rounded-2xl flex-1 md:flex-[3] flex flex-col p-4 sm:p-5 min-w-0">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-base sm:text-lg font-bold text-slate-900">Financieel overzicht</h3>
            <div className="flex items-center gap-1.5">
              <ShareVoiceButton tenantId={tenant.id} tenantName={tenant.name} tenantPhone={tenant.phone || ''} totalDue={totalDue} currency={cur} />
              <NotesButton tenantId={tenant.id} tenantName={tenant.name} />
            </div>
          </div>
          <div className="flex-1 divide-y divide-slate-100">
            {items.map((it) => {
              const Icon = it.icon;
              const klass = it.highlight ? 'text-orange-600'
                : it.info ? 'text-blue-500'
                : it.muted ? 'text-slate-400'
                : 'text-slate-900';
              return (
                <div key={it.key} className={`py-2.5 px-1 ${klass}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        it.highlight ? 'bg-orange-100 text-orange-500'
                          : it.info ? 'bg-blue-50 text-blue-500'
                          : it.muted ? 'bg-slate-50 text-slate-300'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm ${it.highlight ? 'font-extrabold' : 'font-semibold'}`}>{it.label}</p>
                        {it.sub && <p className="text-[10px] mt-0.5">{it.sub}</p>}
                        {it.info && <p className="text-[9px] mt-0.5 italic text-blue-400">informatief — telt niet mee</p>}
                      </div>
                    </div>
                    <p className={`font-bold text-sm sm:text-base ${it.highlight ? 'font-extrabold' : ''}`}>{fmtMoney(it.value, cur)}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t-2 border-slate-200 mt-2 pt-2 flex items-center justify-between">
            <p className="font-bold text-slate-900 text-sm sm:text-base">Totaal openstaand</p>
            <p className="text-lg sm:text-xl font-extrabold text-slate-900" data-testid="overview-total">{fmtMoney(totalDue, cur)}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl md:flex-[2] flex flex-col items-center justify-center text-center p-6 sm:p-8 min-h-[260px]">
          {allPaid ? (
            <>
              {isNewTenant ? (
                // Nieuwe huurder — nog geen factuur. Toon prominente knop
                // om vooruit te betalen voor de eerste maand.
                (() => {
                  // Bepaal welke maand vooruit betaald wordt: gebruik het
                  // door backend berekende `balance.next_period` (dat is
                  // gebaseerd op tenant.created_at + eerste onbetaalde
                  // periode). Fallback op de huidige kalendermaand.
                  const np = (data.balance && data.balance.next_period) || null;
                  const now = new Date();
                  const nextM = (np && Number(np.month)) || (now.getMonth() + 1);
                  const nextY = (np && Number(np.year)) || now.getFullYear();
                  const nextLabel = `${MONTHS_NL[nextM - 1]} ${nextY}`;
                  return (
                <>
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-3">
                    <Home className="w-8 h-8 sm:w-9 sm:h-9 text-orange-500" />
                  </div>
                  <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-orange-600">Welkom {tenant.name.split(' ')[0]}</p>
                  <p className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight mt-1 mb-1">
                    Nog geen factuur
                  </p>
                  <p className="text-xs text-slate-500 mb-3 max-w-xs">
                    Betaal je eerste maand ({nextLabel}) alvast vooruit — {fmtMoney(firstMonthRent, cur)} voor huisnummer {apt.number}
                  </p>
                  <button onClick={() => onPay({ ...data, internet, total_due: firstMonthRent, isAdvance: true,
                    prefill_advance_amount: firstMonthRent,
                    advance_period_month: nextM, advance_period_year: nextY,
                    open_invoices: openInvoices, open_invoices_total: openInvoicesTotal,
                    current_invoices: currentInvoices, current_invoices_total: currentInvoicesTotal,
                    future_invoices: futureInvoices, future_invoices_total: futureInvoicesTotal,
                    current_month_invoice: currentInvoice })}
                    data-testid="overview-first-month-btn"
                    className="w-full max-w-xs bg-orange-500 hover:bg-orange-600 text-white text-sm sm:text-base font-bold rounded-xl flex items-center justify-center gap-2 transition py-3 active:scale-[0.98]">
                    Vooruit betalen voor {nextLabel} <ArrowRight className="w-5 h-5" />
                  </button>
                  <button onClick={() => setShowHistory(true)} data-testid="overview-history-btn"
                    className="mt-2 w-full max-w-xs bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 py-2.5 text-sm">
                    <ClockIcon className="w-4 h-4" /> Betalingsgeschiedenis
                  </button>
                </>
                  );
                })()
              ) : (
                <>
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mb-3">
                    <Check className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-600" />
                  </div>
                  <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-emerald-700">Alles voldaan</p>
                  <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
                    Geen openstaande facturen
                  </p>
                  {credit > 0 && (
                    <div className="mt-3 mb-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Positief saldo</p>
                      <p className="text-xl font-extrabold text-emerald-700">{fmtMoney(credit, cur)}</p>
                      <p className="text-[10px] text-emerald-600 mt-0.5">Wordt verrekend met volgende factuur</p>
                    </div>
                  )}
                  {!credit && <div className="h-3" />}
                  <button onClick={() => onPay({ ...data, internet, total_due: 0, isAdvance: true,
                    open_invoices: openInvoices, open_invoices_total: openInvoicesTotal,
                    current_invoices: currentInvoices, current_invoices_total: currentInvoicesTotal,
                    future_invoices: futureInvoices, future_invoices_total: futureInvoicesTotal,
                    current_month_invoice: currentInvoice })}
                    data-testid="overview-advance-pay-btn"
                    className="mt-2 w-full max-w-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 transition py-2.5 text-sm active:scale-[0.98]">
                    Vooruitbetaling registreren
                  </button>
                  <button onClick={() => setShowHistory(true)} data-testid="overview-history-btn"
                    className="mt-2 w-full max-w-xs bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 py-2.5 text-sm">
                    <ClockIcon className="w-4 h-4" /> Betalingsgeschiedenis
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-3">
                <Wallet className="w-7 h-7 sm:w-9 sm:h-9 text-orange-500" />
              </div>
              <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-slate-400">Te betalen</p>
              <p className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mt-1 mb-6">{fmtMoney(totalDue, cur)}</p>
              <button onClick={() => onPay({ ...data, internet, total_due: totalDue,
                open_invoices: openInvoices, open_invoices_total: openInvoicesTotal,
                current_invoices: currentInvoices, current_invoices_total: currentInvoicesTotal,
                future_invoices: futureInvoices, future_invoices_total: futureInvoicesTotal,
                current_month_invoice: currentInvoice })}
                data-testid="overview-pay-btn"
                className="w-full max-w-xs bg-orange-500 hover:bg-orange-600 text-white text-base sm:text-lg font-bold rounded-xl flex items-center justify-center gap-2 transition py-3 sm:py-3.5 active:scale-[0.98]">
                Volgende <ArrowRight className="w-5 h-5" />
              </button>
              <button onClick={() => setShowHistory(true)} data-testid="overview-history-btn"
                className="mt-2 w-full max-w-xs bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 py-2.5 text-sm">
                <ClockIcon className="w-4 h-4" /> Betalingsgeschiedenis
              </button>
            </>
          )}
        </div>
      </div>

      {showHistory && <PaymentHistoryModal tenant={tenant} apartment={apt} onClose={() => setShowHistory(false)} />}
      {dueReminder && (
        <ReminderPopup
          tenantId={tenant.id}
          note={dueReminder}
          onDismiss={async (dismiss) => {
            if (dismiss) {
              try { await api.post(`/kiosk/tenants/${tenant.id}/notes/${dueReminder.id}/dismiss`); } catch { /* noop */ }
            }
            reload();  // haalt volgende reminder op, of null als er geen meer is
          }} />
      )}
    </div>
  );
}

// =====================================================================
// ReminderPopup — toont een enkele due-notitie als modal bij binnenkomst
// van de huurder in de Kiosk. Twee knoppen: "Later" (opent notitie later
// weer) en "Behandeld" (markeert dismissed_at).
// =====================================================================
function ReminderPopup({ note, onDismiss }) {
  return createPortal((
    <div className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4"
      data-testid="reminder-popup">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border-4 border-amber-400">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
            <StickyNote className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-black text-slate-900">Herinnering</h3>
            <p className="text-xs text-slate-500">
              Aangemaakt {new Date(note.created_at).toLocaleDateString('nl-NL', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
              {note.created_by && <span> door {note.created_by}</span>}
              {note.remind_at && <span> · gepland voor {note.remind_at}</span>}
            </p>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{note.text}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onDismiss(false)}
            data-testid="reminder-later"
            className="flex-1 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm">
            Later
          </button>
          <button onClick={() => onDismiss(true)}
            data-testid="reminder-done"
            className="flex-1 h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4" /> Behandeld
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

// =====================================================================
// Payment history modal
// =====================================================================
function PaymentHistoryModal({ tenant, apartment, onClose }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  // Toast-achtige feedback per betaling voor de WhatsApp-knop. Key = payment.id,
  // value = { kind: 'sending'|'ok'|'err', msg: string }. We tonen dit inline
  // onder de rij zodat de operator direct ziet dat het bericht verstuurd is
  // (of waarom niet: "geen telefoonnummer", "Twilio niet ingericht", etc.).
  const [waState, setWaState] = useState({});
  // Voorkomt dubbele afdruk/whatsapp-taps op dezelfde payment.
  const [busy, setBusy] = useState({});
  useEffect(() => {
    api.get(`/kiosk/tenants/${tenant.id}/payments`)
      .then((r) => setItems(r.data)).catch((e) => setErr(formatError(e)));
  }, [tenant.id]);

  // Stille afdruk: haal de PDF als blob op via de authenticated axios
  // client (window.open naar /api/... werkt niet altijd in de kiosk-PWA
  // want de child-tab krijgt niet automatisch de httpOnly cookies mee).
  // Blob → verborgen iframe → contentWindow.print().
  //
  // In Chrome/Edge gestart met de `--kiosk-printing` vlag wordt het
  // printdialoog automatisch overgeslagen en gaat de bon direct naar de
  // OS-standaardprinter. In een normale browser verschijnt wél nog een
  // dialoog (browser-beveiliging staat 100% stille print niet toe zonder
  // die vlag). Zie /app/memory/kiosk-printing-setup.md voor setup.
  const handlePrint = async (paymentId) => {
    if (busy[paymentId]) return;
    setBusy((prev) => ({ ...prev, [paymentId]: 'print' }));
    setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'sending', msg: 'Bezig met afdrukken…' } }));
    try {
      // Universeel via `iframe.contentWindow.print()` — werkt op elk
      // platform (desktop Chrome met --kiosk-printing → geen dialoog;
      // Android/iOS → native print-dialoog). Bij mislukking valt hij
      // terug op de JPG-versie in een nieuw tabblad zodat de operator
      // via Share Sheet kan afdrukken of opslaan.
      const ok = await printReceipt({
        paymentId,
        apiGet: api.get,
        iframeId: 'kiosk-print-iframe',
      });
      if (!ok) {
        openReceiptImage(paymentId);
        setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'ok', msg: 'Bon geopend in tabblad' } }));
      } else {
        setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'ok', msg: 'Afgedrukt' } }));
      }
      setTimeout(() => {
        setWaState((prev) => {
          const c = { ...prev };
          if (c[paymentId]?.kind === 'ok') delete c[paymentId];
          return c;
        });
      }, 2500);
    } catch (e) {
      setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'err', msg: 'Afdruk mislukt' } }));
    } finally {
      setBusy((prev) => { const c = { ...prev }; delete c[paymentId]; return c; });
    }
  };

  // WhatsApp: haal kwitantie-JPG op, deel via Web Share API (WhatsApp
  // verschijnt in de share-sheet). Fallback: wa.me deeplink met tekst +
  // JPG in nieuw tabblad zodat medewerker 'em handmatig kan bijvoegen.
  const handleWhatsApp = async (paymentId) => {
    if (busy[paymentId]) return;
    setBusy((prev) => ({ ...prev, [paymentId]: 'wa' }));
    setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'sending', msg: 'Bezig…' } }));
    try {
      const resp = await api.get(`/payments/${paymentId}/image`, { responseType: 'blob' });
      const blob = resp.data;
      const receipt = (items || []).find((x) => x.id === paymentId);
      const file = new File([blob], `kwitantie-${receipt?.receipt_number || paymentId}.jpg`,
        { type: 'image/jpeg' });
      const shareText = `Hallo ${tenant.name || ''}, hierbij uw kwitantie ${receipt?.receipt_number || ''}` +
        (receipt?.amount ? ` · ${fmtMoney(receipt.amount, receipt.currency)}` : '') +
        (receipt?.period_month ? ` · Periode ${MONTHS_NL[receipt.period_month - 1]} ${receipt.period_year}` : '') +
        '.';
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText, title: 'Kwitantie' });
        setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'ok', msg: 'Gedeeld' } }));
      } else {
        const phone = String(tenant.phone || '').replace(/\D/g, '');
        if (phone.length >= 7) {
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(shareText)}`,
            '_blank', 'noopener');
        }
        // Ook JPG in nieuw tabblad zodat medewerker 'em kan opslaan/kopiëren.
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
        setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'ok', msg: 'WhatsApp geopend' } }));
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        setWaState((prev) => { const c = { ...prev }; delete c[paymentId]; return c; });
      } else {
        setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'err', msg: 'Delen mislukt' } }));
      }
    } finally {
      setBusy((prev) => { const c = { ...prev }; delete c[paymentId]; return c; });
    }
  };

  return (
    <div className="fixed inset-0 z-50 backdrop-blur-md flex items-center justify-center p-4 md:p-6"
      style={{
        paddingTop: 'max(env(safe-area-inset-top, 0px), 1rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1rem)',
        /* Brand-georiënteerde overlay zodat in PWA-kiosk de home-indicator
           gebied dezelfde oranje kleur houdt als de rest van de kiosk,
           in plaats van een zwarte band. */
        backgroundColor: 'rgba(199, 70, 0, 0.55)',
      }}
      data-testid="kiosk-history-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] my-auto overflow-hidden flex flex-col">
        <div className="px-5 sm:px-6 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <ClockIcon className="w-4 h-4 text-orange-500" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900">Betalingsgeschiedenis</h3>
              <p className="text-xs text-slate-500 truncate">Appt. {apartment?.number}</p>
            </div>
          </div>
          <button onClick={onClose} data-testid="history-close"
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-3"
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          {err && <p className="text-red-500 text-sm py-4">{err}</p>}
          {!items && !err && <div className="py-10 flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500" /></div>}
          {items && items.length === 0 && (
            <div className="py-10 text-center text-slate-400">
              <Receipt className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>Nog geen betalingen voor deze huurder.</p>
            </div>
          )}
          {items && items.map((p) => (
            <div key={p.id} className="py-3 border-b border-slate-100 last:border-0 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-extrabold text-slate-900">{fmtMoney(p.amount, p.currency)}</p>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-orange-100 text-orange-700">{p.category}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">{p.method}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(p.paid_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}{p.receipt_number}
                  {p.period_month ? ` · Periode: ${MONTHS_NL[p.period_month - 1]} ${p.period_year}` : ''}
                </p>
                {(p.received_by || p.approved_by) && (
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {p.received_by ? <>Ontvangen door <b className="text-slate-600">{p.received_by}</b></> : null}
                    {p.received_by && p.approved_by ? ' · ' : ''}
                    {p.approved_by ? <>Goedgekeurd door <b className="text-slate-600">{p.approved_by}</b></> : null}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="flex items-center gap-1.5">
                  <button data-testid={`history-whatsapp-${p.id}`}
                    onClick={() => handleWhatsApp(p.id)}
                    disabled={!!busy[p.id]}
                    className="px-2.5 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-bold text-xs flex items-center gap-1">
                    {busy[p.id] === 'wa'
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <MessageCircle className="w-3 h-3" />}
                    WhatsApp
                  </button>
                  <button data-testid={`history-print-${p.id}`}
                    onClick={() => handlePrint(p.id)}
                    disabled={!!busy[p.id]}
                    className="px-2.5 h-8 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-xs flex items-center gap-1">
                    {busy[p.id] === 'print'
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Printer className="w-3 h-3" />}
                    Afdruk
                  </button>
                </div>
                {waState[p.id] && (
                  <p data-testid={`history-print-status-${p.id}`}
                    className={`text-[10px] font-semibold px-1 ${
                      waState[p.id].kind === 'ok' ? 'text-emerald-600'
                      : waState[p.id].kind === 'err' ? 'text-red-500'
                      : 'text-slate-500'
                    }`}>
                    {waState[p.id].msg}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 sm:px-6 py-3 border-t border-slate-100 shrink-0">
          <button onClick={onClose}
            className="w-full h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm">Sluiten</button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Pay select — checklist + keypad (old-ERP style)
// =====================================================================
// Boete + Internet zijn de enige template-items. Huur wordt per factuur als
// individuele rij getoond (achterstand + huidige maand + vooruit), zodat de
// huurder/medewerker precies kan kiezen wat ze willen voldoen.
const PAY_ITEMS_TEMPLATE = [
  { id: 'boete', label: 'Boetes', icon: AlertCircle, desc: 'Openstaande boetes' },
  { id: 'internet', label: 'Internet', icon: Wifi, desc: 'Internetaansluiting' },
];

function PaySelect({ overview, onBack, onConfirm, onLiveChange }) {
  const { tenant, apartment: apt, balance, internet, total_due, isAdvance = false,
    prefill_advance_amount: prefillAdvance = 0,
    open_invoices: openInvoices = [], open_invoices_total: openInvoicesTotal = 0,
    current_invoices: currentInvoicesRaw = [],
    future_invoices: futureInvoicesRaw = [],
    current_month_invoice: currentInvoice = null } = overview;
  const cur = (balance.currency || apt.currency || 'SRD').toUpperCase();
  const fmt = (v) => fmtMoney(v, cur);
  const openRentFromInvoices = Number(openInvoicesTotal || 0);
  // Vertrouw ALTIJD het backend-bucket `open_invoices_total` (dubbeltelling-
  // fix, was: balance.balance viel terug op totaal-saldo dat óók
  // current_invoices bevatte).
  const openRent = openRentFromInvoices;
  // Huidige maand: array van facturen (kan 1 of 2 zijn — mei in grace + juni
  // bijvoorbeeld). Wanneer er GEEN openstaande factuur is voor de huidige
  // maand (want betaald of nog niet gegenereerd), tonen we ook geen
  // synthetische rij meer — dat toonde eerder 7.500 terwijl de factuur al
  // voldaan was. Nieuwe huurders zonder factuur kunnen "Vooruitbetaling"
  // gebruiken via de Overview-knop.
  const currentInvoices = Array.isArray(currentInvoicesRaw) && currentInvoicesRaw.length > 0
    ? currentInvoicesRaw
    : (currentInvoice ? [currentInvoice] : []);
  const futureInvoices = Array.isArray(futureInvoicesRaw) ? futureInvoicesRaw : [];
  const syntheticCurrent = null;

  const amounts = {
    boete: 0,
    internet: Number(internet || 0),
  };

  const [selected, setSelected] = useState(new Set());
  // Prefill custom-bedrag met eerste-maand-huur als de nieuwe-huurder flow
  // deze doorgeeft — huurder ziet direct het correcte bedrag en kan
  // desgewenst nog aanpassen.
  const [custom, setCustom] = useState(prefillAdvance > 0 ? String(prefillAdvance.toFixed(2)) : '');
  // Ander bedrag / keypad is standaard OPEN op mobiel zodat de huurder direct
  // een bedrag kan invoeren zonder eerst op "Ander bedrag invoeren" te klikken.
  const [showMobileKeypad, setShowMobileKeypad] = useState(true);
  const [planInstallments, setPlanInstallments] = useState([]);
  // Set van invoice-ids die door een actieve regeling gedekt worden. Deze
  // facturen filteren we uit `openInvoices`/`currentInvoices` zodat "Alles
  // betalen" ze niet dubbel telt met de plan-termijnen (bug 2026-02:
  // augustus-factuur SRD 8500 + 2× termijn SRD 4250 = SRD 17.000 terwijl
  // het werkelijk openstaand SRD 8500 is).
  const [planLinkedInvIds, setPlanLinkedInvIds] = useState(new Set());
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planSuccess, setPlanSuccess] = useState(null);  // {id, num_installments, total_amount}

  useEffect(() => {
    api.get(`/kiosk/tenants/${tenant.id}/payment-plans`)
      .then((r) => {
        const out = [];
        const linked = new Set();
        for (const p of r.data || []) {
          // Alleen ACTIEVE regelingen — voltooide/geannuleerde regelingen
          // koppelen we niet meer aan open facturen.
          if (p.status !== 'active') continue;
          for (const invId of (p.invoice_ids || [])) linked.add(invId);
          for (const inst of p.installments || []) {
            if (inst.status !== 'pending') continue;
            out.push({
              planId: p.id, seq: inst.sequence,
              due_date: inst.due_date, amount: Number(inst.amount || 0),
            });
          }
        }
        out.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
        setPlanInstallments(out);
        setPlanLinkedInvIds(linked);
      })
      .catch(() => { setPlanInstallments([]); setPlanLinkedInvIds(new Set()); });
  }, [tenant.id]);

  const planItemKey = (it) => `plan:${it.planId}:${it.seq}`;
  const invItemKey = (inv) => `inv:${inv.id}`;
  const synItemKey = () => 'syn:current';
  // Filter facturen die al door een actieve betalingsregeling worden
  // gedekt uit alle bucket-listen. De plan-termijnen dekken die facturen,
  // dus in "Alles betalen" tellen we ze niet dubbel mee.
  const openInvoicesFiltered = openInvoices.filter((inv) => !planLinkedInvIds.has(inv.id));
  const currentInvoicesFiltered = currentInvoices.filter((inv) => !planLinkedInvIds.has(inv.id));
  const futureInvoicesFiltered = futureInvoices.filter((inv) => !planLinkedInvIds.has(inv.id));
  const hasOpenInvoices = openInvoicesFiltered.length >= 1;
  const hasCurrentInvoices = currentInvoicesFiltered.length >= 1 || !!syntheticCurrent;
  const hasFutureInvoices = futureInvoicesFiltered.length >= 1;

  const toggle = (id) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setCustom('');
  };

  const isDisabled = (id) => (amounts[id] || 0) <= 0;
  const enabled = PAY_ITEMS_TEMPLATE.filter((t) => !isDisabled(t.id));
  // "Alles betalen" includeert: achterstand + huidige maand + boete + internet + plan-termijnen.
  // Vooruit gefactureerd is OPT-IN (niet standaard mee-geselecteerd, want het is toekomst).
  const allSelectableKeys = [
    ...enabled.map((t) => t.id),
    ...(hasOpenInvoices ? openInvoicesFiltered.map(invItemKey) : []),
    ...(currentInvoicesFiltered.length > 0 ? currentInvoicesFiltered.map(invItemKey) : (syntheticCurrent ? [synItemKey()] : [])),
    ...planInstallments.map(planItemKey),
  ];
  const allSelected = allSelectableKeys.length > 0
    && allSelectableKeys.every((k) => selected.has(k));
  const selectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allSelectableKeys));
    setCustom('');
  };

  // Lookup: gebruik gefilterde lijsten zodat plan-linked facturen ook uit
  // de individuele klik-selectie worden geweerd.
  const allInvoicesLookup = [...openInvoicesFiltered, ...currentInvoicesFiltered, ...futureInvoicesFiltered];
  const selectedPlanItems = [...selected].filter((k) => k.startsWith('plan:'))
    .map((k) => planInstallments.find((x) => planItemKey(x) === k))
    .filter(Boolean);
  const selectedInvItems = [...selected].filter((k) => k.startsWith('inv:'))
    .map((k) => allInvoicesLookup.find((x) => invItemKey(x) === k))
    .filter(Boolean);
  const selectedSynCurrent = syntheticCurrent && selected.has(synItemKey())
    ? syntheticCurrent.outstanding : 0;
  const selectedPlainKeys = [...selected].filter((k) =>
    !k.startsWith('plan:') && !k.startsWith('inv:') && !k.startsWith('syn:'));
  const selectedPlainTotal = selectedPlainKeys.reduce((s, id) => s + (amounts[id] || 0), 0);
  const selectedPlanTotal = selectedPlanItems.reduce((s, x) => s + x.amount, 0);
  const selectedInvTotal = selectedInvItems.reduce((s, x) => s + (x.outstanding || 0), 0);
  const selectedTotal = selectedPlainTotal + selectedPlanTotal + selectedInvTotal + selectedSynCurrent;
  const hasCustom = custom && parseFloat(custom) > 0;
  const activeAmount = hasCustom ? parseFloat(custom) : selectedTotal;
  const canProceed = activeAmount > 0;

  const buildDescription = () => {
    const labels = [];
    if (selectedInvItems.length > 0) {
      const months = selectedInvItems
        .map((inv) => inv.period_month ? MONTHS_NL[inv.period_month - 1].slice(0, 3) : null)
        .filter(Boolean);
      labels.push(`Huur ${months.join(', ')}`);
    } else if (selectedSynCurrent > 0) {
      labels.push('Huur (huidige maand)');
    }
    if (selected.has('boete')) labels.push('Boetes');
    if (selected.has('internet')) labels.push('Internet');
    if (selectedPlanItems.length > 0) labels.push(`Regeling (${selectedPlanItems.length}× termijn)`);
    return labels.join(' + ');
  };

  // Live-sync naar het klantenscherm: zodra de operator iets aanvinkt of
  // een bedrag intikt, sturen we het lopende totaal + de geselecteerde
  // onderdelen door naar KioskLayout. KioskLayout broadcast dit dan
  // (via BroadcastChannel + PUT) naar het klantenscherm zodat de klant
  // realtime ziet wat er gebeurt. Dedup wordt door KioskLayout's push-hash
  // afgehandeld.
  // Content-hash ref voor live preview — voorkomt dat we onLiveChange
  // meermaals per render afvuren wanneer de selectie qua INHOUD identiek
  // is (selectedInvItems/PlanItems zijn nieuwe arrays elke render). Zonder
  // deze guard zou de parent voor elke re-render setLivePreview triggeren
  // en zo dubbele renders + onnodige PUTs veroorzaken.
  const lastLivePreviewKeyRef = useRef('');
  useEffect(() => {
    if (typeof onLiveChange !== 'function') return;
    if (activeAmount <= 0) {
      if (lastLivePreviewKeyRef.current !== '__null__') {
        lastLivePreviewKeyRef.current = '__null__';
        onLiveChange(null);
      }
      return;
    }
    const cats = [];
    selectedInvItems.forEach((inv) => {
      const label = inv.period_month
        ? `Huur ${MONTHS_NL[inv.period_month - 1]} ${inv.period_year || ''}`.trim()
        : 'Huur';
      cats.push({ key: 'huur', label, value: Number(inv.outstanding || 0) });
    });
    if (selectedSynCurrent > 0) {
      cats.push({ key: 'huur', label: 'Huur (huidige maand)', value: selectedSynCurrent });
    }
    if (selected.has('boete')) cats.push({ key: 'boete', label: 'Boetes', value: amounts.boete || 0 });
    if (selected.has('internet')) cats.push({ key: 'internet', label: 'Internet', value: amounts.internet || 0 });
    selectedPlanItems.forEach((it, i) => {
      cats.push({ key: 'overig', label: `Regeling termijn ${i + 1}`, value: it.amount });
    });
    if (hasCustom) {
      cats.push({ key: 'overig', label: isAdvance ? 'Vooruitbetaling' : 'Gedeeltelijke betaling', value: parseFloat(custom) });
    }
    const key = JSON.stringify({ a: activeAmount, c: cur, cs: cats.map((x) => `${x.key}:${x.label}:${x.value}`) });
    if (key !== lastLivePreviewKeyRef.current) {
      lastLivePreviewKeyRef.current = key;
      onLiveChange({ amount: activeAmount, currency: cur, categories: cats });
    }
  }, [activeAmount, hasCustom, custom, cur, isAdvance, selected, selectedInvItems, selectedPlanItems, selectedSynCurrent, amounts.boete, amounts.internet, onLiveChange]);


  const press = (k) => {
    if (k === 'DEL') setCustom((c) => c.slice(0, -1));
    else if (k === '.') setCustom((c) => c.includes('.') ? c : c + '.');
    else setCustom((c) => c + k);
    setSelected(new Set());
  };

  const handleNext = () => {
    if (!canProceed) return;
    // Vooruitbetaling: huurder heeft (bijna) niets openstaand maar betaalt
    // vooruit. We willen nu weten VOOR WELKE MAAND en direct verrekenen met
    // die factuur zodat het saldo van die maand meteen omlaag gaat.
    //  1. Als er al een `future_invoices[0]` bestaat (auto-gegenereerd door
    //     de maandelijkse billing tick) → gebruik díe factuur + periode.
    //  2. Anders → doel = eerstvolgende kalendermaand na huidige. Backend
    //     maakt dan automatisch een factuur voor die maand aan (bestaande
    //     "auto-create on payment" logica) en past de 500 partial toe.
    if (isAdvance && hasCustom) {
      let targetMonth;
      let targetYear;
      let targetInvoiceId = null;
      if (futureInvoices.length > 0) {
        targetMonth = futureInvoices[0].period_month;
        targetYear = futureInvoices[0].period_year;
        targetInvoiceId = futureInvoices[0].id;
      } else if (balance.next_period && balance.next_period.month && balance.next_period.year) {
        // BUG FIX (2026-02): Backend `next_period` wijst naar de eerst-
        // volgende ONbetaalde maand vanaf contractstart. Voor huurders die
        // in "arrears"-model werken (bv. "in september betalen we augustus")
        // is dat exact de juiste doel-maand voor een vooruitbetaling.
        //
        // Oude fallback deed `now.getMonth() + 2` (= 2 maanden vooruit
        // t.o.v. de kalender-index 0-based → soms 3 vooruit), waardoor
        // vooruitbetaling in september op oktober terechtkwam terwijl
        // september nog helemaal niet gefactureerd was.
        targetMonth = balance.next_period.month;
        targetYear = balance.next_period.year;
      } else {
        // Absolute laatste fallback: nieuwe huurder zonder enige factuur/
        // betaling én zonder next_period → gebruik eerstvolgende
        // kalendermaand als beste gok.
        const now = new Date();
        let m = now.getMonth() + 2; // +1 voor 1-indexed, +1 voor next
        let y = now.getFullYear();
        if (m > 12) { m -= 12; y += 1; }
        targetMonth = m;
        targetYear = y;
      }
      const monthLabel = MONTHS_NL[targetMonth - 1];
      onConfirm({
        tenant_id: tenant.id, apartment_id: apt.id,
        amount: parseFloat(custom), currency: cur,
        category: 'vooruitbetaling', method: 'contant',
        period_month: targetMonth, period_year: targetYear,
        note: `Vooruitbetaling voor ${monthLabel} ${targetYear}`,
        plan_items: [], plain_amount: parseFloat(custom),
        invoice_ids: targetInvoiceId ? [targetInvoiceId] : [],
      });
      return;
    }
    if (hasCustom) {
      onConfirm({
        tenant_id: tenant.id, apartment_id: apt.id,
        amount: parseFloat(custom), currency: cur, category: 'huur', method: 'contant',
        period_month: balance.next_period ? balance.next_period.month : null,
        period_year: balance.next_period ? balance.next_period.year : null,
        note: `Gedeeltelijke betaling — ${fmt(parseFloat(custom))}`,
        plan_items: [], plain_amount: parseFloat(custom),
      });
      return;
    }
    const plainCategory = selectedPlainKeys.length === 1 ? selectedPlainKeys[0]
      : selectedPlainKeys.length === 0 ? 'betalingsregeling' : 'huur';
    // Bepaal de category op basis van wat er geselecteerd is. Als ALLEEN
    // invoice-items zijn geselecteerd, label de betaling als "huur" met
    // expliciete invoice_ids zodat backend FIFO naar die exacte facturen
    // alloceert (i.p.v. oudste eerst).
    const category = (selectedInvItems.length > 0 || selectedSynCurrent > 0) && selectedPlainKeys.length === 0
      ? 'huur' : plainCategory;
    // BUG FIX: period_month/year moet reflecteren wat de operator daadwerkelijk
    // heeft geselecteerd, niet altijd next_period. Situatie: operator selecteert
    // JULI-factuur maar next_period wijst naar augustus (of andersom) → dan
    // stond periode=aug maar note="Huur jul" op de kwitantie. Verwarrend.
    // Prioriteit: oudste geselecteerde factuur → syntetische huidige-maand →
    // fallback next_period.
    let periodMonthOut = null;
    let periodYearOut = null;
    if (category === 'huur') {
      if (selectedInvItems.length > 0) {
        const sortedInvs = [...selectedInvItems].sort((a, b) => {
          const ay = a.period_year || 0, by = b.period_year || 0;
          if (ay !== by) return ay - by;
          return (a.period_month || 0) - (b.period_month || 0);
        });
        const oldest = sortedInvs[0];
        periodMonthOut = oldest?.period_month || null;
        periodYearOut = oldest?.period_year || null;
      } else if (selectedSynCurrent > 0 && syntheticCurrent) {
        periodMonthOut = syntheticCurrent.period_month || null;
        periodYearOut = syntheticCurrent.period_year || null;
      } else if (balance.next_period) {
        periodMonthOut = balance.next_period.month;
        periodYearOut = balance.next_period.year;
      }
    }
    // Note MOET dezelfde periode reflecteren als period_month/year zodat
    // kwitantie + email geen tegenstrijdige info tonen. Voor "huur" met
    // een concrete maand → "Huur <maand> <jaar>". Anders val terug op de
    // beschrijvende buildDescription() (voor gemengde betalingen).
    let noteOut;
    if (category === 'huur' && periodMonthOut && periodYearOut) {
      const monthLabel = MONTHS_NL[periodMonthOut - 1];
      if (selectedInvItems.length > 1) {
        // Meerdere maanden — toon range i.p.v. alleen oudste.
        const monthsShort = selectedInvItems
          .slice()
          .sort((a, b) => (a.period_year || 0) - (b.period_year || 0)
            || (a.period_month || 0) - (b.period_month || 0))
          .map((inv) => inv.period_month
            ? `${MONTHS_NL[inv.period_month - 1]} ${inv.period_year || ''}`.trim()
            : null)
          .filter(Boolean);
        noteOut = `Huur ${monthsShort.join(', ')}`;
      } else {
        noteOut = `Huur ${monthLabel} ${periodYearOut}`;
      }
    } else {
      noteOut = buildDescription();
    }
    onConfirm({
      tenant_id: tenant.id, apartment_id: apt.id,
      amount: selectedTotal,  // totaal incl. plan items (voor display)
      plain_amount: selectedPlainTotal + selectedInvTotal + selectedSynCurrent,  // alleen plain + invoice + synth current
      currency: cur, category, method: 'contant',
      period_month: periodMonthOut,
      period_year: periodYearOut,
      note: noteOut,
      plan_items: selectedPlanItems.map((x) => ({
        plan_id: x.planId, seq: x.seq, amount: x.amount,
      })),
      // Doorgeven aan backend zodat _allocate_payment_to_invoices op deze
      // specifieke factuur-IDs werkt (FIFO BINNEN selectie). Backend gebruikt
      // dit veld om de partial-betaling correct toe te wijzen.
      invoice_ids: selectedInvItems.map((x) => x.id),
    });
  };

  return (
    <div className="h-full bg-orange-500 flex flex-col px-3 sm:px-6 pt-2">
      <div className="flex items-center justify-between flex-wrap gap-2 py-2">
        <button onClick={onBack} data-testid="payselect-back-btn"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
        <span className="text-sm sm:text-base font-semibold text-white">{isAdvance ? 'Vooruitbetaling registreren' : 'Wat wilt u betalen?'}</span>
        <div className="text-right text-white hidden sm:block">
          <p className="text-xs sm:text-sm font-semibold">{tenant.name}</p>
          <p className="text-[10px] sm:text-xs opacity-70">Appt. {apt.number}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-2 sm:gap-3 min-h-0 pb-2">
        {/* LEFT — Payment items */}
        <div className="bg-white rounded-2xl flex-1 md:flex-[3] flex flex-col min-w-0 p-2 sm:p-3">
          {(enabled.length > 1 || planInstallments.length > 0) && (
            <button onClick={selectAll} data-testid="pay-select-all"
              className={`w-full flex items-center justify-between rounded-lg border-2 transition px-2.5 py-2 sm:px-3 sm:py-2.5 mb-1.5 ${
                allSelected ? 'bg-orange-50 border-orange-400' : 'bg-white border-slate-200 hover:border-orange-300'
              }`}>
              <div className="flex items-center gap-2">
                <div className={`flex items-center justify-center rounded border-2 w-5 h-5 ${allSelected ? 'bg-orange-500 border-orange-500' : 'border-slate-300'}`}>
                  {allSelected && <Check className="text-white w-3.5 h-3.5" strokeWidth={3} />}
                </div>
                <span className="text-sm font-bold text-slate-900">Alles betalen</span>
              </div>
              <span className="text-sm sm:text-base font-semibold text-orange-600 whitespace-nowrap">
                {fmt(enabled.reduce((s, t) => s + (amounts[t.id] || 0), 0)
                  + openInvoicesFiltered.reduce((s, x) => s + Number(x.outstanding || 0), 0)
                  + currentInvoicesFiltered.reduce((s, x) => s + Number(x.outstanding || 0), 0)
                  + (syntheticCurrent ? Number(syntheticCurrent.outstanding || 0) : 0)
                  + planInstallments.reduce((s, p) => s + p.amount, 0))}
              </span>
            </button>
          )}

          <div className="flex flex-col gap-1 sm:gap-1.5 flex-1">
            {/* Achterstallige huur — één regel per maand */}
            {hasOpenInvoices && (
              <>
                <div className="flex items-center gap-2 mt-1 mb-0.5 px-1">
                  <div className="h-px flex-1 bg-red-200" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-red-600">
                    Achterstallige huur · {openInvoicesFiltered.length} {openInvoicesFiltered.length === 1 ? 'maand' : 'maanden'}
                  </span>
                  <div className="h-px flex-1 bg-red-200" />
                </div>
                {openInvoicesFiltered.map((inv) => {
                  const key = invItemKey(inv);
                  const sel = selected.has(key);
                  return (
                    <button key={key} onClick={() => toggle(key)} data-testid={`pay-inv-${inv.id}`}
                      className={`flex items-center justify-between w-full rounded-lg border-2 transition px-2.5 py-2 sm:px-3 sm:py-2.5 ${
                        sel ? 'bg-red-50 border-red-400' : 'bg-white border-slate-200 hover:border-red-300'
                      }`}>
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center justify-center rounded border-2 flex-shrink-0 w-5 h-5 ${sel ? 'bg-red-500 border-red-500' : 'border-slate-300'}`}>
                          {sel && <Check className="text-white w-3.5 h-3.5" strokeWidth={3} />}
                        </div>
                        <div className={`rounded-lg flex items-center justify-center flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 ${sel ? 'bg-red-100' : 'bg-slate-50'}`}>
                          <Banknote className={`w-4 h-4 sm:w-5 sm:h-5 ${sel ? 'text-red-500' : 'text-slate-400'}`} />
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-bold text-slate-900 block">
                            Huur {inv.period_month && inv.period_year
                              ? `${MONTHS_NL[inv.period_month - 1]} ${inv.period_year}`
                              : ''}
                          </span>
                          {inv.is_partial ? (
                            <span className="text-[10px] text-amber-700 font-bold">
                              Deels betaald · nog {fmt(inv.outstanding)} open
                            </span>
                          ) : inv.due_date ? (
                            <span className="text-[10px] text-slate-400">
                              Vervalt {new Date(inv.due_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className={`text-sm sm:text-base flex-shrink-0 ml-2 whitespace-nowrap font-semibold ${sel ? 'text-red-600' : 'text-slate-900'}`}>
                        {fmt(inv.outstanding)}
                      </p>
                    </button>
                  );
                })}
              </>
            )}

            {/* Openstaande huidige maand — één regel per factuur (typisch 1, maar
                kan 2 zijn vroeg in een nieuwe maand met vorige maand nog in grace) */}
            {hasCurrentInvoices && (
              <>
                <div className="flex items-center gap-2 mt-2 mb-0.5 px-1">
                  <div className="h-px flex-1 bg-amber-200" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-600">
                    Openstaande huidige maand
                  </span>
                  <div className="h-px flex-1 bg-amber-200" />
                </div>
                {currentInvoicesFiltered.map((inv) => {
                  const key = invItemKey(inv);
                  const sel = selected.has(key);
                  return (
                    <button key={key} onClick={() => toggle(key)} data-testid={`pay-current-${inv.id}`}
                      className={`flex items-center justify-between w-full rounded-lg border-2 transition px-2.5 py-2 sm:px-3 sm:py-2.5 ${
                        sel ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-200 hover:border-amber-300'
                      }`}>
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center justify-center rounded border-2 flex-shrink-0 w-5 h-5 ${sel ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                          {sel && <Check className="text-white w-3.5 h-3.5" strokeWidth={3} />}
                        </div>
                        <div className={`rounded-lg flex items-center justify-center flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 ${sel ? 'bg-amber-100' : 'bg-slate-50'}`}>
                          <Home className={`w-4 h-4 sm:w-5 sm:h-5 ${sel ? 'text-amber-500' : 'text-slate-400'}`} />
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-bold text-slate-900 block">
                            Huur {inv.period_month && inv.period_year
                              ? `${MONTHS_NL[inv.period_month - 1]} ${inv.period_year}`
                              : ''}
                          </span>
                          {inv.is_partial ? (
                            <span className="text-[10px] text-amber-700 font-bold">
                              Deels betaald · nog {fmt(inv.outstanding)} open
                            </span>
                          ) : inv.due_date ? (
                            <span className="text-[10px] text-slate-400">
                              Vervalt {new Date(inv.due_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-600 font-semibold">Lopende maand</span>
                          )}
                        </div>
                      </div>
                      <p className={`text-sm sm:text-base flex-shrink-0 ml-2 whitespace-nowrap font-semibold ${sel ? 'text-amber-600' : 'text-slate-900'}`}>
                        {fmt(inv.outstanding)}
                      </p>
                    </button>
                  );
                })}
                {syntheticCurrent && (
                  <button onClick={() => toggle(synItemKey())} data-testid="pay-current-synth"
                    className={`flex items-center justify-between w-full rounded-lg border-2 transition px-2.5 py-2 sm:px-3 sm:py-2.5 ${
                      selected.has(synItemKey()) ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-200 hover:border-amber-300'
                    }`}>
                    <div className="flex items-center gap-2">
                      <div className={`flex items-center justify-center rounded border-2 flex-shrink-0 w-5 h-5 ${selected.has(synItemKey()) ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                        {selected.has(synItemKey()) && <Check className="text-white w-3.5 h-3.5" strokeWidth={3} />}
                      </div>
                      <div className="rounded-lg flex items-center justify-center flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 bg-slate-50">
                        <Home className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                      </div>
                      <div className="text-left">
                        <span className="text-sm font-bold text-slate-900 block">Maandhuur</span>
                        <span className="text-[10px] text-amber-600 font-semibold">Lopende maand (geen factuur)</span>
                      </div>
                    </div>
                    <p className={`text-sm sm:text-base flex-shrink-0 ml-2 whitespace-nowrap font-semibold ${selected.has(synItemKey()) ? 'text-amber-600' : 'text-slate-900'}`}>
                      {fmt(syntheticCurrent.outstanding)}
                    </p>
                  </button>
                )}
              </>
            )}

            {/* Boetes + Internet — reguliere extras */}
            {PAY_ITEMS_TEMPLATE.map((t) => {
              const disabled = isDisabled(t.id);
              const sel = selected.has(t.id);
              const Icon = t.icon;
              return (
                <button key={t.id} disabled={disabled} onClick={() => toggle(t.id)} data-testid={`pay-type-${t.id}`}
                  className={`flex items-center justify-between w-full rounded-lg border-2 transition px-2.5 py-2 sm:px-3 sm:py-2.5 ${
                    disabled ? 'bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed' :
                    sel ? 'bg-orange-50 border-orange-400' : 'bg-white border-slate-200 hover:border-orange-300'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className={`flex items-center justify-center rounded border-2 flex-shrink-0 w-5 h-5 ${sel ? 'bg-orange-500 border-orange-500' : 'border-slate-300'}`}>
                      {sel && <Check className="text-white w-3.5 h-3.5" strokeWidth={3} />}
                    </div>
                    <div className={`rounded-lg flex items-center justify-center flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 ${sel ? 'bg-orange-100' : 'bg-slate-50'}`}>
                      <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${sel ? 'text-orange-500' : 'text-slate-400'}`} />
                    </div>
                    <span className="text-sm font-bold text-slate-900">{t.label}</span>
                  </div>
                  <p className={`text-sm sm:text-base flex-shrink-0 ml-2 whitespace-nowrap font-semibold ${disabled ? 'text-slate-300' : sel ? 'text-orange-600' : 'text-slate-900'}`}>
                    {fmt(amounts[t.id] || 0)}
                  </p>
                </button>
              );
            })}

            {/* Vooruit gefactureerd — opt-in (NIET standaard in Alles betalen) */}
            {hasFutureInvoices && (
              <>
                <div className="flex items-center gap-2 mt-2 mb-0.5 px-1">
                  <div className="h-px flex-1 bg-blue-200" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">
                    Vooruit gefactureerd · optioneel
                  </span>
                  <div className="h-px flex-1 bg-blue-200" />
                </div>
                {futureInvoicesFiltered.map((inv) => {
                  const key = invItemKey(inv);
                  const sel = selected.has(key);
                  return (
                    <button key={key} onClick={() => toggle(key)} data-testid={`pay-future-${inv.id}`}
                      className={`flex items-center justify-between w-full rounded-lg border-2 transition px-2.5 py-2 sm:px-3 sm:py-2.5 ${
                        sel ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-200 hover:border-blue-300'
                      }`}>
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center justify-center rounded border-2 flex-shrink-0 w-5 h-5 ${sel ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                          {sel && <Check className="text-white w-3.5 h-3.5" strokeWidth={3} />}
                        </div>
                        <div className={`rounded-lg flex items-center justify-center flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 ${sel ? 'bg-blue-100' : 'bg-slate-50'}`}>
                          <Calendar className={`w-4 h-4 sm:w-5 sm:h-5 ${sel ? 'text-blue-500' : 'text-slate-400'}`} />
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-bold text-slate-900 block">
                            Huur {inv.period_month && inv.period_year
                              ? `${MONTHS_NL[inv.period_month - 1]} ${inv.period_year}`
                              : ''}
                          </span>
                          <span className="text-[10px] text-blue-600 font-semibold">Vooruit gefactureerd</span>
                        </div>
                      </div>
                      <p className={`text-sm sm:text-base flex-shrink-0 ml-2 whitespace-nowrap font-semibold ${sel ? 'text-blue-600' : 'text-slate-900'}`}>
                        {fmt(inv.outstanding)}
                      </p>
                    </button>
                  );
                })}
              </>
            )}
            {planInstallments.length > 0 && (
              <div className="flex items-center gap-2 mt-1 mb-0.5 px-1">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Betalingsregeling
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            {planInstallments.map((it) => {
              const today = new Date().toISOString().slice(0, 10);
              const isOverdue = (it.due_date || '') < today;
              const key = planItemKey(it);
              const sel = selected.has(key);
              return (
                <button key={key} onClick={() => toggle(key)}
                  data-testid={`pay-plan-${it.planId}-${it.seq}`}
                  className={`flex items-center justify-between w-full rounded-lg border-2 transition px-2.5 py-2 sm:px-3 sm:py-2.5 ${
                    sel ? 'bg-orange-50 border-orange-400' : 'bg-white border-slate-200 hover:border-orange-300'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className={`flex items-center justify-center rounded border-2 flex-shrink-0 w-5 h-5 ${sel ? 'bg-orange-500 border-orange-500' : 'border-slate-300'}`}>
                      {sel && <Check className="text-white w-3.5 h-3.5" strokeWidth={3} />}
                    </div>
                    <div className={`rounded-lg flex items-center justify-center flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 ${
                      isOverdue ? 'bg-red-100' : sel ? 'bg-orange-100' : 'bg-slate-50'
                    }`}>
                      <Calendar className={`w-4 h-4 ${isOverdue ? 'text-red-500' : sel ? 'text-orange-500' : 'text-slate-400'}`} />
                    </div>
                    <div className="text-left min-w-0">
                      <p className="text-sm font-bold text-slate-900">
                        Termijn {it.seq}
                        {isOverdue && <span className="ml-1 text-[10px] uppercase tracking-widest text-red-600">achterstallig</span>}
                      </p>
                      <p className="text-[10px] text-slate-500">Vervalt {it.due_date}</p>
                    </div>
                  </div>
                  <p className={`text-sm sm:text-base font-semibold whitespace-nowrap ml-2 ${sel ? 'text-orange-600' : 'text-slate-900'}`}>
                    {fmt(it.amount)}
                  </p>
                </button>
              );
            })}
          </div>

          {selected.size > 0 && (
            <div className="bg-slate-900 rounded-lg flex items-center justify-between px-3 py-2 sm:py-2.5 mt-1.5">
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{selected.size} item{selected.size > 1 ? 's' : ''}</p>
                <p className="text-xs text-white truncate">{buildDescription()}</p>
              </div>
              <p className="text-base sm:text-lg font-bold text-white whitespace-nowrap ml-2">{fmt(selectedTotal)}</p>
            </div>
          )}

          <button onClick={handleNext} disabled={!canProceed} data-testid="payment-next-btn"
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl flex items-center justify-center gap-2 transition active:scale-[0.98] py-3 sm:py-3.5 mt-1.5 text-sm sm:text-base font-bold">
            <span>Direct betalen — {fmt(activeAmount)}</span> <ArrowRight className="w-5 h-5" />
          </button>

          {/* Regeling-afspraak knop: alleen tonen wanneer er échte facturen
              geselecteerd zijn (achterstand / huidige / vooruit). Werkt NIET
              voor vooruitbetaling-modus. */}
          {(selectedInvItems.length > 0 || selectedSynCurrent > 0) && !isAdvance && (
            <button onClick={() => setPlanModalOpen(true)}
              data-testid="payment-plan-arrange-btn"
              className="w-full bg-white border-2 border-orange-300 hover:border-orange-500 text-orange-600 hover:bg-orange-50 rounded-xl flex items-center justify-center gap-2 transition active:scale-[0.98] py-2.5 mt-1.5 text-sm font-bold">
              <Calendar className="w-4 h-4" /> <span>Regeling afspreken — {fmt(selectedInvTotal + selectedSynCurrent)}</span>
            </button>
          )}

          {/* Mobile keypad toggle */}
          <div className="md:hidden mt-1.5">
            {!showMobileKeypad ? (
              <button onClick={() => setShowMobileKeypad(true)} data-testid="mobile-custom-toggle"
                className="w-full flex items-center justify-center gap-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition">
                <Hash className="w-4 h-4" /> Ander bedrag invoeren
              </button>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-medium">Ander bedrag ({cur})</span>
                  <button onClick={() => { setShowMobileKeypad(false); setCustom(''); }} className="text-xs text-slate-400">Sluiten</button>
                </div>
                <div className={`border-2 rounded-lg text-center py-2 mb-2 ${hasCustom ? 'bg-orange-50 border-orange-300' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`font-mono font-extrabold text-xl ${hasCustom ? 'text-orange-600' : 'text-slate-300'}`}>{cur} {custom || '0.00'}</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {['1','2','3','DEL','4','5','6','.','7','8','9','0'].map((k) => (
                    <button key={k} onClick={() => press(k)} data-testid={`mobile-key-${k}`}
                      className={`rounded-lg font-bold transition active:scale-95 h-10 text-base ${
                        k === 'DEL' ? 'bg-red-50 text-red-500 text-xs' : 'bg-slate-50 text-slate-900 hover:bg-orange-50 hover:text-orange-600 border border-slate-100'
                      }`}>{k}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Desktop keypad */}
        <div className="bg-white rounded-2xl hidden md:flex flex-none md:flex-[2] flex-col min-w-0 p-4 sm:p-5">
          <h4 className="text-sm sm:text-base font-bold text-slate-900 mb-0.5">Bedrag invoeren</h4>
          <p className="text-xs text-slate-400 mb-3">Totaal openstaand: {fmt(total_due)}</p>
          <div className={`border-2 rounded-lg transition px-3 py-3 mb-3 ${hasCustom ? 'bg-orange-50 border-orange-300' : 'bg-slate-50 border-slate-200'}`}>
            <p className="text-xs text-slate-400 mb-0.5">{cur}</p>
            <p className={`font-extrabold font-mono text-2xl sm:text-3xl ${hasCustom ? 'text-orange-600' : 'text-slate-900'}`} data-testid="pay-amount-display">
              {custom || '0.00'}
            </p>
          </div>
          <div className="grid grid-cols-3 flex-1 gap-1.5">
            {['1','2','3','4','5','6','7','8','9','.','0','DEL'].map((k) => (
              <button key={k} onClick={() => press(k)} data-testid={`keypad-${k}`}
                className={`rounded-lg font-bold transition active:scale-95 flex items-center justify-center text-base sm:text-lg ${
                  k === 'DEL' ? 'bg-slate-100 text-red-500 hover:bg-red-50 border border-slate-100' :
                  'bg-slate-50 text-slate-900 hover:bg-orange-50 hover:text-orange-600 border border-slate-100'
                }`}>{k}</button>
            ))}
          </div>
        </div>
      </div>

      {planModalOpen && !planSuccess && (
        <ArrangePlanModal
          tenantId={tenant.id}
          currency={cur}
          totalAmount={selectedInvTotal + selectedSynCurrent}
          invoiceIds={selectedInvItems.map((x) => x.id).filter((id) => id && id !== '__syn_current__')}
          monthsLabel={selectedInvItems
            .map((inv) => inv.period_month ? `${MONTHS_NL[inv.period_month - 1]} ${inv.period_year}` : null)
            .filter(Boolean).join(', ') + (selectedSynCurrent > 0 ? ' (huidige maand)' : '')}
          onClose={() => setPlanModalOpen(false)}
          onArranged={(result) => {
            setPlanSuccess(result);
            setPlanModalOpen(false);
          }}
        />
      )}
      {planSuccess && (
        <PlanArrangedReceipt
          plan={planSuccess}
          currency={cur}
          tenant={tenant}
          onClose={() => { setPlanSuccess(null); onBack(); }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Arrange Plan Modal — proactieve betalingsregeling vanuit PaySelect.
// Toont 2/3/4/6/8 termijn-opties met live "per maand"-bedrag en stuurt
// dit door naar POST /kiosk/payment-plans/quick met multi-invoice_ids.
// =====================================================================
function ArrangePlanModal({ tenantId, currency, totalAmount, invoiceIds, monthsLabel, onClose, onArranged }) {
  const [n, setN] = useState(3);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const per = totalAmount / n;
  const fmt = (v) => fmtMoney(v, currency);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const body = {
        tenant_id: tenantId,
        invoice_ids: invoiceIds,
        total_amount: Number(totalAmount.toFixed(2)),
        num_installments: n,
        currency,
        start_date: startDate,
        notes: `Regeling afgesproken voor: ${monthsLabel || 'huurfacturen'}`,
      };
      const { data } = await api.post('/kiosk/payment-plans/quick', body);
      onArranged(data);
    } catch (e) {
      setErr(formatError(e) || 'Kon regeling niet aanmaken');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      data-testid="arrange-plan-modal" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 bg-orange-500 text-white">
          <p className="text-xs uppercase tracking-widest font-bold opacity-80">Betalingsregeling afspreken</p>
          <p className="text-xl font-extrabold mt-1">{fmt(totalAmount)}</p>
          {monthsLabel && <p className="text-xs opacity-80 mt-0.5">Voor: {monthsLabel}</p>}
        </div>
        <div className="p-6">
          <p className="text-sm font-bold text-slate-700 mb-2">In hoeveel termijnen?</p>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {[2, 3, 4, 6, 8].map((opt) => (
              <button key={opt} onClick={() => setN(opt)}
                data-testid={`arrange-plan-n-${opt}`}
                className={`rounded-lg py-3 font-bold text-sm transition ${
                  n === opt ? 'bg-orange-500 text-white ring-2 ring-orange-300'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}>
                {opt}×
              </button>
            ))}
          </div>

          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-700 font-semibold">Per maand</span>
              <span className="font-extrabold text-orange-600">{fmt(per)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
              <span>{n} termijnen, maandelijks</span>
              <span>Eerste op {startDate}</span>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-bold text-slate-700">Startdatum eerste termijn</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              data-testid="arrange-plan-start-date"
              className="mt-1 w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm font-medium" />
          </label>

          {err && <p className="text-xs text-red-600 mt-3 bg-red-50 border border-red-200 rounded-lg p-2">{err}</p>}
        </div>
        <div className="px-6 py-4 bg-slate-50 flex gap-2 border-t border-slate-100">
          <button onClick={onClose} disabled={busy}
            data-testid="arrange-plan-cancel"
            className="flex-1 py-2.5 rounded-lg bg-white border-2 border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-100 disabled:opacity-50">
            Annuleren
          </button>
          <button onClick={submit} disabled={busy}
            data-testid="arrange-plan-confirm"
            className="flex-[2] py-2.5 rounded-lg bg-orange-500 text-white font-bold text-sm hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Regeling bevestigen
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Plan Arranged Receipt — bevestiging na succesvolle regeling-creatie.
// =====================================================================
function PlanArrangedReceipt({ plan, currency, tenant, onClose }) {
  const fmt = (v) => fmtMoney(v, currency);
  const per = plan.installment_amount || plan.monthly_amount || (plan.total_amount / plan.num_installments);
  const pdfUrl = plan.pdf_url
    ? `${process.env.REACT_APP_BACKEND_URL}${plan.pdf_url}`
    : `${process.env.REACT_APP_BACKEND_URL}/api/kiosk/payment-plans/${plan.id}/pdf`;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      data-testid="plan-arranged-receipt">
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="px-6 py-5 bg-emerald-500 text-white text-center">
          <div className="w-14 h-14 rounded-full bg-white/20 mx-auto flex items-center justify-center mb-2">
            <Check className="w-8 h-8 text-white" strokeWidth={3} />
          </div>
          <p className="text-xs uppercase tracking-widest font-bold opacity-90">Regeling aangemaakt</p>
          <p className="text-2xl font-extrabold mt-1">{fmt(plan.total_amount)}</p>
        </div>
        <div className="p-6 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Huurder</span>
            <span className="font-bold">{tenant.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Termijnen</span>
            <span className="font-bold">{plan.num_installments}× {fmt(per)}</span>
          </div>
          {plan.first_due_date && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Eerste vervaldatum</span>
              <span className="font-bold">{plan.first_due_date}</span>
            </div>
          )}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-700">
            Beheer ontvangt een melding. Termijnen verschijnen automatisch bij het volgende kiosk-bezoek.
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-2">
          <a href={pdfUrl} target="_blank" rel="noreferrer"
            data-testid="plan-arranged-pdf"
            className="py-3 rounded-lg bg-white border-2 border-orange-300 text-orange-600 font-bold text-sm hover:bg-orange-50 flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> PDF
          </a>
          <button onClick={onClose}
            data-testid="plan-arranged-close"
            className="py-3 rounded-lg bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-600">
            Sluiten
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Method select — Contant / Bankoverschrijving
// =====================================================================
function MethodSelect({ payload, overview, onBack, onConfirm }) {
  const { tenant, apartment: apt } = overview;
  const cur = payload.currency || 'SRD';
  const methods = [
    { v: 'contant', l: 'Contant', sub: 'Betaal met contant geld', icon: Banknote, accent: 'emerald' },
    { v: 'bank', l: 'Bankoverschrijving', sub: 'Overboeking naar bankrekening', icon: CreditCard, accent: 'blue' },
  ];
  // Poll het klantenscherm puur om te VISUALISEREN welke methode de klant
  // heeft aangeraakt — we navigeren GEEN automatisch door. De medewerker
  // moet altijd zelf bevestigen via de "Bevestig" knop. Dit voorkomt dat
  // een per ongeluk geraakte methode de betaling vastlegt.
  const [customerPicked, setCustomerPicked] = useState(null);
  useEffect(() => {
    let stopped = false;
    let timer;
    const tick = async () => {
      try {
        const { data } = await api.get(`/kiosk/customer-display?t=${Date.now()}`);
        const m = data?.state?.payload?.method;
        const at = data?.state?.payload?.method_chosen_at;
        if (at && m && !stopped) setCustomerPicked(m);
      } catch { /* ignore */ }
      if (!stopped) timer = setTimeout(tick, 600);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, []);
  // GEEN useEffect die automatisch onConfirm aanroept — medewerker bevestigt.

  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }}>
      <div className="flex items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2">
        <button onClick={onBack} data-testid="method-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
        <span className="text-sm sm:text-base font-semibold text-white">
          Hoe wilt u betalen? <span className="ml-2 opacity-80">{fmtMoney(payload.amount, cur)}</span>
        </span>
        <div className="text-right text-white">
          <p className="text-xs sm:text-sm font-semibold">{tenant.name}</p>
          <p className="text-[10px] sm:text-xs opacity-70">Appt. {apt.number}</p>
        </div>
      </div>
      <div className="px-2 sm:px-4 mb-1">
        <div className="bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2 text-white text-center text-sm font-bold"
          data-testid="method-waiting-customer">
          <Loader2 className="inline-block w-4 h-4 mr-2 animate-spin" />
          Wacht op klant: laat hen op het klantenscherm de betaalmethode kiezen — of tik hieronder voor handmatige invoer.
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center pb-6 overflow-auto">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 max-w-4xl w-full px-2">
          {methods.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.v} onClick={() => onConfirm({ ...payload, method: m.v })} data-testid={`method-${m.v}`}
                className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-8 flex sm:flex-col items-center sm:justify-center text-left sm:text-center gap-4 sm:gap-0 hover:scale-[1.02] sm:hover:scale-[1.03] active:scale-[0.98] transition sm:aspect-[3/4] shadow-2xl">
                <div className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full flex items-center justify-center shrink-0 sm:mb-4 ${
                  m.accent === 'red' ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'
                }`}>
                  <Icon className="w-7 h-7 sm:w-10 sm:h-10" />
                </div>
                <div className="min-w-0 flex-1 sm:flex-none">
                  <p className="text-lg sm:text-2xl font-extrabold text-slate-900">{m.l}</p>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5 sm:mt-1">{m.sub}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 sm:hidden ml-auto shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Confirm + Receipt
// =====================================================================
function PaymentConfirm({ payload, overview, onBack, onSuccess }) {
  const { tenant, apartment: apt } = overview;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setLoading(true); setErr('');
    try {
      const planItems = payload.plan_items || [];
      for (const pi of planItems) {
        await api.post(withKioskEmployee(`/kiosk/payment-plans/${pi.plan_id}/installments/${pi.seq}/pay`), {
          method: payload.method,
          amount: pi.amount,
          note: `Operator Kiosk — termijn ${pi.seq}`,
        });
      }
      let data;
      const plainAmount = payload.plain_amount != null ? payload.plain_amount : payload.amount;
      if (plainAmount && plainAmount > 0) {
        const plainPayload = { ...payload, amount: plainAmount };
        delete plainPayload.plan_items; delete plainPayload.plain_amount;
        const res = await api.post(withKioskEmployee('/kiosk/payments'), plainPayload);
        data = res.data;
      } else {
        data = { kind: 'plan_only', plan_items: planItems };
      }
      playSuccessPing();
      onSuccess(data);
    } catch (e) { setErr(formatError(e)); playErrorBuzz(); }
    finally { setLoading(false); }
  };

  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }}>
      <div className="flex items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2">
        <button onClick={onBack} data-testid="confirm-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
        <span className="text-sm sm:text-base font-semibold text-white">Bevestig betaling</span>
        <div className="text-right text-white">
          <p className="text-xs sm:text-sm font-semibold">{tenant.name}</p>
          <p className="text-[10px] sm:text-xs opacity-70">Appt. {apt.number}</p>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center pb-6">
        <div className="bg-white rounded-3xl w-full max-w-xl p-6 sm:p-8 shadow-2xl">
          <div className="bg-slate-900 rounded-2xl p-6 mb-5 text-white text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-white/60">Te betalen</p>
            <p className="text-5xl font-extrabold tracking-tight mt-2 text-orange-400">{fmtMoney(payload.amount, payload.currency)}</p>
            <p className="text-sm text-white/80 mt-2 capitalize">
              {payload.note || payload.category}
              {payload.period_month ? ` · ${MONTHS_NL[payload.period_month - 1]} ${payload.period_year}` : ''}
            </p>
          </div>
          <div className="space-y-2 mb-5">
            <Row label="Huurder" value={tenant.name} />
            <Row label="Appartement" value={`Appt. ${apt.number}`} />
            <Row label="Betaalwijze" value={String(payload.method || '').toUpperCase()} />
          </div>
          {err && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{err}</div>}
          <button onClick={submit} disabled={loading} data-testid="confirm-submit"
            className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 text-white text-lg font-extrabold rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
            Bevestig betaling
          </button>
        </div>
      </div>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center bg-slate-50 rounded-lg p-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-900">{value}</span>
    </div>
  );
}

function PartialPlanSuggestion({ tenantId, partialInvoice, onClose, onPlanned }) {
  const cur = (partialInvoice?.currency || 'SRD').toUpperCase();
  const remaining = Number(partialInvoice?.outstanding || 0);
  const fmt = (v) => fmtMoney(v, cur);
  const [n, setN] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const monthly = useMemo(() => Math.round((remaining / n) * 100) / 100, [remaining, n]);

  if (!partialInvoice || remaining <= 0) return null;

  const monthName = partialInvoice.period_month
    ? `${MONTHS_NL[partialInvoice.period_month - 1]} ${partialInvoice.period_year}`
    : 'deze factuur';

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/kiosk/payment-plans/quick', {
        tenant_id: tenantId,
        invoice_id: partialInvoice.id,
        total_amount: remaining,
        num_installments: n,
        currency: cur,
      });
      onPlanned?.(data);
    } catch (e) {
      setErr(formatError(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      data-testid="partial-plan-suggestion"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0px)' }}>
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <span className="w-10 h-1.5 rounded-full bg-slate-200" />
        </div>
        <div className="px-5 pt-3 sm:pt-6 pb-2 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-orange-500/25">
            <Calendar className="w-6 h-6 text-white" />
          </div>
          <h3 className="text-xl font-extrabold text-slate-900">Resterend bedrag afspreken?</h3>
          <p className="text-sm text-slate-500 mt-1">
            Er staat nog <span className="font-extrabold text-orange-600">{fmt(remaining)}</span> open voor {monthName}.
          </p>
        </div>

        <div className="px-5 py-3 flex-1 overflow-y-auto">
          <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">In hoeveel termijnen?</p>
          <div className="grid grid-cols-3 gap-2">
            {[2, 3, 4].map((opt) => {
              const sel = n === opt;
              const per = Math.round((remaining / opt) * 100) / 100;
              return (
                <button key={opt} onClick={() => setN(opt)} data-testid={`partial-plan-n-${opt}`}
                  className={`rounded-xl border-2 p-3 text-center transition ${
                    sel ? 'border-orange-500 bg-orange-50 shadow-md shadow-orange-500/20'
                      : 'border-slate-200 bg-white hover:border-orange-300'
                  }`}>
                  <p className={`text-2xl font-extrabold ${sel ? 'text-orange-600' : 'text-slate-700'}`}>{opt}×</p>
                  <p className={`text-[10px] uppercase tracking-wider font-bold mt-0.5 ${sel ? 'text-orange-700' : 'text-slate-400'}`}>termijnen</p>
                  <p className={`text-xs font-mono font-extrabold mt-1.5 ${sel ? 'text-orange-700' : 'text-slate-500'}`}>{fmt(per)}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-500 font-bold">Per maand</span>
              <span className="font-extrabold text-slate-900 font-mono">{fmt(monthly)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-bold">Eerste vervaldatum</span>
              <span className="font-mono text-slate-700 font-semibold">~30 dagen vanaf vandaag</span>
            </div>
          </div>

          {err && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
              {err}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 py-3 grid grid-cols-2 gap-2 shrink-0">
          <button onClick={onClose} disabled={busy} data-testid="partial-plan-skip"
            className="h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold disabled:opacity-50">
            Nee, later
          </button>
          <button onClick={submit} disabled={busy} data-testid="partial-plan-confirm"
            className="h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-md shadow-orange-500/25">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Maak regeling
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiptScreen({ payment, overview, onDone }) {
  // Bereken openstaand saldo NA deze betaling — refetch van backend voor
  // de echte stand (rekening houdend met openstaande maanden + nieuwe
  // huurperiode). Fallback: vorige overview min betaald bedrag.
  const cur = payment.currency || overview?.balance?.currency || 'SRD';
  const [remaining, setRemaining] = useState(() => {
    const prevDue = Number(overview?.total_due || 0);
    return Math.max(0, prevDue - Number(payment.amount || 0));
  });
  const [remainingLoading, setRemainingLoading] = useState(true);
  // E-mail status — null = bezig, {sent:true,to} = verstuurd, {sent:false} = overgeslagen/mislukt.
  const [emailStatus, setEmailStatus] = useState(null);

  // Partial-betaling detectie: na de refetch checken we of er een factuur
  // is die zojuist gedeeltelijk betaald is en nog open staat. Zo ja, tonen
  // we de "regeling maken?"-suggestie BEFORE auto-done.
  const [partialInv, setPartialInv] = useState(null);
  const [planMade, setPlanMade] = useState(false);

  useEffect(() => {
    const tid = payment.tenant_id || overview?.tenant?.id;
    if (!tid) { setRemainingLoading(false); return; }
    api.get(`/kiosk/tenants/${tid}/overview`)
      .then((r) => {
        const data = r.data || {};
        const bal = Number(data?.balance?.balance || 0);
        const open = bal > 0 ? bal : 0;
        const internet = Number(data?.tenant?.internet_amount || 0);
        setRemaining(open + internet);
        // Eerste partial-factuur uit de bijgewerkte overview pakken.
        const invs = Array.isArray(data?.open_invoices) ? data.open_invoices : [];
        const partial = invs.find((inv) => inv.is_partial && inv.outstanding > 0);
        if (partial) setPartialInv(partial);
      })
      .catch(() => { /* val terug op lokale schatting */ })
      .finally(() => setRemainingLoading(false));
  }, [payment.tenant_id, overview]);

  // Digitale kopie verzenden — e-mail (PDF-bijlage) + WhatsApp/SMS (PDF-link)
  // tegelijk, getriggerd op het tear-moment. Beide endpoints zijn best-effort
  // en faken nooit een fout; UX blijft soepel.
  useEffect(() => {
    const t = setTimeout(() => {
      Promise.all([
        api.post(`/kiosk/payments/${payment.id}/email`).then((r) => r.data).catch(() => ({ sent: false })),
        api.post(`/kiosk/payments/${payment.id}/whatsapp`).then((r) => r.data).catch(() => ({ sent: false })),
      ]).then(([email, msg]) => {
        setEmailStatus({ email, msg });
      });
    }, 2900);  // direct na de tear-snap
    return () => clearTimeout(t);
  }, [payment.id]);

  // AUTO-PRINT — direct na de tear-animatie de standaard kwitantie naar de
  // kiosk-printer sturen. De operator hoeft niet meer via "Betalings-
  // geschiedenis > Afdruk" te tikken voor elke betaling. Werkt via een
  // verborgen iframe met de PDF-blob → contentWindow.print(). Faalt stil
  // wanneer er geen printer geconfigureerd is (browser toont dan de
  // print-dialoog die de operator gewoon kan annuleren).
  // Auto-print via universele `iframe.contentWindow.print()`. Werkt op:
  //   • Desktop Chrome met --kiosk-printing → geen dialoog, direct printen
  //   • Desktop / Laptop → OS print-dialoog (kies printer of PDF)
  //   • Android Chrome → native Android print-dialoog (Cloud Print, PDF,
  //     of "Delen naar" → Bluetooth thermische printer app)
  //   • iOS Safari → AirPrint dialoog
  //
  // Gebruikt HTML-versie i.p.v. PDF-blob zodat Chrome's --kiosk-printing
  // vlag het dialoog kan overslaan (PDF-viewer negeert die vlag).
  useEffect(() => {
    const t = setTimeout(() => {
      printReceipt({
        paymentId: payment.id,
        apiGet: api.get,
        iframeId: 'kiosk-autoprint-iframe',
      });
    }, 2950);  // 50ms na tear-snap voor cleane audio+visual sync
    return () => clearTimeout(t);
  }, [payment.id]);

  // Manuele "Print bon opnieuw" knop op het ontvangst-scherm. Hergebruikt
  // dezelfde iframe (via id) of maakt een nieuwe aan. Als de printer-dialoog
  // om welke reden dan ook geblokkeerd is (bv. iOS popup-blocker), valt
  // hij terug op de JPG-versie in een nieuw tabblad → gebruiker kan via
  // de Share Sheet alsnog afdrukken of opslaan in Foto's / WhatsApp.
  const manualPrint = async () => {
    const ok = await printReceipt({
      paymentId: payment.id,
      apiGet: api.get,
      iframeId: 'kiosk-manualprint-iframe',
    });
    if (!ok) openReceiptImage(payment.id);
  };


  // Bon-printer geluid — gesynthetiseerd via Web Audio API.
  // Imiteert een thermische kassa-printer: continue mechanische "zip" met
  // ritmische clicks (paper feed), gevolgd door een tear-cut en chime.
  useEffect(() => {
    let ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const t0 = ctx.currentTime;
      const PRINT_DUR = 2.6;    // hoofd "zip" 2.6s
      const TEAR_AT = t0 + 2.65; // korte tear-snap
      const CHIME_AT = t0 + 2.9; // chime na tear

      // --- 1) Hoofdgeluid: gefilterde ruis met snelle aan/uit modulatie
      //     (= karakteristiek zoemend papier-voer geluid van een bonprinter)
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, Math.floor(sr * PRINT_DUR), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const tt = i / sr;
        // 95Hz buzz (= papier door rollers) gecombineerd met 14Hz pulse
        // (= dot-matrix head per regel) en wat ruis voor textuur.
        const buzz = (Math.sin(tt * 2 * Math.PI * 95) > 0 ? 1 : -1) * 0.55;
        const headPulse = Math.sin(tt * 2 * Math.PI * 14) * 0.5 + 0.5; // 0..1
        const noise = (Math.random() * 2 - 1) * 0.45;
        d[i] = (buzz * 0.55 + noise * 0.7) * (0.35 + headPulse * 0.65);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 220;
      const mainGain = ctx.createGain();
      mainGain.gain.setValueAtTime(0.0001, t0);
      mainGain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.08);
      mainGain.gain.setValueAtTime(0.32, t0 + PRINT_DUR - 0.15);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, t0 + PRINT_DUR);
      src.connect(hp).connect(lp).connect(mainGain).connect(ctx.destination);
      src.start(t0);
      src.stop(t0 + PRINT_DUR);

      // --- 2) Mechanische clicks bovenop (papier-tand / step motor)
      const click = (when, vol = 0.18) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = 1800;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(vol, when + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.025);
        o.connect(g).connect(ctx.destination);
        o.start(when); o.stop(when + 0.03);
      };
      for (let i = 0; i < 18; i++) click(t0 + 0.1 + i * 0.14);

      // --- 3) Tear-snap (paper cut)
      const tearLen = Math.floor(sr * 0.18);
      const tearBuf = ctx.createBuffer(1, tearLen, sr);
      const td = tearBuf.getChannelData(0);
      for (let i = 0; i < tearLen; i++) {
        const env = 1 - i / tearLen;
        td[i] = (Math.random() * 2 - 1) * env * env;
      }
      const tear = ctx.createBufferSource();
      tear.buffer = tearBuf;
      const tearHp = ctx.createBiquadFilter();
      tearHp.type = 'highpass';
      tearHp.frequency.value = 2500;
      const tearGain = ctx.createGain();
      tearGain.gain.value = 0.5;
      tear.connect(tearHp).connect(tearGain).connect(ctx.destination);
      tear.start(TEAR_AT);

      // --- 4) Chime (success ding-ding)
      const tone = (freq, start, dur, vol = 0.22) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.connect(g).connect(ctx.destination);
        o.start(start); o.stop(start + dur);
      };
      tone(880, CHIME_AT, 0.22);
      tone(1318, CHIME_AT + 0.22, 0.32);
    } catch { /* audio kan geweigerd zijn — niet kritiek */ }

    return () => { try { ctx && ctx.close(); } catch { /* noop */ } };
  }, []);

  // Auto-terug naar beginscherm na 10 seconden. Pauzeer wanneer de partial-
  // suggestie open is — anders verdwijnt de modal achter het home-scherm voor
  // de huurder hem kan beantwoorden.
  useEffect(() => {
    if (partialInv && !planMade) return undefined;
    const t = setTimeout(onDone, 10000);
    return () => clearTimeout(t);
  }, [onDone, partialInv, planMade]);

  return (
    <div className="h-full bg-orange-500 flex flex-col items-center justify-start sm:justify-center p-4 sm:p-8 overflow-hidden">
      <div className="text-center mb-3 mt-2 sm:mt-0" data-testid="receipt-thanks">
        <div className="w-16 h-16 rounded-full bg-white/95 flex items-center justify-center mx-auto mb-2 shadow-lg">
          <Check className="w-10 h-10 text-emerald-600" strokeWidth={3} />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white">Bedankt!</h2>
        <p className="text-sm text-white/90">Uw betaling is succesvol verwerkt</p>
      </div>

      <div className="bg-white rounded-3xl w-full max-w-md p-6 sm:p-8 shadow-2xl" data-testid="receipt-card">
        {/* Printer-koplabel — blijft vast staan */}
        <div className="flex items-center justify-center gap-2 mb-2 text-slate-400">
          <Printer className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Bon Printer</span>
        </div>
        {/* Statische printer-gleuf waar het papier "uit komt" */}
        <div className="relative h-2 mb-0">
          <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-[3px] bg-slate-900 rounded-full" />
          <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-12 h-1 bg-slate-700 rounded-full" />
        </div>

        {/* Papier-uitvoer — overflow geclipt, papier schuift van bovenaf "uit" */}
        <div className="overflow-hidden mb-4 mt-2">
          <motion.div
            initial={{ y: '-100%', rotate: 0 }}
            animate={{
              y: ['-100%', '0%', '0%', '0%'],
              rotate: [0, 0, 0, 1.4],
            }}
            transition={{
              duration: 2.95,
              times: [0, 0.88, 0.93, 1],
              ease: 'easeOut',
            }}
            style={{ transformOrigin: 'top center' }}
            data-testid="receipt-paper">
            <div className="bg-white rounded-b-2xl rounded-t-md text-left border-2 border-dashed border-slate-200 border-t-0 overflow-hidden">
              {/* Prominente medewerker-banner — direct boven het bedrag.
                  Geeft de huurder vertrouwen + helpt bij klachten. */}
              {payment.received_by && (
                <div className="bg-orange-50 border-b border-orange-200 px-4 py-2 flex items-center gap-2.5"
                  data-testid="receipt-received-by-banner">
                  <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-black shrink-0">
                    {(payment.received_by || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Ontvangen door</p>
                    <p className="text-sm font-extrabold text-slate-900 truncate" data-testid="receipt-received-by">{payment.received_by}</p>
                  </div>
                </div>
              )}
              {/* Exact dezelfde bon als wat er geprint wordt — geladen
                  via de print.html endpoint in preview-modus. Forceren
                  thermal (compact, monochrome/zwart-wit) zodat de bon
                  volledig past zonder scrollen. `preview=1` schakelt
                  auto-print + de zichtbare printknop uit. */}
              <iframe
                title="Kwitantie preview"
                data-testid="receipt-preview-iframe"
                src={`${process.env.REACT_APP_BACKEND_URL}/api/payments/${payment.id}/print.html?preview=1&format=thermal`}
                className="w-full block bg-white"
                style={{ height: '540px', border: 'none' }}
                onLoad={(e) => {
                  // Auto-fit iframe hoogte op basis van content — zo
                  // vermijden we scrollbalken bij zowel korte als lange
                  // bonnen (bv. met opmerking of zonder).
                  try {
                    const doc = e.currentTarget.contentDocument;
                    if (doc && doc.body) {
                      const h = Math.min(720, Math.max(360, doc.body.scrollHeight + 8));
                      e.currentTarget.style.height = `${h}px`;
                    }
                  } catch { /* cross-origin — ignoreer, fallback = fixed height */ }
                }}
                sandbox="allow-same-origin"
              />
              {/* Openstaand-saldo balk BLIJFT los onder de iframe zodat
                  huurder zwart-op-kleur ziet wat er nog open staat. */}
              <div className={`flex justify-between items-center px-4 py-2.5 border-t border-slate-200 ${
                remaining > 0 ? 'bg-orange-50' : 'bg-emerald-50'
              }`} data-testid="receipt-remaining-row">
                <span className={`text-sm font-bold ${remaining > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>
                  Openstaand saldo
                </span>
                <span className={`font-extrabold text-base ${remaining > 0 ? 'text-orange-700' : 'text-emerald-700'}`} data-testid="receipt-remaining">
                  {remainingLoading ? '…' : fmtMoney(remaining, cur)}
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        <motion.button onClick={onDone} data-testid="receipt-done"
          initial={{ scale: 1, boxShadow: '0 0 0 0 rgba(255,92,0,0)' }}
          animate={{
            scale: [1, 1.035, 1],
            boxShadow: [
              '0 0 0 0 rgba(255,92,0,0.55)',
              '0 0 0 14px rgba(255,92,0,0)',
              '0 0 0 0 rgba(255,92,0,0)',
            ],
          }}
          transition={{ delay: 3.1, duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
          className="w-full h-14 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-lg font-black rounded-2xl flex items-center justify-center gap-2 shadow-xl">
          <UserRound className="w-5 h-5" strokeWidth={2.6} />
          Volgende huurder
        </motion.button>
        {/* "Print bon" — manuele herprint knop. Werkt overal:
              • Android → RawBT thermische printer
              • iOS/iPad → opent JPG in nieuw tabblad → Share Sheet
              • Desktop → iframe.print() (of nieuw tabblad als fallback)
            Alleen gemount als er een payment.id is (voorwaarde). */}
        <button onClick={manualPrint} type="button"
          data-testid="receipt-manual-print"
          className="w-full h-12 mt-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-2xl flex items-center justify-center gap-2 border-2 border-slate-200 transition">
          <Printer className="w-4 h-4" />
          Print bon opnieuw
        </button>
        <p className="text-center text-xs text-slate-400 mt-2" data-testid="receipt-autoreturn">
          Automatisch terug naar startscherm in 10 seconden
        </p>
        {emailStatus !== null && (
          <div className="text-center text-[11px] mt-1 font-medium space-y-0.5" data-testid="receipt-delivery-status">
            {emailStatus.email?.sent && (
              <p className="text-emerald-600" data-testid="receipt-email-status">
                E-mail verzonden naar {emailStatus.email.to}
              </p>
            )}
            {emailStatus.msg?.sent && (
              <p className="text-emerald-600" data-testid="receipt-whatsapp-status">
                {emailStatus.msg.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} verzonden naar {emailStatus.msg.to}
              </p>
            )}
            {!emailStatus.email?.sent && !emailStatus.msg?.sent && (
              <p className="text-slate-300">Geen digitale kopie verzonden</p>
            )}
          </div>
        )}
      </div>

      {/* Partial-payment regeling suggestie — verschijnt na ~1.5s zodat de
          huurder eerst de bevestiging "Bedankt!" ziet, dan een keuze maakt. */}
      {partialInv && !planMade && (
        <PartialPlanSuggestion
          tenantId={payment.tenant_id || overview?.tenant?.id}
          partialInvoice={partialInv}
          onClose={() => setPartialInv(null)}
          onPlanned={() => { setPlanMade(true); setPartialInv(null); }}
        />
      )}
    </div>
  );
}
function RowSlim({ label, value }) {
  return <div className="flex justify-between"><span className="text-slate-500">{label}</span><span className="font-bold text-slate-900 capitalize">{value}</span></div>;
}

// =====================================================================
// KasgeldPanel — kiosk-medewerker kan saldo bekijken + nieuwe mutatie
// registreren zonder naar de beheerder. Read-only feed van laatste 200
// mutaties (handmatig + betalingen). Nieuwe mutatie POST'ed naar het
// kiosk-scoped endpoint /api/kiosk/kasgeld dat het kiosk_token accepteert.
// =====================================================================
function KasgeldPanel({ onBack }) {
  const [balances, setBalances] = useState({ SRD: 0, USD: 0, EUR: 0 });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [b, l] = await Promise.all([
        api.get('/kiosk/kasgeld/balance'),
        api.get('/kiosk/kasgeld'),
      ]);
      setBalances(b.data || { SRD: 0, USD: 0, EUR: 0 });
      setItems(Array.isArray(l.data) ? l.data : []);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }}>
      <div className="flex items-center justify-between gap-2 px-1 sm:px-2 py-2" style={{ minHeight: '7vh' }}>
        <button onClick={onBack} data-testid="kasgeld-back"
          className="flex items-center gap-2 text-white font-bold bg-white/20 rounded-xl px-4 py-2.5 min-h-[44px]">
          <ArrowLeft className="w-4 h-4" /> <span className="text-sm">Terug</span>
        </button>
        <span className="text-sm sm:text-base font-black text-white uppercase tracking-widest">Kasgeld</span>
        <button onClick={load} data-testid="kasgeld-refresh"
          className="text-white bg-white/20 rounded-xl px-3 py-2.5 min-h-[44px]" title="Vernieuwen">
          <Loader2 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-4 max-w-3xl w-full mx-auto space-y-4">
        {/* Saldo per valuta */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {['SRD', 'USD', 'EUR'].map((cur) => (
            <div key={cur} className="bg-white rounded-2xl p-4 text-center shadow-lg" data-testid={`kasgeld-bal-${cur}`}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{cur}</p>
              <p className="text-lg sm:text-xl font-black text-slate-900 mt-1 font-mono tabular-nums">
                {(balances[cur] || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
        {/* Nieuwe mutatie */}
        <button onClick={() => setShowForm(true)} data-testid="kasgeld-new-btn"
          className="w-full h-14 rounded-2xl bg-white text-orange-600 font-black text-base inline-flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition">
          <Wallet className="w-5 h-5" /> Nieuwe mutatie
        </button>
        {/* Recente mutaties */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Recente mutaties</h3>
            <span className="text-[10px] font-bold text-slate-400">{items.length}</span>
          </div>
          {err && <p className="p-4 text-xs text-red-600">{err}</p>}
          {!err && loading && <p className="p-4 text-center text-slate-500 text-sm">Laden…</p>}
          {!err && !loading && items.length === 0 && (
            <p className="p-4 text-center text-slate-400 text-sm">Nog geen mutaties.</p>
          )}
          <div className="divide-y divide-slate-100 max-h-[50vh] overflow-auto">
            {items.slice(0, 50).map((it) => {
              const isIn = it.type === 'in';
              const d = it.entry_date || it.created_at;
              return (
                <div key={it.id} className="flex items-center gap-3 px-4 py-3" data-testid={`kasgeld-row-${it.id}`}>
                  <div className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center ${isIn ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {isIn ? <ArrowRight className="w-4 h-4 rotate-[-45deg]" /> : <ArrowRight className="w-4 h-4 rotate-[135deg]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{it.description || it.category || '—'}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : ''}
                      {it.source === 'payment' && ' · Betaling'}
                      {it.method ? ` · ${it.method}` : ''}
                    </p>
                  </div>
                  <p className={`text-sm font-black whitespace-nowrap tabular-nums ${isIn ? 'text-emerald-700' : 'text-red-700'}`}>
                    {isIn ? '+' : '-'}{it.currency} {Number(it.amount || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {showForm && (
        <KasgeldMutationModal onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }} />
      )}
    </div>
  );
}

function KasgeldMutationModal({ onClose, onSaved }) {
  const [step, setStep] = useState('amount');  // 'amount' | 'details'
  const [type, setType] = useState('in');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SRD');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('overig');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const overlayRef = useRef(null);
  const descInputRef = useRef(null);

  // ===== iOS-safe modal positioning =====
  // Probleem: op iPhone Safari schuift bij openen van het toetsenbord de
  // hele pagina omhoog (iOS' "scroll input into view" gedrag). Bij een
  // `position:fixed inset-0` modal betekent dit dat de top van de modal
  // BOVEN de statusbalk uit-schuift → content overlapt met de tijd/notch.
  //
  // Oplossing = 2 dingen combineren:
  //   1. Body scroll lock met scroll-restore → iOS heeft niks meer om
  //      omhoog te scrollen dus de fixed modal blijft op zijn plek.
  //   2. visualViewport tracking → als iOS toch alsnog de layout aanpast
  //      (bv. na een oriëntatie-wissel met keyboard open), volgen we mee.
  //
  // Android heeft dit probleem niet omdat Chrome's `interactive-widget=
  // resizes-content` gewoon de layout viewport schrimpt zonder scroll.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return undefined;
    const vv = window.visualViewport;

    // ---- Stap 1: scroll-lock zonder layout-jitter ----
    // Alleen `overflow: hidden` op html+body — geen body.position=fixed
    // meer omdat dat op iOS PWA een layout-jump veroorzaakt bij sluiten
    // (de menubalk verspringt dan naar boven).
    const body = document.body;
    const html = document.documentElement;
    const saved = {
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
    };
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
    html.style.overflow = 'hidden';

    // ---- Stap 2: modal hoogte + positie op visualViewport ----
    // Modal STRECHT altijd van top:0 tot bottom:0 (volledig scherm) zodat
    // je NOOIT de donkere overlay of oranje Kiosk-background door de
    // safe-area randen ziet. De safe-area padding zit op de INNER-modal
    // (header/footer) — het WITTE oppervlak reikt tot de schermbodem en
    // -bovenkant.
    // Met keyboard: expliciete height = zichtbare viewport zodat de
    // Opslaan-knop boven het keyboard blijft.
    // Hysteresis om flicker te voorkomen: pas terug naar "gesloten" pas
    // als het verschil <60px is (opent bij >120px). Zonder deze buffer
    // schommelt iOS soms rond de drempel tijdens de keyboard-animatie.
    let lastKbdState = false;
    const apply = () => {
      const winH = window.innerHeight;
      const vvH = vv ? vv.height : winH;
      const diff = vv ? (winH - vvH) : 0;
      let kbdOpen = lastKbdState;
      if (!lastKbdState && diff > 120) kbdOpen = true;
      else if (lastKbdState && diff < 60) kbdOpen = false;
      lastKbdState = kbdOpen;
      if (kbdOpen) {
        el.style.bottom = 'auto';
        el.style.height = `${vvH}px`;
        el.style.top = `${vv.offsetTop}px`;
        el.style.left = `${vv.offsetLeft}px`;
        el.style.width = `${vv.width}px`;
      } else {
        el.style.top = '0px';
        el.style.bottom = '0px';
        el.style.height = 'auto';
        el.style.left = '0px';
        el.style.width = '100%';
      }
    };
    apply();
    const applyRAF = () => requestAnimationFrame(apply);
    if (vv) {
      vv.addEventListener('resize', applyRAF);
      vv.addEventListener('scroll', applyRAF);
    }
    window.addEventListener('resize', applyRAF);
    window.addEventListener('orientationchange', applyRAF);
    // Focus/blur events triggeren opnieuw omdat iOS het keyboard-effect
    // niet direct via `resize` doorgeeft.
    const onFocusIn = () => { setTimeout(apply, 50); setTimeout(apply, 300); };
    const onFocusOut = () => { setTimeout(apply, 50); setTimeout(apply, 300); };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    // Extra vangnet: als iOS ondanks body-lock TOCH nog de window probeert
    // te scrollen (soms bij snelle input-focus events), duwen we 'em direct
    // terug naar 0. Zonder deze safety-net kan de modal na een halve
    // seconde alsnog over de statusbalk uitschuiven.
    const onWindowScroll = () => {
      if (window.scrollY !== 0 || window.pageYOffset !== 0) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener('scroll', onWindowScroll, { passive: true });

    return () => {
      // ---- Restore body ----
      body.style.overflow = saved.bodyOverflow;
      body.style.overscrollBehavior = saved.bodyOverscroll;
      html.style.overflow = saved.htmlOverflow;
      if (vv) {
        vv.removeEventListener('resize', applyRAF);
        vv.removeEventListener('scroll', applyRAF);
      }
      window.removeEventListener('resize', applyRAF);
      window.removeEventListener('orientationchange', applyRAF);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('scroll', onWindowScroll);
    };
  }, []);

  const goNext = () => {
    const n = parseFloat(String(amount).replace(',', '.'));
    if (!n || n <= 0) { setErr('Bedrag moet groter dan 0 zijn'); return; }
    setErr('');
    setStep('details');
    // Focus description field zodra step 2 gerenderd is. Autofocus met
    // 200ms delay omdat iOS de focus soms negeert als hij tijdens de
    // transition wordt gezet.
    setTimeout(() => descInputRef.current?.focus(), 220);
  };

  const save = async () => {
    const n = parseFloat(String(amount).replace(',', '.'));
    if (!n || n <= 0) { setErr('Bedrag moet groter dan 0 zijn'); setStep('amount'); return; }
    if (!description.trim()) { setErr('Omschrijving is verplicht'); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/kiosk/kasgeld', {
        type, amount: n, currency,
        description: description.trim(), category,
      });
      onSaved && onSaved();
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  const amountBorder = amount
    ? (type === 'in' ? 'border-emerald-400 text-emerald-700 bg-emerald-50' : 'border-red-400 text-red-700 bg-red-50')
    : 'border-slate-200 text-slate-300 bg-slate-50';

  return createPortal((
    <div ref={overlayRef}
      onClick={onClose}
      className="fixed z-[100] bg-black/60 flex items-stretch sm:items-center justify-center sm:p-4"
      style={{
        // Fallback vóór useEffect draait — daarna neemt JS het over
        top: 0, left: 0, width: '100vw', height: '100dvh',
      }}
      data-testid="kasgeld-overlay">
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col h-full sm:h-auto sm:max-h-[90vh] overflow-hidden"
        data-testid="kasgeld-form">
        {/* Sticky header — safe-area-top padding INSIDE de witte modal,
            zodat het witte oppervlak tot bovenaan het scherm reikt en de
            titel toch onder de notch/statusbalk zit. */}
        <div className="flex-none flex items-center justify-between px-5 pb-3 border-b border-slate-100"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}>
          <div className="flex items-center gap-2">
            {step === 'details' && (
              <button onClick={() => { setErr(''); setStep('amount'); }} data-testid="kasgeld-back-btn"
                className="w-9 h-9 -ml-2 rounded-lg hover:bg-slate-100 flex items-center justify-center">
                <ChevronLeft className="w-5 h-5 text-slate-500" />
              </button>
            )}
            <h3 className="text-lg font-black text-slate-900">
              {step === 'amount' ? 'Nieuwe kasmutatie' : 'Omschrijving'}
            </h3>
          </div>
          <button onClick={onClose} data-testid="kasgeld-form-close" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {step === 'amount' ? (
          /* ============ STEP 1: Type + Currency + Bedrag (NumPad) ============ */
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setType('in')} data-testid="kasgeld-type-in"
                className={`h-11 rounded-xl font-black text-sm ${type === 'in' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                Inkomend
              </button>
              <button onClick={() => setType('out')} data-testid="kasgeld-type-out"
                className={`h-11 rounded-xl font-black text-sm ${type === 'out' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                Uitgaand
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {['SRD', 'USD', 'EUR'].map((c) => (
                <button key={c} onClick={() => setCurrency(c)} data-testid={`kasgeld-cur-${c}`}
                  className={`h-11 rounded-xl font-black text-sm ${currency === c ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {c}
                </button>
              ))}
            </div>

            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Bedrag</span>
              <div data-testid="kasgeld-amount-display"
                className={`w-full h-14 px-4 rounded-xl border-2 flex items-center justify-end text-2xl font-black tabular-nums ${amountBorder}`}>
                {currency} {amount || '0'}
              </div>
            </div>
            <NumPad value={amount} onChange={setAmount} testIdPrefix="kasgeld-npad" />

            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="kasgeld-err">{err}</p>}
          </div>
        ) : (
          /* ============ STEP 2: Omschrijving + Categorie ============
              Layout: inputs bovenaan (direct onder header), Opslaan direct
              onder de velden. Zo blijven ALLE bedienelementen zichtbaar
              zodra het iOS-toetsenbord opent — geen re-positioning nodig,
              geen flicker. De onderste ruimte (leeg) wordt weggeschoven
              door het toetsenbord.
          */
          <div className="flex-1 min-h-0 flex flex-col px-5 py-4 gap-3">
            {/* Samenvatting bedrag → altijd zichtbaar zodat operator ziet
                voor welke transactie hij de omschrijving invult. */}
            <div className={`w-full rounded-xl px-4 py-2.5 flex items-center justify-between ${type === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              <span className="text-[10px] font-black uppercase tracking-widest">
                {type === 'in' ? 'Inkomend' : 'Uitgaand'} · {currency}
              </span>
              <span className="text-xl font-black tabular-nums">{amount || '0'}</span>
            </div>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Omschrijving *</span>
              <input ref={descInputRef}
                value={description} onChange={(e) => setDescription(e.target.value)}
                data-testid="kasgeld-input-desc"
                placeholder="Bijv. schoonmaakspullen"
                autoComplete="off" autoCorrect="off" autoCapitalize="sentences"
                enterKeyHint="next"
                className="w-full h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base" />
            </label>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Categorie</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                data-testid="kasgeld-input-cat"
                className="w-full h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base bg-white">
                <option value="overig">Overig</option>
                <option value="onderhoud">Onderhoud</option>
                <option value="schoonmaak">Schoonmaak</option>
                <option value="salaris">Salaris</option>
                <option value="kantoor">Kantoor</option>
                <option value="brandstof">Brandstof</option>
              </select>
            </label>

            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="kasgeld-err">{err}</p>}

            {/* Opslaan-knop DIRECT onder de velden i.p.v. footer, zodat hij
                zichtbaar blijft als het iOS-toetsenbord opent. */}
            <button onClick={save} disabled={saving} data-testid="kasgeld-save"
              className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Opslaan…</> : 'Opslaan'}
            </button>

            {/* Flex-grow spacer die inklapt onder de keyboard. Geen visible
                content zodat de layout niet flikkert bij open/close. */}
            <div className="flex-1" aria-hidden="true" />
          </div>
        )}

        {/* Sticky footer — alleen zichtbaar in step 1. In step 2 zit de
            Opslaan-knop tussen de velden zelf (zie hierboven) zodat hij
            boven het toetsenbord blijft. */}
        {step === 'amount' && (
          <div className="flex-none px-5 pt-3 border-t border-slate-100 bg-white"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            <button onClick={goNext} data-testid="kasgeld-next-btn"
              disabled={!amount || parseFloat(String(amount).replace(',', '.')) <= 0}
              className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
              Volgende <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

// =====================================================================
// Live ID-scan camera modal (fullscreen, mobile-first).
// Opent de achterste camera via getUserMedia, toont een oranje kader
// als viewfinder, en auto-vast legt zodra het beeld ~1.5s stabiel is.
// Gebruiker kan ook handmatig op "Nu vastleggen" tikken.
// =====================================================================
function IdScanCameraModal({ onClose, onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Start camera stream on mount, cleanup on unmount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera niet ondersteund op dit apparaat.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.onloadedmetadata = () => { v.play().catch(() => {}); setReady(true); };
        }
      } catch (e) {
        setError('Kon camera niet openen. Sta camera-toegang toe in browserinstellingen.');
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = useCallback(() => {
    if (processing) return;
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setProcessing(true);
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (blob) onCaptured(new File([blob], 'id-scan.jpg', { type: 'image/jpeg' }));
      else { setProcessing(false); }
    }, 'image/jpeg', 0.92);
  }, [processing, onCaptured]);

  // Auto-capture: neem elk 120ms een lo-res sample, bepaal pixeldiff met
  // vorige frame. Als de diff onder de threshold blijft voor ~600ms en het
  // beeld is niet blanco → auto-vast leg. Vermijdt dat een stil camera-
  // beeld naar een tafel of muur onterecht triggert (min. brightness check).
  useEffect(() => {
    if (!ready || processing || error) return undefined;
    let prev = null;
    let stable = 0;
    const iv = setInterval(() => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !v.videoWidth) return;
      const w = 128, h = 80;
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(v, 0, 0, w, h);
      const cur = ctx.getImageData(0, 0, w, h).data;
      // Min. helderheid / kleur variatie check zodat we niet triggeren op
      // een pikzwart of blanko beeld
      let brightness = 0;
      for (let i = 0; i < cur.length; i += 32) brightness += cur[i] + cur[i + 1] + cur[i + 2];
      const avgBright = brightness / (cur.length / 32) / 3;
      if (avgBright < 25) { prev = cur; stable = 0; return; }
      if (prev) {
        let diff = 0;
        for (let i = 0; i < cur.length; i += 16) diff += Math.abs(cur[i] - prev[i]);
        const norm = diff / (cur.length / 16);
        if (norm < 6) stable += 1; else stable = 0;
        if (stable >= 5) { // ~600ms — snelle auto-capture
          clearInterval(iv);
          capture();
        }
      }
      prev = cur;
    }, 120);
    return () => clearInterval(iv);
  }, [ready, processing, error, capture]);

  return createPortal((
    <div className="fixed inset-0 z-[110] bg-black flex flex-col"
      data-testid="id-scan-camera-overlay">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-4 pb-2 text-white"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}>
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5" />
          <h3 className="text-lg font-black">Scan ID-kaart</h3>
        </div>
        <button onClick={onClose} data-testid="id-scan-close"
          className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center active:bg-white/30">
          <X className="w-6 h-6" strokeWidth={2.5} />
        </button>
      </div>
      {/* Live view */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-white text-center px-6 text-sm font-semibold">
            {error}
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay
              className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {/* Viewfinder — donker masker + oranje kader in ID-kaart verhouding */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="border-4 border-orange-500 rounded-2xl w-[88%] max-w-md aspect-[85/54]"
                style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
            </div>
            <div className="absolute bottom-6 left-0 right-0 text-center text-white text-sm font-bold px-6 drop-shadow-lg"
              data-testid="id-scan-hint">
              {processing ? (
                <><Loader2 className="inline w-5 h-5 animate-spin mr-2" />Bezig met scannen…</>
              ) : ready ? (
                'Houd ID-kaart in het oranje kader — auto-scan bezig'
              ) : (
                <><Loader2 className="inline w-5 h-5 animate-spin mr-2" />Camera wordt gestart…</>
              )}
            </div>
          </>
        )}
      </div>
      {/* Manueel vastleggen — fallback */}
      <div className="flex-none px-4 py-3 bg-black"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        <button onClick={capture} disabled={!ready || processing || !!error}
          data-testid="id-scan-capture"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          <Camera className="w-4 h-4" /> Nu vastleggen
        </button>
      </div>
    </div>
  ), document.body);
}


// =====================================================================
// Snelle "Nieuwe huurder" modal (Kiosk quick-create).
// Minimale velden: naam + telefoon + optioneel appartement uit dropdown.
// Body scroll-lock voor iOS zodat de fixed modal niet weg-scrollt tijdens
// keyboard-open. `apartments` wordt ge-fetched bij mount.
// =====================================================================
function AddTenantModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [aptId, setAptId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [apartments, setApartments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // ID-scan (live camera) state
  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  // Bewaar de gescande ID-kaart foto zodat we deze na het opslaan van de
  // huurder direct uploaden naar `/tenants/{id}/upload-id-photo`. Anders
  // ziet de beheerder alleen tekst en niet de originele scan.
  const [scannedIdFile, setScannedIdFile] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/apartments').then((r) => {
      if (!alive) return;
      const list = Array.isArray(r?.data) ? r.data : [];
      // Alleen vrije appartementen aanbieden
      setApartments(list.filter((a) => a.status === 'vacant'));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Body scroll-lock wordt beheerd door KioskModalShell → useBodyScrollLock.

  // ID-scan callback: krijgt een File van de live camera, stuurt naar
  // `/api/tenants/ocr-id-card` en vult de velden automatisch in. Bewaart
  // óók het File-object in state → na tenant-creatie uploaden we hem naar
  // `/tenants/{id}/upload-id-photo` zodat de beheerder de originele scan
  // + auto-gecropte avatar krijgt.
  const onScanCaptured = async (file) => {
    setShowScanner(false);
    if (!file) return;
    setScannedIdFile(file);
    setScanning(true); setErr(''); setScanMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/tenants/ocr-id-card', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const d = r?.data || {};
      if (d.name) setName(d.name);
      if (d.birth_date) setBirthDate(d.birth_date);
      if (d.id_number) setIdNumber(d.id_number);
      const conf = typeof d.confidence === 'number' ? Math.round(d.confidence * 100) : null;
      setScanMsg(conf != null ? `Gescand · ${conf}% zekerheid — foto wordt opgeslagen` : 'Gescand — foto wordt opgeslagen');
    } catch (e2) { setErr(formatError(e2)); }
    finally { setScanning(false); }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setErr('Naam is verplicht'); return; }
    setSaving(true); setErr('');
    try {
      const body = { name: trimmed };
      if (phone.trim()) body.phone = phone.trim();
      if (aptId) body.apartment_id = aptId;
      if (birthDate) body.birth_date = birthDate;
      if (idNumber.trim()) body.id_number = idNumber.trim();
      const r = await api.post('/tenants', body);
      const created = r?.data;
      // Upload de ID-kaart foto (indien gescand) direct na aanmaak. Fouten
      // hier blokkeren niet — huurder is al aangemaakt. `upload-id-photo`
      // triggert bovendien face-crop → tenant.avatar_url.
      if (created?.id && scannedIdFile) {
        try {
          const fd = new FormData();
          fd.append('file', scannedIdFile);
          await api.post(`/tenants/${created.id}/upload-id-photo`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (upErr) {
          console.warn('ID-foto upload gefaald (huurder wel aangemaakt):', upErr);
        }
      }
      onSaved && onSaved(created);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title="Nieuwe huurder" Icon={UserPlus}
      testId="add-tenant" onClose={onClose}
      footer={(
        <button onClick={save} disabled={saving || !name.trim()}
          data-testid="add-tenant-save"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Opslaan…' : 'Huurder opslaan'}
        </button>
      )}>
      {({ accent }) => (
        <>
          {/* Live ID-scan camera + Gemini Vision — auto-invullen NAW velden */}
          <button type="button" onClick={() => setShowScanner(true)}
            disabled={scanning}
            data-testid="add-tenant-scan-id"
            className="w-full h-14 rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-700 font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {scanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            {scanning ? 'Scannen…' : 'Scan ID-kaart'}
          </button>
          {showScanner && (
            <IdScanCameraModal
              onClose={() => setShowScanner(false)}
              onCaptured={onScanCaptured} />
          )}
          {scanMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-4 py-2 text-center"
              data-testid="add-tenant-scan-msg">
              ✓ {scanMsg}
            </div>
          )}
          <label className="block">
            <span className={modalLabelCls}>Naam *</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              data-testid="add-tenant-name"
              placeholder="Voornaam Achternaam"
              className={modalInputCls(accent)} />
          </label>
          <label className="block">
            <span className={modalLabelCls}>Telefoon</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              type="tel" inputMode="tel" autoComplete="tel"
              data-testid="add-tenant-phone"
              placeholder="+597 8xx xxxx"
              className={modalInputCls(accent)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={modalLabelCls}>Geboortedatum</span>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
                data-testid="add-tenant-birth" className={modalInputCls(accent)} />
            </label>
            <label className="block">
              <span className={modalLabelCls}>ID-nummer</span>
              <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)}
                data-testid="add-tenant-id-number"
                placeholder="XXXXXXX"
                className={modalInputCls(accent)} />
            </label>
          </div>
          <label className="block">
            <span className={modalLabelCls}>Appartement (optioneel)</span>
            <select value={aptId} onChange={(e) => setAptId(e.target.value)}
              data-testid="add-tenant-apartment"
              className={`${modalInputCls(accent)} bg-white`}>
              <option value="">— Nog geen appartement —</option>
              {apartments.sort(sortApartments).map((a) => (
                <option key={a.id} value={a.id}>Appt. {a.number} · {a.currency} {a.rent_amount}</option>
              ))}
            </select>
          </label>
          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3"
              data-testid="add-tenant-error">
              {err}
            </div>
          )}
        </>
      )}
    </KioskModalShell>
  );
}

// =====================================================================
// Snelle "Nieuw appartement" modal (Kiosk quick-create).
// Minimale velden: nummer + huur bedrag + currency (default SRD).
// =====================================================================
function AddApartmentModal({ onClose, onSaved }) {
  const [number, setNumber] = useState('');
  const [rent, setRent] = useState('');
  const [currency, setCurrency] = useState('SRD');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Body scroll-lock wordt beheerd door KioskModalShell → useBodyScrollLock.

  const save = async () => {
    const n = String(number || '').trim();
    const r = parseFloat(String(rent).replace(',', '.'));
    if (!n) { setErr('Nummer is verplicht'); return; }
    if (!r || r <= 0) { setErr('Huur bedrag moet groter dan 0 zijn'); return; }
    setSaving(true); setErr('');
    try {
      const body = { number: n, rent_amount: r, currency };
      if (description.trim()) body.description = description.trim();
      const res = await api.post('/apartments', body);
      onSaved && onSaved(res?.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title="Nieuw appartement" Icon={Home}
      testId="add-apartment" onClose={onClose}
      footer={(
        <button onClick={save} disabled={saving || !number.trim() || !rent}
          data-testid="add-apartment-save"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Opslaan…' : 'Appartement opslaan'}
        </button>
      )}>
      {({ accent }) => (
        <>
          <label className="block">
            <span className={modalLabelCls}>Nummer *</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)}
              autoFocus data-testid="add-apartment-number"
              placeholder="A1, HUIS 7A, …"
              className={modalInputCls(accent)} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block col-span-2">
              <span className={modalLabelCls}>Huur bedrag *</span>
              <input value={rent} onChange={(e) => setRent(e.target.value)}
                type="number" inputMode="decimal" step="0.01" min="0"
                data-testid="add-apartment-rent"
                placeholder="0.00"
                className={modalInputCls(accent)} />
            </label>
            <label className="block">
              <span className={modalLabelCls}>Valuta</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                data-testid="add-apartment-currency"
                className={`${modalInputCls(accent)} bg-white`}>
                <option value="SRD">SRD</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className={modalLabelCls}>Omschrijving (optioneel)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              data-testid="add-apartment-description"
              placeholder="Type / verdieping / kenmerk"
              className={modalInputCls(accent)} />
          </label>
          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3"
              data-testid="add-apartment-error">
              {err}
            </div>
          )}
        </>
      )}
    </KioskModalShell>
  );
}

// =====================================================================
// Gedeelde modal-shell utilities (DRY) — body scroll lock + createPortal.
// Elk create-formulier binnen de Kiosk gebruikt dezelfde skeleton met
// een gekleurde header, safe-area padding en een sticky bottom knop.
// =====================================================================
// Scroll-lock helper — voorkomt scroll-through achter modals zonder de
// iOS "body position fixed" jitter die op iPhone PWA de layout na sluiten
// omhoog laat verspringen. We gebruiken alleen `overflow: hidden` op
// html en body — herstellen exact wat er stond na unmount.
function useBodyScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOv: html.style.overflow,
      bodyOv: body.style.overflow,
      bodyOb: body.style.overscrollBehavior,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
    return () => {
      html.style.overflow = prev.htmlOv;
      body.style.overflow = prev.bodyOv;
      body.style.overscrollBehavior = prev.bodyOb;
    };
  }, []);
}

function KioskModalShell({ title, Icon, testId, onClose, children, footer }) {
  // Track visualViewport zodat de modal automatisch mee-krimpt met het
  // toetsenbord op iOS/Android. Zonder deze tracking scrollt iOS de
  // hele pagina omhoog om een focus-input onder het keyboard vandaan
  // te halen → header verdwijnt uit beeld en form voelt onstabiel.
  // Met visualViewport-sized modal blijft alles op zijn plek — alleen
  // de scrollbare body verkort, header en footer zichtbaar boven het
  // keyboard.
  const vv = useVisualViewport();
  // Op mobiel: forceer top/height op basis van visualViewport (blijft
  // altijd binnen zichtbaar gebied). Op desktop (sm+) valt CSS terug op
  // `inset-0` + centreren via classes.
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const mobileStyle = isMobile ? {
    top: `${vv.top}px`,
    height: `${vv.height}px`,
  } : {};
  return createPortal((
    <div
      className="fixed left-0 right-0 z-[100] bg-white sm:bg-black/60 sm:inset-0 flex flex-col sm:items-center sm:justify-center sm:p-4"
      style={mobileStyle}
      data-testid={`${testId}-overlay`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full h-full sm:h-auto sm:max-w-md sm:max-h-[90dvh] bg-white sm:rounded-2xl flex flex-col overflow-hidden"
        data-testid={`${testId}-form`}>
        {/* Header — oranje op mobiel (Kiosk-huisstijl), wit op desktop */}
        <div className="flex-none flex items-center justify-between px-4 sm:px-5 pb-3 sm:pb-3 bg-orange-500 sm:bg-white border-b border-orange-600 sm:border-slate-100"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 sm:w-9 sm:h-9 rounded-xl sm:rounded-lg bg-white/20 sm:bg-orange-100 backdrop-blur-sm sm:backdrop-blur-none flex items-center justify-center">
              <Icon className="w-5 h-5 text-white sm:text-orange-600" />
            </div>
            <h3 className="text-lg font-black text-white sm:text-slate-900">{title}</h3>
          </div>
          <button onClick={onClose} data-testid={`${testId}-close`}
            className="w-11 h-11 sm:w-9 sm:h-9 rounded-xl sm:rounded-lg bg-white/20 sm:bg-transparent sm:hover:bg-slate-100 backdrop-blur-sm sm:backdrop-blur-none flex items-center justify-center active:bg-white/30">
            <X className="w-6 h-6 sm:w-5 sm:h-5 text-white sm:text-slate-500" strokeWidth={2.5} />
          </button>
        </div>
        {/* Body — witte scrollbare content. `overscroll-contain` voorkomt
            dat de scroll doorlekt naar de underlying page op iOS. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4 bg-white"
          style={{ WebkitOverflowScrolling: 'touch' }}
          data-testid={`${testId}-body`}>
          {typeof children === 'function' ? children({ accent: 'focus:border-orange-500' }) : children}
        </div>
        {footer && (
          <div className="flex-none border-t border-slate-100 px-5 py-3 bg-white"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

const modalInputCls = (accent) =>
  `mt-1 w-full h-12 rounded-xl border-2 border-slate-200 ${accent} outline-none px-4 text-base font-semibold text-slate-900`;
const modalLabelCls = 'text-xs font-bold text-slate-500 uppercase tracking-wide';

// =====================================================================
// Nieuwe locatie modal
// =====================================================================
function AddLocationModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) { setErr('Naam is verplicht'); return; }
    setSaving(true); setErr('');
    try {
      const body = { name: name.trim() };
      if (address.trim()) body.address = address.trim();
      const r = await api.post('/locations', body);
      onSaved && onSaved(r?.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title="Nieuwe locatie" Icon={MapPin}
      testId="add-location" onClose={onClose}
      footer={(
        <button onClick={save} disabled={saving || !name.trim()}
          data-testid="add-location-save"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Opslaan…' : 'Locatie opslaan'}
        </button>
      )}>
      {({ accent }) => (
        <>
          <label className="block">
            <span className={modalLabelCls}>Naam *</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              autoFocus data-testid="add-location-name"
              placeholder="Hoofdvestiging, Filiaal…"
              className={modalInputCls(accent)} />
          </label>
          <label className="block">
            <span className={modalLabelCls}>Adres</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              data-testid="add-location-address"
              placeholder="Straatnaam nr, Stad"
              className={modalInputCls(accent)} />
          </label>
          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3"
              data-testid="add-location-error">{err}</div>
          )}
        </>
      )}
    </KioskModalShell>
  );
}

// =====================================================================
// Nieuw contract modal
// =====================================================================
function AddContractModal({ onClose, onSaved }) {
  const [tenants, setTenants] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [aptId, setAptId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [payDay, setPayDay] = useState(1);
  const [deposit, setDeposit] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/tenants'), api.get('/apartments')]).then(([tr, ar]) => {
      if (!alive) return;
      setTenants(Array.isArray(tr?.data) ? tr.data : []);
      setApartments(Array.isArray(ar?.data) ? ar.data : []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const save = async () => {
    if (!tenantId) { setErr('Kies een huurder'); return; }
    if (!aptId) { setErr('Kies een appartement'); return; }
    if (!startDate) { setErr('Startdatum is verplicht'); return; }
    setSaving(true); setErr('');
    try {
      const body = {
        tenant_id: tenantId,
        apartment_id: aptId,
        start_date: startDate,
        payment_day: Number(payDay) || 1,
        deposit_amount: parseFloat(String(deposit).replace(',', '.')) || 0,
      };
      if (endDate) body.end_date = endDate;
      const r = await api.post('/contracts', body);
      onSaved && onSaved(r?.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title="Nieuw contract" Icon={FileText}
      testId="add-contract" onClose={onClose}
      footer={(
        <button onClick={save} disabled={saving || !tenantId || !aptId || !startDate}
          data-testid="add-contract-save"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Opslaan…' : 'Contract opslaan'}
        </button>
      )}>
      {({ accent }) => (
        <>
          <label className="block">
            <span className={modalLabelCls}>Huurder *</span>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}
              data-testid="add-contract-tenant"
              className={`${modalInputCls(accent)} bg-white`}>
              <option value="">— Kies huurder —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.apartment_number ? ` · Appt. ${t.apartment_number}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={modalLabelCls}>Appartement *</span>
            <select value={aptId} onChange={(e) => setAptId(e.target.value)}
              data-testid="add-contract-apartment"
              className={`${modalInputCls(accent)} bg-white`}>
              <option value="">— Kies appartement —</option>
              {apartments.sort(sortApartments).map((a) => (
                <option key={a.id} value={a.id}>Appt. {a.number} · {a.currency} {a.rent_amount}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={modalLabelCls}>Startdatum *</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                data-testid="add-contract-start" className={modalInputCls(accent)} />
            </label>
            <label className="block">
              <span className={modalLabelCls}>Einddatum</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                data-testid="add-contract-end" className={modalInputCls(accent)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={modalLabelCls}>Betaaldag</span>
              <input type="number" min="1" max="31" value={payDay}
                onChange={(e) => setPayDay(e.target.value)}
                data-testid="add-contract-payday" className={modalInputCls(accent)} />
            </label>
            <label className="block">
              <span className={modalLabelCls}>Borg</span>
              <input type="number" min="0" step="0.01" value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                placeholder="0.00"
                data-testid="add-contract-deposit" className={modalInputCls(accent)} />
            </label>
          </div>
          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3"
              data-testid="add-contract-error">{err}</div>
          )}
        </>
      )}
    </KioskModalShell>
  );
}

// =====================================================================
// Nieuwe factuur modal — kiest tenant + period, backend berekent bedrag.
// =====================================================================
function AddInvoiceModal({ onClose, onSaved }) {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/tenants').then((r) => {
      if (!alive) return;
      setTenants((Array.isArray(r?.data) ? r.data : []).filter((t) => t.apartment_id));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const save = async () => {
    if (!tenantId) { setErr('Kies een huurder'); return; }
    setSaving(true); setErr('');
    try {
      const r = await api.post('/invoices', {
        tenant_id: tenantId,
        period_month: Number(month),
        period_year: Number(year),
      });
      onSaved && onSaved(r?.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title="Nieuwe factuur" Icon={Receipt}
      testId="add-invoice" onClose={onClose}
      footer={(
        <button onClick={save} disabled={saving || !tenantId}
          data-testid="add-invoice-save"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Opslaan…' : 'Factuur opslaan'}
        </button>
      )}>
      {({ accent }) => (
        <>
          <label className="block">
            <span className={modalLabelCls}>Huurder *</span>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}
              data-testid="add-invoice-tenant"
              className={`${modalInputCls(accent)} bg-white`}>
              <option value="">— Kies huurder —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.apartment_number ? ` · Appt. ${t.apartment_number}` : ''}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={modalLabelCls}>Maand *</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)}
                data-testid="add-invoice-month"
                className={`${modalInputCls(accent)} bg-white`}>
                {MONTHS_NL.map((m, idx) => (
                  <option key={idx + 1} value={idx + 1}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={modalLabelCls}>Jaar *</span>
              <input type="number" min="2020" max="2100" value={year}
                onChange={(e) => setYear(e.target.value)}
                data-testid="add-invoice-year" className={modalInputCls(accent)} />
            </label>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3">
            Het bedrag wordt automatisch berekend op basis van de huurprijs van het appartement.
          </div>
          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3"
              data-testid="add-invoice-error">{err}</div>
          )}
        </>
      )}
    </KioskModalShell>
  );
}

// =====================================================================
// Betalingen inzien — modal met scrollbare lijst van recente betalingen.
// =====================================================================
function PaymentsViewerModal({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/payments', { params: { limit: 50 } }).then((r) => {
      if (!alive) return;
      setPayments(Array.isArray(r?.data) ? r.data : []);
    }).catch((e) => setErr(formatError(e)))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <KioskModalShell title="Betalingen inzien" Icon={Banknote}
      testId="payments-viewer" onClose={onClose}
      footer={(
        <button onClick={onClose}
          data-testid="payments-viewer-close-btn"
          className="w-full h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">
          Sluiten
        </button>
      )}>
      {() => (
        <>
          {loading && (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-rose-500 animate-spin" /></div>
          )}
          {!loading && err && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3">{err}</div>
          )}
          {!loading && !err && payments.length === 0 && (
            <div className="text-center text-slate-500 py-10 text-sm">Nog geen betalingen.</div>
          )}
          {!loading && payments.map((p) => (
            <div key={p.id} data-testid={`payment-row-${p.id}`}
              className="rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-slate-900 truncate">{p.tenant_name || '—'}</div>
                <div className="text-xs text-slate-500 truncate">
                  {p.receipt_number || p.id?.slice(0, 8)} · {p.category || 'huur'}
                  {p.apartment_number ? ` · Appt. ${p.apartment_number}` : ''}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {p.paid_at ? new Date(p.paid_at).toLocaleString('nl-NL') : '—'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-black text-slate-900">{fmtMoney(p.amount, p.currency || 'SRD')}</div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-orange-600">
                  {p.status || 'approved'}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </KioskModalShell>
  );
}

// =====================================================================
// Nieuw onderhoud modal
// =====================================================================
function AddMaintenanceModal({ onClose, onSaved }) {
  const [apartments, setApartments] = useState([]);
  const [aptId, setAptId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [cost, setCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/apartments').then((r) => {
      if (!alive) return;
      setApartments(Array.isArray(r?.data) ? r.data : []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const save = async () => {
    if (!aptId) { setErr('Kies een appartement'); return; }
    if (!title.trim()) { setErr('Titel is verplicht'); return; }
    setSaving(true); setErr('');
    try {
      const body = {
        apartment_id: aptId,
        title: title.trim(),
        priority,
        cost: parseFloat(String(cost).replace(',', '.')) || 0,
      };
      if (description.trim()) body.description = description.trim();
      const r = await api.post('/maintenance', body);
      onSaved && onSaved(r?.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title="Nieuw onderhoud" Icon={Wrench}
      testId="add-maintenance" onClose={onClose}
      footer={(
        <button onClick={save} disabled={saving || !aptId || !title.trim()}
          data-testid="add-maintenance-save"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Opslaan…' : 'Onderhoud opslaan'}
        </button>
      )}>
      {({ accent }) => (
        <>
          <label className="block">
            <span className={modalLabelCls}>Appartement *</span>
            <select value={aptId} onChange={(e) => setAptId(e.target.value)}
              data-testid="add-maintenance-apartment"
              className={`${modalInputCls(accent)} bg-white`}>
              <option value="">— Kies appartement —</option>
              {apartments.sort(sortApartments).map((a) => (
                <option key={a.id} value={a.id}>Appt. {a.number}{a.tenant_name ? ` · ${a.tenant_name}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={modalLabelCls}>Titel *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              data-testid="add-maintenance-title"
              placeholder="Lekkage keukenkraan"
              className={modalInputCls(accent)} />
          </label>
          <label className="block">
            <span className={modalLabelCls}>Omschrijving</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3} data-testid="add-maintenance-description"
              placeholder="Extra details voor de monteur"
              className={`mt-1 w-full rounded-xl border-2 border-slate-200 ${accent} outline-none px-4 py-3 text-base font-semibold text-slate-900`} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={modalLabelCls}>Prioriteit</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}
                data-testid="add-maintenance-priority"
                className={`${modalInputCls(accent)} bg-white`}>
                <option value="low">Laag</option>
                <option value="medium">Middel</option>
                <option value="high">Hoog</option>
              </select>
            </label>
            <label className="block">
              <span className={modalLabelCls}>Kosten (SRD)</span>
              <input type="number" min="0" step="0.01" value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0.00"
                data-testid="add-maintenance-cost" className={modalInputCls(accent)} />
            </label>
          </div>
          {err && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-4 py-3"
              data-testid="add-maintenance-error">{err}</div>
          )}
        </>
      )}
    </KioskModalShell>
  );
}

// =====================================================================
// Beheerder-actie sheet — fullscreen op mobiel, gecentreerd op desktop.
// Uniform Kiosk-oranje kleurenpalet: witte tegels met oranje icoon-vak
// en donkere titeltekst. Vervangt de multi-kleur pastel-tegels.
// =====================================================================
function KioskAddSheet({ onClose, onPick }) {
  // visualViewport-tracking → sheet krimpt mee met keyboard (hoewel dit
  // sheet zelf geen inputs heeft, blijft consistentie belangrijk voor
  // toekomstige uitbreidingen en zorgt het dat de sheet nooit onder de
  // FAB doorschuift). Geen body-scroll-lock — die veroorzaakt een
  // "sprong" op iOS wat lijkt op een menubalk die omhoog schuift.
  const vv = useVisualViewport();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const mobileStyle = isMobile ? {
    top: `${vv.top}px`,
    height: `${vv.height}px`,
  } : {};
  const tiles = [
    { key: 'tenant',      label: 'Nieuwe huurder',    Icon: UserPlus },
    { key: 'apartment',   label: 'Nieuw appartement', Icon: Home },
    { key: 'location',    label: 'Nieuwe locatie',    Icon: MapPin },
    { key: 'contract',    label: 'Nieuw contract',    Icon: FileText },
    { key: 'invoice',     label: 'Nieuwe factuur',    Icon: Receipt },
    { key: 'payments',    label: 'Betalingen inzien', Icon: Banknote },
    { key: 'maintenance', label: 'Onderhoud',         Icon: Wrench },
  ];
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal((
    <div
      className="fixed left-0 right-0 z-[100] bg-orange-500 sm:inset-0 flex flex-col animate-in fade-in duration-150"
      style={mobileStyle}
      data-testid="kiosk-add-sheet-overlay">
      {/* Header — matcht Kiosk-huisstijl (oranje bg, wit) */}
      <div className="flex-none flex items-center justify-between px-4"
        style={{
          paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
          paddingBottom: 12,
        }}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Plus className="w-6 h-6 text-white" strokeWidth={3} />
          </div>
          <h3 className="text-xl font-black text-white">Snel toevoegen</h3>
        </div>
        <button onClick={onClose} data-testid="kiosk-add-sheet-close"
          className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center active:bg-white/30 transition">
          <X className="w-6 h-6 text-white" strokeWidth={2.5} />
        </button>
      </div>
      {/* Body — 2-koloms grid van witte tegels met oranje icon */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((t) => (
            <button key={t.key} onClick={() => onPick(t.key)}
              data-testid={`kiosk-tile-${t.key}`}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/95 active:bg-white shadow-lg py-6 px-3 transition active:scale-95 min-h-[130px]">
              <span className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                <t.Icon className="w-7 h-7 text-orange-600" strokeWidth={2} />
              </span>
              <span className="text-sm font-black text-slate-900 leading-tight text-center">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
}



// =====================================================================
// Main
// =====================================================================
export default function KioskLayout() {
  useHidePwaSplash();
  const navigate = useBrandedNavigate();
  const [step, setStep] = useState('check');
  const [apartment, setApartment] = useState(null);
  const [overview, setOverview] = useState(null);
  const [paymentPayload, setPaymentPayload] = useState(null);
  // Live-preview voor het klantenscherm tijdens de "pay" stap. Wordt door
  // PaySelect realtime bijgewerkt naarmate de operator categorieën aanvinkt
  // of via het keypad een bedrag intikt — zodat de klant op zijn scherm
  // het lopend totaal en de geselecteerde onderdelen meteen ziet, vóórdat
  // de operator op "Verder" tikt.
  const [livePreview, setLivePreview] = useState(null);
  const [paymentResult, setPaymentResult] = useState(null);
  const [company, setCompany] = useState(getKioskCompany());
  const [nfcToast, setNfcToast] = useState(null); // {kind:'ok'|'err', msg}
  // Modals voor snel aanmaken vanuit de Kiosk (alle beheerder-shortcuts)
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [showAddApartment, setShowAddApartment] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [showAddContract, setShowAddContract] = useState(false);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [showPaymentsViewer, setShowPaymentsViewer] = useState(false);
  const [showAddMaintenance, setShowAddMaintenance] = useState(false);
  // Bump om ApartmentSelect te forceren opnieuw te fetchen na een aanmaak
  const [apartmentsReloadKey, setApartmentsReloadKey] = useState(0);

  // Bottom-sheet tegel selectie → open de bijbehorende modal
  const handleSheetPick = useCallback((key) => {
    setShowAddSheet(false);
    // Kleine delay zodat de sheet-close animatie niet clashet met modal-open
    setTimeout(() => {
      if (key === 'tenant') setShowAddTenant(true);
      else if (key === 'apartment') setShowAddApartment(true);
      else if (key === 'location') setShowAddLocation(true);
      else if (key === 'contract') setShowAddContract(true);
      else if (key === 'invoice') setShowAddInvoice(true);
      else if (key === 'payments') setShowPaymentsViewer(true);
      else if (key === 'maintenance') setShowAddMaintenance(true);
    }, 100);
  }, []);

  useEffect(() => {
    // document.title wordt centraal beheerd door usePwaManifest() in App.js
    const tok = localStorage.getItem('kiosk_token');
    if (!tok) { navigate('/login?target=kiosk', { replace: true }); return; }
    setCompany(getKioskCompany());
    setStep('select');
  }, [navigate]);

  // Tijdens kiosk-modus moet body/root in PWA standalone ORANJE zijn (zodat
  // het iPhone-home-indicator gebied en eventuele 1px doorlek aan de notch
  // de huisstijl-kleur tonen, niet wit). De Admin gebruikt wit. We schakelen
  // door middel van een body-class die alleen in standalone PWA effect heeft,
  // EN we zetten body/html bg direct in style. Voor kiosk gebruiken we WIT
  // omdat de vaste witte FAB-menubalk onderaan staat — zo krijgen we nooit
  // een oranje strook onder de FAB bij iOS PWA viewport-drift.
  // .kiosk-fullscreen zelf heeft orange bg (#FF5C00) en dekt de rest af.
  useEffect(() => {
    const BODY_BG = '#ffffff';
    document.body.classList.add('kiosk-mode');
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const prevBodyBg = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = BODY_BG;
    document.body.style.backgroundColor = BODY_BG;
    // NB: theme-color wordt NIET meer per-route overschreven — dat gaf
    // flikkering op Android. Centrale waarde staat in index.html.
    return () => {
      document.body.classList.remove('kiosk-mode');
      document.documentElement.style.backgroundColor = prevHtmlBg;
      document.body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  // CLEANUP — wanneer het kiosk-component unmount (operator navigeert
  // weg, sluit tab, refreshed) OF de pagina verborgen wordt, reset het
  // klantenscherm naar idle. sendBeacon werkt ook tijdens unload (regular
  // fetch wordt door browser geannuleerd). Dit is een safety-net naast de
  // explicit `reset()` en `exit()` calls.
  useEffect(() => {
    const beaconReset = () => {
      try {
        const url = `${process.env.REACT_APP_BACKEND_URL}/api/kiosk/customer-display/reset-beacon`;
        const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
        navigator.sendBeacon?.(url, blob);
      } catch { /* ignore */ }
    };
    const onVis = () => {
      // Wanneer pagina verborgen wordt (tab gewisseld, scherm uit) reset
      // het klantenscherm zodat het niet eindeloos op de vorige huurder
      // blijft hangen. Bij terugkeer naar de tab pushed Kiosk gewoon de
      // current state opnieuw via heartbeat.
      if (document.visibilityState === 'hidden') beaconReset();
    };
    window.addEventListener('pagehide', beaconReset);
    window.addEventListener('beforeunload', beaconReset);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', beaconReset);
      window.removeEventListener('beforeunload', beaconReset);
      document.removeEventListener('visibilitychange', onVis);
      // Component unmount = navigatie naar andere pagina binnen SPA.
      // Reset hier ook expliciet zodat ander scherm niet de oude state ziet.
      beaconReset();
    };
  }, []);

  // ===================================================================
  // NFC TAP-LISTENER (USB HID-kaartlezer)
  // ===================================================================
  // Een USB HID NFC-lezer (bv. ACR122U) gedraagt zich als een toetsenbord
  // en "typt" het kaart-UID in rappe burst gevolgd door Enter zodra een
  // kaart wordt getapt. We luisteren wereldwijd op de kiosk en accepteren
  // de scan ALLEEN als:
  //   - er geen tekstveld de focus heeft (anders breekt typen kapot),
  //   - de toetsaanslagen kort op elkaar volgen (<35ms gemiddeld, mens
  //     typt 80-200ms tussen toetsen),
  //   - de string ≥6 karakters lang is (NFC UID's zijn doorgaans 8-14
  //     hex chars).
  // Op een match navigeren we DIRECT naar het overview-scherm; geen
  // operator-actie meer nodig.
  useEffect(() => {
    if (step !== 'select') return undefined;  // alleen actief op picker
    let buffer = '';
    let lastTs = 0;
    let timer = null;

    const handleScan = async (uid) => {
      try {
        const { data } = await api.post('/kiosk/nfc-lookup', { card_id: uid });
        if (data?.found && data?.apartment) {
          const apt = data.apartment;
          // Verrijk met tenant-naam zodat de overview-card direct compleet is
          if (data.tenant?.name && !apt.tenant_name) apt.tenant_name = data.tenant.name;
          setApartment(apt);
          setStep('overview');
          setNfcToast({ kind: 'ok', msg: `Welkom — ${apt.tenant_name || `App. ${apt.number}`}` });
        } else {
          setNfcToast({ kind: 'err', msg: 'Kaart niet herkend. Geef de admin de kaart om te koppelen.' });
        }
      } catch (err) {
        setNfcToast({ kind: 'err', msg: 'Kon kaart niet uitlezen. Probeer opnieuw.' });
      }
      setTimeout(() => setNfcToast(null), 4000);
    };

    // === Web NFC API (Android Chrome) ===
    // Wanneer de Kiosk draait op een Android-tablet/telefoon, kan de
    // BUILT-IN NFC chip kaarten uitlezen via de Web NFC API. Vereist HTTPS
    // en user-gesture om de scan te starten. iOS Safari ondersteunt dit
    // NIET (Apple heeft Web NFC geblokkeerd). Voor iOS gebruik je in plaats
    // daarvan NFC URL-tags die `https://<domain>/kiosk/nfc?c=<UID>` open.
    let ndefReader = null;
    let ndefAbort = null;
    const startWebNfc = async () => {
      if (typeof window === 'undefined' || !('NDEFReader' in window)) return;
      try {
        ndefReader = new window.NDEFReader();
        ndefAbort = new AbortController();
        await ndefReader.scan({ signal: ndefAbort.signal });
        ndefReader.addEventListener('reading', (ev) => {
          // serialNumber kan formaten als "04:a1:b2:c3:d4" hebben
          const raw = ev?.serialNumber || '';
          const uid = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (uid.length >= 6) handleScan(uid);
        });
      } catch (err) {
        // Permission denied of niet ondersteund — stille fallback (HID/URL werkt nog steeds)
        if (err?.name !== 'AbortError') {
          console.warn('Web NFC niet beschikbaar:', err?.message || err);
        }
      }
    };
    startWebNfc();

    const onKey = (e) => {
      // Skip als gebruiker actief in een invoerveld typt
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

      const now = Date.now();
      const gap = now - lastTs;
      lastTs = now;

      // Reset buffer als er een lange pauze was (handmatige toets)
      if (gap > 120 && buffer.length > 0) buffer = '';

      if (e.key === 'Enter') {
        const candidate = buffer.trim();
        buffer = '';
        if (candidate.length >= 6) handleScan(candidate);
        return;
      }
      // Accepteer alleen alfanumeriek (NFC UID's zijn hex)
      if (e.key.length === 1 && /[A-Za-z0-9]/.test(e.key)) {
        buffer += e.key;
        // Safety: clear buffer na 800ms inactiviteit
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { buffer = ''; }, 800);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timer) clearTimeout(timer);
      // Stop de Web NFC scan op unmount / step-change
      try { ndefAbort?.abort(); } catch (err) { /* noop */ }
    };
  }, [step]);

  // ===================================================================
  // URL-TAG NFC (iOS Safari + Android — universele fallback)
  // ===================================================================
  // Wanneer een NFC-tag geprogrammeerd is met een URL als
  // `https://<jouw-domain>/kiosk?nfc=04A1B2C3D4`, dan opent de
  // telefoon (iOS én Android) automatisch Safari/Chrome naar die URL
  // wanneer de huurder zijn telefoon tegen de tag tikt. Wij vangen de
  // `?nfc=` query-param hier af en doen dezelfde lookup-flow.
  useEffect(() => {
    if (step !== 'select') return undefined;
    try {
      const url = new URL(window.location.href);
      const uidFromUrl = (url.searchParams.get('nfc') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (uidFromUrl.length < 6) return undefined;
      // Direct verwerken (zelfde flow als HID/Web NFC)
      (async () => {
        try {
          const { data } = await api.post('/kiosk/nfc-lookup', { card_id: uidFromUrl });
          if (data?.found && data?.apartment) {
            const apt = data.apartment;
            if (data.tenant?.name && !apt.tenant_name) apt.tenant_name = data.tenant.name;
            setApartment(apt);
            setStep('overview');
            setNfcToast({ kind: 'ok', msg: `Welkom — ${apt.tenant_name || `App. ${apt.number}`}` });
          } else {
            setNfcToast({ kind: 'err', msg: 'Kaart niet herkend.' });
          }
        } catch (err) {
          console.error('URL-tag NFC lookup failed', err);
        }
        setTimeout(() => setNfcToast(null), 4000);
        // Wis de query-param uit de URL zodat refresh niet opnieuw triggert
        try {
          url.searchParams.delete('nfc');
          window.history.replaceState({}, '', url.toString());
        } catch (err) { /* noop */ }
      })();
    } catch (err) { console.error('URL-tag NFC parse failed', err); }
    return undefined;
  }, [step]);

  const exit = useCallback(() => {
    // Reset customer-display naar idle bij uitloggen.
    api.delete('/kiosk/customer-display').catch(() => {});
    // VOLLEDIGE reset zodat een volgende gebruiker (vooral een andere
    // medewerker op een gedeeld kiosk-toestel) cleanly bij de PIN-keypad
    // landt zonder oude tokens of role-voorkeur. Anders krijgt de PWA
    // een auto-redirect terug naar /kiosk of /admin met de stale tokens
    // van de vorige gebruiker.
    try {
      localStorage.removeItem('kiosk_token');
      localStorage.removeItem('kiosk_company');
      localStorage.removeItem('admin_token');
      localStorage.removeItem('pwa_preferred_role');
      localStorage.removeItem('active_company_id');
    } catch { /* ignore */ }
    try {
      // Ook oude sessionStorage keys opruimen (backwards-compat).
      localStorage.removeItem('kiosk_emp_id');
      localStorage.removeItem('kiosk_emp_name');
      localStorage.removeItem('kiosk_emp_pin');
      sessionStorage.removeItem('kiosk_emp_id');
      sessionStorage.removeItem('kiosk_emp_name');
      sessionStorage.removeItem('kiosk_emp_pin');
    } catch { /* ignore */ }
    // Hard reload zodat AuthProvider zijn cached state óók kwijt is.
    window.location.assign('/login?pick=1');
  }, []);

  // Push huidige state naar het klantenscherm. Idempotent — we sturen
  // alleen waarden die de klant ook mag zien (geen pin_hash, geen company_id).
  // Combinatie van 3 transports:
  //  1) BroadcastChannel — instant same-browser sync (2e tab / 2e monitor)
  //  2) Backend PUT — robuust voor cross-device (klant tablet in andere ruimte)
  //  3) Heartbeat elke 3s — overwrite stale state in DB, voorkomt vastlopen
  useEffect(() => {
    if (step === 'check') return undefined;
    const pushKeyRef = { current: '' };
    const buildBody = () => {
      const apt = apartment ? {
        id: apartment.id, number: apartment.number, address: apartment.address || '',
        rent_amount: apartment.rent_amount, currency: apartment.currency,
        tenant_name: apartment.tenant_name,
      } : null;
      const tenant = overview?.tenant ? {
        name: overview.tenant.name,
        internet_amount: overview.tenant.internet_amount || 0,
      } : (apartment?.tenant_name ? { name: apartment.tenant_name } : null);
      const ovw = overview ? {
        balance: overview.balance, apartment: overview.apartment,
        internet: overview.internet || 0, total_due: overview.total_due || 0,
        // Bucket-info toevoegen zodat het klantenscherm EXACT dezelfde
        // "Achterstallige huur" / "Maandhuur" splitsing kan tonen als de
        // beheerder-kiosk. Voorheen kreeg het klantenscherm alleen
        // `balance.balance` (legacy) waardoor Financieel overzicht altijd
        // op "Volledig bij / SRD 0,00" bleef staan zelfs bij achterstand.
        open_invoices: Array.isArray(overview.open_invoices) ? overview.open_invoices : [],
        open_invoices_total: Number(overview.open_invoices_total || 0),
        current_invoices: Array.isArray(overview.current_invoices) ? overview.current_invoices : [],
        current_invoices_total: Number(overview.current_invoices_total || 0),
        future_invoices: Array.isArray(overview.future_invoices) ? overview.future_invoices : [],
        future_invoices_total: Number(overview.future_invoices_total || 0),
        current_month_invoice: overview.current_month_invoice || null,
        credit_balance: Number(overview.credit_balance || 0),
      } : null;
      // Tijdens 'pay' tonen we de live preview van de operator-selectie
      // (categorieën + lopend totaal) zodat het klantenscherm meteen
      // meebeweegt. Zodra de operator op "Verder" tikt wordt paymentPayload
      // gevuld en gebruikt — die heeft voorrang.
      const livePayload = (!paymentPayload && step === 'pay' && livePreview) ? {
        amount: livePreview.amount, currency: livePreview.currency,
        categories: livePreview.categories || [],
      } : null;
      const payload = paymentPayload ? {
        amount: paymentPayload.amount, currency: paymentPayload.currency,
        categories: paymentPayload.categories || [], method: paymentPayload.method,
      } : livePayload;
      const payment = paymentResult ? {
        amount: paymentResult.amount, currency: paymentResult.currency,
        receipt_number: paymentResult.receipt_number, method: paymentResult.method,
        paid_at: paymentResult.paid_at,
      } : null;
      return { step, apartment: apt, tenant, overview: ovw, payload, payment };
    };
    const push = () => {
      const body = buildBody();
      // CONTENT-HASH dedup: alleen pushen wanneer er ECHT iets is veranderd.
      // Anders zou de heartbeat elke 3s dezelfde receipt-state terug-pushen
      // naar de DB met een nieuwe timestamp, wat het klantenscherm zou laten
      // flikkeren tussen idle (na 12s TTL) en receipt (door nieuwe push).
      let contentKey = '';
      try {
        contentKey = JSON.stringify({
          s: body.step,
          a: body.apartment?.id, t: body.tenant?.name,
          amt: body.payload?.amount, cur: body.payload?.currency,
          m: body.payload?.method, mc: body.payload?.method_chosen_at,
          // Categorieën in de hash zodat live-preview wijzigingen
          // (b.v. operator vinkt "Internet" aan met €0) een push triggeren.
          cats: (body.payload?.categories || []).map((c) => `${c.key || c.label}:${c.value || 0}`).join('|'),
          r: body.payment?.receipt_number, pa: body.payment?.paid_at,
        });
      } catch { contentKey = String(Math.random()); }
      if (contentKey === pushKeyRef.current) return;
      pushKeyRef.current = contentKey;
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('surirent-customer-display');
          bc.postMessage({ state: { ...body, updated_at: new Date().toISOString() } });
          bc.close();
        }
      } catch { /* ignore */ }
      api.put('/kiosk/customer-display', body).catch(() => {});
    };
    push();
    // Heartbeat: elke 1.5s een keepalive push. De content-hash dedup in
    // `push()` zorgt dat we GEEN onnodige PUTs doen — alleen wanneer de
    // state daadwerkelijk verandert. 1.5s ipv 3s zodat een stale state
    // sneller wordt opgemerkt en gecorrigeerd.
    const hb = setInterval(push, 1500);
    return () => clearInterval(hb);
  }, [step, apartment, overview, paymentPayload, paymentResult, livePreview]);

  // "Beheerder" knop in de kiosk: als de PIN-login een admin-token heeft
  // afgegeven (PIN is shared secret van het bedrijf), spring direct naar
  // /admin. We doen een hard navigation zodat AuthProvider zijn /auth/me
  // opnieuw uitvoert met het nieuwe admin_token (en niet de oude user=null
  // state uit de cache van vóór de PIN-login).
  // Voor MEDEWERKER-logins (employee-PIN, geen admin_token): verbergen we
  // de knop volledig — zij mogen niet bij de Beheer-omgeving. Daarom geven
  // we adminMode hieronder alleen door aan de buttons als er een token is.
  const adminMode = useCallback(() => {
    let hasAdminToken = false;
    try { hasAdminToken = !!localStorage.getItem('admin_token'); } catch { /* ignore */ }
    if (hasAdminToken) {
      window.location.assign('/admin');
    } else {
      navigate('/login?view=admin', { replace: true });
    }
  }, [navigate]);

  // Snapshot van admin_token aanwezigheid — wordt herberekend wanneer er
  // een medewerker (uit)logt zodat de Beheerder-knop direct verschijnt of
  // verdwijnt.
  const [hasAdminAccess, setHasAdminAccess] = useState(() => {
    try { return !!localStorage.getItem('admin_token'); } catch { return false; }
  });
  useEffect(() => {
    const refresh = () => {
      try { setHasAdminAccess(!!localStorage.getItem('admin_token')); } catch { /* ignore */ }
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('kiosk-employee-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('kiosk-employee-changed', refresh);
    };
  }, []);

  const reset = () => {
    // Wis ook DIRECT het klantenscherm zodat een volgende huurder niet de
    // oude data ziet (vooral belangrijk na een betaling — operator klikt
    // "Klaar" en de volgende klant moet meteen het welkom-scherm zien).
    api.delete('/kiosk/customer-display').catch(() => {});
    setApartment(null); setOverview(null); setPaymentPayload(null);
    setLivePreview(null); setPaymentResult(null);
    setStep('select');
  };

  // Klant initieert betaling vanaf het klantenscherm — we synchroniseren
  // hier de admin Kiosk zodat we direct naar de method-pick gaan.
  useEffect(() => {
    if (step !== 'overview' || !overview) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      try {
        // Geauthenticeerd endpoint — werkt altijd, ongeacht slug-staat.
        const { data } = await api.get(`/kiosk/customer-display?t=${Date.now()}`);
        const p = data?.state?.payload;
        if (!stopped && p?.customer_initiated && p?.amount > 0) {
          setPaymentPayload({
            amount: p.amount,
            currency: p.currency || 'SRD',
            categories: p.categories || [],
            tenant_id: overview.tenant?.id,
            apartment_id: overview.apartment?.id,
          });
          setStep('method');
          return;
        }
      } catch { /* ignore */ }
      if (!stopped) timer = setTimeout(tick, 600);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [step, overview]);

  const showDesktopBar = step !== 'check';
  // Medewerker-PIN systeem is compleet uitgeschakeld: de kiosk-PIN (of
  // admin_token) is de enige authenticatie. Geen aparte emp-login sheet,
  // geen banner. Payments gaan direct als "approved" (backend accepteert
  // ontbrekende employee_id/employee_pin en houdt status=approved).

  return (
    <div className="kiosk-fullscreen bg-orange-500" data-testid="kiosk-root">
      {/* NFC SCAN TOAST — alleen op het apartement-picker scherm, en alleen
          zichtbaar wanneer er daadwerkelijk een scan-resultaat is (success of
          error). De statische "tap hint" is weggehaald op verzoek. */}
      {step === 'select' && nfcToast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div data-testid="kiosk-nfc-toast"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full shadow-2xl font-black ${
              nfcToast.kind === 'ok'
                ? 'bg-emerald-500 text-white'
                : 'bg-red-500 text-white'
            }`}
            style={{ fontSize: 'clamp(12px, 1.1vmin + 9px, 16px)' }}>
            {nfcToast.kind === 'ok'
              ? <CheckCircle className="w-4 h-4" strokeWidth={2.6} />
              : <AlertCircle className="w-4 h-4" strokeWidth={2.6} />}
            <span>{nfcToast.msg}</span>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step} variants={variants}
          initial="enter" animate="center" exit="exit"
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden mobile-safe-bottom kiosk-content-scroll"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          {step === 'check' && (
            <div className="h-full bg-orange-500 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            </div>
          )}
          {step === 'select' && (
            <ApartmentSelect key={apartmentsReloadKey}
              onSelect={(a) => { setApartment(a); setStep('overview'); }}
              onAdmin={hasAdminAccess ? adminMode : null}
              onKasgeld={() => setStep('kasgeld')}
              onExit={exit} />
          )}
          {step === 'kasgeld' && (
            <KasgeldPanel onBack={() => setStep('select')} />
          )}
          {step === 'overview' && apartment && (
            <TenantOverview apartment={apartment} onBack={reset}
              onPay={(d) => { setOverview(d); setStep('pay'); }} />
          )}
          {step === 'pay' && overview && (
            <PaySelect overview={overview} onBack={() => setStep('overview')}
              onLiveChange={setLivePreview}
              onConfirm={(p) => { setLivePreview(null); setPaymentPayload(p); setStep('method'); }} />
          )}
          {step === 'method' && paymentPayload && overview && (
            <MethodSelect payload={paymentPayload} overview={overview} onBack={() => setStep('pay')}
              onConfirm={(p) => { setPaymentPayload(p); setStep('confirm'); }} />
          )}
          {step === 'confirm' && paymentPayload && overview && (
            <PaymentConfirm payload={paymentPayload} overview={overview} onBack={() => setStep('method')}
              onSuccess={(r) => { setPaymentResult(r); setStep('receipt'); }} />
          )}
          {step === 'receipt' && paymentResult && (
            <ReceiptScreen payment={paymentResult} overview={overview} onDone={reset} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Snelle aanmaak modals — beschikbaar vanaf de Kiosk */}
      {showAddSheet && (
        <KioskAddSheet
          onClose={() => setShowAddSheet(false)}
          onPick={handleSheetPick} />
      )}
      {showAddTenant && (
        <AddTenantModal
          onClose={() => setShowAddTenant(false)}
          onSaved={() => {
            setShowAddTenant(false);
            setApartmentsReloadKey((k) => k + 1);
          }} />
      )}
      {showAddApartment && (
        <AddApartmentModal
          onClose={() => setShowAddApartment(false)}
          onSaved={() => {
            setShowAddApartment(false);
            setApartmentsReloadKey((k) => k + 1);
          }} />
      )}
      {showAddLocation && (
        <AddLocationModal
          onClose={() => setShowAddLocation(false)}
          onSaved={() => {
            setShowAddLocation(false);
            setApartmentsReloadKey((k) => k + 1);
          }} />
      )}
      {showAddContract && (
        <AddContractModal
          onClose={() => setShowAddContract(false)}
          onSaved={() => setShowAddContract(false)} />
      )}
      {showAddInvoice && (
        <AddInvoiceModal
          onClose={() => setShowAddInvoice(false)}
          onSaved={() => setShowAddInvoice(false)} />
      )}
      {showPaymentsViewer && (
        <PaymentsViewerModal
          onClose={() => setShowPaymentsViewer(false)} />
      )}
      {showAddMaintenance && (
        <AddMaintenanceModal
          onClose={() => setShowAddMaintenance(false)}
          onSaved={() => setShowAddMaintenance(false)} />
      )}

      {/* Mobile-only vaste "+" menubalk onderaan — ALTIJD zichtbaar buiten
          het check-scherm, ook bovenop geopende modals (portal + z-[110]). */}
      {step !== 'check' && (
        <MobileAddFab onOpen={() => setShowAddSheet(true)} />
      )}

      {/* Desktop bottom bar — via createPortal in document.body geplaatst met
          fixed + z-[110] zodat de balk ALTIJD zichtbaar en klikbaar blijft,
          ook bovenop een geopende modal (modals gebruiken z-[100]). */}
      {showDesktopBar && createPortal((
        <div className="hidden md:block fixed bottom-0 left-0 right-0 z-[110] bg-white border-t border-slate-100"
          data-testid="kiosk-bottom-bar">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="rounded-lg bg-orange-500 flex items-center justify-center w-9 h-9 shrink-0">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm sm:text-base font-bold text-slate-800 truncate" data-testid="kiosk-footer-company">
                {company?.name || 'Kiosk'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {apartment && step !== 'select' && (
                <div className="flex items-center gap-2 mr-2">
                  <span className="text-sm text-slate-400 font-medium hidden lg:inline">{apartment.tenant_name}</span>
                  <span className="text-sm font-bold text-slate-800">Appt. {apartment.number}</span>
                </div>
              )}
              {step === 'select' && (
                <>
                  <button onClick={() => setShowAddTenant(true)} data-testid="kiosk-add-tenant-btn-desktop"
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-4 py-2 text-sm">
                    <UserPlus className="w-4 h-4" /> Huurder
                  </button>
                  <button onClick={() => setShowAddApartment(true)} data-testid="kiosk-add-apartment-btn-desktop"
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-4 py-2 text-sm">
                    <Home className="w-4 h-4" /> Appt.
                  </button>
                  <button onClick={() => setShowAddLocation(true)} data-testid="kiosk-add-location-btn-desktop"
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-4 py-2 text-sm">
                    <MapPin className="w-4 h-4" /> Locatie
                  </button>
                  <button onClick={() => setShowAddContract(true)} data-testid="kiosk-add-contract-btn-desktop"
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-4 py-2 text-sm">
                    <FileText className="w-4 h-4" /> Contract
                  </button>
                  <button onClick={() => setShowAddInvoice(true)} data-testid="kiosk-add-invoice-btn-desktop"
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-4 py-2 text-sm">
                    <Receipt className="w-4 h-4" /> Factuur
                  </button>
                  <button onClick={() => setShowPaymentsViewer(true)} data-testid="kiosk-payments-viewer-btn-desktop"
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-4 py-2 text-sm">
                    <Banknote className="w-4 h-4" /> Betalingen
                  </button>
                  <button onClick={() => setShowAddMaintenance(true)} data-testid="kiosk-add-maintenance-btn-desktop"
                    className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-4 py-2 text-sm">
                    <Wrench className="w-4 h-4" /> Onderhoud
                  </button>
                </>
              )}
              <button onClick={adminMode} data-testid="kiosk-admin-btn-desktop"
                className={`bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-5 py-2 text-sm ${hasAdminAccess ? '' : 'hidden'}`}>Beheerder</button>
              {step === 'select' && (
                <button onClick={() => setStep('kasgeld')} data-testid="kiosk-kasgeld-btn-desktop"
                  className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg px-5 py-2 text-sm">
                  <Wallet className="w-4 h-4" /> Kasgeld
                </button>
              )}
              <button onClick={exit} data-testid="kiosk-lock-btn-desktop"
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg px-5 py-2 text-sm">Uit</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
