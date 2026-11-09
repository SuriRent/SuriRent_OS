import { KioskAdminOnboarding } from '../../components/KioskAdminOnboarding';
import { KioskContractSignModal } from '../../components/KioskContractSign';
import PhotoUpload from '../../components/PhotoUpload';
import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext, lazy, Suspense, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useBrandedNavigate } from '../../lib/branded-nav';
import { publicMarketingUrl } from '../../lib/env';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search, Sun, Palette, Menu as MenuIcon, ScanLine,
  Building2, ArrowRight, ArrowLeft, Banknote, Receipt, LogOut, MapPin,
  Check, Loader2, Home, X, Wallet, FileText, AlertCircle, Coins,
  Smartphone, CreditCard, ShieldCheck, Clock as ClockIcon, Printer, Download,
  User, UserRound, Settings as SettingsIcon, Hash, CheckCircle, Calendar,
  MessageCircle, StickyNote, Trash2, Pencil, Plus, Mic, ChevronLeft, ChevronRight,
  UserPlus, Wrench, Nfc, Camera, ArrowUpRight, ArrowDownLeft, ChevronDown,
  Landmark as LandmarkIcon, Users, Database, FileSignature,   Wifi, Sparkles, Zap,
  BookOpen, LayoutGrid, MoreHorizontal, SlidersHorizontal,
} from 'lucide-react';
  import PowerControl, { ApartmentPower } from './admin/PowerControl';
import { api, formatError, fmtMoney, MONTHS_NL } from '../../lib/api';
import { postIdOcr } from '../../lib/idOcr';
import { StripePayElements } from '../../components/StripePayElements';
import { playSuccessPing, playErrorBuzz } from '../../lib/tap-sounds';
import {
  getKioskEmployee, withKioskEmployee,
} from '../../components/KioskEmployee';
import NumPad from '../../components/NumPad';
import KioskEmployeePush from '../../components/KioskEmployeePush';
import { useHidePwaSplash } from '../../lib/use-hide-pwa-splash';
import { printReceipt, openReceiptImage, apkPrintMessage, apkBridge, printFinancialReceipt, printTextLines } from '../../lib/kiosk-print';
import { KioskLiveStatus, KioskSheetLiveActions, KioskHeaderLiveButtons } from '../../components/KioskLiveStatus';
import { getKioskUserKey } from '../../lib/kiosk-live';
import { PhoneIdScan } from '../../components/PhoneIdScan';
import { KioskInvoicesModal } from '../../components/KioskInvoicesModal';
import { KioskPdfViewer } from '../../components/KioskPdfViewer';
import { KioskAdminPopup } from '../../components/KioskAdminPopup';
const KioskBonPage = lazy(() => import('./admin/KioskBonPage'));
const KioskSettingsPage = lazy(() => import('./admin/KioskSettingsPage'));
import { FxStats, FxTabs, FxRow, FxEmpty, FxIconBtn, KioskFxCtx } from '../../components/KioskFx';
import KioskManual from '../../components/KioskManual';
import { KioskDepositModal } from '../../components/KioskDepositModal';
import SubscriptionBell from '../../components/SubscriptionBell';
import { INSTELLINGEN_SECTIONS } from './admin/instellingenSections';
import InvoiceForm from './admin/invoices/InvoiceForm';
import { ModalHostContext } from '../../components/KeyboardSafeModal';
import { kioskLiveBye } from '../../lib/kiosk-live';
import { isKtpDevice } from '../../lib/ktp-printer';
import { BtPrintButton } from '../../components/BtPrintButton';
import { setIosStatusBar, useWhitePageBehindModal } from '../../lib/ios-status-bar';
import useKeyboardOpen from '../../lib/use-keyboard-open';
import useVisualViewportPosition from '../../lib/use-visual-viewport-position';
import { KtpPrintButton } from '../../components/KtpPrintButton';
import { PrintChoiceMenu, usePrintOptions } from '../../components/PrintChoiceMenu';
import { KasgeldReceiptScreen } from '../../components/KasgeldReceipt';
import { NfcLinkModal } from '../../components/NfcLinkModal';
import { KioskTenantSearch } from '../../components/KioskTenantSearch';
import { KioskBankTransferModal } from '../../components/KioskBankTransferModal';
import { KIOSK_ADMIN_PAGES, KioskAdminPage } from '../../components/KioskAdminInvoices';
import ImpersonationBanner from '../../components/ImpersonationBanner';
import CompanySupportNotice from '../../components/CompanySupportNotice';
import { emitNfc, subscribeNfc } from '../../lib/nfc-bus';
import { readKioskSelectCache, fetchKioskSelect, clearKioskSelectCache, prefetchKioskSelect, invalidateKioskSelect } from '../../lib/kiosk-cache';
import { useAuth } from '../../lib/auth';
const noop = () => {};

prefetchKioskSelect();

function useKioskLiveRefresh(refresh) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    const onChange = () => refreshRef.current();
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
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
  // 2026-02-28 — De drie knoppen "Uit", "Kasgeld" en "Beheerder" zijn
  // verhuisd naar de mobile `+` bottom-sheet (zie KioskAddSheet). Hierdoor
  // komt de top-balk op mobiel vrij en kan de inhoud (Kies een locatie
  // / Appartement) hoger op het scherm beginnen. We retourneren null om
  // bestaande call-sites (ApartmentSelect / TenantConfirm) niet te hoeven
  // aanpassen, zodat de knoppen puur via de sheet bereikbaar blijven.
  void onAdmin; void onExit; void onKasgeld;
  return null;
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
//   • z-[110]                                       → onder fullscreen modals
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
  const kbOpen = useKeyboardOpen();
  // Verberg de balk zodra het keyboard open is — anders schuift hij mee
  // omhoog met de gekrompen layout-viewport op iOS.
  if (kbOpen) return null;
  return createPortal((
    <div className="md:hidden fixed inset-x-0 z-[110] bg-white shadow-[0_-6px_24px_rgba(0,0,0,0.12)]"
      style={{
        // Balk boven de safe-area (Android nav-balk / iOS home-indicator).
        // Fallback 16px voor toestellen zonder env-value. + 16px extra
        // marge voor comfortabele tap-zone en visuele adem.
        bottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)',
        touchAction: 'none',
      }}
      data-testid="kiosk-fab-bar">
      <button onClick={onOpen} type="button"
        data-testid="kiosk-fab-plus"
        aria-label="Menu — Snel toevoegen"
        style={{ touchAction: 'manipulation' }}
        className="w-full h-7 relative bg-transparent active:bg-slate-50 transition">
        <span className="absolute left-1/2 -translate-x-1/2 -top-3 w-10 h-10 rounded-full bg-orange-500 text-white shadow-2xl flex items-center justify-center pointer-events-none">
          <Plus className="w-5 h-5" strokeWidth={3} />
        </span>
      </button>
    </div>
  ), document.body);
}

// =====================================================================
// Apartment select (with optional inline location picker when ≥2 locations)
// =====================================================================
// Desktop-kop: logo + bedrijfsnaam, locatie · "Kies uw appartement", rechts huurders + beheer.
const KioskThemeCtx = createContext({ theme: 'orange', toggle: () => {}, isAdmin: false });

// Beheerder-menu (dropdown) in de desktop-kop.
const ADMIN_MENU_ITEMS = [
  { id: 'nfc', label: 'NFC-tag', Icon: Wifi, onClick: () => navAdmin('nfc', 'admin') },
  { id: 'kasgeld', label: 'Kasgeld', Icon: Wallet, onClick: () => window.dispatchEvent(new CustomEvent('go-tab', { detail: 'kasgeld' })) },
];

const BOEKHOUDER_KIOSK_PAGES = ['overzicht', 'huurders', 'betalingen', 'facturen', 'regelingen', 'borg', 'notificaties'];

function requestedAdminStep() {
  const page = new URLSearchParams(window.location.search).get('admin');
  if (page === 'kasgeld') return 'kasgeld';
  if (page === 'nfc') return 'select';
  return KIOSK_ADMIN_PAGES[page] ? `admin:${page}` : 'select';
}

// Menu: telefoon = volledig scherm (zoals het + menu), desktop/iPad = popup in het midden.
function KioskMenuPanel({ title, Icon, items, onClose, testId, wide = false }) {
  const { theme } = useContext(KioskThemeCtx);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal((
    <div className="fixed inset-0 z-[120] flex md:items-center md:justify-center md:p-6 md:bg-black/40 md:backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose} data-testid={`${testId}-overlay`}>
      <div onClick={(e) => e.stopPropagation()} role="menu" data-testid={testId}
        className={`w-full h-full md:h-auto md:max-h-[85dvh] ${wide ? 'md:max-w-5xl' : 'md:max-w-4xl'} md:rounded-3xl md:overflow-hidden bg-orange-500 md:bg-white flex flex-col md:shadow-2xl animate-in md:zoom-in-95 duration-150 ${theme === 'white' ? 'kiosk-sheet-white' : theme === 'green' ? 'kiosk-sheet-green' : ''}`}>
        <div className="flex-none flex items-center justify-between px-4 md:px-6 md:border-b md:border-slate-100"
          style={{ paddingTop: 'max(var(--kiosk-sat), 16px)', paddingBottom: 12 }}>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 md:bg-orange-100 flex items-center justify-center">
              <Icon className="w-6 h-6 text-white md:text-[#FF5C00]" strokeWidth={2.4} />
            </div>
            <h3 className="text-xl font-black text-white md:text-slate-900"
              data-testid={`${testId}-title`}>{title}</h3>
          </div>
          <button type="button" onClick={onClose} data-testid={`${testId}-close`} aria-label="Sluiten"
            className="w-11 h-11 rounded-xl bg-white/20 md:bg-slate-100 md:hover:bg-slate-200 flex items-center justify-center transition">
            <X className="w-6 h-6 text-white md:text-slate-700" strokeWidth={2.5} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pt-1 md:pt-5 pb-4"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
          <div className={`grid grid-cols-2 md:grid-cols-4 ${wide ? 'lg:grid-cols-5' : ''} gap-3`}>
            {items.map((t, i) => (
              <button key={t.id} type="button" role="menuitem" data-testid={t.testid} onClick={() => { onClose(); t.onClick(); }}
                style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                className={`flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/95 md:bg-slate-50 md:hover:bg-orange-50 md:ring-1 md:ring-slate-100 shadow-lg md:shadow-none py-6 md:py-5 px-3 min-h-[130px] md:min-h-[120px] transition-[background-color,transform] active:scale-95 animate-in fade-in slide-in-from-bottom-1 fill-mode-both ${t.className || ''}`}>
                <span className="w-14 h-14 md:w-12 md:h-12 rounded-2xl bg-orange-100 flex items-center justify-center">
                  <t.Icon className="w-7 h-7 md:w-6 md:h-6 text-orange-600" strokeWidth={2} />
                </span>
                <span className="text-sm font-black text-slate-900 leading-tight text-center">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

// Onthoud vanuit welk menu een popup is geopend, zodat sluiten terugkeert naar dat menu.
let menuOrigin = null;
const navAdmin = (id, origin, returnTo = null) => {
  menuOrigin = origin ? { menu: origin, returnTo } : null;
  window.dispatchEvent(new CustomEvent('kiosk-nav', { detail: `admin:${id}` }));
};
const returnToMenu = () => {
  const origin = menuOrigin;
  menuOrigin = null;
  if (origin?.menu) window.dispatchEvent(new CustomEvent('kiosk-open-menu', { detail: origin.menu }));
};
function useMenuReopen(name, setOpen) {
  useEffect(() => {
    const h = (e) => { if (e.detail === name) setOpen(true); };
    const close = () => setOpen(false);
    window.addEventListener('kiosk-open-menu', h);
    window.addEventListener('kiosk-close-menu', close);
    return () => {
      window.removeEventListener('kiosk-open-menu', h);
      window.removeEventListener('kiosk-close-menu', close);
    };
  }, [name, setOpen]);
}

function isStaffSession() {
  try { return localStorage.getItem('kiosk_staff') === '1'; } catch { return false; }
}

function useAdminRole(isAdmin) {
  const [role, setRole] = useState(null);
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/auth/me').then((r) => setRole(r?.data?.staff ? 'staff' : (r?.data?.role || null))).catch(() => {});
  }, [isAdmin]);
  return role;
}

// Abonnement-bel (zelfde als beheeromgeving) — opent Mijn abonnement als kiosk-popup.
function KioskBell() {
  const { isAdmin } = useContext(KioskThemeCtx);
  const role = useAdminRole(isAdmin);
  if (!isAdmin || !role || role === 'boekhouder' || role === 'superadmin' || role === 'staff') return null;
  return (
    <div className="kiosk-bell shrink-0" data-testid="kiosk-subscription-bell">
      <SubscriptionBell compact backPath="/kiosk" onOpenSub={() => navAdmin('inst-abonnement')} />
    </div>
  );
}

// Tandwiel rechtsboven: elke instelling apart als eigen popup (alleen beheerder).
function KioskSettingsMenu() {
  const { isAdmin, isUi } = useContext(KioskThemeCtx);
  const [open, setOpen] = useState(false);
  const role = useAdminRole(isAdmin);
  const close = useCallback(() => setOpen(false), []);
  useMenuReopen('settings', setOpen);
  useEffect(() => { import('./admin/KioskSettingsPage'); }, []);
  if (!isAdmin || !role || role === 'boekhouder' || role === 'staff') return null;
  const items = INSTELLINGEN_SECTIONS.map(({ id, label, icon }) => ({
    id, label, Icon: icon, testid: `kiosk-settings-menu-${id}`, onClick: () => navAdmin(`inst-${id}`, 'settings'),
  }));
  return (
    <>
      <button type="button" onClick={() => navAdmin('inst-abonnement')} data-testid="kiosk-header-settings" aria-label="Instellingen" aria-expanded={open}
        className="hidden md:flex w-10 h-10 rounded-full items-center justify-center text-white transition-colors hover:bg-white/15">
        {isUi ? <User className="w-6 h-6" /> : <SettingsIcon className="w-6 h-6" />}
      </button>
      {open && <KioskMenuPanel wide title="Instellingen" Icon={SettingsIcon} items={items} onClose={close} testId="kiosk-settings-menu" />}
    </>
  );
}

function KioskAdminMenu({ returnTo }) {
  const { isAdmin } = useContext(KioskThemeCtx);
  const [open, setOpen] = useState(false);
  const role = useAdminRole(isAdmin);
  const close = useCallback(() => setOpen(false), []);
  useMenuReopen('admin', setOpen);
  if (!isAdmin) return null;
  const items = [
    {
      id: 'manual', label: 'Handleiding', Icon: BookOpen, testid: 'kiosk-admin-menu-manual',
      onClick: () => window.dispatchEvent(new CustomEvent('kiosk-manual-open')),
    },
    ...Object.keys(KIOSK_ADMIN_PAGES)
      .filter((id) => id !== 'instellingen' && id !== 'overzicht')
      .filter((id) => role !== 'boekhouder' || BOEKHOUDER_KIOSK_PAGES.includes(id))
      .map((id) => ({
        id, label: KIOSK_ADMIN_PAGES[id].label, Icon: KIOSK_ADMIN_PAGES[id].Icon,
        testid: `kiosk-admin-menu-${id}`,
        onClick: () => navAdmin(id, 'admin', returnTo),
      })),
    ...ADMIN_MENU_ITEMS.map((m) => ({
      ...m,
      testid: `kiosk-admin-menu-${m.id}`,
      ...(m.id === 'nfc' ? { onClick: () => navAdmin('nfc', 'admin', returnTo) } : {}),
    })),
    ...(role === 'admin' ? [{
      id: 'tour', label: 'Rondleiding starten', Icon: Sparkles, testid: 'kiosk-admin-menu-tour',
      onClick: () => window.dispatchEvent(new CustomEvent('kiosk-tour-start')),
    }] : []),
  ];
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-label="Beheermenu"
        data-testid="kiosk-admin-menu-btn"
        className="w-10 h-10 rounded-full flex items-center justify-center text-white transition-colors bg-white/15 hover:bg-white/25">
        <MenuIcon className="w-5 h-5" strokeWidth={2.4} />
      </button>
      {open && <KioskMenuPanel wide title="Beheer" Icon={MenuIcon} items={items} onClose={close} testId="kiosk-admin-menu" />}
    </div>
  );
}

function HeaderLive() {
  const { isAdmin } = useContext(KioskThemeCtx);
  return <KioskHeaderLiveButtons isAdmin={isAdmin} />;
}

function ThemeToggle({ testId, className = '' }) {
  const { theme, rawTheme, toggle } = useContext(KioskThemeCtx);
  const white = theme === 'white';
  const green = theme === 'green';
  const nextTheme = rawTheme === 'ui' ? 'Oranje modus' : rawTheme === 'wave' ? 'UI thema' : white ? 'Golf-achtergrond' : green ? 'Oranje modus' : 'Witte modus';
  return (
    <button type="button" onClick={toggle} data-testid={testId}
      aria-label={nextTheme} title={nextTheme}
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${white ? 'bg-orange-500 text-white hover:bg-orange-600' : green ? 'bg-white text-emerald-700 hover:bg-emerald-50' : 'bg-white/15 text-white hover:bg-white/25'} ${className}`}>
      {white ? <Palette className="w-5 h-5" /> : green ? <Sun className="w-5 h-5" /> : <Palette className="w-5 h-5" />}
    </button>
  );
}

const STEP_TITLES = {
  kasgeld: 'Kasgeldbeheer', stroom: 'Stroom', overview: 'Financieel overzicht', pay: 'Wat wilt u betalen?',
  method: 'Betaalmethode', confirm: 'Bevestigen', receipt: 'Kwitantie', 'admin:facturen': 'Facturen', 'admin:betalingen': 'Betalingen', 'admin:huurders': 'Huurders',
};

function DesktopKioskHeader({
  currentLocation, currentStep, currentLocationId, totalGroups, onLocations, onAdmin, onSearch,
  currentApartment, tenant, title = 'Kies uw appartement',
}) {
  let company = null;
  try { company = JSON.parse(localStorage.getItem('kiosk_company') || 'null'); } catch { /* ignore */ }
  const { isUi } = useContext(KioskThemeCtx);
  const loc = currentLocation ? [currentLocation.name, currentLocation.address].filter(Boolean).join(', ') : '';
  const locLabel = currentStep === 'stroom' ? title : loc ? (isUi && currentStep === 'select' ? loc : `${loc}  •  ${title}`) : title;
  return (
    <div className="kiosk-chrome flex items-center gap-3 md:gap-6 pl-2 pr-2 py-2 md:py-3 md:min-h-[7vh]" data-testid="kiosk-desktop-header">
      <KioskAdminMenu returnTo={{
        step: currentStep || 'select',
        location: currentLocationId || null,
        apartment: currentApartment || null,
      }} />
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1 md:flex-none md:shrink-0">
        <Home className="w-8 h-8 md:w-10 md:h-10 text-white shrink-0" strokeWidth={2.2} />
        <span className="text-xl md:text-2xl lg:text-3xl font-black text-white tracking-tight truncate" data-testid="kiosk-header-company">
          {company?.name || 'Kiosk'}
        </span>
      </div>
      {isUi && <span className="hidden md:block w-px h-9 bg-slate-300 shrink-0" aria-hidden="true" />}
      <button type="button" onClick={totalGroups > 1 ? onLocations : undefined} data-testid="back-to-locations"
        className={`hidden md:flex min-w-0 items-center justify-center gap-2 text-white font-semibold text-base lg:text-lg ${currentStep === 'stroom' ? 'mx-auto px-8 py-2.5 rounded-full bg-black/20 border border-white/30 shadow-lg font-black' : 'flex-1'} ${totalGroups > 1 ? 'hover:opacity-80' : 'cursor-default'}`}>
        {currentStep === 'stroom' ? <Zap className="w-5 h-5 shrink-0" fill="currentColor" /> : loc && <MapPin className="w-5 h-5 shrink-0" />}
        <span className="truncate">{locLabel}</span>
        {isUi && currentStep !== 'stroom' && <ChevronDown className="w-4 h-4 shrink-0" />}
      </button>
      {isUi && onSearch && (
        <button type="button" onClick={onSearch} data-testid="kiosk-ui-header-search"
          className="hidden md:flex flex-1 min-w-0 max-w-[420px] h-11 items-center gap-2 rounded-full bg-slate-100/80 px-4 text-slate-400 text-[15px]">
          <Search className="w-5 h-5 text-[#1B2A5C] shrink-0" /> <span className="truncate">Zoek huurder...</span>
        </button>
      )}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {tenant && (
          <div className="hidden md:flex items-center gap-2 rounded-full bg-white/95 pl-1 pr-3 py-1 max-w-[40vw]" data-testid="kiosk-header-tenant">
            <div className="w-9 h-9 [&>div]:!w-9 [&>div]:!h-9 [&>div]:!ring-0 shrink-0">
              <OverviewTenantPhoto src={tenant.photo} name={tenant.name} />
            </div>
            <span className="hidden sm:block text-sm font-black text-slate-800 truncate">{tenant.name}</span>
          </div>
        )}
        {onSearch && (
          <button type="button" onClick={onSearch} data-testid="kiosk-header-search" aria-label="Huurder zoeken"
            className="hidden md:flex h-10 md:w-auto justify-center rounded-full bg-white text-[#F26A12] hover:bg-white/90 items-center gap-2 md:px-4 font-bold transition-colors">
            <Search className="w-5 h-5" strokeWidth={2.4} /> <span className="hidden md:inline">Zoek huurder</span>
          </button>
        )}
        {!isUi && <HeaderLive />}
        <ThemeToggle testId="kiosk-theme-toggle" className="hidden md:flex" />
        <span className="hidden md:block w-px h-8 bg-white/40" />
        <KioskBell />
        <KioskEmployeePush />
        <KioskSettingsMenu />
      </div>
    </div>
  );
}

const UI_FILTERS = [
  { id: 'all', label: 'Alle' }, { id: 'paid', label: 'Betaald' }, { id: 'partial', label: 'Gedeeltelijk' },
  { id: 'unpaid', label: 'Niet betaald' }, { id: 'vacant', label: 'Vrij' },
];

function uiAptStatus(a) {
  if (!a.tenant_id) return 'vacant';
  if (a.tenant_deposit_pending) return 'deposit';
  return a.pay_status === 'paid' ? 'paid' : a.pay_status === 'partial' ? 'partial' : 'unpaid';
}

function UiStatusPill({ a, className = '' }) {
  const s = uiAptStatus(a);
  const base = `inline-flex items-center justify-center gap-1.5 rounded-full px-3 md:px-4 py-1 md:py-1.5 text-[13px] md:text-sm font-bold text-white whitespace-nowrap ${className}`;
  if (s === 'vacant') return <span className={`${base} bg-slate-700`} data-testid={`apt-${a.number}-link`}><ArrowRight className="w-4 h-4" strokeWidth={3} /> Beschikbaar</span>;
  if (s === 'deposit') return <span className={`${base} bg-sky-600`} data-testid={`apt-${a.number}-deposit-pending`}><ClockIcon className="w-4 h-4" strokeWidth={3} /> Wacht op borg</span>;
  if (s === 'paid') return <span className={`${base} bg-emerald-600`} data-testid={`apt-${a.number}-paid`}><Check className="w-4 h-4" strokeWidth={3} /> Betaald</span>;
  if (s === 'partial') return <span className={`${base} bg-amber-500`} data-testid={`apt-${a.number}-partial`}><ClockIcon className="w-4 h-4" strokeWidth={3} /> Gedeeltelijk</span>;
  return <span className={`${base} bg-red-500`} data-testid={`apt-${a.number}-unpaid`}><X className="w-4 h-4" strokeWidth={3} /> Niet betaald</span>;
}

// UI-thema: lijst-rij op telefoon, kaart op desktop/tablet.
function UiAptCard({ a, onOpen }) {
  const vacant = !a.tenant_id;
  const photo = a.tenant_avatar_url || a.tenant_id_photo_url;
  const src = photo && !/^https?:/.test(photo) ? `${process.env.REACT_APP_BACKEND_URL}${photo}` : photo;
  return (
    <button type="button" onClick={onOpen} data-testid={vacant ? `apt-${a.number}-vacant` : `apt-${a.number}`}
      className="kiosk-ui-card group w-full text-left flex flex-col relative rounded-2xl md:rounded-[22px] bg-white px-3 py-2 md:px-4 md:py-3 transition active:scale-[0.99] md:hover:-translate-y-0.5">
      <div className={`flex items-center gap-3 md:items-start w-full min-w-0 ${vacant ? 'md:flex-col md:items-center md:text-center md:gap-1' : ''}`}>
        <div className={`shrink-0 rounded-full overflow-hidden w-[52px] h-[52px] md:w-[64px] md:h-[64px] flex items-center justify-center ring-4 ring-white shadow-md ${vacant ? 'bg-slate-100' : 'bg-orange-50'}`}>
          {src && !vacant
            ? <img src={src} alt={a.tenant_name || ''} data-testid={`apt-${a.number}-photo`} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <Home className={`w-7 h-7 md:w-9 md:h-9 ${vacant ? 'text-slate-400' : 'text-orange-500'}`} />}
        </div>
        <div className="min-w-0 flex-1 md:max-w-full md:pr-9">
          <p className="text-[17px] md:text-xl font-extrabold text-[#1B2A5C] uppercase tracking-tight truncate leading-tight">{a.number}</p>
          <p className={`flex items-center gap-1.5 text-sm md:text-[13px] text-slate-700 font-medium truncate ${vacant ? 'md:justify-center' : ''}`}>
            {!vacant && <User className="w-4 h-4 shrink-0 text-[#1B2A5C]" />}
            <span className="truncate">{vacant ? 'Vrij' : a.tenant_name}</span>
          </p>
        </div>
        <UiStatusPill a={a} className="md:hidden shrink-0" />
        <span className={`shrink-0 w-8 h-8 rounded-full bg-slate-100 text-[#1B2A5C] flex items-center justify-center md:absolute md:top-3 md:right-3 ${vacant ? 'md:hidden' : ''}`}>
          <ChevronRight className="w-4 h-4" strokeWidth={2.6} />
        </span>
      </div>
      <div className="hidden md:flex justify-center mt-2"><UiStatusPill a={a} /></div>
    </button>
  );
}

function VillaArt({ className = '' }) {
  return (
    <svg viewBox="0 0 240 150" className={className} aria-hidden="true">
      <ellipse cx="120" cy="140" rx="112" ry="9" fill="#000" opacity="0.08" />
      <rect x="30" y="62" width="120" height="76" rx="4" fill="#fff" />
      <rect x="130" y="40" width="80" height="98" rx="4" fill="#FFE3CC" />
      <path d="M22 66 L90 22 L158 66 Z" fill="#FF7A1F" />
      <path d="M124 44 L170 14 L216 44 Z" fill="#E85D00" />
      <rect x="44" y="80" width="26" height="30" rx="3" fill="#BFE3F5" />
      <rect x="80" y="80" width="26" height="30" rx="3" fill="#BFE3F5" />
      <rect x="146" y="60" width="24" height="26" rx="3" fill="#BFE3F5" />
      <rect x="178" y="60" width="24" height="26" rx="3" fill="#BFE3F5" />
      <rect x="146" y="98" width="24" height="40" rx="3" fill="#1B2A5C" />
      <rect x="112" y="96" width="22" height="42" rx="3" fill="#8A5A3B" />
      <circle cx="16" cy="118" r="16" fill="#3FAE5A" />
      <rect x="14" y="128" width="4" height="12" fill="#6B4423" />
      <circle cx="226" cy="122" r="13" fill="#3FAE5A" />
    </svg>
  );
}

function UiHero({ apartments, locationName }) {
  const occ = apartments.filter((a) => a.tenant_id);
  const paid = occ.filter((a) => a.pay_status === 'paid').length;
  const unpaid = occ.length - paid;
  const rent = occ.reduce((s, a) => s + (Number(a.rent_amount) || 0), 0);
  const cur = occ.find((a) => a.currency)?.currency || 'SRD';
  const pct = (n) => `${occ.length ? Math.round((n / occ.length) * 100) : 0}%`;
  const stat = (key, Icon, tone, label, value, bar, barTone) => (
    <div key={key} className="kiosk-ui-stat rounded-2xl bg-white p-2 md:px-4 md:py-3 shadow-[0_8px_22px_-14px_rgba(15,23,42,0.35)] min-w-0" data-testid={`kiosk-ui-stat-${key}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`shrink-0 w-8 h-8 md:w-11 md:h-11 rounded-full flex items-center justify-center ${tone}`}><Icon className="w-4 h-4 md:w-6 md:h-6" strokeWidth={2.6} /></span>
        <div className="min-w-0">
          <p className="text-[11px] md:text-[12px] font-medium text-slate-600 truncate leading-tight">{label}</p>
          <p className="text-[15px] md:text-[22px] font-extrabold text-[#1B2A5C] leading-tight whitespace-nowrap">{value}</p>
        </div>
        {key === 'rent' && <ChevronDown className="hidden md:block ml-auto w-5 h-5 text-[#1B2A5C] shrink-0" />}
      </div>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className={`h-full rounded-full ${barTone}`} style={{ width: bar }} /></div>
      )}
    </div>
  );
  return (
    <div className="kiosk-ui-hero px-1 sm:px-2 md:px-5 md:pt-3 pb-3" data-testid="kiosk-ui-hero">
      {locationName && (
        <div className="md:hidden flex justify-center -mt-1 mb-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 shadow px-4 py-1.5 text-[13px] font-bold text-[#1B2A5C] max-w-full">
            <MapPin className="w-4 h-4 text-[#FF5C00] shrink-0" /><span className="truncate">{locationName}</span><ChevronDown className="w-4 h-4 shrink-0" />
          </span>
        </div>
      )}
      <VillaArt className="hidden md:block fixed right-6 bottom-24 w-72 pointer-events-none -z-10 opacity-90" />
      <div className="relative overflow-hidden rounded-3xl md:rounded-none kiosk-ui-hero-banner px-4 pt-3 pb-3 md:p-0 md:overflow-visible text-white md:text-slate-900 bg-gradient-to-r from-[#FF7A1F] to-[#FF9A45] md:bg-none md:from-transparent md:to-transparent md:flex md:items-center md:justify-between md:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 w-11 h-11 md:w-16 md:h-16 rounded-full bg-white/90 md:bg-gradient-to-br md:from-[#FF8A2B] md:to-[#FF5C00] flex items-center justify-center text-[#FF5C00] md:text-white shadow-md">
            <Building2 className="w-6 h-6 md:hidden" strokeWidth={2.2} /><Home className="hidden md:block w-8 h-8" strokeWidth={2.4} fill="currentColor" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[19px] md:text-3xl font-bold tracking-tight leading-tight truncate">Appartementen Overzicht</h2>
            <p className="text-[13px] md:text-base font-normal text-white/90 md:text-slate-500">Totaal: {apartments.length} appartementen</p>
          </div>
        </div>
        <VillaArt className="md:hidden absolute right-1 bottom-0 w-28 pointer-events-none" />
        <div className="hidden md:grid grid-cols-3 gap-3 w-[min(760px,62vw)] shrink-0">
          {stat('paid', Check, 'bg-emerald-500 text-white', 'Betaald deze maand', `${paid} / ${occ.length}`, pct(paid), 'bg-emerald-500')}
          {stat('late', AlertCircle, 'bg-red-500 text-white', 'Achterstand', `${unpaid} / ${occ.length}`, pct(unpaid), 'bg-red-500')}
          {stat('rent', Calendar, 'bg-orange-100 text-[#FF5C00]', 'Totaal huur', `${cur} ${Math.round(rent).toLocaleString('nl-NL')}`)}
        </div>
      </div>
      <div className="md:hidden grid grid-cols-3 gap-2 mt-3">
        {stat('paid', Check, 'bg-emerald-500 text-white', 'Betaald', `${paid} / ${occ.length}`, pct(paid), 'bg-emerald-500')}
        {stat('late', AlertCircle, 'bg-red-500 text-white', 'Achterstand', `${unpaid} / ${occ.length}`, pct(unpaid), 'bg-red-500')}
        {stat('rent', Calendar, 'bg-orange-100 text-[#FF5C00]', 'Totaal huur', `${cur} ${Math.round(rent).toLocaleString('nl-NL')}`)}
      </div>
    </div>
  );
}

function ApartmentSelect({
  onSelect, onAdmin, onAdminAll, onExit, onKasgeld, onSearch,
  selectedLocationId, onLocationSelectionChange,
}) {
  const { isUi } = useContext(KioskThemeCtx);
  const [uiQ, setUiQ] = useState('');
  const [uiFilter, setUiFilter] = useState('all');
  const navigate = useBrandedNavigate();
  const [cached] = useState(readKioskSelectCache);
  const [apartments, setApartments] = useState(() => cached?.apartments || []);
  const [locations, setLocations] = useState(() => (cached?.locations || []).filter((l) => l.id !== '_none'));
  const setSelectedLocationId = onLocationSelectionChange;
  useEffect(() => {
    const onNav = (e) => { if (e.detail === 'dashboard') setSelectedLocationId(null); };
    window.addEventListener('kiosk-nav', onNav);
    return () => window.removeEventListener('kiosk-nav', onNav);
  }, []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [linkApt, setLinkApt] = useState(null);
  const reloadSelect = useCallback(() => {
    invalidateKioskSelect();
    fetchKioskSelect().then((d) => {
      setApartments(d.apartments);
      setLocations(d.locations.filter((l) => l.id !== '_none'));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const refresh = () => reloadSelect();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('surirent:live-change', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reloadSelect]);

  useEffect(() => {
    fetchKioskSelect().then((d) => {
      setApartments(d.apartments);
      setLocations(d.locations.filter((l) => l.id !== '_none'));
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
        clearKioskSelectCache();
        navigate('/login?target=kiosk', { replace: true });
        return;
      }
      setError(formatError(e));
    }).finally(() => setLoading(false));
  }, [navigate]);

  const unassignedCount = useMemo(
    () => apartments.filter((a) => !a.location_id).length,
    [apartments]
  );
  const totalGroups = locations.length + (unassignedCount > 0 ? 1 : 0);
  const showLocationPicker = totalGroups > 1 && selectedLocationId === null;
  useEffect(() => {
    onLocationSelectionChange(selectedLocationId);
  }, [onLocationSelectionChange, selectedLocationId]);

  // Auto-skip when there's only one (or zero) groups.
  useEffect(() => {
    if (loading) return;
    if (selectedLocationId && !['__none__', '__any__'].includes(selectedLocationId)
      && !locations.some((l) => l.id === selectedLocationId)) { setSelectedLocationId(null); return; }
    if (selectedLocationId !== null) return;
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
  ).sort(sortApartments);
  const shown = !isUi ? visible : visible.filter((a) => {
    const term = uiQ.trim().toLowerCase();
    if (uiFilter !== 'all' && uiAptStatus(a) !== uiFilter) return false;
    return !term || `${a.number} ${a.tenant_name || ''}`.toLowerCase().includes(term);
  });

  // ----- Location picker view -----
  if (showLocationPicker) {
    return (
      <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '0 1.5vw 0' }}>
        {/* Mobile: knoppen bovenaan in 1 rij (matcht ontwerp) */}
        <MobileHeaderButtons onAdmin={onAdmin} onExit={onExit} onKasgeld={onKasgeld} />
        {/* Mobile: kleine titel links, onder de knoppen */}
        <DesktopKioskHeader title="Kies een locatie" currentStep="select" totalGroups={1}
          onAdmin={onAdminAll || onAdmin} onSearch={onSearch} />
        <div className="kiosk-chrome md:hidden px-2 pt-1 pb-2 flex items-center justify-between gap-2">
          <span className="text-xl font-black text-white tracking-tight">Kies een locatie</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto pb-32 md:pb-28">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 px-1 sm:px-2 max-w-5xl mx-auto pt-2">
            {locations.map((loc) => {
              const count = apartments.filter((a) => a.location_id === loc.id).length;
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
      {/* Desktop: bestaande header met terug-knop + gecentreerde titel */}
      <DesktopKioskHeader currentLocation={currentLocation} currentStep="select"
        currentLocationId={selectedLocationId} totalGroups={totalGroups}
        onLocations={() => setSelectedLocationId(null)} onAdmin={onAdminAll || onAdmin} onSearch={onSearch} />
      <div className={`kiosk-chrome md:hidden px-2 pt-1 pb-2 flex items-center gap-2 min-w-0${isUi ? ' !hidden' : ''}`}>
        {totalGroups > 1 && (
          <button onClick={() => setSelectedLocationId(null)} data-testid="back-to-locations-mobile"
            className="flex items-center gap-1 text-white/90 font-bold bg-white/15 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs">
            <ArrowLeft className="w-3.5 h-3.5" /> Locaties
          </button>
        )}
        <span className="text-xl font-black text-white tracking-tight truncate">
          {currentLocation ? currentLocation.name : 'Kies uw appartement'}
        </span>
      </div>

      {isUi && <UiHero apartments={visible} locationName={currentLocation ? [currentLocation.name, currentLocation.address].filter(Boolean).join(', ') : ''} />}
      {isUi && (
        <div className="md:hidden flex items-center gap-2 px-1 sm:px-2 pb-3">
          <label className="flex-1 min-w-0 h-12 rounded-2xl bg-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.35)] flex items-center gap-2 px-4">
            <Search className="w-5 h-5 text-[#1B2A5C] shrink-0" />
            <input value={uiQ} onChange={(e) => setUiQ(e.target.value)} placeholder="Zoek huurder of appartement..." data-testid="kiosk-ui-search"
              className="w-full min-w-0 bg-transparent outline-none text-[15px] text-slate-800 placeholder:text-slate-400" />
          </label>
          <label className="relative shrink-0 w-12 h-12 rounded-2xl bg-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.35)] flex items-center justify-center text-[#1B2A5C]">
            <SlidersHorizontal className="w-5 h-5" />
            <select value={uiFilter} onChange={(e) => setUiFilter(e.target.value)} aria-label="Filter" data-testid="kiosk-ui-filter"
              className="absolute inset-0 opacity-0 w-full h-full">
              {UI_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && (
        <div className="bg-white/95 text-red-600 rounded-lg text-center text-sm font-semibold mx-1 mb-2 py-2 px-3">{error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-auto pb-32 md:pb-28">
        <div className={isUi
          ? 'grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 items-start gap-2 sm:gap-3 md:gap-3 px-1 sm:px-2 md:px-5 md:pt-1'
          : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3 md:gap-4 px-1 sm:px-2 md:pt-2'}>
          {shown.map((a) => {
            if (isUi) return <UiAptCard key={a.id} a={a} onOpen={() => (a.tenant_id ? onSelect(a) : setLinkApt(a))} />;
            // De pasfoto komt uit Huurders (ID-kaart) en wordt altijd getoond.
            const photo = a.tenant_id
              ? (a.tenant_avatar_url || a.tenant_id_photo_url)
              : null;
            const photoSrc = photo && !/^https?:/.test(photo)
              ? `${process.env.REACT_APP_BACKEND_URL}${photo}`
              : photo;
            if (!a.tenant_id) {
              return (
                <button key={a.id} onClick={() => setLinkApt(a)} data-testid={`apt-${a.number}-vacant`}
                  className="group bg-white/90 flex flex-col items-center justify-center text-center rounded-2xl p-3 sm:p-4 md:py-5 hover:-translate-y-1 hover:bg-white transition border-2 border-dashed border-slate-300 hover:border-orange-500">
                  <div className="rounded-full flex items-center justify-center w-14 h-14 md:w-20 md:h-20 mb-2 md:mb-3 bg-slate-100 group-hover:bg-orange-50">
                    <Home className="w-7 h-7 md:w-9 md:h-9 text-slate-400 group-hover:text-orange-500" />
                  </div>
                  <span className="text-lg sm:text-xl md:text-2xl font-black text-slate-500 mb-0.5 md:mb-1 uppercase tracking-tight">{a.number}</span>
                  <span className="text-xs sm:text-sm md:text-base text-slate-600 font-bold mb-2 md:mb-3">Vrij</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-slate-700 group-hover:bg-[#FF5C00] text-white md:text-sm md:px-5 md:py-1 rounded-full px-3 py-1 transition-colors" data-testid={`apt-${a.number}-link`}>
                    <UserPlus className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={3} /> Koppelen
                  </span>
                </button>
              );
            }
            return (
            <button key={a.id} onClick={() => onSelect(a)} data-testid={`apt-${a.number}`}
              className="group bg-white flex flex-col items-center justify-center text-center rounded-2xl p-3 sm:p-4 md:py-5 hover:-translate-y-1 transition border-2 border-transparent hover:border-orange-500 shadow-[0_6px_18px_-6px_rgba(120,40,0,0.35)]"
              style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
              {photoSrc ? (
                <div className="rounded-full overflow-hidden w-14 h-14 md:w-20 md:h-20 mb-2 md:mb-3 bg-orange-50 ring-4 ring-slate-100 group-hover:ring-orange-300">
                  <img src={photoSrc} alt={a.tenant_name || ''}
                    data-testid={`apt-${a.number}-photo`}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
              ) : (
                <div className="rounded-full flex items-center justify-center w-14 h-14 md:w-20 md:h-20 mb-2 md:mb-3 bg-orange-50 group-hover:bg-orange-100">
                  <Building2 className="w-7 h-7 md:w-9 md:h-9 text-orange-500" />
                </div>
              )}
              <span className="text-lg sm:text-xl md:text-2xl font-black text-slate-900 mb-0.5 md:mb-1 uppercase tracking-tight">{a.number}</span>
              <div className="flex items-center gap-1 md:gap-1.5 text-slate-700 mb-2 md:mb-3 max-w-full">
                <User className="w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4 shrink-0" />
                <span className="text-xs sm:text-sm md:text-base truncate text-slate-700 font-medium max-w-[100px] sm:max-w-[120px] md:max-w-[170px]">{a.tenant_name}</span>
              </div>
              {/* Betaal-status badge — dynamisch per huurder-status:
                   • paid    → Betaald    (groen)
                   • partial → Deels bet. (geel/oranje)
                   • unpaid  → Niet bet.  (rood)
                  Wanneer er geen facturen zijn, valt de backend terug op
                  "paid" (geen achterstand). */}
              {a.tenant_deposit_pending ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-sky-600 text-white md:text-sm md:px-5 md:py-1 rounded-full px-3 py-1" data-testid={`apt-${a.number}-deposit-pending`}>
                  <ClockIcon className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={3} /> Wacht op borg
                </span>
              ) : a.pay_status === 'paid' ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-600 text-white md:text-sm md:px-5 md:py-1 rounded-full px-3 py-1" data-testid={`apt-${a.number}-paid`}>
                  <Check className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={3} /> Betaald
                </span>
              ) : a.pay_status === 'partial' ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-500 text-white md:text-sm md:px-5 md:py-1 rounded-full px-3 py-1" data-testid={`apt-${a.number}-partial`}>
                  <ClockIcon className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={3} /> Gedeeltelijk
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-red-500 text-white md:text-sm md:px-5 md:py-1 rounded-full px-3 py-1" data-testid={`apt-${a.number}-unpaid`}>
                  <X className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={3} /> Niet betaald
                </span>
              )}
            </button>
            );
          })}
          {shown.length === 0 && (
            <div className="col-span-full bg-white/90 rounded-2xl p-10 text-center">
              <Home className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-semibold">Geen appartementen op deze locatie.</p>
            </div>
          )}
        </div>
      </div>
      {linkApt && <LinkTenantModal apartment={linkApt} onClose={() => setLinkApt(null)}
        onLinked={(d) => {
          setLinkApt(null); reloadSelect();
          window.dispatchEvent(new CustomEvent('kiosk-deposit-open', { detail: {
            id: d.tenant_id, name: d.tenant_name, apartment_id: d.apartment_id,
            apartment_number: d.apartment_number, rent_amount: d.rent_amount, currency: d.currency } }));
        }} />}
    </div>
  );
}

// Open koppelscherm vangt telefoon-ID-scans op (i.p.v. Nieuwe huurder-modal).
const linkScanHandler = { current: null };

function LinkTenantModal({ apartment, onClose, onLinked }) {
  const [tab, setTab] = useState('existing');
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [f, setF] = useState({ name: '', phone: '', email: '', id_number: '', birth_date: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef(null);
  const [phoneScanned, setPhoneScanned] = useState(false);
  useEffect(() => {
    linkScanHandler.current = (msg) => {
      const sc = msg.scan || {};
      setTab('new');
      setF((p) => ({ ...p, name: sc.name || p.name, id_number: sc.id_number || p.id_number, birth_date: sc.birth_date || p.birth_date }));
      setScan({ scan: sc, asset_id: msg.asset_id, id_photo_url: msg.id_photo_url });
      setPhoneScanned(true);
    };
    return () => { linkScanHandler.current = null; };
  }, []);
  const onScanFile = async (file) => {
    if (!file) return;
    setScanning(true); setErr('');
    try {
      const { data } = await postIdOcr('/kiosk/id-scan', file, { user_key: 'link-tenant' });
      const sc = data?.scan || {};
      setF((p) => ({ ...p, name: sc.name || p.name, id_number: sc.id_number || p.id_number, birth_date: sc.birth_date || p.birth_date }));
      setScan(data);
      if (!sc.name && !sc.id_number) setErr('ID-kaart niet goed gelezen — vul de gegevens zelf in of scan opnieuw.');
    } catch (e) { setErr(formatError(e)); } finally { setScanning(false); if (scanRef.current) scanRef.current.value = ''; }
  };
  const loadUnassigned = useCallback(() => api.get('/kiosk/tenants/unassigned').then((r) => {
      setList(r.data || []);
      if (!(r.data || []).length) setTab('new');
    }).catch((e) => { setList([]); setErr(formatError(e)); }), []);
  useEffect(() => { loadUnassigned(); }, [loadUnassigned]);
  useKioskLiveRefresh(loadUnassigned);
  const shown = (list || []).filter((t) => !q || `${t.name} ${t.phone || ''} ${t.id_number || ''}`.toLowerCase().includes(q.toLowerCase()));
  const canSave = tab === 'existing' ? !!pick : f.name.trim().length > 1;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/kiosk/apartments/${apartment.id}/link-tenant`,
        tab === 'existing' ? { tenant_id: pick } : { new_tenant: f });
      if (tab === 'new' && scan?.asset_id) {
        await api.post(`/kiosk/tenants/${data.tenant_id}/attach-id-photo`, { asset_id: scan.asset_id }).catch(() => {});
      }
      onLinked(data);
    } catch (e) { setErr(formatError(e)); } finally { setBusy(false); }
  };
  const input = 'w-full h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base bg-white';
  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <button onClick={onClose} data-testid="link-tenant-cancel" className="h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Annuleren</button>
      <button onClick={save} disabled={!canSave || busy} data-testid="link-tenant-save"
        className="h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Koppelen
      </button>
    </div>
  );
  return (
    <KioskModalShell title={`Huurder koppelen — ${apartment.number}`} Icon={UserPlus} testId="link-tenant" onClose={onClose} footer={footer}>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 mb-3">
        {[['existing', 'Bestaande huurder'], ['new', 'Nieuwe huurder']].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setTab(v)} data-testid={`link-tenant-tab-${v}`}
            className={`h-10 rounded-lg text-sm font-black transition-colors ${tab === v ? 'bg-white text-[#FF5C00] shadow-sm' : 'text-slate-500'}`}>{l}</button>
        ))}
      </div>
      {tab === 'existing' ? (
        <div className="space-y-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op naam, telefoon of ID" data-testid="link-tenant-search" className={input} />
          {!list ? <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto my-4" />
            : shown.length === 0 ? <p className="text-sm text-slate-500 text-center py-4" data-testid="link-tenant-empty">{q ? 'Geen resultaten.' : 'Geen huurders zonder appartement.'}</p>
              : (
                <div className="max-h-[45vh] overflow-y-auto space-y-1.5">
                  {shown.map((t) => (
                    <button key={t.id} type="button" onClick={() => setPick(t.id)} data-testid={`link-tenant-option-${t.id}`}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-colors ${pick === t.id ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 hover:border-orange-300'}`}>
                      <p className="font-bold text-slate-900">{t.name}</p>
                      <p className="text-xs text-slate-500">{[t.phone, t.id_number].filter(Boolean).join(' · ') || '—'}</p>
                    </button>
                  ))}
                </div>
              )}
        </div>
      ) : (
        <div className="space-y-2">
          <input ref={scanRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="link-tenant-scan-input"
            onChange={(e) => onScanFile(e.target.files?.[0])} />
          <button type="button" onClick={() => scanRef.current?.click()} disabled={scanning} data-testid="link-tenant-scan"
            className="w-full h-12 rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 hover:bg-orange-100 text-[#FF5C00] font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-5 h-5" />}
            {scanning ? 'ID-kaart lezen…' : scan ? 'Opnieuw scannen' : 'Scan ID-kaart'}
          </button>
          {phoneScanned && <p className="text-xs font-bold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2" data-testid="link-tenant-phone-scanned">Gegevens ontvangen van uw telefoon</p>}
          <p className="hidden md:block text-[11px] text-slate-400 text-center" data-testid="link-tenant-phone-hint">Of scan met uw telefoon via de knop "Scan ID" — de gegevens verschijnen hier vanzelf.</p>
          {scan?.id_photo_url && (
            <img src={`${process.env.REACT_APP_BACKEND_URL}${scan.id_photo_url}`} alt="Gescande ID-kaart" data-testid="link-tenant-scan-preview"
              className="w-full max-h-32 object-contain rounded-xl bg-slate-50 border border-slate-200" />
          )}
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Naam *" data-testid="link-tenant-name" className={input} />
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Telefoon" inputMode="tel" data-testid="link-tenant-phone" className={input} />
          <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="E-mail" inputMode="email" data-testid="link-tenant-email" className={input} />
          <input value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} placeholder="ID-nummer" data-testid="link-tenant-idnr" className={input} />
        </div>
      )}
      <p className="text-xs text-slate-500 mt-3">Na het koppelen opent direct het borgscherm. De huurfacturen starten pas na betaling van de borg.</p>
      {err && <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="link-tenant-err">{err}</p>}
    </KioskModalShell>
  );
}

// FinancialPrintButton — printer-icoon voor de financiële bon van de huurder.
function FinancialPrintButton({ tenantId }) {
  const [printState, setPrintState] = useState(null);
  const printOpts = usePrintOptions();
  if (!printOpts.any) return null;
  return (
    <span title={printState?.msg || 'Financiële bon printen'} data-testid="overview-fin-print">
      <PrintChoiceMenu paymentId="fin" iconOnly
        remoteUrl={`/kiosk/tenants/${tenantId}/financial-remote-print`}
        printDataUrl={`/kiosk/tenants/${tenantId}/financial-print-data`}
        onLocal={() => printFinancialReceipt({ tenantId, apiGet: (u, o) => api.get(u, o) })
          .then((ok) => !ok && setPrintState({ kind: 'err', msg: 'Printen mislukt' }))}
        onStatus={setPrintState} />
    </span>
  );
}
// =====================================================================
// NotesButton — toont badge met aantal notities, opent NotesModal.
// =====================================================================
function NotesButton({ tenantId, tenantName }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(null);
  const loadCount = useCallback(() => {
    api.get(`/kiosk/tenants/${tenantId}/notes`)
      .then((r) => setCount((r.data || []).length))
      .catch(() => setCount(0));
  }, [tenantId]);
  useEffect(() => { loadCount(); }, [loadCount]);
  useKioskLiveRefresh(loadCount);
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="overview-notes-btn" title="Notities" aria-label="Notities"
        className="px-2.5 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs inline-flex items-center gap-1.5">
        <StickyNote className="w-3.5 h-3.5" />
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
  useKioskLiveRefresh(load);

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

  const printNoteLocal = async (n) => {
    try {
      const { data } = await api.get(`/kiosk/tenants/${tenantId}/notes/${n.id}/print-data`);
      await printTextLines(data.lines, data);
    } catch (e) { setErr(formatError(e)); }
  };
  const dismiss = async (id) => {
    try {
      await api.post(`/kiosk/tenants/${tenantId}/notes/${id}/dismiss`);
      await load();
    } catch (e) { setErr(formatError(e)); }
  };

  return createPortal((
    <div onClick={onClose} className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-stretch sm:items-center justify-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl flex flex-col h-full sm:h-auto sm:max-h-[85vh] overflow-hidden"
        data-testid="notes-modal">
        <div className="flex-none flex items-center justify-between px-5 pb-3 border-b border-slate-100"
          style={{ paddingTop: 'max(var(--kiosk-sat), 16px)' }}>
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
                    <PrintChoiceMenu paymentId={`note-${n.id}`} iconOnly
                      remoteUrl={`/kiosk/tenants/${tenantId}/notes/${n.id}/remote-print`}
                      printDataUrl={`/kiosk/tenants/${tenantId}/notes/${n.id}/print-data`}
                      onLocal={() => printNoteLocal(n)}
                      onStatus={(s) => setErr(s.kind === 'err' ? s.msg : '')} />
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
// Huurder-overzicht alvast ophalen bij het aantikken (start tijdens de schermovergang).
const _ovPrefetch = new Map();
const fetchOverview = (tid) => api.get(`/kiosk/tenants/${tid}/overview`);
function prefetchOverview(tid) {
  if (!tid) return;
  _ovPrefetch.set(tid, { p: fetchOverview(tid), at: Date.now() });
}
// Betaling via beheer → prefetch-cache weg, zodat de kiosk vers ophaalt.
const clearOverviewPrefetch = () => _ovPrefetch.clear();
window.addEventListener('kiosk-overview-invalidate', clearOverviewPrefetch);
window.addEventListener('surirent:live-change', clearOverviewPrefetch);
function takeOverview(tid) {
  const hit = _ovPrefetch.get(tid);
  _ovPrefetch.delete(tid);
  return hit && Date.now() - hit.at < 15000 ? hit.p : fetchOverview(tid);
}

function OverviewTenantPhoto({ src, name }) {
  const [bad, setBad] = useState(false);
  const url = src && !/^https?:/.test(src) ? `${process.env.REACT_APP_BACKEND_URL}${src}` : src;
  const ini = (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-orange-100 ring-4 ring-orange-50 flex items-center justify-center" data-testid="overview-tenant-photo">
      {url && !bad
        ? <img src={url} alt={name || ''} className="w-full h-full object-cover" onError={() => setBad(true)} />
        : <span className="text-base sm:text-lg font-black text-[#FF5C00]">{ini}</span>}
    </div>
  );
}

function TenantOverview({ apartment, onBack, onPay }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [dueReminder, setDueReminder] = useState(null);

  const reload = useCallback((fresh = false) => {
    if (!apartment?.tenant_id) return;
    (fresh ? fetchOverview(apartment.tenant_id) : takeOverview(apartment.tenant_id))
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
  const actRef = useRef({});
  useEffect(() => {
    const onAct = (e) => actRef.current[e.detail]?.();
    window.addEventListener('kiosk-tenant-action', onAct);
    return () => window.removeEventListener('kiosk-tenant-action', onAct);
  }, []);
  useEffect(() => {
    const onInv = (e) => { const t = e.detail?.tenant_id; if (!t || t === apartment?.tenant_id) reload(true); };
    window.addEventListener('kiosk-overview-invalidate', onInv);
    return () => window.removeEventListener('kiosk-overview-invalidate', onInv);
  }, [reload, apartment?.tenant_id]);
  useEffect(() => {
    const onChange = () => reload(true);
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  if (loading) return <div className="h-full bg-orange-500 flex items-center justify-center"><Loader2 className="w-10 h-10 text-white animate-spin" /></div>;
  if (err || !data) return <div className="h-full bg-orange-500 flex items-center justify-center text-white p-8">{err || 'Geen data'}</div>;

  const { tenant, apartment: apt, balance, credit_balance: credit = 0 } = data;
  // Backend levert 3 buckets:
  //   open_invoices      → Achterstallige huur (vervaltermijn + grace verstreken)
  //   current_invoices   → Openstaande huidige maand (lopende periode of nog in grace)
  //   future_invoices    → Vooruit gefactureerd (toekomst, NIET in totaal)
  const openInvoices = Array.isArray(data.open_invoices) ? data.open_invoices : [];
  const openInvoicesTotal = Number(data.open_invoices_total || 0);
  // Boetes — alleen berekenen/tonen wanneer admin "Automatische boetes" heeft
  // ingeschakeld in Facturen-automatisering. Backend levert `fines_total`
  // als 0 wanneer uitgeschakeld, anders de berekende som.
  const finesTotal = Number(data.fines_total || 0);
  const finesCurrency = String(data.fines_currency || data.balance?.currency || 'SRD');
  const currentInvoices = Array.isArray(data.current_invoices) ? data.current_invoices : [];
  const currentInvoicesTotal = Number(data.current_invoices_total || 0);
  const futureInvoices = Array.isArray(data.future_invoices) ? data.future_invoices : [];
  const futureInvoicesTotal = Number(data.future_invoices_total || 0);
  // Eerste current factuur voor legacy-display (backwards compat).
  const currentInvoice = data.current_month_invoice || currentInvoices[0] || null;
  // Achterstand — ALTIJD uit het backend bucket (`open_invoices_total`). De
  // oude fallback op `balance.balance` was buggy: `balance.balance` bevat
  // ook current_invoices, waardoor die bij het openstaand bedrag
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
  // Totaal openstaand = achterstand + huidige maand
  // (vooruit gefactureerd NIET meegerekend — dat is toekomst, geen schuld nu)
  // (Internet-item is verwijderd op 2026-02-22)
  const totalDue = currentMonthAmount + openRent;
  const allPaid = totalDue <= 0;
  actRef.current = {
    pay: () => onPay({ ...data, total_due: totalDue,
      open_invoices: openInvoices, open_invoices_total: openInvoicesTotal,
      current_invoices: currentInvoices, current_invoices_total: currentInvoicesTotal,
      future_invoices: futureInvoices, future_invoices_total: futureInvoicesTotal,
      current_month_invoice: currentInvoice }),
    history: () => setShowHistory(true),
  };
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
    // Boetes — alleen tonen wanneer er daadwerkelijk een boetebedrag is
    // berekend (admin heeft "Automatische boetes" aangezet). Zolang
    // `finesTotal === 0` blijft de rij volledig verborgen.
    ...(finesTotal > 0 ? [{
      key: 'fines',
      label: 'Boetes',
      value: finesTotal,
      currency: finesCurrency,
      icon: FileText,
      muted: true,
    }] : []),
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
    <div className="h-full bg-orange-500 flex flex-col pt-[1.5vh] md:pt-0" style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }}>
      <div className="kiosk-chrome md:hidden flex items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2">
        <button onClick={onBack} data-testid="overview-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 sm:gap-3 pb-3 md:pt-3">
        <div className="bg-white rounded-2xl flex-1 md:flex-[3] flex flex-col p-4 sm:p-5 min-w-0">
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <OverviewTenantPhoto src={apartment?.tenant_avatar_url || tenant.avatar_url || apartment?.tenant_id_photo_url} name={tenant.name} />
              <div className="min-w-0">
                <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-400">Financieel overzicht</p>
                <h3 className="text-base sm:text-lg font-black text-slate-900 truncate" data-testid="overview-tenant-name">{tenant.name}</h3>
                <p className="text-xs text-slate-500">Appt. {apt.number}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <FinancialPrintButton tenantId={tenant.id} />
              <NotesButton tenantId={tenant.id} tenantName={tenant.name} />
            </div>
          </div>
          {tenant.deposit_pending && (
            <div className="mb-3 rounded-2xl bg-sky-50 border border-sky-200 p-3 flex items-center gap-3" data-testid="overview-deposit-pending">
              <ShieldCheck className="w-7 h-7 text-sky-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-900">Borg nog niet betaald</p>
                <p className="text-xs text-slate-600">Contract en maandfacturen starten na de borgbetaling.</p>
              </div>
              <button type="button" data-testid="overview-deposit-pay"
                onClick={() => window.dispatchEvent(new CustomEvent('kiosk-deposit-open', { detail: { ...tenant, apartment_number: apt.number, rent_amount: apt.rent_amount, currency: apt.currency } }))}
                className="shrink-0 h-11 px-4 rounded-xl bg-[#FF5C00] text-white font-black text-sm">Borg betalen</button>
            </div>
          )}
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
          <div className="border-t-2 border-slate-200 mt-2 pt-2 row-label-value">
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
                  if (tenant.deposit_pending) return (
                    <div className="flex flex-col items-center" data-testid="overview-deposit-first">
                      <ShieldCheck className="w-12 h-12 text-sky-600 mb-2" />
                      <p className="text-lg font-extrabold text-slate-900">Eerst de borg</p>
                      <p className="text-xs text-slate-500 mb-3 max-w-xs">Huur betalen kan pas nadat de borg is geregistreerd.</p>
                      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('kiosk-deposit-open', { detail: { ...tenant, apartment_number: apt.number, rent_amount: apt.rent_amount, currency: apt.currency } }))}
                        className="h-12 px-6 rounded-xl bg-[#FF5C00] text-white font-black">Borg betalen</button>
                    </div>
                  );
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
                  <button onClick={() => onPay({ ...data, total_due: firstMonthRent, isAdvance: true,
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
                  <button onClick={() => onPay({ ...data, total_due: 0, isAdvance: true,
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
              <button onClick={() => onPay({ ...data, total_due: totalDue,
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
            reload(true);  // haalt volgende reminder op, of null als er geen meer is
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
    <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
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
  const loadPayments = useCallback(() => {
    api.get(`/kiosk/tenants/${tenant.id}/payments`)
      .then((r) => { setItems(r.data); setErr(''); }).catch((e) => setErr(formatError(e)));
  }, [tenant.id]);
  useEffect(() => { loadPayments(); }, [loadPayments]);
  useEffect(() => {
    const onChange = () => loadPayments();
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadPayments]);

  // Stille afdruk: haal de PDF als blob op via de authenticated axios
  // client (window.open naar /api/... werkt niet altijd in de kiosk-PWA
  // want de child-tab krijgt niet automatisch de httpOnly cookies mee).
  // Bon in #bon → window.print().
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
      // Universeel via window.print() met #bon — werkt op elk
      // platform (desktop Chrome met --kiosk-printing → geen dialoog;
      // Android/iOS → native print-dialoog). Bij mislukking valt hij
      // terug op de JPG-versie in een nieuw tabblad zodat de operator
      // via Share Sheet kan afdrukken of opslaan.
      const ok = await printReceipt({
        paymentId,
        apiGet: api.get,
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
  // Bon-JPG's vooraf ophalen zodat navigator.share direct binnen de klik kan
  // starten (Android blokkeert delen na een trage fetch).
  const jpgCache = useRef({});
  const fetchJpg = (id) => {
    if (!jpgCache.current[id]) {
      jpgCache.current[id] = api.get(`/payments/${id}/image`, { responseType: 'blob' })
        .then((r) => r.data).catch((e) => { delete jpgCache.current[id]; throw e; });
    }
    return jpgCache.current[id];
  };
  useEffect(() => {
    (items || []).slice(0, 8).forEach((x) => { fetchJpg(x.id).catch(() => {}); });
  }, [items]); // eslint-disable-line

  const handleWhatsApp = async (paymentId) => {
    if (busy[paymentId]) return;
    setBusy((prev) => ({ ...prev, [paymentId]: 'wa' }));
    setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'sending', msg: 'Bezig…' } }));
    const receipt = (items || []).find((x) => x.id === paymentId);
    const phone = String(tenant.phone || '').replace(/\D/g, '');
    const apiBase = (api.defaults.baseURL || `${window.location.origin}/api`).replace(/\/+$/, '');
    const imageUrl = `${apiBase}/payments/${paymentId}/image`;
    const shareText = `Hallo ${tenant.name || ''}, hierbij uw kwitantie ${receipt?.receipt_number || ''}` +
      (receipt?.amount ? ` · ${fmtMoney(receipt.amount, receipt.currency)}` : '') +
      (receipt?.period_month ? ` · Periode ${MONTHS_NL[receipt.period_month - 1]} ${receipt.period_year}` : '') +
      '.';
    const whatsAppUrl = phone.length >= 7
      ? `https://wa.me/${phone}?text=${encodeURIComponent(shareText)}`
      : imageUrl;
    // Reserveer het tabblad binnen de klikactie; browsers kunnen pop-ups na
    // het ophalen van de JPG blokkeren wanneer navigator.share niet lukt.
    const canFileShare = typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] });
    const fallbackTab = canFileShare ? null : window.open('about:blank', '_blank');
    // Geen bestand-delen mogelijk (desktop): kopieer de bon als afbeelding naar het
    // klembord en download de JPG, open WhatsApp zonder link; plakken met Ctrl+V.
    const useFallback = async (jpgBlob, fileName) => {
      let copied = false;
      if (jpgBlob) {
        try {
          const bmp = await createImageBitmap(jpgBlob);
          const cv = document.createElement('canvas');
          cv.width = bmp.width; cv.height = bmp.height;
          cv.getContext('2d').drawImage(bmp, 0, 0);
          const png = await new Promise((res) => cv.toBlob(res, 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
          copied = true;
        } catch { /* klembord niet beschikbaar */ }
        try {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(jpgBlob);
          a.download = fileName;
          document.body.appendChild(a); a.click(); a.remove();
        } catch { /* download mislukt */ }
      }
      if (phone.length >= 7) {
        if (fallbackTab && !fallbackTab.closed) fallbackTab.location.replace(whatsAppUrl);
        else openWhatsApp(phone, shareText);
      } else {
        if (fallbackTab && !fallbackTab.closed) fallbackTab.close();
        if (!jpgBlob) openReceiptImage(paymentId);
      }
      setWaState((prev) => ({
        ...prev,
        [paymentId]: {
          kind: 'ok',
          msg: copied ? 'Bon gekopieerd — plak in WhatsApp (Ctrl+V)' : 'Bon gedownload — voeg toe in WhatsApp',
        },
      }));
    };
    try {
      const blob = await fetchJpg(paymentId);
      const file = new File([blob], `bon-${receipt?.receipt_number || paymentId}.jpg`,
        { type: 'image/jpeg' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText, title: 'Kwitantie' });
        if (fallbackTab && !fallbackTab.closed) fallbackTab.close();
        setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'ok', msg: 'Gedeeld' } }));
      } else {
        await useFallback(blob, file.name);
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (fallbackTab && !fallbackTab.closed) fallbackTab.close();
        setWaState((prev) => { const c = { ...prev }; delete c[paymentId]; return c; });
      } else if (canFileShare && e && e.name !== 'TypeError') {
        setWaState((prev) => ({ ...prev, [paymentId]: { kind: 'err', msg: 'Delen mislukt, tik nogmaals' } }));
      } else {
        await useFallback();
      }
    } finally {
      setBusy((prev) => { const c = { ...prev }; delete c[paymentId]; return c; });
    }
  };

  return (
    <KioskModalShell
      title="Betalingsgeschiedenis"
      Icon={ClockIcon}
      testId="history"
      onClose={onClose}
      wide
      tall
    >
      <div data-testid="kiosk-history-modal" className="space-y-0">
        <div className="pb-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
            <ClockIcon className="w-4 h-4 text-orange-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">Betalingen · Appt. {apartment?.number}</h3>
            <p className="text-xs text-slate-500 truncate">
              {tenant.name || ''}{tenant.name && items ? ' · ' : ''}
              {items ? `${items.length} betaling${items.length === 1 ? '' : 'en'}` : 'Laden…'}
            </p>
          </div>
        </div>
        {err && <p className="text-red-500 text-sm py-4">{err}</p>}
        {!items && !err && <div className="py-10 flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500" /></div>}
        {items && items.length === 0 && (
          <div className="py-10 text-center text-slate-400">
            <Receipt className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>Nog geen betalingen voor deze huurder.</p>
          </div>
        )}
        {items && items.map((p) => (
          <div key={p.id} data-testid={`history-row-${p.id}`} className="py-3 border-b border-slate-100 last:border-0 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
            <div className="flex-1 min-w-0 break-words">
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
                  aria-label="WhatsApp"
                  className="w-9 h-9 sm:w-auto sm:h-8 sm:px-2.5 rounded-full sm:rounded-lg bg-slate-100 hover:bg-slate-200 active:scale-95 disabled:opacity-60 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 transition-transform">
                  {busy[p.id] === 'wa'
                    ? <Loader2 className="w-4 h-4 sm:w-3 sm:h-3 animate-spin" />
                    : <MessageCircle className="w-4 h-4 sm:w-3 sm:h-3" />}
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>
                <PrintChoiceMenu paymentId={p.id} disabled={busy[p.id] === 'print'}
                  onLocal={() => handlePrint(p.id)}
                  onStatus={(st) => setWaState((prev) => ({ ...prev, [p.id]: st }))} />
              </div>
              {waState[p.id] && (
                <p data-testid={`history-print-status-${p.id}`}
                  className={`text-[10px] font-semibold px-1 max-w-[140px] text-right ${
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
    </KioskModalShell>
  );
}

// =====================================================================
// Pay select — checklist + keypad (old-ERP style)
// =====================================================================
// Boete is het enige template-item. Huur wordt per factuur als
// individuele rij getoond (achterstand + huidige maand + vooruit), zodat de
// huurder/medewerker precies kan kiezen wat ze willen voldoen.
// (Internet-item verwijderd op verzoek — 2026-02-22.)
const PAY_ITEMS_TEMPLATE = [
  { id: 'boete', label: 'Boetes', icon: AlertCircle, desc: 'Openstaande boetes' },
];

function PaySelect({ overview, onBack, onConfirm }) {
  const { tenant, apartment: apt, balance, total_due, isAdvance = false,
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
  };

  const [selected, setSelected] = useState(new Set());
  // Prefill custom-bedrag met eerste-maand-huur als de nieuwe-huurder flow
  // deze doorgeeft — huurder ziet direct het correcte bedrag en kan
  // desgewenst nog aanpassen.
  const [custom, setCustom] = useState(prefillAdvance > 0 ? String(prefillAdvance.toFixed(2)) : '');
  // Ander bedrag / keypad is standaard OPEN op mobiel zodat de huurder direct
  // een bedrag kan invoeren zonder eerst op "Ander bedrag invoeren" te klikken.
  const [showMobileKeypad, setShowMobileKeypad] = useState(false);
  const [planInstallments, setPlanInstallments] = useState([]);
  // Set van invoice-ids die door een actieve regeling gedekt worden. Deze
  // facturen filteren we uit `openInvoices`/`currentInvoices` zodat "Alles
  // betalen" ze niet dubbel telt met de plan-termijnen (bug 2026-02:
  // augustus-factuur SRD 8500 + 2× termijn SRD 4250 = SRD 17.000 terwijl
  // het werkelijk openstaand SRD 8500 is).
  const [planLinkedInvIds, setPlanLinkedInvIds] = useState(new Set());
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planSuccess, setPlanSuccess] = useState(null);  // {id, num_installments, total_amount}

  const loadPaymentPlans = useCallback(() => api.get(`/kiosk/tenants/${tenant.id}/payment-plans`)
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
      .catch(() => { setPlanInstallments([]); setPlanLinkedInvIds(new Set()); }), [tenant.id]);
  useEffect(() => { loadPaymentPlans(); }, [loadPaymentPlans]);
  useKioskLiveRefresh(loadPaymentPlans);

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
  // "Alles betalen" includeert: achterstand + huidige maand + boete + plan-termijnen.
  // Vooruit gefactureerd is OPT-IN (niet standaard mee-geselecteerd, want het is toekomst).
  // (Internet-item is verwijderd op 2026-02-22.)
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
    if (selectedPlanItems.length > 0) labels.push(`Regeling (${selectedPlanItems.length}× termijn)`);
    return labels.join(' + ');
  };



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
    <div className="h-full bg-orange-500 flex flex-col px-3 sm:px-6 pt-2 md:pt-3">
      <div className="kiosk-chrome md:hidden flex items-center justify-between flex-wrap gap-2 py-2">
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
          <div className="hidden md:flex items-center gap-3 px-1 pb-3 mb-2 border-b border-slate-100" data-testid="payselect-tenant">
            <OverviewTenantPhoto src={tenant.avatar_url} name={tenant.name} />
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-400">{isAdvance ? 'Vooruitbetaling registreren' : 'Wat wilt u betalen?'}</p>
              <h3 className="text-base sm:text-lg font-black text-slate-900 truncate">{tenant.name}</h3>
              <p className="text-xs text-slate-500">Appt. {apt.number}</p>
            </div>
          </div>
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

          {/* Items-lijst — eigen gegroepeerde scroll-container binnen de kaart
              ONDER de "Alles betalen" knop, zodat die altijd zichtbaar
              bovenaan blijft en de maanden/termijnen daaronder scrollen.
              De lichte achtergrond + border visualiseert het scroll-vak.
              De knoppen ("Direct betalen" / "Regeling afspreken") én het
              "Ander bedrag" numpad blijven altijd zichtbaar daaronder. */}
          <div className="flex flex-col gap-1 sm:gap-1.5 flex-1 min-h-0 overflow-y-auto bg-slate-50/60 border border-slate-100 rounded-xl p-1.5">
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

            {/* Boetes — alleen tonen wanneer de beheerder daadwerkelijk een
                boetebedrag heeft ingesteld (amounts[t.id] > 0). Zolang er
                geen boete openstaat, verbergen we de rij volledig zodat de
                huurder niet onnodig verwarring krijgt. */}
            {PAY_ITEMS_TEMPLATE.filter((t) => (amounts[t.id] || 0) > 0).map((t) => {
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

          {/* Donkere "N items — Huur X, Y, Z — totaal" samenvatting verwijderd
              per user-verzoek (2026-02-28). De totalen worden al duidelijk
              getoond in de "Direct betalen" + "Regeling afspreken" knoppen
              hieronder, dus een aparte samenvatting is overbodig. */}

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

          {/* Mobile keypad — de toggle-bar ("Ander bedrag · Sluiten") blijft
              ALTIJD zichtbaar; alleen het numpad-grid en het bedragdisplay
              worden onder de bar in-/uitgevouwen. Extra bottom-padding met
              safe-area zodat de 7/8/9/0 rij niet onder de iOS home-indicator
              of Android navigatiebalk verdwijnt. */}
          <div className="md:hidden mt-1.5 bg-white border border-slate-200 rounded-xl overflow-hidden"
            style={{ paddingBottom: showMobileKeypad ? 'max(env(safe-area-inset-bottom, 0px), 12px)' : '0px' }}>
            {/* Toggle-bar — altijd zichtbaar, click schakelt het numpad */}
            <button
              type="button"
              onClick={() => {
                setShowMobileKeypad((v) => {
                  const next = !v;
                  if (!next) setCustom('');
                  return next;
                });
              }}
              data-testid="mobile-custom-toggle"
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-slate-50 transition">
              <span className="flex items-center gap-2 text-slate-700 font-medium">
                <Hash className="w-4 h-4" />
                Ander bedrag ({cur})
              </span>
              <span className="text-xs text-slate-500 font-semibold">
                {showMobileKeypad ? 'Sluiten' : 'Openen'}
              </span>
            </button>

            {/* Numpad-paneel — opent/sluit zonder de toggle-bar te verbergen */}
            {showMobileKeypad && (
              <div className="border-t border-slate-100 p-2.5">
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
                className={`portrait:min-h-[60px] rounded-lg font-bold transition active:scale-95 flex items-center justify-center text-base sm:text-lg ${
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
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4"
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
            <div className="row-label-value text-sm">
              <span className="text-slate-700 font-semibold">Per maand</span>
              <span className="font-extrabold text-orange-600">{fmt(per)}</span>
            </div>
            <div className="row-label-value text-xs text-slate-500 mt-1">
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
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const closePdf = useCallback(() => setPdfUrl(''), []);
  useEffect(() => {
    if (!pdfUrl) return undefined;
    return () => URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);
  const openPdf = async () => {
    setPdfLoading(true);
    setPdfError('');
    try {
      const path = plan.pdf_url || `/kiosk/payment-plans/${plan.id}/pdf`;
      const { data } = await api.get(path, { responseType: 'blob' });
      setPdfUrl(URL.createObjectURL(new Blob([data], { type: 'application/pdf' })));
    } catch (e) {
      setPdfError(formatError(e, 'PDF openen mislukt'));
    } finally {
      setPdfLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4"
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
          <div className="row-label-value text-sm">
            <span className="text-slate-500">Huurder</span>
            <span className="font-bold">{tenant.name}</span>
          </div>
          <div className="row-label-value text-sm">
            <span className="text-slate-500">Termijnen</span>
            <span className="font-bold">{plan.num_installments}× {fmt(per)}</span>
          </div>
          {plan.first_due_date && (
            <div className="row-label-value text-sm">
              <span className="text-slate-500">Eerste vervaldatum</span>
              <span className="font-bold">{plan.first_due_date}</span>
            </div>
          )}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-700">
            Beheer ontvangt een melding. Termijnen verschijnen automatisch bij het volgende kiosk-bezoek.
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-2">
          <button type="button" onClick={openPdf} disabled={pdfLoading}
            data-testid="plan-arranged-pdf"
            className="py-3 rounded-lg bg-white border-2 border-orange-300 text-orange-600 font-bold text-sm hover:bg-orange-50 flex items-center justify-center gap-2 disabled:opacity-50">
            {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {pdfLoading ? 'PDF laden…' : 'PDF'}
          </button>
          <button onClick={onClose}
            data-testid="plan-arranged-close"
            className="py-3 rounded-lg bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-600">
            Sluiten
          </button>
        </div>
        {pdfError && <p role="alert" className="px-6 pb-3 text-sm text-red-600">{pdfError}</p>}
      </div>
      {pdfUrl && (
        <KioskPdfViewer
          url={pdfUrl}
          filename={`regeling-${plan.id}.pdf`}
          onClose={closePdf}
          testId="plan-arranged-pdf-viewer"
        />
      )}
    </div>
  );
}

// =====================================================================
// Method select — Contant / Bankoverschrijving
// =====================================================================
function MethodSelect({ payload, overview, onBack, onConfirm }) {
  const { tenant, apartment: apt } = overview;
  const cur = payload.currency || 'SRD';
  const [stripeCfg, setStripeCfg] = useState(null);
  const [stripeMethod, setStripeMethod] = useState(null);
  const [bankOpen, setBankOpen] = useState(false);
  const pick = (m) => {
    if (m.stripe) setStripeMethod(m.stripe);
    else if (m.v === 'bank') setBankOpen(true);
    else onConfirm({ ...payload, method: m.v });
  };
  useEffect(() => { api.get('/kiosk/stripe/config').then(({ data }) => setStripeCfg(data)).catch(() => {}); }, []);
  const methods = [
    { v: 'contant', l: 'Contant', sub: 'Betaal met contant geld', icon: Banknote, accent: 'emerald' },
    { v: 'bank', l: 'Bankoverschrijving', sub: 'Overboeking naar bankrekening', icon: CreditCard, accent: 'blue' },
    ...(stripeCfg?.enabled && stripeCfg.methods.includes('card') ? [{ v: 'creditcard', l: 'Creditcard', sub: 'Direct betalen op dit scherm', icon: CreditCard, accent: 'orange', stripe: 'card' }] : []),
    ...(stripeCfg?.enabled && stripeCfg.methods.includes('ideal') ? [{ v: 'ideal', l: 'iDEAL', sub: 'Direct naar uw bank', icon: LandmarkIcon, accent: 'pink', stripe: 'ideal' }] : []),
  ];

  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }}>
      <div className="kiosk-chrome flex md:grid md:grid-cols-3 items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2">
        <button onClick={onBack} data-testid="method-back"
          className="md:hidden flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
        <span className="text-sm sm:text-base font-semibold text-white md:col-start-2 md:text-center">
          Hoe wilt u betalen? <span className="ml-2 opacity-80">{fmtMoney(payload.amount, cur)}</span>
        </span>
        <div className="text-right text-white">
          <p className="text-xs sm:text-sm font-semibold">{tenant.name}</p>
          <p className="text-[10px] sm:text-xs opacity-70">Appt. {apt.number}</p>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center pb-6 overflow-auto">
        <div className={`grid grid-cols-1 gap-3 sm:gap-4 w-full px-2 ${methods.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-4 max-w-6xl' : 'sm:grid-cols-3 max-w-4xl'}`}>
          {methods.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.v} onClick={() => pick(m)} data-testid={`method-${m.v}`}
                className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-8 flex sm:flex-col items-center sm:justify-center text-left sm:text-center gap-4 sm:gap-0 hover:scale-[1.02] sm:hover:scale-[1.03] active:scale-[0.98] transition sm:aspect-[3/4] shadow-2xl">
                <div className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full flex items-center justify-center shrink-0 sm:mb-4 ${
                  m.accent === 'red' ? 'bg-red-50 text-red-500' : m.accent === 'orange' ? 'bg-orange-50 text-[#FF5C00]' : m.accent === 'pink' ? 'bg-pink-50 text-[#CC0066]' : 'bg-emerald-50 text-emerald-500'
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
      {bankOpen && (
        <KioskBankTransferModal amount={payload.amount} currency={cur}
          description={[`Appt. ${apt.number}`, tenant.name, payload.note].filter(Boolean).join(' – ')}
          onClose={() => setBankOpen(false)}
          onDone={() => { setBankOpen(false); onConfirm({ ...payload, method: 'bank' }); }} />
      )}
      {stripeMethod && (
        <KioskStripePanel payload={payload} method={stripeMethod} tenantName={tenant.name}
          onClose={() => setStripeMethod(null)}
          onPaid={(pi) => onConfirm({ ...payload, method: stripeMethod === 'ideal' ? 'ideal' : 'creditcard', stripe_payment_intent_id: pi, stripe_paid: true })} />
      )}
    </div>
  );
}

// Stripe betalen in de Kiosk: direct de betaalpagina (kaart op scherm, iDEAL via bankpagina).
function KioskStripePanel({ payload, method, tenantName, onClose, onPaid }) {
  const [intent, setIntent] = useState(null);
  const [err, setErr] = useState('');
  const cur = payload.currency || 'SRD';
  const openBank = (u) => { const w = window.open(u, '_blank'); if (!w) window.location.assign(u); };
  useEffect(() => {
    api.post('/kiosk/stripe/intent', { tenant_id: payload.tenant_id, amount: payload.amount, currency: cur, method, origin: window.location.origin })
      .then(({ data }) => { setIntent(data); if (data.redirect_url) openBank(data.redirect_url); })
      .catch((e) => setErr(formatError(e)));
  }, []);
  useEffect(() => {
    if (!intent) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const { data } = await api.get(`/kiosk/stripe/status/${intent.payment_intent_id}`);
        if (data.status === 'paid' && !stop) { stop = true; playSuccessPing(); onPaid(intent.payment_intent_id); return; }
        if (data.status === 'failed' && !stop) setErr('Betaling mislukt of geannuleerd — probeer opnieuw.');
      } catch { /* opnieuw */ }
      if (!stop) setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [intent]);
  const eur = intent ? `€${(intent.amount_eur_cents / 100).toFixed(2)}` : '';
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="kiosk-stripe-panel">
      <div className="bg-white rounded-3xl w-full max-w-lg max-h-[92vh] overflow-auto shadow-2xl p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{method === 'ideal' ? 'iDEAL' : 'Creditcard'} · {tenantName}</p>
            <p className="text-2xl font-black text-slate-900">{fmtMoney(payload.amount, cur)} {eur && <span className="text-base font-bold text-[#FF5C00]">({eur})</span>}</p>
          </div>
          <button onClick={onClose} data-testid="kiosk-stripe-close" className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><X className="w-5 h-5 text-slate-600" /></button>
        </div>
        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 mb-3" data-testid="kiosk-stripe-error">{err}</p>}
        {!err && !intent && <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>}
        {intent && intent.redirect_url && (
          <div className="text-center py-4" data-testid="kiosk-stripe-ideal">
            <p className="text-sm font-bold text-slate-900">Rond de betaling af op de iDEAL-pagina</p>
            <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Wacht op betaling…</p>
            <button onClick={() => openBank(intent.redirect_url)} data-testid="kiosk-stripe-ideal-open"
              className="mt-4 w-full h-14 rounded-2xl bg-[#CC0066] hover:bg-[#B3005A] text-white font-black">Open iDEAL-betaalpagina</button>
          </div>
        )}
        {intent && !intent.redirect_url && (
          <StripePayElements publishableKey={intent.publishable_key} clientSecret={intent.client_secret} amountLabel={eur}
            returnUrl={`${window.location.origin}/betalen/${intent.token}`} onPaid={() => {}} />
        )}
        {intent?.mode === 'test' && <p className="text-[10px] text-center font-bold uppercase tracking-widest text-amber-600 mt-4">Testmodus</p>}
      </div>
    </div>,
    document.body,
  );
}

// =====================================================================
// Confirm + Receipt
// =====================================================================
// APK print-bridge: alleen binnen de Android-APK (ReactNativeWebView) actief.
const METHOD_LABELS = { contant: 'Contant', bank: 'Bankoverschrijving', creditcard: 'Creditcard', ideal: 'iDEAL' };
const fmtPrintDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
async function sendApkPrint(data, paymentId) {
  // Volledige bon-gegevens (bedrijf/locatie, saldo, omschrijving…) uit de backend.
  let full = {};
  if (paymentId) {
    try { full = (await api.get(`/kiosk/payments/${paymentId}/print-data`)).data || {}; }
    catch (e) { console.warn('[APK PRINT_RECEIPT] print-data niet opgehaald', e); }
  }
  // APK opent zelf het systeem-printvenster; url = print-klare bon (HTML, @media print).
  const url = paymentId ? `${process.env.REACT_APP_BACKEND_URL}/api/payments/${paymentId}/print.html?format=thermal&preview=1` : null;
  const msg = apkPrintMessage(url, { ...data, ...full });
  console.log('[APK PRINT_RECEIPT]', msg);
  const bridge = apkBridge();
  if (!bridge) return;
  if (paymentId) window.dispatchEvent(new CustomEvent('kiosk-receipt-printed', { detail: { paymentId } }));
  try { bridge(JSON.stringify(msg)); } catch (e) { console.warn('[APK PRINT_RECEIPT] mislukt', e); }
}

function PaymentConfirm({ payload, overview, onBack, onSuccess }) {
  const { tenant, apartment: apt } = overview;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (payload.stripe_paid) submit(); }, []);
  const submit = async () => {
    setLoading(true); setErr('');
    try {
      const planItems = payload.plan_items || [];
      let planReceipt = '';
      let planPayment = null;
      for (const pi of planItems) {
        const pr = await api.post(withKioskEmployee(`/kiosk/payment-plans/${pi.plan_id}/installments/${pi.seq}/pay`), {
          method: payload.method,
          amount: pi.amount,
          note: `Operator Kiosk — termijn ${pi.seq}`,
        });
        planReceipt = planReceipt || pr?.data?.receipt_number || pr?.data?.payment?.receipt_number || '';
        planPayment = planPayment || pr?.data?.payment || null;
      }
      let data;
      const plainAmount = payload.plain_amount != null ? payload.plain_amount : payload.amount;
      if (plainAmount && plainAmount > 0) {
        const plainPayload = { ...payload, amount: plainAmount };
        delete plainPayload.plan_items; delete plainPayload.plain_amount; delete plainPayload.stripe_paid;
        const res = await api.post(withKioskEmployee('/kiosk/payments'), plainPayload);
        data = res.data;
      } else {
        // Alleen termijnen: gebruik de termijnbetaling als kwitantie (anders payment.id = undefined).
        data = { ...(planPayment || {}), kind: 'plan_only', plan_items: planItems };
      }
      playSuccessPing();
      // Alleen de KT-V520 print automatisch (stil via KTPsdk); elders nooit een automatisch printvenster.
      if (isKtpDevice()) sendApkPrint({
        naam: tenant?.name || '',
        appartement: apt?.number || '',
        bedrag: fmtMoney(payload.amount, payload.currency || 'SRD'),
        methode: METHOD_LABELS[payload.method] || payload.method || '',
        datum: fmtPrintDate(new Date()),
        kwitantie: data?.receipt_number || data?.payment?.receipt_number || planReceipt || '',
      }, data?.id || data?.payment?.id);
      // Overige toestellen: KT-V520 via WebSocket + Bluetooth print de succespagina automatisch.
      onSuccess(data);
    } catch (e) { setErr(formatError(e)); playErrorBuzz(); }
    finally { setLoading(false); }
  };

  return (
    <div className="h-full bg-orange-500 flex flex-col" style={{ padding: '1.5vh 1.5vw 0' }}>
      <div className="kiosk-chrome flex md:grid md:grid-cols-3 items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2">
        <button onClick={onBack} data-testid="confirm-back"
          className="md:hidden flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
        <span className="text-sm sm:text-base font-semibold text-white md:col-start-2 md:text-center">Bevestig betaling</span>
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
    <div className="row-label-value items-center bg-slate-50 rounded-lg p-3">
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
            <div className="row-label-value mb-1">
              <span className="text-slate-500 font-bold">Per maand</span>
              <span className="font-extrabold text-slate-900 font-mono">{fmt(monthly)}</span>
            </div>
            <div className="row-label-value">
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

// Bon-preview die zich schaalt naar de beschikbare hoogte (geen scrollen) en
// horizontaal gecentreerd staat. Papier schuift recht van onder naar boven in.
function FittedReceiptPreview({ paymentId, maxScale = 1, fancy = false }) {
  const boxRef = useRef(null);
  const paperRef = useRef(null);
  const [size, setSize] = useState({ w: 230, h: 420 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [lines, setLines] = useState(null);
  const [failed, setFailed] = useState(false);


  useEffect(() => {
    let alive = true;
    api.get(`/kiosk/payments/${paymentId}/print-data`, { params: { force_ktp: true } })
      .then(({ data }) => { if (alive) { if (data?.lines?.length) setLines(data.lines); else setFailed(true); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [paymentId]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = paperRef.current;
    if (lines && el) setSize({ w: Math.max(180, Math.ceil(el.offsetWidth)), h: Math.max(200, Math.ceil(el.offsetHeight)) });
  }, [lines]);

  const onLoad = (e) => {
    try {
      const doc = e.currentTarget.contentDocument;
      const bon = doc?.getElementById('bon') || doc?.body;
      if (bon) setSize({ w: Math.max(180, Math.ceil(bon.scrollWidth)), h: Math.max(200, Math.ceil(bon.scrollHeight) + 4) });
    } catch { /* cross-origin — vaste maat */ }
  };

  const px = { normal: 12, small: 13, medium: 14, large: 20 };
  const scale = box.h ? Math.min(maxScale, box.h / size.h, box.w / size.w) : 1;
  return (
    <div ref={boxRef} className="flex-1 min-h-0 overflow-hidden flex items-start justify-center" data-testid="receipt-preview-box">
      <motion.div initial={{ y: '100%', opacity: 0 }} animate={{ y: '0%', opacity: 1 }} transition={{ duration: 3.5, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ width: size.w * scale, height: size.h * scale }} className="relative shrink-0" data-testid="receipt-paper">
        {lines ? (
          <div ref={paperRef} data-testid="receipt-preview-lines"
            className={`absolute top-0 left-0 ${fancy ? '' : 'bg-white border border-dashed border-slate-200 p-2'}`}
            style={{
              width: '58mm', fontFamily: 'monospace', color: fancy ? '#1f2937' : '#000',
              transform: `scale(${scale})`, transformOrigin: 'top left',
              ...(fancy ? {
                background: '#ffffff',
                backgroundImage: 'repeating-linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) 3px,rgba(0,0,0,0.012) 3px,rgba(0,0,0,0.012) 4px)',
                padding: '14px 12px 18px',
                letterSpacing: '0.02em',
                WebkitFontSmoothing: 'antialiased',
                clipPath: `polygon(${Array.from({ length: 21 }, (_, i) => `${(i * 100) / 20}% ${i % 2 ? '5px' : '0'}`).join(',')},${Array.from({ length: 21 }, (_, i) => `${100 - (i * 100) / 20}% ${i % 2 ? 'calc(100% - 5px)' : '100%'}`).join(',')})`,
              } : {}),
            }}>
            {lines.map((l, i) => (
              <div key={i} style={{ textAlign: l.align || 'left', fontWeight: l.bold ? 700 : 400, fontSize: px[l.size] || px.normal, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '1em' }}>{l.text}</div>
            ))}
          </div>
        ) : failed && (
        <iframe
          title="Kwitantie preview"
          data-testid="receipt-preview-iframe"
          src={`${process.env.REACT_APP_BACKEND_URL}/api/payments/${paymentId}/print.html?preview=1&format=thermal`}
          onLoad={onLoad}
          sandbox="allow-same-origin"
          scrolling="no"
          className="absolute top-0 left-0 bg-white border border-dashed border-slate-200"
          style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
        )}
      </motion.div>
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
  const [bonOpen, setBonOpen] = useState(() => !(typeof window !== 'undefined' && window.innerWidth >= 768));
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768);
  useEffect(() => {
    const on = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useEffect(() => {
    if (!bonOpen) return undefined;
    const t = setTimeout(() => setBonOpen(false), 12000);
    return () => clearTimeout(t);
  }, [bonOpen]);

  useEffect(() => {
    const tid = payment.tenant_id || overview?.tenant?.id;
    if (!tid) { setRemainingLoading(false); return; }
    // Zelfde bedrag als "Nog openstaand" op de bon (outstanding_after van de betaling).
    const bon = payment.id
      ? api.get(`/kiosk/payments/${payment.id}/print-data`)
        .then((r) => { const v = Number(r.data?.outstanding_after); if (Number.isFinite(v)) setRemaining(Math.max(0, v)); })
        .catch(() => { /* val terug op lokale schatting */ })
      : Promise.resolve();
    const ov = api.get(`/kiosk/tenants/${tid}/overview`)
      .then((r) => {
        // Eerste partial-factuur uit de bijgewerkte overview pakken.
        const invs = Array.isArray(r.data?.open_invoices) ? r.data.open_invoices : [];
        const partial = invs.find((inv) => inv.is_partial && inv.outstanding > 0);
        if (partial) setPartialInv(partial);
      })
      .catch(() => { /* geen suggestie */ });
    Promise.all([bon, ov]).finally(() => setRemainingLoading(false));
  }, [payment.tenant_id, payment.id, overview]);

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

  // Manuele "Print bon opnieuw"; valt terug op de JPG-versie als printen faalt.
  const manualPrint = async () => {
    const ok = await printReceipt({
      paymentId: payment.id,
      apiGet: api.get,
    });
    if (!ok) openReceiptImage(payment.id);
  };


  // Auto-terug naar beginscherm na 10 seconden. Pauzeer wanneer de partial-
  // suggestie open is — anders verdwijnt de modal achter het home-scherm voor
  // de huurder hem kan beantwoorden.
  useEffect(() => {
    if (partialInv && !planMade) return undefined;
    const t = setTimeout(onDone, 15000);
    return () => clearTimeout(t);
  }, [onDone, partialInv, planMade]);

  return (
    <div className="h-full bg-orange-500 flex flex-col items-center p-3 sm:p-6 overflow-hidden">
      <div className="kiosk-chrome text-center mb-2 shrink-0" data-testid="receipt-thanks">
        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-white/95 flex items-center justify-center mx-auto mb-1 shadow-lg">
          <Check className="w-6 h-6 sm:w-9 sm:h-9 text-emerald-600" strokeWidth={3} />
        </div>
        <h2 className="text-xl sm:text-3xl font-extrabold text-white leading-tight">Bedankt!</h2>
        <p className="text-xs sm:text-sm text-white/90">Uw betaling is succesvol verwerkt</p>
      </div>

      <div className="w-full flex-1 min-h-0 flex flex-col items-center">
      <div className="bg-white rounded-3xl w-full max-w-md p-3 sm:p-5 shadow-2xl flex-1 min-h-0 flex flex-col" data-testid="receipt-card">
        <div className="flex items-center justify-center gap-2 mb-1 text-slate-400 shrink-0">
          <Printer className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Bon Printer</span>
        </div>
        {payment.received_by && (
          <p className="text-center text-[11px] text-slate-500 mb-1 shrink-0 truncate" data-testid="receipt-received-by-banner">
            Ontvangen door <span className="font-extrabold text-slate-900" data-testid="receipt-received-by">{payment.received_by}</span>
          </p>
        )}
        {/* Mobiel: bon schuift als popup omhoog (zoals uit de printer) */}
        {isDesktop && <FittedReceiptPreview paymentId={payment.id} />}
        {!isDesktop && (
        <button type="button" onClick={() => setBonOpen(true)} data-testid="receipt-show-bon"
          className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-orange-500 transition-colors">
          <Printer className="w-10 h-10" />
          <span className="text-sm font-bold">Bon bekijken</span>
        </button>
        )}
        {!isDesktop && bonOpen && createPortal((
          <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setBonOpen(false)} data-testid="receipt-bon-popup">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}
              className="w-full max-w-sm bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden" style={{ height: 'min(88vh, 820px)' }} onClick={(e) => e.stopPropagation()}>
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="flex items-center gap-2 font-black text-slate-900"><Printer className="w-5 h-5 text-orange-500" /> Kwitantie</span>
                <button type="button" onClick={() => setBonOpen(false)} data-testid="receipt-bon-close" aria-label="Sluiten"
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 min-h-0 bg-slate-100 p-3 flex flex-col overflow-hidden">
                <FittedReceiptPreview paymentId={payment.id} maxScale={3} />
              </div>
              <div className="shrink-0 p-3">
                <button type="button" onClick={() => setBonOpen(false)}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-black">Klaar</button>
              </div>
            </motion.div>
          </div>
        ), document.body)}
        <div className={`flex justify-between items-center px-3 py-1.5 mt-2 rounded-xl shrink-0 ${
          remaining > 0 ? 'bg-orange-50' : 'bg-emerald-50'
        }`} data-testid="receipt-remaining-row">
          <span className={`text-xs font-bold ${remaining > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>Openstaand saldo</span>
          <span className={`font-extrabold text-sm ${remaining > 0 ? 'text-orange-700' : 'text-emerald-700'}`} data-testid="receipt-remaining">
            {remainingLoading ? '…' : fmtMoney(remaining, cur)}
          </span>
        </div>

        <div className="shrink-0 mt-2 space-y-2">
          <button onClick={onDone} data-testid="receipt-done"
            className="w-full h-12 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-base font-black rounded-2xl flex items-center justify-center gap-2 shadow-lg transition-colors">
            <UserRound className="w-5 h-5" strokeWidth={2.6} />
            Volgende huurder
          </button>
          <div className="flex items-start gap-2">
            {payment.id && (
              <div className="flex-1 min-w-0 empty:hidden" data-testid="receipt-ktp-print">
                <KtpPrintButton log={{ id: payment.id, payment_id: payment.id }} onPrinted={noop} fetchPrinters autoSend />
              </div>
            )}
            {payment.id && <BtPrintButton paymentId={payment.id} autoSend />}
            {isKtpDevice() && (
              <button onClick={manualPrint} type="button" data-testid="receipt-manual-print"
                className="flex-1 h-10 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl flex items-center justify-center gap-1.5 border-2 border-slate-200 transition-colors">
                <Printer className="w-4 h-4" />
                Ingebouwde printer
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-slate-400" data-testid="receipt-autoreturn">
            Automatisch terug naar startscherm in 15 seconden
            {emailStatus?.email?.sent && <span className="text-emerald-600" data-testid="receipt-email-status"> · E-mail verzonden</span>}
            {emailStatus?.msg?.sent && <span className="text-emerald-600" data-testid="receipt-whatsapp-status"> · {emailStatus.msg.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} verzonden</span>}
          </p>
        </div>
      </div>
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
  return <div className="row-label-value"><span className="text-slate-500">{label}</span><span className="font-bold text-slate-900 capitalize">{value}</span></div>;
}

// =====================================================================
// =====================================================================
// KasgeldPanel — nieuw design (2026-02-28), inspired door user mock-up.
// Oranje achtergrond, twee witte "card" secties: Overzicht + Recente
// mutaties met per-maand accordion. Werkt zowel op mobiel (compacte
// stack) als desktop (bredere layout).
//
// Data-flow (ongewijzigd):
//   GET /kiosk/kasgeld/balance → { SRD, USD, EUR } totaal-saldi
//   GET /kiosk/kasgeld         → laatste 200 mutations (shared endpoint)
//   POST /kiosk/kasgeld        → nieuwe mutatie via KasgeldMutationModal
// =====================================================================
function KasgeldPanel({ embedded = false }) {
  const [balances, setBalances] = useState({ SRD: 0, USD: 0, EUR: 0 });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const { isAdmin, theme } = useContext(KioskThemeCtx);
  const role = useAdminRole(isAdmin);
  const canManage = role === 'admin' || role === 'superadmin';
  const [sourceFilter, setSourceFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const removeEntry = async (it) => {
    if (!window.confirm(`Mutatie "${it.description || it.category}" verwijderen?`)) return;
    try { await api.delete(`/kasgeld/${it.id}`); load(); } catch (e) { setErr(formatError(e)); }
  };
  const visibleItems = useMemo(() => (sourceFilter === 'all' ? items
    : items.filter((it) => (it.source || 'kasgeld') === sourceFilter)), [items, sourceFilter]);

  // Huidige maand als default-focus voor de accordion én het
  // "Oktober 2026 ▼" selector-pil in de overzicht-card.
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(currentKey);
  const [expandedMonths, setExpandedMonths] = useState(() => new Set([currentKey]));

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setErr('');
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
  useEffect(() => {
    if (!embedded) return undefined;
    const open = () => setShowForm(true);
    window.addEventListener('kiosk-kasgeld-new', open);
    return () => window.removeEventListener('kiosk-kasgeld-new', open);
  }, [embedded]);
  useEffect(() => {
    const onChange = () => load({ quiet: true });
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Groepeer alle mutations per YYYY-MM, nieuwste maand eerst.
  const monthGroups = useMemo(() => {
    const map = new Map();
    for (const it of visibleItems) {
      const d = new Date(it.entry_date || it.created_at);
      if (isNaN(d)) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${MONTHS_NL[d.getMonth()]} ${d.getFullYear()}`,
          year: d.getFullYear(),
          month: d.getMonth(),
          items: [],
        });
      }
      map.get(key).items.push(it);
    }
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [visibleItems]);

  const selectedLabel = (() => {
    const g = monthGroups.find((x) => x.key === selectedMonth);
    if (g) return g.label;
    const [y, m] = selectedMonth.split('-');
    return `${MONTHS_NL[Number(m) - 1]} ${y}`;
  })();

  const toggleMonth = (key) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const pickMonth = (key) => {
    setSelectedMonth(key);
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setShowMonthPicker(false);
  };

  const totalMutations = visibleItems.length;
  const srdBalance = balances.SRD || 0;

  return (
    <div className={embedded ? 'w-full flex flex-col' : `h-full w-full ${theme === 'white' ? 'bg-[#F4F5F7]' : theme === 'green' ? 'bg-[#F2F8F4]' : 'bg-[#EF5600]'} flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0`}
      style={embedded ? undefined : { paddingLeft: '1.5vw', paddingRight: '1.5vw' }}>
      {/* Body — mobile: vertical stack met Kasgeld-overzicht BOVEN (user mock);
          md+: horizontal 3:2 row match van het Financieel-overzicht patroon
          (Recente mutaties links breed, Kasgeld rechts smaller). We gebruiken
          `md:order-*` om op desktop de volgorde te wisselen zonder HTML-swap. */}
      {embedded && (
        <div className="space-y-4" data-testid="kasgeld-fx">
          <FxStats testId="kasgeld-fx-stats" items={[
            ['SRD', Number(balances.SRD || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 'orange'],
            ['USD', Number(balances.USD || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 'slate'],
            ['EUR', Number(balances.EUR || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 'slate']]} />
          <FxTabs testPrefix="kasgeld" value={sourceFilter} onChange={setSourceFilter} tabs={[
            { v: 'all', label: 'Alles', count: items.length },
            { v: 'kasgeld', label: 'Handmatig', count: items.filter((it) => (it.source || 'kasgeld') === 'kasgeld').length },
            { v: 'payment', label: 'Betalingen', count: items.filter((it) => it.source === 'payment').length }]} />
          {err && <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="kasgeld-err">{err}</div>}
          {!err && loading && <Loader2 className="w-6 h-6 text-slate-300 mx-auto animate-spin my-6" data-testid="kasgeld-loading" />}
          {!err && !loading && visibleItems.length === 0 && <FxEmpty text="Nog geen mutaties." testId="kasgeld-empty" />}
          {visibleItems.map((it) => {
            const isIn = it.type === 'in';
            const d = it.entry_date || it.created_at;
            const dateLabel = d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            const creator = (it.created_by_name || '').trim();
            return (
              <FxRow key={it.id} testId={`kasgeld-row-${it.id}`}
                title={it.description || it.category || '—'}
                sub={[dateLabel, it.source === 'payment' ? (it.method || 'Betaling') : 'Contant', creator && `Door ${creator}`].filter(Boolean).join(' · ')}
                amount={`${isIn ? '+' : '−'}${fmtMoney(it.amount, it.currency)}`}
                status={it.excluded_from_balance ? 'Niet in saldo' : isIn ? 'Ontvangen' : 'Uitgave'}
                tone={it.excluded_from_balance ? 'slate' : isIn ? 'green' : 'red'}
                actions={canManage && it.source !== 'payment' ? (
                  <>
                    <FxIconBtn onClick={() => setEditing(it)} title="Bewerken" testId={`kasgeld-row-edit-${it.id}`}><Pencil className="w-4 h-4" /></FxIconBtn>
                    <FxIconBtn onClick={() => removeEntry(it)} danger title="Verwijderen" testId={`kasgeld-row-delete-${it.id}`}><Trash2 className="w-4 h-4" /></FxIconBtn>
                  </>
                ) : undefined} />
            );
          })}
        </div>
      )}
      {!embedded && (
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 sm:gap-3 pb-3 md:pt-3 overflow-hidden">
        {/* ─── Kasgeld overzicht ─── (mobile: top | desktop: right) */}
        <div className="bg-white rounded-2xl md:flex-[2] md:order-2 flex flex-col p-3 sm:p-6 shrink-0 md:shrink md:overflow-y-auto">
          <div className="row-label-value items-center mb-2.5 sm:mb-4">
            <h2 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight">Kasgeld</h2>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl px-2.5 py-2">
                <Calendar className="w-3.5 h-3.5" /> Maand
              </span>
              <button onClick={() => setShowMonthPicker(true)} data-testid="kasgeld-month-picker"
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-900 bg-white border border-slate-200 rounded-xl px-2.5 py-2 hover:border-slate-300 active:scale-95 transition sm:gap-1.5 sm:px-2.5 sm:py-2 sm:text-xs">
                <span className="capitalize">{selectedLabel}</span>
                <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            </div>
          </div>

          {/* Totaal saldo — orange tile + big SRD amount */}
          <div className="flex items-center gap-2.5 mb-2.5 sm:gap-4 sm:mb-4">
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-orange-100 text-[#FF5C00] flex items-center justify-center shrink-0">
              <Wallet className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm font-semibold text-slate-500">Totaal kasgeld</p>
              <p className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums leading-tight truncate" data-testid="kasgeld-total-srd">
                {fmtMoney(srdBalance, 'SRD')}
              </p>
            </div>
          </div>

          {/* 3-currency grid */}
          <div className="grid grid-cols-3 bg-slate-50 rounded-2xl divide-x divide-slate-200 mb-2.5 sm:mb-5" data-testid="kasgeld-currency-grid">
            {['SRD', 'USD', 'EUR'].map((cur) => (
              <div key={cur} className="px-1.5 py-2 sm:px-2 sm:py-3 text-center min-w-0" data-testid={`kasgeld-bal-${cur}`}>
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-500">{cur}</p>
                <p className="text-sm sm:text-base font-black text-slate-900 mt-0.5 tabular-nums leading-tight truncate">
                  {Number(balances[cur] || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>

          <button onClick={() => setShowForm(true)} data-testid="kasgeld-new-btn"
            className={`${embedded ? 'hidden' : ''} w-full h-12 sm:h-14 rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-black text-base inline-flex items-center justify-center gap-2.5 shadow-[0_10px_25px_-5px_            rgba(255,92,0,0.35)] active:scale-[0.98] transition`}>
            <Wallet className="w-5 h-5" strokeWidth={2.5} /> Nieuwe mutatie
          </button>
        </div>

        {/* ─── Recente mutaties ─── (mobile: bottom | desktop: left wide) */}
        <div className={`bg-white rounded-2xl md:flex-[3] md:order-1 flex flex-col ${embedded ? 'p-3' : 'p-4'} sm:p-5 min-w-0 overflow-hidden`}>
          <div className="row-label-value items-center mb-3">
            <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">Recente mutaties</h3>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 rounded-full px-3 py-1.5" data-testid="kasgeld-count-badge">
              {totalMutations} mutaties
            </span>
          </div>

          <div className="flex gap-2 mb-4 overflow-x-auto" data-testid="kasgeld-source-filter">
            {[['all', 'Alles'], ['kasgeld', 'Alleen handmatig'], ['payment', 'Alleen betalingen']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setSourceFilter(v)} data-testid={`kasgeld-filter-${v}`}
                className={`shrink-0 h-10 px-4 rounded-full text-sm font-bold transition-colors ${sourceFilter === v ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {l}
              </button>
            ))}
          </div>

          {err && <div className="p-3 mb-2 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" data-testid="kasgeld-err">{err}</div>}

          {!err && loading && (
            <div className="py-10 text-center" data-testid="kasgeld-loading">
              <Loader2 className="w-6 h-6 text-slate-300 mx-auto animate-spin" />
              <p className="text-sm text-slate-400 font-semibold mt-2">Laden…</p>
            </div>
          )}

          {!err && !loading && monthGroups.length === 0 && (
            <div className="py-10 text-center" data-testid="kasgeld-empty">
              <Wallet className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400 font-semibold">Nog geen mutaties.</p>
            </div>
          )}

          <div className={`flex-1 min-h-0 overflow-y-auto space-y-2 ${embedded ? '' : '-mx-1 px-1'} pb-14 md:pb-0`}>
            {monthGroups.map((g) => {
              const isOpen = expandedMonths.has(g.key);
              const isSelected = g.key === selectedMonth;
              return (
                <div key={g.key} className={embedded ? '' : `rounded-2xl border transition ${
                  isSelected ? 'border-orange-200 bg-orange-50/40' : 'border-slate-200 bg-slate-50/40'
                }`} data-testid={`kasgeld-month-${g.key}`}>
                  <button type="button" onClick={() => toggleMonth(g.key)}
                    data-testid={`kasgeld-month-toggle-${g.key}`}
                    className={`w-full flex items-center gap-3 ${embedded ? 'px-0' : 'px-4'} py-4 text-left`}>
                    <Calendar className="w-5 h-5 text-slate-500 shrink-0" />
                    <span className="flex-1 min-w-0 font-black text-slate-900 capitalize truncate">{g.label}</span>
                    <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">{g.items.length} mutaties</span>
                    <ChevronDown className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className={`divide-y divide-slate-100 border-t border-slate-100 bg-white ${embedded ? '' : 'rounded-b-2xl'}`} data-testid={`kasgeld-month-items-${g.key}`}>
                      {g.items.map((it) => (
                        <KasgeldMutationRow key={it.id} item={it} canManage={canManage} flush={embedded}
                          onEdit={() => setEditing(it)} onDelete={() => removeEntry(it)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* Month picker overlay (bottom-sheet op mobiel, centered op desktop) */}
      {showMonthPicker && (
        <KasgeldMonthPicker groups={monthGroups} selected={selectedMonth}
          onPick={pickMonth} onClose={() => setShowMonthPicker(false)} />
      )}

      {showForm && (
        <KasgeldMutationModal canBackdate={canManage} onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }} />
      )}
      {editing && (
        <KasgeldEditModal entry={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function KioskApartmentsPanel({ onBack, onNewApartment, reloadKey, onChanged }) {
  const [apartments, setApartments] = useState(() => readKioskSelectCache()?.apartments || []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState('overzicht');
  const [editingApartment, setEditingApartment] = useState(null);
  const [assigningApartment, setAssigningApartment] = useState(null);
  const operator = getKioskEmployee();

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setErr('');
    try {
      const data = await fetchKioskSelect();
      setApartments(data.apartments || []);
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const onChange = () => load({ quiet: true });
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('surirent:live-change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('surirent:live-change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const occupied = apartments.filter((apartment) => apartment.tenant_id || apartment.status === 'occupied').length;
  const refreshAfterChange = () => {
    invalidateKioskSelect();
    onChanged?.();
    load();
  };
  const removeTenant = async (apartment) => {
    if (!window.confirm(`Huurder loskoppelen van appartement ${apartment.number}?`)) return;
    try {
      await api.post(`/apartments/${apartment.id}/remove-tenant`);
      refreshAfterChange();
    } catch (e) {
      setErr(formatError(e));
    }
  };
  const deleteApartment = async (apartment) => {
    if (!window.confirm(`Appartement ${apartment.number} verwijderen?`)) return;
    try {
      await api.delete(`/apartments/${apartment.id}`);
      setDetailId(null);
      refreshAfterChange();
    } catch (e) {
      setErr(formatError(e));
    }
  };
  const rentsByCurrency = apartments.reduce((totals, apartment) => {
    const currency = (apartment.currency || 'SRD').toUpperCase();
    totals[currency] = (totals[currency] || 0) + Number(apartment.rent_amount || 0);
    return totals;
  }, {});
  const monthlyRent = Object.entries(rentsByCurrency)
    .map(([currency, amount]) => fmtMoney(amount, currency))
    .join(' · ') || fmtMoney(0, 'SRD');
  const selectedApartment = apartments.find((apartment) => apartment.id === detailId);

  if (detailId && selectedApartment) {
    const isOccupied = !!selectedApartment.tenant_id || selectedApartment.status === 'occupied';
    const photoUrl = selectedApartment.photo_url
      ? (selectedApartment.photo_url.includes('/api/landing/asset/')
        ? `${selectedApartment.photo_url}${selectedApartment.photo_url.includes('?') ? '&' : '?'}thumb=1`
        : selectedApartment.photo_url)
      : '';
    return (
      <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
        style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-apartment-detail">
        <div className="flex-1 min-h-0 overflow-y-auto py-3">
          <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-3">
            <section className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:p-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {photoUrl ? (
                  <img src={photoUrl} alt={`Appartement ${selectedApartment.number}`}
                    className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 bg-slate-100 object-cover"
                    onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${isOccupied ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-[#FF5C00]'}`}>
                    <Home className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-widest text-[#FF5C00]">Appartement</p>
                  <h1 className="mt-0.5 truncate text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
                    {selectedApartment.number}
                  </h1>
                  <p className="truncate text-sm font-semibold text-slate-500">
                    {selectedApartment.tenant_name || selectedApartment.address || 'Geen huurder gekoppeld'}
                    {' · '}{fmtMoney(selectedApartment.rent_amount, selectedApartment.currency || 'SRD')} / maand
                  </p>
                </div>
                <span className={`hidden shrink-0 rounded-full px-3 py-1 text-xs font-black sm:inline-flex ${isOccupied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {isOccupied ? 'Bezet' : 'Beschikbaar'}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button type="button" onClick={() => { setDetailId(null); setDetailTab('overzicht'); }} data-testid="apartment-detail-back"
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" /> Terug
                </button>
                <button type="button" onClick={() => setEditingApartment(selectedApartment)}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700 hover:bg-slate-200"
                  data-testid="apartment-detail-edit"><Pencil className="h-4 w-4" /> Bewerk</button>
                {selectedApartment.tenant_id ? (
                  <button type="button" onClick={() => removeTenant(selectedApartment)}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-orange-50 px-3 text-sm font-bold text-[#FF5C00] hover:bg-orange-100"
                    data-testid="apartment-detail-remove-tenant"><UserRound className="h-4 w-4" /> Loskoppelen</button>
                ) : (
                  <button type="button" onClick={() => setAssigningApartment(selectedApartment)}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-orange-50 px-3 text-sm font-bold text-[#FF5C00] hover:bg-orange-100"
                    data-testid="apartment-detail-assign"><UserPlus className="h-4 w-4" /> Huurder toewijzen</button>
                )}
                <button type="button" onClick={() => deleteApartment(selectedApartment)}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 text-sm font-bold text-red-600 hover:bg-red-100"
                  data-testid="apartment-detail-delete"><Trash2 className="h-4 w-4" /> Verwijder</button>
              </div>
            </section>

            {err && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{err}</div>}

            <div className="flex shrink-0 gap-2 overflow-x-auto rounded-2xl border border-slate-100 bg-white p-2 shadow-sm"
              role="tablist" aria-label="Appartementdetails">
              {[
                ['overzicht', 'Overzicht'],
                ['huurder', 'Huurder'],
                ['woning', 'Appartement & foto'],
              ].map(([tab, label]) => (
                <button key={tab} type="button" role="tab" aria-selected={detailTab === tab}
                  onClick={() => setDetailTab(tab)} data-testid={`apartment-detail-tab-${tab}`}
                  className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold transition ${
                    detailTab === tab ? 'bg-[#FF5C00] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {detailTab === 'overzicht' && (
              <div className="grid min-w-0 gap-3 xl:grid-cols-[1.4fr_1fr]" data-testid="apartment-detail-overview">
                <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-black text-slate-900">Appartementgegevens</h2>
                    <Home className="h-5 w-5 text-[#FF5C00]" />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Nummer</p>
                      <p className="mt-1 truncate font-black text-slate-900">{selectedApartment.number}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Status</p>
                      <p className={`mt-1 font-black ${isOccupied ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {isOccupied ? 'Bezet' : 'Beschikbaar'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Adres</p>
                      <p className="mt-1 font-bold text-slate-900">{selectedApartment.address || 'Geen adres opgegeven'}</p>
                    </div>
                    <div className="rounded-xl bg-orange-50 p-3 sm:col-span-2">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Huur per maand</p>
                      <p className="mt-1 text-xl font-black text-slate-900">
                        {fmtMoney(selectedApartment.rent_amount, selectedApartment.currency || 'SRD')}
                      </p>
                    </div>
                  </div>
                </section>
                <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-black text-slate-900">Huurder</h2>
                    <Users className="h-5 w-5 text-[#FF5C00]" />
                  </div>
                  {selectedApartment.tenant_name ? (
                    <>
                      <p className="truncate text-lg font-black text-slate-900">{selectedApartment.tenant_name}</p>
                      <p className="mt-1 truncate text-sm text-slate-500">
                        {selectedApartment.tenant_phone || selectedApartment.tenant_email || 'Geen contactgegevens'}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-slate-500">Er is nog geen huurder gekoppeld.</p>
                  )}
                  <button type="button" onClick={() => setDetailTab('huurder')}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-50 px-4 text-sm font-bold text-[#FF5C00] hover:bg-orange-100">
                    Bekijk huurder <ChevronRight className="h-4 w-4" />
                  </button>
                </section>
              </div>
            )}

            {detailTab === 'huurder' && (
              <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" data-testid="apartment-detail-tenant">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-black text-slate-900">Huurder</h2>
                  <Users className="h-5 w-5 text-[#FF5C00]" />
                </div>
                {selectedApartment.tenant_name ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-50 font-black text-[#FF5C00]">
                      {(selectedApartment.tenant_name || '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-black text-slate-900">{selectedApartment.tenant_name}</p>
                      <p className="truncate text-sm text-slate-500">{selectedApartment.tenant_phone || 'Geen telefoonnummer'}</p>
                      <p className="truncate text-sm text-slate-500">{selectedApartment.tenant_email || 'Geen e-mailadres'}</p>
                    </div>
                    <button type="button" onClick={() => removeTenant(selectedApartment)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-50 px-4 text-sm font-bold text-red-600 hover:bg-red-100"
                      data-testid="apartment-detail-remove-tenant"><UserRound className="h-4 w-4" /> Huurder loskoppelen</button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-50 p-5 text-center">
                    <p className="mb-3 text-sm font-semibold text-slate-500">Er is nog geen huurder gekoppeld.</p>
                    <button type="button" onClick={() => setAssigningApartment(selectedApartment)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-4 text-sm font-bold text-white hover:bg-[#E05200]"
                      data-testid="apartment-detail-assign"><UserPlus className="h-4 w-4" /> Huurder toewijzen</button>
                  </div>
                )}
              </section>
            )}

            {detailTab === 'woning' && (
              <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" data-testid="apartment-detail-property">
                <div className="mb-3">
                  <h2 className="text-base font-black text-slate-900">Appartement & foto</h2>
                  <p className="text-sm text-slate-500">{selectedApartment.address || 'Geen adres opgegeven'}</p>
                </div>
                {photoUrl ? (
                  <img src={photoUrl} alt={`Appartement ${selectedApartment.number}`}
                    className="max-h-[42vh] min-h-48 w-full rounded-xl bg-slate-100 object-contain"
                    onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div className="flex min-h-48 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
                    <div className="text-center">
                      <Home className="mx-auto mb-2 h-10 w-10" />
                      <p className="text-sm font-semibold">Geen foto beschikbaar</p>
                    </div>
                  </div>
                )}
                {selectedApartment.description && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Beschrijving</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{selectedApartment.description}</p>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
        {editingApartment && (
          <AddApartmentModal
            initial={editingApartment}
            onClose={() => setEditingApartment(null)}
            onSaved={() => {
              setEditingApartment(null);
              refreshAfterChange();
            }}
          />
        )}
        {assigningApartment && (
          <AssignApartmentTenantModal
            apartment={assigningApartment}
            onClose={() => setAssigningApartment(null)}
            onSaved={() => {
              setAssigningApartment(null);
              refreshAfterChange();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#FF5C00] flex flex-col pt-[max(var(--kiosk-sat),12px)] md:pt-0"
      style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-apartments-panel">
      <div className="kiosk-chrome md:hidden flex items-center justify-between flex-wrap gap-2 px-1 sm:px-2 py-2 shrink-0">
        <button onClick={onBack} data-testid="apartments-panel-back"
          className="flex items-center gap-1.5 text-white font-bold bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 sm:px-4 sm:py-2 active:scale-95 transition">
          <ArrowLeft className="w-4 h-4" /> <span className="text-xs sm:text-sm">Terug</span>
        </button>
        <div className="text-right text-white">
          <p className="text-xs sm:text-sm font-semibold">{operator?.name || 'Kiosk'}</p>
          <p className="text-[10px] sm:text-xs opacity-70">Appartementenbeheer</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 sm:gap-3 pb-3 md:pt-3 overflow-hidden">
        <div className="kiosk-admin-summary bg-white rounded-2xl md:flex-[2] md:order-2 flex flex-col p-2.5 sm:p-6 shrink-0 md:shrink md:overflow-y-auto"
          data-testid="apartments-summary">
          <div className="kiosk-admin-summary-heading row-label-value items-center mb-2 sm:mb-4">
            <h2 className="text-base sm:text-2xl font-black text-slate-900 tracking-tight">Appartementen</h2>
            <Home className="w-4 h-4 sm:w-5 sm:h-5 text-[#FF5C00]" />
          </div>

          <div className="kiosk-admin-summary-stats grid grid-cols-2 gap-1.5 mb-2 sm:gap-3 sm:mb-4">
            <div className="rounded-2xl bg-orange-50 p-2 sm:p-4">
              <p className="text-[10px] sm:text-xs font-bold text-slate-500">Appartementen</p>
              <p className="mt-0.5 sm:mt-1 text-lg sm:text-2xl font-black text-slate-900" data-testid="apartments-total">{apartments.length}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-2 sm:p-4">
              <p className="text-[10px] sm:text-xs font-bold text-slate-500">Bezet</p>
              <p className="mt-0.5 sm:mt-1 text-lg sm:text-2xl font-black text-emerald-800" data-testid="apartments-occupied">{occupied}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-2 sm:p-4">
              <p className="text-[11px] sm:text-sm font-semibold text-slate-500">Huur p/m</p>
              <p className="mt-0.5 sm:mt-1 break-words text-base sm:text-2xl font-black text-slate-900 tabular-nums"
                data-testid="apartments-monthly-rent">{monthlyRent}</p>
            </div>
          </div>

          <button onClick={onNewApartment} data-testid="apartments-new-btn"
            className="kiosk-admin-summary-action w-full h-10 sm:h-14 rounded-xl sm:rounded-2xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-black text-xs sm:text-base inline-flex items-center justify-center gap-1.5 sm:gap-2.5 shadow-[0_10px_25px_-5px_rgba(255,92,0,0.5)] active:scale-[0.98] transition">
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2.5} /> Nieuwe appartement
          </button>
        </div>

        <div className="kiosk-admin-list bg-white rounded-2xl flex-1 min-h-0 md:flex-[3] md:order-1 flex flex-col p-2.5 sm:p-5 min-w-0 overflow-hidden">
          <div className="row-label-value items-center mb-3">
            <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">Alle appartementen</h3>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 rounded-xl px-2.5 py-1"
              data-testid="apartments-count-badge">{apartments.length} totaal</span>
          </div>
          <button type="button" onClick={onNewApartment} data-testid="apartments-new-btn-mobile"
            className="kiosk-admin-mobile-action mb-2 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-3 py-2.5 font-black text-white">
            <Plus className="h-4 w-4" strokeWidth={2.5} /> Nieuwe appartement
          </button>

          {err && <div className="p-3 mb-2 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm" role="alert">{err}</div>}
          {!err && loading && (
            <div className="py-10 text-center" data-testid="apartments-loading">
              <Loader2 className="w-6 h-6 text-slate-300 mx-auto animate-spin" />
              <p className="text-sm text-slate-400 font-semibold mt-2">Laden…</p>
            </div>
          )}
          {!err && !loading && apartments.length === 0 && (
            <div className="py-10 text-center" data-testid="apartments-empty">
              <Home className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400 font-semibold">Nog geen appartementen.</p>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pb-14 -mx-1 px-1 sm:space-y-2 md:pb-0">
            {apartments.map((apartment) => {
              const isOccupied = !!apartment.tenant_id || apartment.status === 'occupied';
              const photoUrl = apartment.photo_url
                ? (apartment.photo_url.includes('/api/landing/asset/')
                  ? `${apartment.photo_url}${apartment.photo_url.includes('?') ? '&' : '?'}thumb=1`
                  : apartment.photo_url)
                : '';
              return (
                <button key={apartment.id} type="button" onClick={() => { setDetailTab('overzicht'); setDetailId(apartment.id); }}
                  className="flex w-full items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/50 p-2.5 text-left transition hover:bg-slate-50 active:bg-slate-100 sm:gap-3 sm:p-4"
                  data-testid={`apartment-row-${apartment.id}`}>
                  {photoUrl ? (
                    <img src={photoUrl} alt="" loading="lazy" decoding="async"
                      className="h-9 w-9 shrink-0 rounded-xl bg-slate-100 object-cover sm:h-14 sm:w-14"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  ) : (
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-14 sm:w-14 ${isOccupied ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-[#FF5C00]'}`}>
                      <Home className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 truncate">{apartment.number}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {apartment.tenant_name || apartment.address || (isOccupied ? 'Bezet' : 'Beschikbaar')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black text-slate-900 sm:text-sm">{fmtMoney(apartment.rent_amount, apartment.currency || 'SRD')}</p>
                    <span className={`text-[10px] font-bold ${isOccupied ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {isOccupied ? 'Bezet' : 'Beschikbaar'}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Eén transactie-rij: gekleurd icoon-tegel + titel + sub (datum · methode · "Door ...") +
// bedrag. Gebruikt in de accordion-month-groepen van KasgeldPanel.
function KasgeldMutationRow({ item, canManage, onEdit, onDelete, flush = false }) {
  const isIn = item.type === 'in';
  const d = item.entry_date || item.created_at;
  const dateLabel = d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const sourceLabel = item.source === 'payment' ? (item.method || 'Betaling') : 'Contant';
  const creator = (item.created_by_name || '').trim();
  return (
    <div className={`kiosk-cash-row flex items-center gap-3 ${flush ? 'px-0' : 'px-3 sm:px-4'} py-3`} data-testid={`kasgeld-row-${item.id}`}>
      <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center ${
        isIn ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
      }`}>
        {isIn ? <ArrowUpRight className="w-5 h-5" strokeWidth={2.5} /> : <ArrowDownLeft className="w-5 h-5" strokeWidth={2.5} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm sm:text-base font-bold text-slate-900 truncate" data-testid={`kasgeld-row-title-${item.id}`}>
          {item.description || item.category || '—'}
        </p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {dateLabel}{dateLabel && ' · '}<span className="capitalize">{sourceLabel}</span>
          {creator && (
            <>
              {' · '}
              <span className="text-slate-600" data-testid={`kasgeld-row-creator-${item.id}`}>
                Door {creator}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="kiosk-cash-row-values flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-3 shrink-0">
      <p className={`kiosk-cash-row-amount text-sm sm:text-base font-black whitespace-nowrap tabular-nums shrink-0 ${
        item.excluded_from_balance ? 'text-slate-400' : isIn ? 'text-emerald-600' : 'text-red-500'
      }`} data-testid={`kasgeld-row-amount-${item.id}`} title={item.excluded_from_balance ? 'Verrekend met borg — telt niet mee in kassaldo' : undefined}>
        {isIn ? '+' : '−'}{item.currency} {Number(item.amount || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {item.excluded_from_balance && <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 text-right" data-testid={`kasgeld-row-excluded-${item.id}`}>niet in saldo</span>}
      </p>
      {canManage && (item.source === 'payment' ? (
        <span className="sm:w-[68px] shrink-0 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400" data-testid={`kasgeld-row-auto-${item.id}`}>auto</span>
      ) : (
        <div className="flex gap-1 shrink-0">
          <button type="button" onClick={onEdit} data-testid={`kasgeld-row-edit-${item.id}`} aria-label="Bewerken"
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-orange-100 text-slate-500 hover:text-[#FF5C00] flex items-center justify-center transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          <button type="button" onClick={onDelete} data-testid={`kasgeld-row-delete-${item.id}`} aria-label="Verwijderen"
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 flex items-center justify-center transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      </div>
    </div>
  );
}

const KASGELD_CATEGORIES = {
  in: [
    { group: 'Inkomsten', options: [
      ['huur', 'Huuropbrengsten (standaard huur)'],
      ['borg', 'Borg / waarborgsom'],
      ['nutsvoorzieningen_doorbelast', 'Nutsvoorzieningen doorbelast aan huurder'],
      ['boetes_administratiekosten', 'Laat-betaalboetes / administratiekosten'],
      ['overige_inkomsten_borginhouding', 'Overige inkomsten / borginhouding / incidentele verhuur'],
    ] },
  ],
  out: [
    { group: 'Onderhoud & reparaties (vastgoed)', options: [
      ['onderhoud_loodgieterswerk', 'Loodgieterswerk'],
      ['onderhoud_elektriciteit', 'Elektra en reparaties'],
      ['onderhoud_airco', 'Airco-onderhoud'],
      ['onderhoud_schilderwerk', 'Schilderwerk en kleine bouwkundige aanpassingen'],
    ] },
    { group: 'Nutsvoorzieningen (algemeen / leegstand)', options: [
      ['nutsvoorzieningen_algemeen', 'EBS / SWM gemeenschappelijke ruimtes of leegstand'],
      ['internet_wifi', 'Internet / Wi-Fi'],
    ] },
    { group: 'Schoonmaak & verbruiksartikelen', options: [
      ['schoonmaak_verbruiksartikelen', 'Schoonmaakmiddelen en verbruiksartikelen'],
      ['terreinonderhoud', 'Glazenwasser / terreinonderhoud'],
    ] },
    { group: 'Beheers- & administratiekosten', options: [
      ['bankkosten', 'Bankkosten'],
      ['kantoorbenodigdheden', 'Kantoorbenodigdheden en kasrollen'],
    ] },
    { group: 'Belastingen & vergunningen', options: [
      ['belastingen_vergunningen', 'Huurwaarde-/grondbelasting en vergunningen'],
    ] },
    { group: 'Onvoorzien', options: [
      ['onvoorzien_diversen', 'Onvoorzien / diversen'],
    ] },
  ],
};
const kasgeldCategoryOptions = (type) => KASGELD_CATEGORIES[type].flatMap(({ options }) => options);
const kasInput = 'w-full h-12 px-3 rounded-xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base bg-white';

function KasgeldEditModal({ entry, onClose, onSaved }) {
  const editCategories = kasgeldCategoryOptions(entry.type);
  const initialCategory = editCategories.some(([value]) => value === entry.category)
    ? entry.category
    : editCategories[0][0];
  const [f, setF] = useState({
    type: entry.type, amount: String(entry.amount ?? ''), currency: entry.currency || 'SRD',
    description: entry.description || '', category: initialCategory,
    entry_date: (entry.entry_date || entry.created_at || '').slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const n = parseFloat(String(f.amount).replace(',', '.'));
    if (!n || n <= 0) { setErr('Bedrag moet groter dan 0 zijn'); return; }
    if (!f.description.trim()) { setErr('Omschrijving is verplicht'); return; }
    setSaving(true); setErr('');
    try { await api.put(`/kasgeld/${entry.id}`, { ...f, amount: n }); onSaved(); }
    catch (e) { setErr(formatError(e)); } finally { setSaving(false); }
  };
  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <button onClick={onClose} className="h-12 rounded-xl bg-slate-100 text-slate-700 font-black text-sm">Annuleren</button>
      <button onClick={save} disabled={saving} data-testid="kasgeld-edit-save"
        className="h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Opslaan
      </button>
    </div>
  );
  return (
    <KioskModalShell title="Mutatie bewerken" Icon={Pencil} testId="kasgeld-edit" onClose={onClose} footer={footer}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[['in', 'Inkomsten', ArrowUpRight], ['out', 'Uitgaven', ArrowDownLeft]].map(([v, l, Icon]) => (
            <button key={v} type="button" onClick={() => setF({ ...f, type: v, category: kasgeldCategoryOptions(v)[0][0] })} data-testid={`kasgeld-edit-type-${v}`}
              className={`h-12 rounded-xl font-black text-sm inline-flex items-center justify-center gap-2 border-2 ${f.type === v ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
              <Icon className="w-5 h-5" /> {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <input inputMode="decimal" value={f.amount} onChange={set('amount')} data-testid="kasgeld-edit-amount" placeholder="Bedrag" className={kasInput} />
          <select value={f.currency} onChange={set('currency')} data-testid="kasgeld-edit-currency" className={kasInput}>
            {['SRD', 'USD', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <input value={f.description} onChange={set('description')} data-testid="kasgeld-edit-desc" placeholder="Omschrijving" className={kasInput} />
        <div className="grid grid-cols-2 gap-2">
          <select value={f.category} onChange={set('category')} data-testid="kasgeld-edit-cat" className={kasInput}>
            {KASGELD_CATEGORIES[f.type].map(({ group, options }) => (
              <optgroup key={group} label={group}>
                {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
            ))}
          </select>
          <input type="date" value={f.entry_date} onChange={set('entry_date')} data-testid="kasgeld-edit-date" className={kasInput} />
        </div>
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="kasgeld-edit-err">{err}</p>}
      </div>
    </KioskModalShell>
  );
}

// Bottom-sheet op mobiel / centered dialog op desktop om een maand te kiezen.
// Toont alle maanden die daadwerkelijk mutations hebben.
function KasgeldMonthPicker({ groups, selected, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose} data-testid="kasgeld-month-picker-overlay">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom,16px), 16px)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-lg font-black text-slate-900">Kies een maand</h3>
          <button onClick={onClose} data-testid="kasgeld-month-picker-close"
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-3 pb-4">
          {groups.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">Geen mutaties beschikbaar.</p>
          )}
          {groups.map((g) => {
            const active = g.key === selected;
            return (
              <button key={g.key} onClick={() => onPick(g.key)}
                data-testid={`kasgeld-month-pick-${g.key}`}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition ${
                  active ? 'bg-orange-50 border border-[#FF5C00]' : 'hover:bg-slate-50 border border-transparent'
                }`}>
                <Calendar className={`w-5 h-5 shrink-0 ${active ? 'text-[#FF5C00]' : 'text-slate-400'}`} />
                <span className="flex-1 min-w-0 font-bold text-slate-900 capitalize truncate">{g.label}</span>
                <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">{g.items.length}</span>
                {active && <Check className="w-5 h-5 text-[#FF5C00] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>, document.body);
}

function KasgeldMutationModal({ onClose, onSaved, canBackdate = false }) {
  const [step, setStep] = useState('amount');  // 'amount' | 'details'
  const [type, setType] = useState('in');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SRD');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(kasgeldCategoryOptions('in')[0][0]);
  const [entryDate, setEntryDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const sheetRef = useRef(null);
  const descInputRef = useRef(null);
  useVisualViewportPosition(sheetRef);

  useEffect(() => {
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
      const useAdmin = canBackdate && !getKioskEmployee()?.id;
      const { data } = await api.post(useAdmin ? '/kasgeld' : withKioskEmployee('/kiosk/kasgeld'), {
        type, amount: n, currency,
        description: description.trim(), category,
        ...(canBackdate && entryDate ? { entry_date: entryDate } : {}),
      });
      setSaved(data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  const amountBorder = amount
    ? (type === 'in' ? 'border-emerald-400 text-emerald-700 bg-emerald-50' : 'border-red-400 text-red-700 bg-red-50')
    : (type === 'in' ? 'border-emerald-200 text-emerald-700 bg-emerald-50/70' : 'border-red-200 text-red-700 bg-red-50/70');
  const changeType = (nextType) => {
    setType(nextType);
    setCategory(kasgeldCategoryOptions(nextType)[0][0]);
  };

  return createPortal((
    <div
      onClick={saved ? onSaved : onClose}
      className="keyboard-opaque-backdrop fixed inset-0 z-[120] overflow-hidden bg-white sm:bg-black/60 sm:backdrop-blur-md flex items-stretch sm:items-center justify-center sm:p-4"
      data-testid="kasgeld-overlay">
      <div ref={sheetRef} onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col h-full sm:h-auto sm:max-h-[90vh] overflow-hidden"
        data-testid="kasgeld-form">
        {/* Sticky header — safe-area-top padding INSIDE de witte modal,
            zodat het witte oppervlak tot bovenaan het scherm reikt en de
            titel toch onder de notch/statusbalk zit. */}
        <div className="flex-none flex items-center justify-between gap-3 px-5 pb-4 border-b border-slate-100"
          style={{ paddingTop: 'max(var(--kiosk-sat), 16px)' }}>
          <div className="flex min-w-0 items-center gap-3">
            {step === 'details' && !saved && (
              <button onClick={() => { setErr(''); setStep('amount'); }} data-testid="kasgeld-back-btn"
                className="w-10 h-10 shrink-0 -ml-2 rounded-xl bg-slate-100 flex items-center justify-center">
                <ChevronLeft className="w-5 h-5 text-slate-700" />
              </button>
            )}
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-orange-100 flex items-center justify-center">
              <Wallet className="w-8 h-8 text-orange-600" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-black leading-tight text-slate-900">
                {saved ? 'Kasgeld bon' : step === 'amount' ? 'Nieuwe kasmutatie' : 'Omschrijving'}
              </h3>
              <p className="mt-1 text-sm leading-tight text-slate-500">
                {step === 'amount' && !saved ? 'Voer het bedrag in en kies de valuta' : step === 'details' && !saved ? 'Voeg een omschrijving en categorie toe' : 'Overzicht van de kasmutatie'}
              </p>
            </div>
          </div>
          <button onClick={saved ? onSaved : onClose} data-testid="kasgeld-form-close" className="w-14 h-14 shrink-0 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
            <X className="w-7 h-7 text-slate-700" />
          </button>
        </div>

        {saved ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
            <KasgeldReceiptScreen entry={saved} onDone={onSaved} />
          </div>
        ) : step === 'amount' ? (
          /* ============ STEP 1: Valuta + type + bedrag (NumPad) ============ */
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4"
            style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="grid grid-cols-3 gap-2">
              {['SRD', 'USD', 'EUR'].map((c) => (
                <button key={c} onClick={() => setCurrency(c)} data-testid={`kasgeld-cur-${c}`}
                  className={`h-14 rounded-2xl border font-black text-base inline-flex items-center justify-center gap-2 ${currency === c ? 'border-orange-500 bg-orange-500 text-white shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  <span className="text-xl" aria-hidden="true">{c === 'SRD' ? '🇸🇷' : c === 'USD' ? '🇺🇸' : '🇪🇺'}</span>
                  {c}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              <button onClick={() => changeType('in')} data-testid="kasgeld-type-in"
                className={`h-12 rounded-xl font-black text-base inline-flex items-center justify-center gap-2 transition ${type === 'in' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-600'}`}>
                <ArrowUpRight className="w-5 h-5" /> Inkomsten
              </button>
              <button onClick={() => changeType('out')} data-testid="kasgeld-type-out"
                className={`h-12 rounded-xl font-black text-base inline-flex items-center justify-center gap-2 transition ${type === 'out' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-600'}`}>
                <ArrowDownLeft className="w-5 h-5" /> Uitgaven
              </button>
            </div>

            <div data-testid="kasgeld-amount-display"
              className={`w-full min-h-[76px] px-4 rounded-2xl border-2 flex items-center justify-between gap-3 ${amountBorder}`}>
              <div className="flex items-center gap-3">
                <Coins className="w-8 h-8 shrink-0" />
                <span className="text-xs font-black uppercase tracking-wider">Bedrag</span>
              </div>
              <span className="text-3xl sm:text-2xl font-black tabular-nums text-right">{currency} {amount || '0'}</span>
            </div>

            <NumPad value={amount} onChange={setAmount} testIdPrefix="kasgeld-npad"
              buttonClassName="!h-16 !rounded-2xl !text-3xl" />

            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="kasgeld-err">{err}</p>}
          </div>
        ) : (
          /* ============ STEP 2: Omschrijving + Categorie ============ */
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-5 py-4 gap-4"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            {/* Samenvatting bedrag → altijd zichtbaar zodat operator ziet
                voor welke transactie hij de omschrijving invult. */}
            <div className={`w-full min-h-[76px] rounded-2xl border-2 px-4 py-3 flex items-center justify-between gap-3 ${type === 'in' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              <div className="flex items-center gap-3">
                <Coins className="w-8 h-8 shrink-0" />
                <span className="text-xs font-black uppercase tracking-wider">{type === 'in' ? 'Inkomsten' : 'Uitgaand'}</span>
              </div>
              <span className="text-2xl font-black tabular-nums text-right">{currency} {amount || '0'}</span>
            </div>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-wider text-slate-600 block mb-2">Omschrijving *</span>
              <input ref={descInputRef}
                value={description} onChange={(e) => setDescription(e.target.value)}
                data-testid="kasgeld-input-desc"
                placeholder="Bijv. schoonmaakspullen"
                autoComplete="off" autoCorrect="off" autoCapitalize="sentences"
                enterKeyHint="next"
                className="w-full h-14 px-4 rounded-2xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base" />
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-wider text-slate-600 block mb-2">Categorie</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                data-testid="kasgeld-input-cat"
                className="w-full h-14 px-4 rounded-2xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base bg-white">
                {KASGELD_CATEGORIES[type].map(({ group, options }) => (
                  <optgroup key={group} label={group}>
                    {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>

            {canBackdate && (
              <label className="block">
                <span className="text-xs font-black uppercase tracking-wider text-slate-600 block mb-2">Boekdatum</span>
                <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} data-testid="kasgeld-input-date"
                  className="w-full h-14 px-4 rounded-2xl border-2 border-slate-200 focus:border-orange-500 outline-none text-base bg-white" />
              </label>
            )}

            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="kasgeld-err">{err}</p>}

          </div>
        )}

        {!saved && (
          <div className="flex-none px-5 pt-3 border-t border-slate-100 bg-white"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            {step === 'amount' ? (
              <button onClick={goNext} data-testid="kasgeld-next-btn"
                disabled={!amount || parseFloat(String(amount).replace(',', '.')) <= 0}
                className="w-full h-16 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-black text-lg inline-flex items-center justify-center gap-4 shadow-lg shadow-orange-200 disabled:opacity-50">
                <CheckCircle className="w-7 h-7" />
                <span className="h-8 w-px bg-white/40" />
                Volgende
                <ArrowRight className="w-7 h-7" />
              </button>
            ) : (
              <button onClick={save} disabled={saving} data-testid="kasgeld-save"
                className="w-full h-16 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-black text-lg inline-flex items-center justify-center gap-3 shadow-lg shadow-orange-200 disabled:opacity-50">
                {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Opslaan…</> : <><CheckCircle className="w-6 h-6" /> Opslaan</>}
              </button>
            )}
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
        style={{ paddingTop: 'max(var(--kiosk-sat), 12px)' }}>
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
function AddTenantModal({ onClose, onSaved, prefill = null }) {
  const [name, setName] = useState(prefill?.scan?.name || '');
  const [phone, setPhone] = useState('');
  const [aptId, setAptId] = useState('');
  const [birthDate, setBirthDate] = useState(prefill?.scan?.birth_date || '');
  const [idNumber, setIdNumber] = useState(prefill?.scan?.id_number || '');
  const [apartments, setApartments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // ID-scan (live camera) state
  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(prefill ? 'ID-scan ontvangen van telefoon — foto wordt opgeslagen' : '');
  // Bewaar de gescande ID-kaart foto zodat we deze na het opslaan van de
  // huurder direct uploaden naar `/tenants/{id}/upload-id-photo`. Anders
  // ziet de beheerder alleen tekst en niet de originele scan.
  const [scannedIdFile, setScannedIdFile] = useState(null);

  const loadApartments = useCallback(() => api.get('/apartments').then((r) => {
      const list = Array.isArray(r?.data) ? r.data : [];
      // Alleen vrije appartementen aanbieden
      setApartments(list.filter((a) => a.status === 'vacant'));
    }).catch(() => {}), []);
  useEffect(() => { loadApartments(); }, [loadApartments]);
  useKioskLiveRefresh(loadApartments);

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
      const r = await postIdOcr('/tenants/ocr-id-card', file);
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
      let created = r?.data;
      // Upload de ID-kaart foto (indien gescand) direct na aanmaak. Fouten
      // hier blokkeren niet — huurder is al aangemaakt. `upload-id-photo`
      // triggert bovendien face-crop → tenant.avatar_url.
      if (created?.id && scannedIdFile) {
        try {
          const fd = new FormData();
          fd.append('file', scannedIdFile);
          const { data: photo } = await api.post(`/tenants/${created.id}/id-photo`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          created = {
            ...created,
            id_photo_url: photo?.id_photo_url || created.id_photo_url,
            avatar_url: photo?.avatar_url || null,
          };
        } catch (upErr) {
          console.warn('ID-foto upload gefaald (huurder wel aangemaakt):', upErr);
        }
      }
      if (created?.id && !scannedIdFile && prefill?.asset_id) {
        try {
          const { data: photo } = await api.post(
            `/kiosk/tenants/${created.id}/attach-id-photo`,
            { asset_id: prefill.asset_id },
          );
          created = {
            ...created,
            id_photo_url: photo?.id_photo_url || created.id_photo_url,
            avatar_url: photo?.avatar_url || null,
          };
        } catch (upErr) {
          console.warn('ID-foto koppelen gefaald (huurder wel aangemaakt):', upErr);
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
          {prefill?.id_photo_url && !scannedIdFile && (
            <img src={`${process.env.REACT_APP_BACKEND_URL}${prefill.id_photo_url}`} alt="Gescande ID-kaart"
              data-testid="add-tenant-scan-preview" className="w-full max-h-48 object-contain rounded-xl border border-slate-200 bg-slate-50" />
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
// Appartement aanmaken of bewerken vanuit Kiosk Beheer.
// =====================================================================
function AssignApartmentTenantModal({ apartment, onClose, onSaved }) {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/tenants')
      .then(({ data }) => setTenants(Array.isArray(data) ? data : data?.items || []))
      .catch((error) => setErr(formatError(error)))
      .finally(() => setLoading(false));
  }, []);

  const assign = async () => {
    if (!tenantId) return;
    setSaving(true);
    setErr('');
    try {
      await api.post(`/apartments/${apartment.id}/assign-tenant`, { tenant_id: tenantId });
      onSaved?.();
    } catch (error) {
      setErr(formatError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KioskModalShell title={`Huurder toewijzen aan ${apartment.number}`} Icon={Users}
      testId="assign-apartment-tenant" onClose={onClose}
      footer={(
        <button type="button" onClick={assign} disabled={saving || loading || !tenantId}
          data-testid="assign-apartment-tenant-save"
          className="w-full h-12 rounded-xl bg-orange-500 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? 'Toewijzen…' : 'Huurder toewijzen'}
        </button>
      )}>
      {({ accent }) => (
        <>
          <label className="block">
            <span className={modalLabelCls}>Selecteer huurder</span>
            <select value={tenantId} onChange={(event) => setTenantId(event.target.value)}
              disabled={loading || tenants.length === 0}
              data-testid="assign-apartment-tenant-select"
              className={`${modalInputCls(accent)} bg-white`}>
              <option value="">{loading ? 'Huurders laden…' : '— Kies een huurder —'}</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name || 'Onbekende huurder'}{tenant.apartment_number ? ` · ${tenant.apartment_number}` : ''}
                </option>
              ))}
            </select>
          </label>
          {!loading && tenants.length === 0 && !err && (
            <p className="text-sm font-semibold text-slate-500">Geen huurders gevonden. Maak eerst een huurder aan.</p>
          )}
          {err && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{err}</div>}
        </>
      )}
    </KioskModalShell>
  );
}

function AddApartmentModal({ initial = null, onClose, onSaved }) {
  const [number, setNumber] = useState(initial?.number || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [rent, setRent] = useState(initial?.rent_amount == null ? '' : String(initial.rent_amount));
  const [currency, setCurrency] = useState(initial?.currency || 'SRD');
  const [showTenantPhoto, setShowTenantPhoto] = useState(!!initial?.show_tenant_photo);
  const [locationId, setLocationId] = useState(() => {
    if (initial?.location_id) return initial.location_id;
    try { return sessionStorage.getItem('kiosk_sel_loc') || ''; } catch { return ''; }
  });
  const [photoUrl, setPhotoUrl] = useState(initial?.photo_url || '');
  const [locations, setLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Body scroll-lock wordt beheerd door KioskModalShell → useBodyScrollLock.

  useEffect(() => {
    fetchKioskSelect()
      .then((data) => {
        const available = data.locations.filter((location) => location.id !== '_none');
        setLocations(available);
        setLocationId((current) => available.some((location) => location.id === current)
          ? current
          : available.length === 1 ? available[0].id : '');
      })
      .catch((e) => setErr(formatError(e)))
      .finally(() => setLoadingLocations(false));
  }, []);

  const save = async () => {
    const n = String(number || '').trim();
    const r = parseFloat(String(rent).replace(',', '.'));
    if (!n) { setErr('Nummer is verplicht'); return; }
    if (!r || r <= 0) { setErr('Huur bedrag moet groter dan 0 zijn'); return; }
    setSaving(true); setErr('');
    try {
      const body = {
        number: n, address: address.trim(), description: description.trim(), rent_amount: r,
        currency, location_id: locationId || null, photo_url: photoUrl.trim(),
        show_tenant_photo: showTenantPhoto,
      };
      const res = initial?.id
        ? await api.put(`/apartments/${initial.id}`, body)
        : await api.post('/apartments', body);
      onSaved && onSaved(res?.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title={initial ? 'Appartement bewerken' : 'Nieuw appartement'} Icon={Home}
      testId="add-apartment" onClose={onClose} xwide={!!initial}
      footer={(
        <button onClick={save} disabled={saving || !number.trim() || !rent}
          data-testid="add-apartment-save"
          className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Opslaan…' : initial ? 'Wijzigingen opslaan' : 'Appartement opslaan'}
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
          <label className="block">
            <span className={modalLabelCls}>Adres</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              data-testid="add-apartment-address"
              placeholder="Straat en huisnummer"
              className={modalInputCls(accent)} />
          </label>
          <label className="block">
            <span className={modalLabelCls}>Omschrijving</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              data-testid="add-apartment-description"
              rows={2}
              className={`${modalInputCls(accent)} h-auto min-h-20 py-3`} />
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
            <span className={modalLabelCls}>Locatie</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
              data-testid="add-apartment-location"
              disabled={loadingLocations}
              className={`${modalInputCls(accent)} bg-white`}>
              <option value="">{loadingLocations ? 'Locaties laden…' : '— Geen locatie —'}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}{location.address ? ` · ${location.address}` : ''}</option>
              ))}
            </select>
          </label>
          <PhotoUpload value={photoUrl} onChange={setPhotoUrl} label="Foto van het appartement"
            height="h-36" showUrlField={false} capture="environment" testId="add-apartment-photo" />
          <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={showTenantPhoto} onChange={(event) => setShowTenantPhoto(event.target.checked)}
              data-testid="add-apartment-show-tenant-photo"
              className="h-4 w-4 accent-orange-500" />
            Toon foto van huurder in de kiosk
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

function KioskHistBtn({ dir, disabled, onClick, white, green = false }) {
  const Ico = dir === 'back' ? (white || green ? ChevronLeft : LayoutGrid) : ChevronRight;
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={`kiosk-bar-${dir}`} aria-label={dir === 'back' ? 'Vorig scherm' : 'Volgend scherm'}
      className={`shrink-0 w-16 flex flex-col items-center justify-center gap-1.5 rounded-xl py-2.5 transition-[background-color,opacity] duration-150 disabled:opacity-35 disabled:cursor-default ${green ? 'text-[#087A55] bg-emerald-50 enabled:hover:bg-emerald-100' : white ? 'text-[#FF5C00] bg-orange-50 enabled:hover:bg-orange-100' : 'text-[#F26A12] bg-white enabled:hover:bg-orange-50'}`}>
      <Ico className="w-7 h-7" strokeWidth={2.4} />
      <span className="text-[10px] lg:text-[11px] xl:text-sm font-semibold leading-tight">{dir === 'back' ? 'Terug' : 'Volgende'}</span>
    </button>
  );
}

// Gegevens en contact van de gekozen huurder (onderbalk bij een gekozen appartement).
function TenantInfoModal({ apartment, mode, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!apartment?.tenant_id) return;
    takeOverview(apartment.tenant_id).then((r) => setData(r.data)).catch((e) => setErr(formatError(e)));
  }, [apartment]);
  const t = data?.tenant || {};
  const apt = data?.apartment || {};
  const phone = String(t.phone || '').trim();
  const digits = phone.replace(/\D/g, '');
  const rows = [
    ['Naam', t.name], ['Appartement', apt.number || apartment?.number], ['Telefoon', phone],
    ['E-mail', t.email], ['Huur', apt.rent_amount != null ? fmtMoney(Number(apt.rent_amount), apt.currency || 'SRD') : ''],
  ].filter(([, v]) => v);
  const btn = 'w-full min-w-0 h-12 rounded-xl px-3 font-bold text-sm inline-flex items-center justify-center gap-2 active:scale-95 transition';
  return (
    <KioskModalShell title={mode === 'contact' ? 'Contact' : 'Gegevens'} Icon={mode === 'contact' ? Smartphone : User}
      testId={`tenant-${mode}`} onClose={onClose}>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!data && !err && <div className="py-8 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500" /></div>}
      {data && mode !== 'contact' && (
        <dl className="divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5 text-sm">
              <dt className="font-semibold text-slate-500">{k}</dt>
              <dd className="font-bold text-slate-900 text-right break-all">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {data && mode === 'contact' && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-slate-900">{t.name}{phone ? ` · ${phone}` : ''}</p>
          {digits ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <a href={`tel:${phone}`} data-testid="tenant-contact-call"
                className={`${btn} bg-orange-500 text-white hover:bg-orange-600`}>Bellen</a>
              <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" data-testid="tenant-contact-whatsapp"
                className={`${btn} bg-emerald-500 text-white hover:bg-emerald-600`}>
                <MessageCircle className="w-4 h-4 shrink-0" /> WhatsApp
              </a>
              {t.email && <a href={`mailto:${t.email}`} data-testid="tenant-contact-email"
                className={`${btn} bg-slate-100 text-slate-800 hover:bg-slate-200`}>E-mail</a>}
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500">Geen telefoonnummer bekend.</p>
              {t.email && <a href={`mailto:${t.email}`} data-testid="tenant-contact-email"
                className={`${btn} bg-slate-100 text-slate-800 hover:bg-slate-200`}>E-mail</a>}
            </>
          )}
        </div>
      )}
    </KioskModalShell>
  );
}

function KioskModalShell({ title, subtitle = 'Beheer deze gegevens', Icon, testId, onClose, children, footer, wide = false, tall = false, xwide = false, fullscreenMobile = false }) {
  const [host, setHost] = useState(null);
  const modalRef = useRef(null);
  useVisualViewportPosition(modalRef, fullscreenMobile ? 768 : 640);
  const { theme } = useContext(KioskThemeCtx);
  useWhitePageBehindModal(fullscreenMobile ? 767 : 639);
  return createPortal((
    <div
      className={`keyboard-opaque-backdrop fixed inset-0 z-[120] overflow-hidden bg-white ${fullscreenMobile ? 'md:bg-black/50 md:backdrop-blur-md md:flex md:items-center md:justify-center md:p-4' : 'sm:bg-black/50 sm:backdrop-blur-md sm:flex sm:items-center sm:justify-center sm:p-4'} ${theme === 'white' ? 'kiosk-modal-white' : theme === 'green' ? 'kiosk-modal-green' : ''}`}
      data-testid={`${testId}-overlay`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={modalRef} onClick={(e) => e.stopPropagation()}
        className={`kiosk-standard-form absolute inset-x-0 top-0 w-full h-full ${fullscreenMobile
          ? `${tall ? 'md:h-[88dvh]' : 'md:h-auto'} ${xwide ? 'md:max-w-[42rem] lg:max-w-5xl' : wide ? 'md:max-w-[42rem]' : 'md:max-w-md'} md:max-h-[90dvh] md:rounded-2xl md:static md:inset-auto`
          : `${tall ? 'sm:h-[88dvh]' : 'sm:h-auto'} ${xwide ? 'sm:max-w-[42rem] lg:max-w-5xl' : wide ? 'sm:max-w-[42rem]' : 'sm:max-w-md'} sm:max-h-[90dvh] sm:rounded-2xl sm:static sm:inset-auto`} bg-white flex flex-col overflow-hidden`}
        data-testid={`${testId}-form`}>
        <ModalHostContext.Provider value={tall ? host : null}>
        <div className="kiosk-modal-head flex-none flex items-center justify-between gap-3 px-5 pb-4 bg-white border-b border-slate-100"
          style={{ paddingTop: 'max(var(--kiosk-sat), 16px)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-orange-100 flex items-center justify-center">
              <Icon className="w-7 h-7 text-orange-600" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-black leading-tight text-slate-900"
                data-testid={`${testId}-title`}>{title}</h3>
              <p className="mt-1 text-sm leading-tight text-slate-500">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} data-testid={`${testId}-close`}
            className="w-14 h-14 shrink-0 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
            <X className="w-7 h-7 text-slate-700" strokeWidth={2.5} />
          </button>
        </div>
        <div ref={tall ? setHost : undefined} data-kiosk-host={tall ? '' : undefined} style={tall ? { transform: 'translateZ(0)' } : undefined} className="relative flex-1 min-h-0 flex flex-col">
        {/* Body — witte scrollbare content. `overscroll-contain` voorkomt
            dat de scroll doorlekt naar de underlying page op iOS. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4 bg-white"
          style={{ WebkitOverflowScrolling: 'touch' }}
          data-testid={`${testId}-body`}>
          {typeof children === 'function' ? children({ accent: 'focus:border-orange-500' }) : children}
        </div>
        {footer && (
          <div className="kiosk-modal-footer flex-none border-t border-slate-100 px-5 py-3 bg-white"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            {footer}
          </div>
        )}
        </div>
        </ModalHostContext.Provider>
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
  const [photoUrl, setPhotoUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [createdLocation, setCreatedLocation] = useState(null);

  const save = async () => {
    if (!name.trim()) { setErr('Naam is verplicht'); return; }
    setSaving(true); setErr('');
    try {
      const body = { name: name.trim() };
      if (address.trim()) body.address = address.trim();
      if (photoUrl.trim()) body.photo_url = photoUrl.trim();
      const r = await api.post('/locations', body);
      if (!r?.data?.id) throw new Error('Locatie is aangemaakt, maar kan niet worden geopend. Probeer de kiosk te vernieuwen.');
      setCreatedLocation(r.data);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <KioskModalShell title="Nieuwe locatie" Icon={MapPin}
      testId="add-location" onClose={onClose}
      footer={(
        createdLocation ? (
          <button type="button" onClick={() => onSaved?.(createdLocation)}
            data-testid="add-location-open"
            className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2">
            <MapPin className="w-4 h-4" /> Ga naar {createdLocation.name}
          </button>
        ) : (
          <button onClick={save} disabled={saving || !name.trim()}
            data-testid="add-location-save"
            className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? 'Opslaan…' : 'Locatie opslaan'}
          </button>
        )
      )}>
      {({ accent }) => (
        <>
          {createdLocation ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3"
              data-testid="add-location-success">
              <p className="font-bold">Locatie aangemaakt</p>
              <p className="mt-1 text-sm">Open {createdLocation.name} om de appartementen daar te bekijken of toe te voegen.</p>
            </div>
          ) : (
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
              <PhotoUpload value={photoUrl} onChange={setPhotoUrl} label="Locatiefoto"
                height="h-36" showUrlField={false} capture="environment" testId="add-location-photo" />
            </>
          )}
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
  const [paymentDayLoading, setPaymentDayLoading] = useState(true);
  const paymentDayEdited = useRef(false);
  const [deposit, setDeposit] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const loadTenantAndApartments = useCallback(() => Promise.all([api.get('/tenants'), api.get('/apartments')]).then(([tr, ar]) => {
      setTenants(Array.isArray(tr?.data) ? tr.data : []);
      setApartments(Array.isArray(ar?.data) ? ar.data : []);
    }).catch(() => {}), []);
  useEffect(() => { loadTenantAndApartments(); }, [loadTenantAndApartments]);
  useKioskLiveRefresh(loadTenantAndApartments);

  useEffect(() => {
    let alive = true;
    api.get('/settings')
      .then(({ data }) => {
        const configuredDay = Number(data?.invoicing?.contract_payment_day);
        if (alive && !paymentDayEdited.current) {
          setPayDay(Number.isInteger(configuredDay) && configuredDay >= 1 && configuredDay <= 31 ? configuredDay : 1);
        }
      })
      .catch((e) => {
        if (alive) {
          setPayDay(null);
          setErr(formatError(e));
        }
      })
      .finally(() => { if (alive) setPaymentDayLoading(false); });
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
        ...(payDay ? { payment_day: Number(payDay) } : {}),
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
        <button onClick={save} disabled={saving || paymentDayLoading || !tenantId || !aptId || !startDate}
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
              <input type="number" min="1" max="31" value={payDay ?? ''} disabled={paymentDayLoading}
                onChange={(e) => { paymentDayEdited.current = true; setPayDay(e.target.value); }}
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
          <p className="text-[11px] text-slate-500">
            {paymentDayLoading ? 'Standaard betaaldag laden…' : 'Standaard overgenomen van de vervaldag bij Facturen automatisering; per contract aanpasbaar.'}
          </p>
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
// Nieuwe factuur vanuit de menubalk — zelfde formulier als beheer (incl. Historische achterstand).
function KioskInvoiceFormModal({ onClose, onSaved }) {
  const [tenants, setTenants] = useState([]);
  const loadTenants = useCallback(() => api.get('/tenants').then((r) => setTenants(Array.isArray(r?.data) ? r.data : [])).catch(() => {}), []);
  useEffect(() => { loadTenants(); }, [loadTenants]);
  useKioskLiveRefresh(loadTenants);
  return (
    <KioskModalShell title="Facturen" Icon={Receipt} testId="add-invoice" onClose={onClose}>
      <InvoiceForm inline tenants={tenants} onCancel={onClose} onSaved={onSaved} />
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

  const loadPayments = useCallback(() => api.get('/payments', { params: { limit: 50 } }).then((r) => {
      setPayments(Array.isArray(r?.data) ? r.data : []);
    }).catch((e) => setErr(formatError(e)))
      .finally(() => setLoading(false)), []);
  useEffect(() => { loadPayments(); }, [loadPayments]);
  useKioskLiveRefresh(loadPayments);

  return (
    <KioskModalShell title="Betalingen inzien" Icon={Banknote}
      testId="payments-viewer" onClose={onClose}>
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
                <div className="text-sm font-black text-slate-900 truncate">{p.apartment_number || 'Geen appartement'}</div>
                <div className="text-xs text-slate-500 truncate">
                  {p.tenant_name || 'Onbekende huurder'} · {p.receipt_number || p.id?.slice(0, 8)} · {p.category || 'huur'}
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
function AddMaintenanceModal({ onClose, onSaved, initialApartmentId = '' }) {
  const [apartments, setApartments] = useState([]);
  const [aptId, setAptId] = useState(initialApartmentId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [cost, setCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const loadApartments = useCallback(() => api.get('/apartments').then((r) => {
      setApartments(Array.isArray(r?.data) ? r.data : []);
    }).catch(() => {}), []);
  useEffect(() => { loadApartments(); }, [loadApartments]);
  useKioskLiveRefresh(loadApartments);

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
function SheetThemeButton() {
  const { theme, rawTheme, toggle } = useContext(KioskThemeCtx);
  const white = theme === 'white';
  const green = theme === 'green';
  const nextTheme = rawTheme === 'ui' ? 'Oranje modus' : rawTheme === 'wave' ? 'UI thema' : white ? 'Golf-achtergrond' : green ? 'Oranje modus' : 'Witte modus';
  return (
    <button type="button" onClick={toggle} data-testid="kiosk-sheet-theme-toggle"
      aria-label={nextTheme}
      className={`flex-1 h-11 rounded-full font-bold text-sm inline-flex items-center justify-center shadow-sm active:scale-95 transition ${green ? 'bg-white text-emerald-700' : 'bg-white/15 text-white'}`}>
      {white || green ? <Palette className="w-5 h-5" strokeWidth={2.5} /> : <Sun className="w-5 h-5" strokeWidth={2.5} />}
    </button>
  );
}

function KioskAddSheet({ onClose, onPick, hasAdminAccess = false }) {
  const { theme } = useContext(KioskThemeCtx);
  // Snel-aanmaak tegels (zelfde set als de desktop-balk). Kiosk-niveau
  // acties (Kasgeld, Beheerder, Uit) worden onder de grid als compacte
  // knopbalk gerenderd, NIET als cards.
  const tiles = [
    { key: 'manual',       label: 'Handleiding',       Icon: BookOpen },
    { key: 'tenant',      label: 'Nieuwe huurder',    Icon: UserPlus },
    { key: 'apartment',   label: 'Nieuw appartement', Icon: Home },
    { key: 'location',    label: 'Nieuwe locatie',    Icon: MapPin },
    { key: 'contract',    label: 'Nieuw contract',    Icon: FileText },
    { key: 'invoice',     label: 'Nieuwe factuur',    Icon: Receipt },
    { key: 'payments',    label: 'Betalingen inzien', Icon: Banknote },
    { key: 'maintenance', label: 'Onderhoud',         Icon: Wrench },
    { key: 'nfc',         label: 'NFC-tag koppelen',  Icon: Nfc },
    ...(hasAdminAccess ? [{ key: 'stroom', label: 'Stroom', Icon: Zap }] : []),
  ];
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal((
    <div
      className={`keyboard-opaque-backdrop kiosk-add-sheet-overlay fixed inset-0 z-[120] bg-orange-500 flex flex-col animate-in fade-in duration-150 ${theme === 'white' ? 'kiosk-sheet-white' : theme === 'green' ? 'kiosk-sheet-green' : ''}`}
      data-testid="kiosk-add-sheet-overlay">
      <div className="flex-none flex items-center justify-between px-4"
        style={{
          paddingTop: 'max(var(--kiosk-sat), 16px)',
          paddingBottom: 12,
        }}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Plus className="w-6 h-6 text-white" strokeWidth={3} />
          </div>
          <h3 className="text-xl font-black text-white" data-testid="kiosk-add-sheet-title">Snel toevoegen</h3>
        </div>
        <button onClick={onClose} data-testid="kiosk-add-sheet-close"
          className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center active:bg-white/30 transition">
          <X className="w-6 h-6 text-white" strokeWidth={2.5} />
        </button>
      </div>
      <div className="kiosk-add-sheet-scroll px-4 pt-1">
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

      <div className="kiosk-add-sheet-footer flex-none px-4 pt-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        <div className="flex gap-2" data-testid="kiosk-sheet-actions">
        <div className="contents" data-testid="kiosk-sheet-actions-row">
          {hasAdminAccess && !isStaffSession() && (
            <button onClick={() => onPick('settings')} data-testid="kiosk-tile-settings" aria-label="Instellingen"
              className="flex-1 h-11 rounded-full font-bold text-sm inline-flex items-center justify-center bg-white/15 text-white shadow-sm active:scale-95 transition">
              <SettingsIcon className="w-5 h-5" strokeWidth={2.5} />
            </button>
          )}
          <button onClick={() => onPick('exit')} data-testid="kiosk-tile-exit" aria-label="Uit"
            className="flex-1 h-11 rounded-full font-bold text-sm inline-flex items-center justify-center bg-white/15 text-white shadow-sm active:scale-95 transition">
            <LogOut className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </div>
        <KioskSheetLiveActions isAdmin={hasAdminAccess} onClose={onClose}>
          <SheetThemeButton />
        </KioskSheetLiveActions>
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
  const keyboardOpen = useKeyboardOpen();
  const navigate = useBrandedNavigate();
  const { user } = useAuth();
  const [isMobileViewport, setIsMobileViewport] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const updateViewport = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);
  const [supportActive, setSupportActive] = useState(false);
  // Direct naar 'select' als er een token is: scheelt een exit+enter animatie.
  const [step, setStep] = useState(() => {
    const isDemoLaunch = new URLSearchParams(window.location.search).get('demo') === '1';
    return !isDemoLaunch && localStorage.getItem('kiosk_token') ? requestedAdminStep() : 'check';
  });
  const [demoLoginError, setDemoLoginError] = useState('');
  const demoLoginStarted = useRef(false);
  const demoSession = useRef(new URLSearchParams(window.location.search).get('demo') === '1');
  const [apartment, setApartment] = useState(null);
  const [tenantModal, setTenantModal] = useState(null);
  const [overview, setOverview] = useState(null);
  const [paymentPayload, setPaymentPayload] = useState(null);
  const [paymentResult, setPaymentResult] = useState(null);
  const [company, setCompany] = useState(getKioskCompany());
  const [nfcToast, setNfcToast] = useState(null); // {kind:'ok'|'err', msg}
  const [nfcLink, setNfcLink] = useState(null); // {uid} → koppelscherm open
  // Modals voor snel aanmaken vanuit de Kiosk (alle beheerder-shortcuts)
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [showAddApartment, setShowAddApartment] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [showAddContract, setShowAddContract] = useState(false);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [showPaymentsViewer, setShowPaymentsViewer] = useState(false);
  const [showAddMaintenance, setShowAddMaintenance] = useState(false);
  // Bump om ApartmentSelect te forceren opnieuw te fetchen na een aanmaak
  const [apartmentsReloadKey, setApartmentsReloadKey] = useState(0);

  // Tijdens de huurder-overview en betaalkeuze worden deze data als state
  // doorgegeven tussen schermen; houd ze bij wijzigingen op beide apparaten
  // direct vers zonder de lopende bevestiging/betaling te onderbreken.
  useEffect(() => {
    if (!apartment?.tenant_id || step !== 'pay') return undefined;
    const refresh = () => {
      fetchOverview(apartment.tenant_id)
        .then(({ data }) => setOverview(data))
        .catch(() => {});
    };
    window.addEventListener('surirent:live-change', refresh);
    return () => window.removeEventListener('surirent:live-change', refresh);
  }, [apartment?.tenant_id, step]);

  // Bottom-sheet actie-refs — handleSheetPick wordt vroeg in de component
  // gedeclareerd, maar `exit` en `adminMode` pas later. We vangen hun
  // referenties via useRef zodat we geen hoisting-issue krijgen in de
  // useCallback dependency array.
  const exitRef = useRef(null);
  const adminRef = useRef(null);

  // Bottom-sheet tegel selectie → open de bijbehorende modal of
  // navigeer naar het kiosk-niveau scherm (kasgeld / admin / exit).
  const [phoneScanOpen, setPhoneScanOpen] = useState(false);
  const [showInvoicesModal, setShowInvoicesModal] = useState(false);
  const closeInvoices = useCallback(() => { setShowInvoicesModal(false); returnToMenu(); }, []);
  const [adminPopup, setAdminPopup] = useState(null);
  const [depositFor, setDepositFor] = useState(null);
  const [contractFor, setContractFor] = useState(null);
  useEffect(() => {
    const h = (e) => setDepositFor(e.detail);
    window.addEventListener('kiosk-deposit-open', h);
    return () => window.removeEventListener('kiosk-deposit-open', h);
  }, []);
  // Links in embedded beheerpagina's openen het bijbehorende kiosk-scherm.
  useEffect(() => {
    const MAP = { tenants: 'huurders', payments: 'betalingen', apartments: 'appartementen', locations: 'locaties',
      contracts: 'contracten', payment_plans: 'regelingen', deposits: 'borg', maintenance: 'onderhoud',
      employees: 'werknemers', notifications: 'notificaties', instellingen: 'instellingen', settings: 'instellingen', overview: 'overzicht' };
    const onTab = (e) => {
      const t = typeof e.detail === 'string' ? e.detail : e.detail?.tab;
      menuOrigin = null;
      setAdminPopup(null);
      if (t === 'invoices') { setShowInvoicesModal(false); setStep('admin:facturen'); }
      else if (t === 'kasgeld') setStep('kasgeld');
      else if (t === 'tenants') setStep('admin:huurders');
      else if (t === 'locations') setStep('admin:locaties');
      else if (t === 'contracts') setStep('admin:contracten');
      else if (t === 'payments') setStep('admin:betalingen');
      else if (t === 'payment_plans') setStep('admin:regelingen');
      else if (MAP[t]) setAdminPopup(MAP[t]);
    };
    window.addEventListener('go-tab', onTab);
    return () => window.removeEventListener('go-tab', onTab);
  }, []);
  const [tenantPrefill, setTenantPrefill] = useState(null);
  const [scanToast, setScanToast] = useState(null);
  // Desktop: ID-scan van de telefoon van dezelfde gebruiker → Nieuwe huurder opent ingevuld.
  useEffect(() => {
    const onScan = (e) => {
      const msg = e.detail || {};
      if (window.innerWidth < 768) return;
      const mine = getKioskUserKey();
      if ((msg.user_key || '') === mine && linkScanHandler.current) { linkScanHandler.current(msg); return; }
      if ((msg.user_key || '') !== mine) return;
      setTenantPrefill(msg);
      setShowAddTenant(true);
      setScanToast(msg.scan?.name || 'Nieuwe huurder');
      setTimeout(() => setScanToast(null), 5000);
    };
    window.addEventListener('kiosk-id-scan', onScan);
    return () => window.removeEventListener('kiosk-id-scan', onScan);
  }, []);
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
      else if (key === 'kasgeld') setStep('kasgeld');
      else if (key === 'stroom') setStep('stroom');
      else if (key === 'scanid') setPhoneScanOpen(true);
      else if (key === 'nfc') setNfcLink({ uid: '' });
      else if (key === 'settings') window.dispatchEvent(new CustomEvent('kiosk-open-menu', { detail: 'settings' }));
      else if (key === 'manual') setManualOpen(true);
      else if (key === 'admin') { if (localStorage.getItem('admin_token') || localStorage.getItem('kiosk_admin_cookie') === '1') window.dispatchEvent(new CustomEvent('kiosk-open-menu', { detail: 'admin' })); else adminRef.current?.(); }
      else if (key === 'exit') exitRef.current?.();
    }, 100);
  }, []);
  useEffect(() => {
    const openManual = () => setManualOpen(true);
    window.addEventListener('kiosk-manual-open', openManual);
    return () => window.removeEventListener('kiosk-manual-open', openManual);
  }, []);

  useEffect(() => {
    // document.title wordt centraal beheerd door usePwaManifest() in App.js
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      if (demoLoginStarted.current) return;
      demoLoginStarted.current = true;
      api.post('/auth/demo-login').then(({ data }) => {
        if (!data?.token || !data?.kiosk_token) throw new Error('Demo-login gaf geen kiosktoegang terug.');
        localStorage.setItem('admin_token', data.token);
        localStorage.setItem('kiosk_token', data.kiosk_token);
        localStorage.setItem('kiosk_company', JSON.stringify(data.company || {}));
        localStorage.setItem('is_demo_session', '1');
        window.dispatchEvent(new Event('kiosk-employee-changed'));
        demoSession.current = true;
        if (data.company?.slug) localStorage.setItem('pwa_company_slug', data.company.slug);
        setCompany(data.company || null);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.hash}`);
        setStep('select');
      }).catch((error) => {
        setDemoLoginError(formatError(error, 'De demo kan momenteel niet worden geopend.'));
      });
      return;
    }
    const tok = localStorage.getItem('kiosk_token');
    if (!tok) { navigate('/login?target=kiosk', { replace: true }); return; }
    setCompany(getKioskCompany());
    setStep(requestedAdminStep());
    if (new URLSearchParams(window.location.search).get('admin') === 'nfc') setNfcLink({ uid: '' });
  }, [navigate]);

  // Tijdens kiosk-modus moet body/root in PWA standalone ORANJE zijn (zodat
  // het iPhone-home-indicator gebied en eventuele 1px doorlek aan de notch
  // de huisstijl-kleur tonen, niet wit). De Admin gebruikt wit. We schakelen
  // door middel van een body-class die alleen in standalone PWA effect heeft,
  // EN we zetten body/html bg direct in style. Voor kiosk gebruiken we WIT
  // omdat de vaste witte FAB-menubalk onderaan staat — zo krijgen we nooit
  // een oranje strook onder de FAB bij iOS PWA viewport-drift.
  // .kiosk-fullscreen zelf heeft orange bg (#FF5C00) en dekt de rest af.
  const [kioskTheme, setKioskTheme] = useState(() => {
    const stored = localStorage.getItem('kiosk_theme');
    return ['orange', 'ui', 'wave'].includes(stored) ? stored : 'white';
  });
  useEffect(() => {
    const root = document.documentElement;
    const isAndroid = /Android/i.test(navigator.userAgent || '');
    if (isAndroid) root.classList.add('kiosk-android-device');
    return () => {
      if (isAndroid) root.classList.remove('kiosk-android-device');
    };
  }, []);
  useEffect(() => {
    const apply = (t) => { if (['white', 'orange', 'green', 'ui', 'wave'].includes(t)) { t = t === 'orange' || t === 'ui' || t === 'wave' ? t : 'white'; setKioskTheme(t); localStorage.setItem('kiosk_theme', t); } };
    api.get('/kiosk/theme').then(({ data }) => apply(data?.theme)).catch(() => {});
    const onWs = (e) => apply(e.detail);
    window.addEventListener('kiosk-theme', onWs);
    return () => window.removeEventListener('kiosk-theme', onWs);
  }, []);
  const toggleTheme = useCallback(() => {
    const next = kioskTheme === 'orange' ? 'white' : kioskTheme === 'white' ? 'wave' : kioskTheme === 'wave' ? 'ui' : 'orange';
    setKioskTheme(next);
    localStorage.setItem('kiosk_theme', next);
    api.put('/kiosk/theme', { theme: next }).catch(() => { setKioskTheme(kioskTheme); localStorage.setItem('kiosk_theme', kioskTheme); });
  }, [kioskTheme]);
  const isUi = kioskTheme === 'ui';
  const isWhite = kioskTheme === 'white' || isUi;
  const isGreen = false;
  const isOrange = kioskTheme === 'orange';
  useEffect(() => {
    const bg = isUi ? '#F6F7FB' : isWhite ? '#FFFFFF' : isGreen ? '#F2F8F4' : '#FF5C00';
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
    document.body.classList.toggle('kiosk-white-body', isWhite);
    document.body.classList.toggle('kiosk-ui-body', isUi);
    document.body.classList.toggle('kiosk-green-active', isGreen);
    setIosStatusBar(bg);
  }, [isWhite, isGreen, isUi]);
  useEffect(() => {
    const savedTheme = localStorage.getItem('kiosk_theme');
    const BODY_BG = savedTheme === 'orange' ? '#FF5C00' : (savedTheme === 'ui' || savedTheme === 'wave') ? '#F6F7FB' : '#FFFFFF';
    document.body.classList.add('kiosk-mode');
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const prevBodyBg = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = BODY_BG;
    document.body.style.backgroundColor = BODY_BG;
    // iPhone-PWA: statusbalk effen oranje achter klok/batterij (zoals Expo Go).
    setIosStatusBar(BODY_BG);
    return () => {
      setIosStatusBar('#F7F8FA');
      document.body.classList.remove('kiosk-mode');
      document.body.classList.remove('kiosk-white-body', 'kiosk-green-active', 'kiosk-ui-body');
      document.documentElement.style.backgroundColor = prevHtmlBg;
      document.body.style.backgroundColor = prevBodyBg;
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
        } else if (data && !data.found) {
          // Onbekende tag → koppelscherm (medewerker kiest de huurder)
          setNfcLink({ uid: data.card_id || uid });
          return;
        } else {
          setNfcToast({ kind: 'err', msg: 'Deze huurder heeft geen appartement.' });
        }
      } catch (err) {
        setNfcToast({ kind: 'err', msg: 'Kon kaart niet uitlezen. Probeer opnieuw.' });
      }
      setTimeout(() => setNfcToast(null), 4000);
    };
    // Tag-ID's uit de Android-app (bestaand NFC-systeem van de APK)
    const unsubNfc = subscribeNfc(handleScan);

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
          if (uid.length >= 6) emitNfc(uid);
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
        if (candidate.length >= 6) emitNfc(candidate);
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
      unsubNfc();
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

  const exit = useCallback(async () => {
    kioskLiveBye();
    const wasDemo = demoSession.current || (() => {
      try { return localStorage.getItem('is_demo_session') === '1'; }
      catch { return false; }
    })();
    // VOLLEDIGE reset zodat een volgende gebruiker (vooral een andere
    // medewerker op een gedeeld kiosk-toestel) cleanly bij de PIN-keypad
    // landt zonder oude tokens of role-voorkeur. Anders krijgt de PWA
    // een auto-redirect terug naar /kiosk of /admin met de stale tokens
    // van de vorige gebruiker.
    try {
      localStorage.removeItem('kiosk_token');
      localStorage.removeItem('kiosk_company');
      localStorage.removeItem('admin_token');
      localStorage.removeItem('auth_user_cache');
      localStorage.removeItem('kiosk_admin_cookie');
      localStorage.removeItem('pwa_preferred_role');
      localStorage.removeItem('active_company_id');
      if (wasDemo) {
        localStorage.removeItem('is_demo_session');
        localStorage.removeItem('pwa_company_slug');
      }
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
    // Wacht tot auth-cookies gewist zijn voordat we de kiosk verlaten.
    api.post('/auth/logout').catch(() => {}).finally(() => {
      window.location.assign(wasDemo ? publicMarketingUrl() || '/' : '/login?pick=1&loggedout=1');
    });
  }, []);


  // Open het beheermenu binnen de kiosk; medewerkers zonder beheer-token
  // worden naar de beheer-login gestuurd.
  const adminMode = useCallback(() => {
    let hasAdminAccess = false;
    try {
      hasAdminAccess = !!localStorage.getItem('admin_token')
        || localStorage.getItem('kiosk_admin_cookie') === '1';
    } catch { /* ignore */ }
    if (hasAdminAccess) {
      window.dispatchEvent(new CustomEvent('kiosk-open-menu', { detail: 'admin' }));
    } else {
      navigate('/login?view=admin', { replace: true });
    }
  }, [navigate]);

  // Koppel de refs die handleSheetPick gebruikt om Exit/Admin te triggeren
  // zonder in een hoisting-fout te lopen (handleSheetPick is bovenaan de
  // component, deze callbacks zijn hier verder onder).
  useEffect(() => { exitRef.current = exit; }, [exit]);
  useEffect(() => { adminRef.current = adminMode; }, [adminMode]);

  // Snapshot van admin_token aanwezigheid — wordt herberekend wanneer er
  // een medewerker (uit)logt zodat de Beheerder-knop direct verschijnt of
  // verdwijnt.
  useEffect(() => {
    const onNav = (e) => { if (e.detail === 'tenants') setShowAddTenant(true); };
    window.addEventListener('kiosk-nav', onNav);
    return () => window.removeEventListener('kiosk-nav', onNav);
  }, []);

  const [hasAdminAccess, setHasAdminAccess] = useState(() => {
    if (localStorage.getItem('kiosk_admin_cookie') === '1') return true;
    try { return !!localStorage.getItem('admin_token'); } catch { return false; }
  });
  useEffect(() => {
    const refresh = () => {
      try { setHasAdminAccess(!!localStorage.getItem('admin_token') || localStorage.getItem('kiosk_admin_cookie') === '1'); } catch { /* ignore */ }
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('kiosk-employee-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('kiosk-employee-changed', refresh);
    };
  }, []);

  const reset = () => {
    setApartment(null); setOverview(null); setPaymentPayload(null);
    setPaymentResult(null);
    setStep('select');
  };


  const themeCtx = useMemo(() => ({ theme: (kioskTheme === 'ui' || kioskTheme === 'wave') ? 'white' : kioskTheme, rawTheme: kioskTheme, isUi: kioskTheme === 'ui', toggle: toggleTheme, isAdmin: hasAdminAccess }), [kioskTheme, toggleTheme, hasAdminAccess]);
  // Vorig/volgend scherm voor de pijlen in de menubalk (alleen stabiele schermen).
  const hist = useRef({ list: [], i: -1 });
  const [, setHistTick] = useState(0);
  const [selectedLocationId, setSelectedLocationId] = useState(() => {
    try { return sessionStorage.getItem('kiosk_sel_loc') || null; } catch { return null; }
  });
  useEffect(() => {
    try {
      if (selectedLocationId) sessionStorage.setItem('kiosk_sel_loc', selectedLocationId);
      else sessionStorage.removeItem('kiosk_sel_loc');
    } catch { /* noop */ }
  }, [selectedLocationId]);
  const popupSetters = {
    'add-location': [showAddLocation, setShowAddLocation], 'add-apartment': [showAddApartment, setShowAddApartment],
    'add-tenant': [showAddTenant, setShowAddTenant], 'add-invoice': [showAddInvoice, setShowAddInvoice],
    'add-maintenance': [showAddMaintenance, setShowAddMaintenance], facturen: [showInvoicesModal, setShowInvoicesModal],
  };
  const popupKey = Object.keys(popupSetters).find((k) => popupSetters[k][0]) || adminPopup || null;
  const openOnly = (key) => {
    Object.entries(popupSetters).forEach(([k, [, set]]) => set(k === key));
    setAdminPopup(null);
  };
  const stableStep = step === 'select' || step === 'overview' || step === 'kasgeld' || step === 'stroom' || step.startsWith('admin:');
  useEffect(() => {
    if (!step.startsWith('admin:') && menuOrigin?.menu === 'admin') menuOrigin = null;
  }, [step]);
  const sameEntry = (e) => e && e.step === step && e.apartment?.id === apartment?.id
    && e.popup === popupKey && e.location === selectedLocationId;
  useEffect(() => {
    const h = hist.current;
    if (!stableStep || sameEntry(h.list[h.i])) return;
    // Venster gesloten → zelfde als één stap terug (geen dubbele entry).
    if (sameEntry(h.list[h.i - 1])) { h.i -= 1; setHistTick((t) => t + 1); return; }
    h.list = [...h.list.slice(0, h.i + 1), { step, apartment, popup: popupKey, location: selectedLocationId }];
    h.i = h.list.length - 1;
    setHistTick((t) => t + 1);
  }, [step, apartment, popupKey, selectedLocationId]);
  const applyEntry = (e) => {
    setApartment(e.apartment); setStep(e.step);
    setSelectedLocationId(e.location ?? null);
    Object.entries(popupSetters).forEach(([k, [, set]]) => set(e.popup === k));
    setAdminPopup(e.popup && !popupSetters[e.popup] ? e.popup : null);
    setHistTick((t) => t + 1);
  };
  const returnFromAdminPage = () => {
    if (!step.startsWith('admin:') || menuOrigin?.menu !== 'admin') return false;
    const h = hist.current;
    const current = sameEntry(h.list[h.i]) ? h.list[h.i]
      : { step, apartment, popup: popupKey, location: selectedLocationId };
    let menuIndex = -1;
    for (let index = h.i - 1; index >= 0; index -= 1) {
      const entry = h.list[index];
      if (entry.step === menuOrigin.returnTo?.step
        && entry.location === menuOrigin.returnTo?.location
        && entry.apartment?.id === menuOrigin.returnTo?.apartment?.id
        && !entry.popup) {
        menuIndex = index;
        break;
      }
    }
    const menuEntry = menuIndex >= 0
      ? h.list[menuIndex]
      : { ...menuOrigin.returnTo, popup: null };
    h.list = [
      ...(menuIndex >= 0 ? h.list.slice(0, menuIndex) : []),
      menuEntry,
      current,
    ];
    h.i = h.list.length - 2;
    applyEntry(menuEntry);
    returnToMenu();
    return true;
  };
  const goHist = (d) => {
    if (d < 0 && returnFromAdminPage()) return;
    if (d < 0 && step === 'select' && selectedLocationId && !popupKey) {
      const h = hist.current;
      const previous = h.list[h.i - 1];
      if (previous?.step === 'select' && previous.location == null && !previous.popup) {
        h.i -= 1;
        applyEntry(previous);
      } else {
        const current = sameEntry(h.list[h.i]) ? h.list[h.i]
          : { step, apartment, popup: popupKey, location: selectedLocationId };
        const picker = { ...current, location: null };
        h.list = [...h.list.slice(0, h.i), picker, current];
        h.i = h.list.length - 2;
        applyEntry(picker);
      }
      return;
    }
    if (d > 0) window.dispatchEvent(new CustomEvent('kiosk-close-menu'));
    const h = hist.current;
    if (d < 0 && !stableStep && h.list[h.i]) { applyEntry(h.list[h.i]); return; }
    const e = h.list[h.i + d];
    if (!e) return;
    h.i += d;
    applyEntry(e);
  };
  const goBack = () => {
    if (returnFromAdminPage()) return;
    if (hist.current.i > 0 || (!stableStep && hist.current.i >= 0)
      || (step === 'select' && selectedLocationId && !popupKey)) {
      goHist(-1);
      return;
    }
    if (step !== 'select' && hist.current.i <= 0) {
      const h = hist.current;
      const current = sameEntry(h.list[h.i]) ? h.list[h.i]
        : { step, apartment, popup: popupKey, location: selectedLocationId };
      const menuEntry = { step: 'select', apartment: null, popup: null, location: selectedLocationId };
      h.list = [menuEntry, current];
      h.i = 0;
      applyEntry(menuEntry);
    }
  };
  const canBack = step === 'kasgeld' || step === 'stroom' || step.startsWith('admin:')
    || (step === 'select' && selectedLocationId && !popupKey)
    || hist.current.i > 0 || (!stableStep && hist.current.i >= 0);
  const canFwd = hist.current.i < hist.current.list.length - 1;
  const showDesktopBar = step !== 'check';
  const showMobileKioskBar = !step.startsWith('admin:') && ['select', 'kasgeld', 'stroom'].includes(step);
  const tenantBar = !!apartment?.tenant_id && ['overview', 'pay', 'method', 'confirm'].includes(step);
  const tenantAct = (a) => { openOnly(null); setTenantModal(null); window.dispatchEvent(new CustomEvent('kiosk-tenant-action', { detail: a })); };
  const tenantBarItems = [
    { id: 'overview', label: 'Overzicht', icon: Wallet, testid: 'kiosk-tb-overview', onClick: () => { openOnly(null); setTenantModal(null); setStep('overview'); } },
    { id: 'pay', label: 'Betalen', icon: CreditCard, testid: 'kiosk-tb-pay', onClick: () => { openOnly(null); setTenantModal(null); if (step === 'overview') tenantAct('pay'); } },
    { id: 'history', label: 'Geschiedenis', icon: Receipt, testid: 'kiosk-tb-history', onClick: () => { if (step !== 'overview') setStep('overview'); setTimeout(() => tenantAct('history'), step === 'overview' ? 0 : 400); } },
    { id: 'maintenance', label: 'Onderhoud', icon: Wrench, testid: 'kiosk-tb-maintenance', onClick: () => { setTenantModal(null); openOnly('add-maintenance'); } },
    { id: 'info', label: 'Gegevens', icon: User, testid: 'kiosk-tb-info', onClick: () => { openOnly(null); setTenantModal('info'); } },
    { id: 'contact', label: 'Contact', icon: Smartphone, testid: 'kiosk-tb-contact', onClick: () => { openOnly(null); setTenantModal('contact'); } },
    ...(hasAdminAccess ? [{ id: 'power', label: 'Stroom', icon: Zap, testid: 'kiosk-tb-power', onClick: () => { openOnly(null); setTenantModal('power'); } }] : []),
    { id: 'close', label: 'Sluiten', icon: X, testid: 'kiosk-tb-close', onClick: () => { openOnly(null); setTenantModal(null); reset(); } },
  ];
  const showTopHead = step !== 'check' && step !== 'select' && !(isMobileViewport && step.startsWith('admin:'));
  useWhitePageBehindModal(767, step.startsWith('admin:'));
  useEffect(() => {
    const onNav = (e) => {
      if (e.detail === 'admin:facturen') {
        setShowInvoicesModal(false);
        setAdminPopup(null);
        setStep('admin:facturen');
      }
      else if (e.detail === 'admin:nfc') setNfcLink({ uid: '' });
      else if (e.detail === 'admin:appartementen' || e.detail === 'admin:huurders' || e.detail === 'admin:locaties' || e.detail === 'admin:contracten' || e.detail === 'admin:betalingen' || e.detail === 'admin:regelingen') {
        setAdminPopup(null);
        setStep(e.detail);
      }
      else if (typeof e.detail === 'string' && e.detail.startsWith('admin:inst-') && window.innerWidth >= 768
        && INSTELLINGEN_SECTIONS.some((s) => s.id === e.detail.slice(11))) {
        setAdminPopup(null);
        setStep(e.detail);
      }
      else if (typeof e.detail === 'string' && e.detail.startsWith('admin:')) setAdminPopup(e.detail.slice(6));
    };
    window.addEventListener('kiosk-nav', onNav);
    return () => window.removeEventListener('kiosk-nav', onNav);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onTourNavigate = (event) => {
      const route = event.detail || {};
      window.dispatchEvent(new CustomEvent('kiosk-close-menu'));
      setShowInvoicesModal(false);
      setAdminPopup(null);
      setNfcLink(null);
      setSearchOpen(false);
      setShowAddSheet(false);
      setShowAddTenant(false);
      setShowAddApartment(false);
      setShowAddLocation(false);
      setShowAddContract(false);
      setShowAddInvoice(false);
      setShowPaymentsViewer(false);
      setShowAddMaintenance(false);
      setPhoneScanOpen(false);
      setDepositFor(null);
      setContractFor(null);
      if (route.type === 'settings') {
        setStep('select');
        setAdminPopup(`inst-${route.id}`);
      } else if (route.type === 'page') {
        setStep('select');
        if (route.id === 'facturen') setStep('admin:facturen');
        else if (route.id === 'regelingen') setStep('admin:regelingen');
        else setAdminPopup(route.id);
      } else if (route.type === 'nfc') {
        setStep('select');
        setNfcLink({ uid: '' });
      } else if (route.type === 'cash') {
        setStep('kasgeld');
      } else if (route.type === 'search') {
        setStep('select');
        setSearchOpen(true);
      } else if (route.type === 'quick-sheet') {
        setStep('select');
        setShowAddSheet(true);
      } else if (route.type === 'quick-action') {
        setStep('select');
        window.setTimeout(() => handleSheetPick(route.key), 120);
      } else if (route.type === 'admin-menu') {
        setStep('select');
        window.dispatchEvent(new CustomEvent('kiosk-open-menu', { detail: 'admin' }));
      } else if (route.type === 'home') {
        setStep('select');
      }
    };
    window.addEventListener('kiosk-tour-navigate', onTourNavigate);
    return () => window.removeEventListener('kiosk-tour-navigate', onTourNavigate);
  }, []);
  const pickSearched = (a) => {
    setSearchOpen(false);
    prefetchOverview(a?.tenant_id);
    setOverview(null); setPaymentPayload(null); setPaymentResult(null);
    setApartment(a);
    setStep('overview');
  };
  // Kiosk-Facturen "Betalen" → open het financieel overzicht van die huurder.
  useEffect(() => {
    const onOpen = async (e) => {
      const tid = e.detail?.tenant_id;
      if (!tid) return;
      const d = await fetchKioskSelect().catch(() => null);
      const apt = (d?.apartments || []).find((x) => x.tenant_id === tid);
      if (apt) pickSearched(apt);
    };
    window.addEventListener('kiosk-open-tenant', onOpen);
    return () => window.removeEventListener('kiosk-open-tenant', onOpen);
  });
  const barRef = useRef(null);
  const headRef = useRef(null);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--kiosk-head-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showTopHead]);
  // Meet de echte hoogte van de desktop-menubalk zodat de witte kaarten er nooit tegenaan lopen.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--kiosk-bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--kiosk-bar-h'); };
  }, [showDesktopBar]);
  // Medewerker-PIN systeem is compleet uitgeschakeld: de kiosk-PIN (of
  // admin_token) is de enige authenticatie. Geen aparte emp-login sheet,
  // geen banner. Payments gaan direct als "approved" (backend accepteert
  // ontbrekende employee_id/employee_pin en houdt status=approved).

  // Service-worker update mag de kiosk alleen op het startscherm herladen.
  useEffect(() => {
    window.__kioskSafeToReload = step === 'select' && !apartment;
    return () => { window.__kioskSafeToReload = true; };
  }, [step, apartment]);

  return (
    <KioskThemeCtx.Provider value={themeCtx}>
    <ImpersonationBanner />
    <div className={`kiosk-fullscreen ${isWhite ? 'kiosk-white bg-white' : isGreen ? 'kiosk-green bg-[#F2F8F4]' : 'bg-orange-500'}${isUi ? ' kiosk-ui' : ''}`} data-testid="kiosk-root" data-theme={kioskTheme} style={isOrange ? { '--kiosk-orange-bg': 'url(/kiosk-orange-bg.png)', '--kiosk-orange-bg-portrait': 'url(/kiosk-orange-bg-portrait.png)' } : (isUi || kioskTheme === 'wave') ? undefined : isWhite ? { '--kiosk-white-bg': 'url(/kiosk-white-bg.jpg)', '--kiosk-white-bg-portrait': 'url(/kiosk-white-bg-portrait.jpg)' } : undefined}>
      {!user?.original_user_id && user?.role !== 'superadmin' && (
        <div
          className={`absolute inset-x-0 top-0 z-[120] ${supportActive ? 'block' : 'hidden'}`}
          style={{ height: 'calc(var(--kiosk-sat) + 2.75rem)', paddingTop: 'var(--kiosk-sat)' }}
        >
          <CompanySupportNotice kiosk onActiveChange={setSupportActive} />
        </div>
      )}
      <KioskLiveStatus isAdmin={hasAdminAccess} onHome={step === 'select'} />
      {manualOpen && <KioskManual onClose={() => setManualOpen(false)} />}
      {/* NFC SCAN TOAST — alleen op het apartement-picker scherm, en alleen
          zichtbaar wanneer er daadwerkelijk een scan-resultaat is (success of
          error). De statische "tap hint" is weggehaald op verzoek. */}
      {nfcLink && (
        <NfcLinkModal uid={nfcLink.uid} onClose={() => { setNfcLink(null); returnToMenu(); }}
          onLinked={(data) => {
            setNfcLink(null); menuOrigin = null;
            if (data?.apartment) {
              const apt = data.apartment;
              if (data.tenant?.name && !apt.tenant_name) apt.tenant_name = data.tenant.name;
              setApartment(apt);
              setStep('overview');
            }
          }} />
      )}
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
      {showTopHead && (
        <div ref={headRef} className="kiosk-head-wrap absolute inset-x-0 z-10" style={{ top: supportActive ? 'calc(var(--kiosk-sat) + 2.75rem)' : 0, padding: 'var(--kiosk-sat) 1.5vw 0' }}>
          <DesktopKioskHeader title={STEP_TITLES[step]} currentStep={step}
            currentLocationId={selectedLocationId} currentApartment={apartment}
            totalGroups={1} onAdmin={adminMode}
            tenant={apartment?.tenant_id && ['overview', 'pay', 'method', 'confirm', 'receipt'].includes(step)
              ? { name: apartment.tenant_name, photo: apartment.tenant_avatar_url || apartment.tenant_id_photo_url }
              : null}
            onSearch={step === 'kasgeld' || step === 'overview' ? () => setSearchOpen(true) : undefined} />
        </div>
      )}
      <AnimatePresence initial={false}>
        <motion.div key={step} variants={variants}
          initial="enter" animate="center" exit="exit"
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className={`absolute inset-0 overflow-y-auto overflow-x-hidden mobile-safe-bottom kiosk-content-scroll ${showTopHead ? 'kiosk-has-head' : ''} ${showDesktopBar ? '' : 'kiosk-no-bar'} ${showMobileKioskBar ? 'kiosk-mobile-has-bar' : ''}`}
          style={{ paddingTop: supportActive ? 'calc(var(--kiosk-sat) + 2.75rem)' : 'var(--kiosk-sat)', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          {step === 'check' && (
            <div className="h-full bg-orange-500 flex flex-col items-center justify-center gap-4 px-6 text-center">
              {demoLoginError ? (
                <>
                  <p className="max-w-md font-bold text-white" role="alert">{demoLoginError}</p>
                  <button type="button" onClick={() => window.location.assign('/')}
                    className="rounded-xl bg-white px-5 py-3 font-black text-[#0B1B3F]">Terug naar SuriRent</button>
                </>
              ) : <Loader2 className="w-10 h-10 text-white animate-spin" />}
            </div>
          )}
          {step === 'select' && (
            <ApartmentSelect key={apartmentsReloadKey}
              selectedLocationId={selectedLocationId}
              onLocationSelectionChange={setSelectedLocationId}
              onSelect={(a) => { prefetchOverview(a?.tenant_id); setApartment(a); setStep('overview'); }}
              onAdmin={hasAdminAccess ? adminMode : null}
              onAdminAll={adminMode}
              onKasgeld={() => setStep('kasgeld')}
              onSearch={() => setSearchOpen(true)}
              onExit={exit} />
          )}
          {step === 'admin:appartementen' && hasAdminAccess && (
            isMobileViewport
              ? <KioskAdminPopup id="appartementen" Shell={KioskModalShell} onClose={goBack} />
              : (
                <div className="h-full min-h-0 kiosk-admin-skin">
                  <KioskApartmentsPanel
                    onBack={goBack}
                    onNewApartment={() => setShowAddApartment(true)}
                    reloadKey={apartmentsReloadKey}
                    onChanged={() => { invalidateKioskSelect(); setApartmentsReloadKey((key) => key + 1); }}
                  />
                </div>
              )
          )}
          {step === 'admin:huurders' && hasAdminAccess && (
            isMobileViewport
              ? <KioskAdminPopup id="huurders" Shell={KioskModalShell} onClose={goBack} />
              : <KioskAdminPage id="huurders" kioskLayout onBack={goBack} />
          )}
          {step === 'admin:locaties' && hasAdminAccess && (
            isMobileViewport
              ? <KioskAdminPopup id="locaties" Shell={KioskModalShell} onClose={goBack} />
              : <KioskAdminPage id="locaties" kioskLayout onBack={goBack} />
          )}
          {step === 'admin:contracten' && hasAdminAccess && (
            isMobileViewport
              ? <KioskAdminPopup id="contracten" Shell={KioskModalShell} onClose={goBack} />
              : <KioskAdminPage id="contracten" kioskLayout onBack={goBack} />
          )}
          {step === 'admin:betalingen' && hasAdminAccess && (
            isMobileViewport
              ? <KioskAdminPopup id="betalingen" Shell={KioskModalShell} onClose={goBack} />
              : <KioskAdminPage id="betalingen" kioskLayout onBack={goBack} />
          )}
          {step === 'admin:regelingen' && hasAdminAccess && (
            isMobileViewport
              ? <KioskAdminPopup id="regelingen" Shell={KioskModalShell} onClose={goBack} />
              : <KioskAdminPage id="regelingen" kioskLayout onBack={goBack} />
          )}
          {step === 'admin:facturen' && hasAdminAccess && (
            isMobileViewport
              ? <KioskAdminPopup id="facturen" Shell={KioskModalShell} onClose={goBack} />
              : <KioskAdminPage id="facturen" kioskLayout onBack={goBack} />
          )}
          {step === 'admin:bon' && hasAdminAccess && (
            <Suspense fallback={<Loader2 className="w-8 h-8 text-white animate-spin mx-auto my-16" />}>
              <div className="h-full min-h-0 kiosk-admin-skin"><KioskBonPage onBack={goBack} /></div>
            </Suspense>
          )}
          {step.startsWith('admin:inst-') && hasAdminAccess && !isMobileViewport && (
            <Suspense fallback={<Loader2 className="w-8 h-8 text-white animate-spin mx-auto my-16" />}>
              <div className="h-full min-h-0 kiosk-admin-skin"><KioskSettingsPage id={step.slice(11)} onBack={goBack} /></div>
            </Suspense>
          )}
          {step.startsWith('admin:') && step !== 'admin:appartementen' && step !== 'admin:huurders' && step !== 'admin:locaties' && step !== 'admin:contracten' && step !== 'admin:betalingen' && step !== 'admin:regelingen' && step !== 'admin:facturen'
            && hasAdminAccess && KIOSK_ADMIN_PAGES[step.slice(6)] && (
            <KioskAdminPage id={step.slice(6)} onBack={goBack} />
          )}
          {step === 'kasgeld' && (
            isMobileViewport ? (
              <KioskModalShell title="Kasgeld" Icon={Wallet} testId="kiosk-popup-kasgeld" onClose={goBack}
                wide xwide tall fullscreenMobile
                footer={(
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('kiosk-kasgeld-new'))} data-testid="kiosk-popup-kasgeld-new"
                    className="w-full h-12 rounded-xl bg-[#FF5C00] text-white font-black text-sm inline-flex items-center justify-center gap-2">
                    <Wallet className="w-4 h-4" /> Nieuwe mutatie
                  </button>
                )}>
                <KioskFxCtx.Provider value><div className="kiosk-fx space-y-4"><KasgeldPanel embedded /></div></KioskFxCtx.Provider>
              </KioskModalShell>
            ) : <KasgeldPanel />
          )}
          {step === 'stroom' && hasAdminAccess && (
            <div className="h-full overflow-y-auto bg-orange-500 kiosk-admin-skin" data-testid="kiosk-stroom">
              <PowerControl kiosk orangeMode={isOrange} />
            </div>
          )}
          {step === 'overview' && apartment && (
            <TenantOverview key={apartment.id} apartment={apartment} onBack={reset}
              onPay={(d) => { setOverview(d); setStep('pay'); }} />
          )}
          {step === 'pay' && overview && (
            <PaySelect overview={overview} onBack={() => setStep('overview')}
              onConfirm={(p) => { setPaymentPayload(p); setStep('method'); }} />
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

      {/* Snelle aanmaak modals — beschikbaar vanaf de Kiosk desktop-bar.
          De mobile "+" FAB + Snel Toevoegen sheet zijn verwijderd (user
          request 2026-02-22 — werkten niet naar behoren op iOS PWA). */}
      {searchOpen && (
        <KioskTenantSearch onClose={() => setSearchOpen(false)} onPick={pickSearched} />
      )}
      {phoneScanOpen && <PhoneIdScan onClose={() => setPhoneScanOpen(false)} CameraModal={IdScanCameraModal} />}
      {scanToast && (
        <div data-testid="kiosk-id-scan-toast"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] rounded-2xl bg-emerald-600 text-white font-bold px-5 py-3 shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <ScanLine className="w-5 h-5" /> ID-scan ontvangen: {scanToast}
        </div>
      )}
      {showAddTenant && (
        <AddTenantModal
          key={tenantPrefill?.asset_id || 'manual'}
          prefill={tenantPrefill}
          onClose={() => { setShowAddTenant(false); setTenantPrefill(null); }}
          onSaved={(created) => {
            setShowAddTenant(false);
            setTenantPrefill(null);
            invalidateKioskSelect(); setApartmentsReloadKey((k) => k + 1);
            if (created?.apartment_id && created?.deposit_status === 'pending') setDepositFor(created);
          }} />
      )}
      {showAddApartment && (
        <AddApartmentModal
          onClose={() => setShowAddApartment(false)}
          onSaved={() => {
            setShowAddApartment(false);
            invalidateKioskSelect(); setApartmentsReloadKey((k) => k + 1);
          }} />
      )}
      <KioskAdminOnboarding enabled={hasAdminAccess}
        onWizardClosed={() => { invalidateKioskSelect(); setApartmentsReloadKey((k) => k + 1); }} />
      {showAddLocation && (
        <AddLocationModal
          onClose={() => setShowAddLocation(false)}
          onSaved={(created) => {
            setShowAddLocation(false);
            try { sessionStorage.setItem('kiosk_sel_loc', created.id); } catch { /* noop */ }
            invalidateKioskSelect(); setApartmentsReloadKey((k) => k + 1);
          }} />
      )}
      {showAddContract && (
        <AddContractModal
          onClose={() => setShowAddContract(false)}
          onSaved={() => setShowAddContract(false)} />
      )}
      {showAddInvoice && (
        <KioskInvoiceFormModal
          onClose={() => setShowAddInvoice(false)}
          onSaved={() => setShowAddInvoice(false)} />
      )}
      {showInvoicesModal && hasAdminAccess && (
        <KioskInvoicesModal Shell={KioskModalShell} onClose={closeInvoices}
          onPay={(tid) => { setShowInvoicesModal(false); window.dispatchEvent(new CustomEvent('kiosk-open-tenant', { detail: { tenant_id: tid } })); }} />
      )}
      {depositFor && (
        <KioskDepositModal Shell={KioskModalShell} tenant={depositFor}
          onClose={() => {
            if (depositFor._paid) setContractFor(depositFor.id);
            setDepositFor(null); invalidateKioskSelect(); setApartmentsReloadKey((k) => k + 1);
          }}
          onPaid={() => { depositFor._paid = true; if (apartment) setApartment({ ...apartment, _r: Date.now() }); }} />
      )}
      {contractFor && (
        <KioskContractSignModal Shell={KioskModalShell} tenantId={contractFor} onClose={() => setContractFor(null)} />
      )}
      {adminPopup && hasAdminAccess && (
        <KioskAdminPopup id={adminPopup} Shell={KioskModalShell} onClose={() => { setAdminPopup(null); returnToMenu(); }} />
      )}
      {showPaymentsViewer && (
        <PaymentsViewerModal
          onClose={() => setShowPaymentsViewer(false)} />
      )}
      {showAddMaintenance && (
        <AddMaintenanceModal
          initialApartmentId={apartment?.id || ''}
          onClose={() => setShowAddMaintenance(false)}
          onSaved={() => setShowAddMaintenance(false)} />
      )}

      {/* KioskAddSheet — opent via mobile FAB (hieronder) en dispatcht via
          handleSheetPick naar dezelfde setShowAdd*-states als de desktop-bar. */}
      {showAddSheet && (
        <KioskAddSheet
          onClose={() => setShowAddSheet(false)}
          onPick={handleSheetPick}
          hasAdminAccess={hasAdminAccess}
        />
      )}

      {/* Mobile "+" FAB — kiosk-medewerker opent dezelfde quick-add bottom-
          sheet die normaal via de desktop-balk bereikbaar is (Huurder, Appt.,
          Locatie, Contract, Factuur, Betalingen, Onderhoud). Zichtbaar
          op mobiel in het selectiescherm en de beheerpagina's. Vorige
          iOS-PWA viewport-drift bug is opgelost door de FAB via createPortal
          direct onder document.body te mounten met safe-area padding; het
          `KioskAddSheet` opent fullscreen zodat het keyboard-shift probleem
          niet meer speelt. */}
      {showMobileKioskBar && !keyboardOpen && <div className={`${isUi ? 'md:hidden h-16' : 'hidden min-[390px]:block md:hidden h-14'}`} aria-hidden="true" />}
      {showMobileKioskBar && !keyboardOpen && !showAddSheet && isUi && createPortal((
        <nav data-testid="kiosk-mobile-bottom-bar" className="kiosk-ui-mobile-nav md:hidden fixed bottom-0 inset-x-0 z-[109] bg-white rounded-t-[26px] shadow-[0_-10px_30px_-14px_rgba(15,23,42,0.3)] px-2 pt-2"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}>
          <div className="grid grid-cols-5 items-stretch">
            {[
              { id: 'back', label: 'Terug', Icon: Home, on: step === 'select', fn: () => { if (canBack) goBack(); } },
              { id: 'apt', label: 'Appartementen', Icon: Building2, fn: () => (hasAdminAccess ? setStep('admin:appartementen') : setShowAddApartment(true)) },
              { id: 'ten', label: 'Huurders', Icon: Users, fn: () => (hasAdminAccess ? setStep('admin:huurders') : setShowAddTenant(true)) },
              { id: 'inv', label: 'Facturen', Icon: FileSignature, fn: () => (hasAdminAccess ? setStep('admin:facturen') : setShowAddInvoice(true)) },
              { id: 'more', label: 'Meer', Icon: MoreHorizontal, fn: () => setShowAddSheet(true) },
            ].map(({ id, label, Icon, on, fn }) => (
              <button key={id} type="button" onClick={fn} data-testid={`kiosk-ui-bar-${id}`}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 mx-0.5 min-w-0 active:scale-95 transition ${on ? 'bg-gradient-to-b from-[#FF8A2B] to-[#FF5C00] text-white shadow-md' : 'text-[#1B2A5C]'}`}>
                <Icon className="w-6 h-6" strokeWidth={2} />
                <span className="text-[10.5px] font-semibold leading-tight whitespace-nowrap">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      ), document.body)}
      {showMobileKioskBar && !isUi && !keyboardOpen && !showAddSheet && !(showAddTenant || showAddApartment || showAddLocation || showAddContract || showAddInvoice || showPaymentsViewer || showAddMaintenance || nfcLink) && createPortal((
        <>
          <button
            type="button"
            onClick={() => setShowAddSheet(true)}
            data-testid="kiosk-mobile-fab"
            aria-label="Snelle acties"
            className={`md:hidden min-[390px]:hidden fixed right-4 z-[109] w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition ${isGreen ? 'bg-[#00845D] text-white shadow-[0_12px_28px_-8px_rgba(0,132,93,0.4)]' : isWhite ? 'bg-[#FF5C00] hover:bg-[#E05200] text-white shadow-[0_12px_28px_-8px_rgba(255,92,0,0.65)]' : 'bg-white text-[#FF5C00] shadow-[0_12px_28px_-8px_rgba(0,0,0,0.45)]'}`}
            style={{ bottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
          >
            <Plus className="w-7 h-7" strokeWidth={2.8} />
          </button>
          {/* Grote telefoons (≥390px): onderste menubalk met + in het midden. */}
          <nav data-testid="kiosk-mobile-bottom-bar"
            className={`hidden min-[390px]:flex md:hidden fixed bottom-0 left-0 right-0 z-[109] h-10 items-center justify-around px-1 border-t ${isWhite ? 'kiosk-white-nav ' : ''}${isGreen || isWhite ? 'bg-white border-slate-200 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.15)]' : 'bg-[#FF6B1A] border-[#E04E00]/40 shadow-[0_-10px_30px_-14px_rgba(120,30,0,0.45)]'}`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', boxSizing: 'content-box' }}>
            <button type="button" onClick={goBack} disabled={!canBack} data-testid="kiosk-mobile-bar-back"
              className={`flex-1 h-full flex flex-col items-center justify-center gap-px active:scale-95 transition-[transform,opacity] disabled:opacity-35 ${isGreen || isWhite ? 'text-slate-700' : 'text-white'}`}>
              <ChevronLeft className="w-6 h-6" strokeWidth={2.4} />
              <span className="text-xs font-bold leading-none">Terug</span>
            </button>
            <button type="button" onClick={() => setPhoneScanOpen(true)} data-testid="kiosk-mobile-bar-scanid"
              className={`flex-1 h-full flex flex-col items-center justify-center gap-px active:scale-95 transition-transform ${isGreen || isWhite ? 'text-slate-700' : 'text-white'}`}>
              <ScanLine className="w-6 h-6" strokeWidth={2.4} />
              <span className="text-xs font-bold leading-none">Scan ID</span>
            </button>
            <button type="button" onClick={() => setShowAddSheet(true)} data-testid="kiosk-mobile-bar-plus" aria-label="Snelle acties"
              className={`-mt-5 w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform ring-4 ${isGreen ? 'ring-white bg-[#00845D] text-white shadow-[0_12px_28px_-8px_rgba(0,132,93,0.4)]' : isWhite ? 'ring-white bg-[#FF5C00] hover:bg-[#E05200] text-white shadow-[0_12px_28px_-8px_rgba(255,92,0,0.65)]' : 'ring-[#FF6B1A] bg-white text-[#FF5C00] shadow-[0_12px_28px_-8px_rgba(0,0,0,0.45)]'}`}>
              <Plus className="w-7 h-7" strokeWidth={2.8} />
            </button>
            <button type="button" onClick={() => setStep('kasgeld')} data-testid="kiosk-mobile-bar-kasgeld"
              className={`flex-1 h-full flex flex-col items-center justify-center gap-px active:scale-95 transition-transform ${isGreen || isWhite ? 'text-slate-700' : 'text-white'}`}>
              <Database className="w-6 h-6" strokeWidth={2.4} />
              <span className="text-xs font-bold leading-none">Kasgeld</span>
            </button>
            <button type="button" onClick={() => goHist(1)} disabled={!canFwd} data-testid="kiosk-mobile-bar-next"
              className={`flex-1 h-full flex flex-col items-center justify-center gap-px active:scale-95 transition-[transform,opacity] disabled:opacity-35 ${isGreen || isWhite ? 'text-slate-700' : 'text-white'}`}>
              <ChevronRight className="w-6 h-6" strokeWidth={2.4} />
              <span className="text-xs font-bold leading-none">Volgende</span>
            </button>
          </nav>
        </>
      ), document.body)}

      {/* Desktop bottom bar — via createPortal in document.body geplaatst.
          Fullscreen modals use a higher layer so their controls stay clear. */}
      {showDesktopBar && createPortal((
        <nav ref={barRef} className={`hidden md:block fixed bottom-0 left-0 right-0 z-[110] border-t ${isWhite ? 'kiosk-white-nav ' : ''}${isGreen || isWhite ? 'bg-white border-slate-200 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.15)]' : 'bg-[#FF6B1A] border-[#E04E00]/40 shadow-[0_-10px_30px_-14px_rgba(120,30,0,0.45)]'}`}
          data-testid="kiosk-bottom-bar" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className={`flex items-stretch gap-1 px-2 py-2${isUi ? ' kiosk-ui-bar' : ''}`}>
            {isUi ? (
              <button type="button" onClick={() => { if (canBack) goBack(); }} data-testid="kiosk-ui-bar-back" data-active="true"
                className="shrink-0 w-[8.5vw] min-w-[72px] flex flex-col items-center justify-center gap-1.5 rounded-2xl py-2.5 px-1 bg-gradient-to-b from-[#FF8A2B] to-[#FF5C00] text-white shadow-md active:scale-95">
                <LayoutGrid className="w-7 h-7" strokeWidth={2} />
                <span className="text-[11px] lg:text-sm font-bold leading-tight">Terug</span>
              </button>
            ) : <KioskHistBtn dir="back" disabled={!canBack} onClick={goBack} white={isWhite} green={isGreen} />}
            {(tenantBar ? tenantBarItems : [
              { id: 'locations', label: 'Locaties', icon: MapPin, testid: 'kiosk-add-location-btn-desktop', onClick: () => openOnly('add-location') },
              { id: 'apartments', label: 'Appartementen', icon: isUi ? Building2 : Home, testid: 'kiosk-add-apartment-btn-desktop', onClick: () => openOnly('add-apartment') },
              { id: 'tenants', label: 'Huurders', icon: Users, testid: 'kiosk-add-tenant-btn-desktop', onClick: () => openOnly('add-tenant') },
              { id: 'invoices', label: 'Facturen', icon: FileSignature, testid: 'kiosk-add-invoice-btn-desktop', onClick: () => openOnly('add-invoice') },
              { id: 'maintenance', label: 'Onderhoud', icon: Wrench, testid: 'kiosk-add-maintenance-btn-desktop', onClick: () => openOnly('add-maintenance') },
              { id: 'kasgeld', label: 'Kasgeld', icon: Database, testid: 'kiosk-kasgeld-btn-desktop', onClick: () => { openOnly(null); setStep('kasgeld'); } },
              ...(hasAdminAccess ? [{ id: 'stroom', label: 'Stroom', icon: Zap, testid: 'kiosk-stroom-btn-desktop', onClick: () => { openOnly(null); setStep('stroom'); } }] : []),
              { id: 'logout', label: 'Uitloggen', icon: LogOut, testid: 'kiosk-lock-btn-desktop', onClick: exit },
            ]).map(({ id, label, icon: Icon, testid, onClick }) => {
              const active = (id === 'dashboard' && step === 'select') || (id === 'kasgeld' && step === 'kasgeld') || (id === 'stroom' && step === 'stroom')
                || (tenantBar && ((id === 'overview' && step === 'overview' && !tenantModal) || (id === 'pay' && step !== 'overview') || (id === tenantModal)));
              return (
                <Fragment key={id}>
                {isUi && <span className="self-center h-10 w-px bg-slate-300/80 shrink-0" aria-hidden="true" />}
                <button type="button" onClick={onClick} data-testid={testid} data-active={active ? 'true' : undefined}
                  className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1.5 rounded-xl py-2.5 px-1 transition-colors active:scale-95 ${active ? (isGreen ? 'bg-[#00845D] text-white shadow-md' : isWhite ? 'bg-[#FF5C00] text-white shadow-md' : 'bg-white text-[#F26A12] shadow-md') : (isGreen ? 'text-slate-600 bg-[#F1F8F4] hover:bg-emerald-50 hover:text-emerald-800' : isWhite ? 'text-slate-600 bg-slate-50 hover:bg-orange-50 hover:text-[#F26A12]' : 'text-white bg-white/[0.06] hover:bg-white/15')}`}>
                  <Icon className="w-7 h-7" strokeWidth={1.8} />
                  <span className="text-[10px] lg:text-[11px] xl:text-sm font-semibold leading-tight text-center max-w-full truncate">{label}</span>
                </button>
                </Fragment>
              );
            })}
            {!isUi && <KioskHistBtn dir="next" disabled={!canFwd} onClick={() => goHist(1)} white={isWhite} green={isGreen} />}
          </div>
        </nav>
      ), document.body)}
      {tenantModal && tenantModal !== 'power' && apartment && (
        <TenantInfoModal apartment={apartment} mode={tenantModal} onClose={() => setTenantModal(null)} />
      )}
      {tenantModal === 'power' && apartment && (
        <ApartmentPower apartmentId={apartment.id} onClose={() => setTenantModal(null)} orangeMode={isOrange} />
      )}
    </div>
    </KioskThemeCtx.Provider>
  );
}
