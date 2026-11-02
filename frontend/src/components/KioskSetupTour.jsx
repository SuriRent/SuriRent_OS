import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, RotateCw, X } from 'lucide-react';
import { api } from '../lib/api';

const selectors = {
  settingsOpen: (mobile) => mobile ? '[data-testid="kiosk-admin-menu-btn"]' : '[data-testid="kiosk-header-settings"]',
  settingsSection: (mobile) => mobile
    ? '[data-testid="kiosk-admin-menu-instellingen"]'
    : '[data-testid="kiosk-settings-menu-bedrijf"]',
  settingsClose: (mobile) => mobile
    ? '[data-testid="kiosk-admin-page-back"]'
    : '[data-testid="kiosk-popup-inst-bedrijf-close"]',
  adminMenu: '[data-testid="kiosk-admin-menu-btn"]',
  locationsMenu: '[data-testid="kiosk-admin-menu-locaties"]',
  locationNew: '[data-testid="kiosk-popup-locaties-new"]',
  locationPopupClose: '[data-testid="kiosk-popup-locaties-close"]',
  apartmentsMenu: '[data-testid="kiosk-admin-menu-appartementen"]',
  apartmentNew: '[data-testid="kiosk-popup-appartementen-new"]',
  apartmentPopupClose: '[data-testid="kiosk-popup-appartementen-close"]',
  tenantsMenu: '[data-testid="kiosk-admin-menu-huurders"]',
  tenantNew: '[data-testid="kiosk-popup-huurders-new"]',
};

const TOUR_STEPS = {
  settingsOpen: {
    group: 1, title: 'Open Instellingen',
    text: (mobile) => mobile
      ? 'Tik op Beheer om het beheermenu te openen. Daarna wijzen we Bedrijfsgegevens aan.'
      : 'Tik op het tandwiel Instellingen rechtsboven.',
    target: (mobile) => selectors.settingsOpen(mobile), next: 'settingsSection',
  },
  settingsSection: {
    group: 1, title: 'Bedrijfsgegevens',
    text: (mobile) => mobile
      ? 'Tik in het beheermenu op Instellingen om Bedrijfsgegevens te openen.'
      : 'Kies Bedrijfsgegevens in het instellingenmenu.',
    target: (mobile) => selectors.settingsSection(mobile), next: 'businessSave',
  },
  businessSave: {
    group: 1, title: 'Vul de bedrijfsgegevens in',
    text: () => 'Vul de bedrijfsnaam en contactgegevens in en tik op Opslaan. Je kunt ook de overige gegevens aanvullen.',
    target: '[data-testid="business-info-save"]', next: 'awaiting-profile',
  },
  settingsClose: {
    group: 1, title: 'Sluit Instellingen',
    text: (mobile) => mobile ? 'Tik op Terug om Instellingen te sluiten.' : 'Tik op het kruisje om Instellingen te sluiten.',
    target: (mobile) => selectors.settingsClose(mobile), next: 'settingsMenuClose', nextMobile: 'nextSetupStep',
  },
  settingsMenuClose: {
    group: 1, title: 'Sluit het instellingenmenu',
    text: () => 'Sluit ook dit menu. Daarna openen we Locaties.',
    target: '[data-testid="kiosk-settings-menu-close"]', next: 'nextSetupStep',
  },
  openLocationsMenu: {
    group: 2, title: 'Open Beheer',
    text: () => 'Open het beheermenu om Locaties te kiezen.',
    target: selectors.adminMenu, next: 'locationsMenu',
  },
  locationsMenu: {
    group: 2, title: 'Kies Locaties',
    text: () => 'Tik op Locaties.',
    target: selectors.locationsMenu, next: 'locationNew',
  },
  locationNew: {
    group: 2, title: 'Maak een locatie aan',
    text: () => 'Tik op Nieuwe locatie. Vul in het formulier de naam in en tik op Opslaan.',
    target: selectors.locationNew, next: 'awaiting-location',
  },
  locationPopupClose: {
    group: 2, title: 'Sluit Locaties',
    text: () => 'Sluit dit venster. Het beheermenu opent weer, zodat je Appartementen kunt kiezen.',
    target: selectors.locationPopupClose, next: 'apartmentsMenu',
  },
  openApartmentsMenu: {
    group: 3, title: 'Open Beheer',
    text: () => 'Open het beheermenu om Appartementen te kiezen.',
    target: selectors.adminMenu, next: 'apartmentsMenu',
  },
  apartmentsMenu: {
    group: 3, title: 'Kies Appartementen',
    text: () => 'Tik op Appartementen.',
    target: selectors.apartmentsMenu, next: 'apartmentNew',
  },
  apartmentNew: {
    group: 3, title: 'Maak een appartement aan',
    text: () => 'Tik op Nieuw appartement. Vul het nummer en de huur in, kies de locatie en tik op Opslaan.',
    target: selectors.apartmentNew, next: 'awaiting-apartment',
  },
  apartmentPopupClose: {
    group: 3, title: 'Sluit Appartementen',
    text: () => 'Sluit dit venster. Kies daarna Huurders in het beheermenu.',
    target: selectors.apartmentPopupClose, next: 'tenantsMenu',
  },
  openTenantsMenu: {
    group: 4, title: 'Open Beheer',
    text: () => 'Open het beheermenu om Huurders te kiezen.',
    target: selectors.adminMenu, next: 'tenantsMenu',
  },
  tenantsMenu: {
    group: 4, title: 'Kies Huurders',
    text: () => 'Tik op Huurders.',
    target: selectors.tenantsMenu, next: 'tenantNew',
  },
  tenantNew: {
    group: 4, title: 'Maak een huurder aan',
    text: () => 'Tik op Nieuwe huurder. Vul de naam in, kies het appartement en tik op Opslaan.',
    target: selectors.tenantNew, next: 'awaiting-tenant',
  },
};

const SAVE_STAGE = {
  'awaiting-profile': { key: 'profile', next: 'settingsClose' },
  'awaiting-location': { key: 'locations', next: 'locationPopupClose' },
  'awaiting-apartment': { key: 'apartment', next: 'apartmentPopupClose' },
  'awaiting-tenant': { key: 'tenant', next: 'complete' },
};

const STAGE_GROUPS = {
  settingsOpen: 1, settingsSection: 1, businessSave: 1, 'awaiting-profile': 1, settingsClose: 1, settingsMenuClose: 1,
  openLocationsMenu: 2, locationsMenu: 2, locationNew: 2, 'awaiting-location': 2, locationPopupClose: 2,
  openApartmentsMenu: 3, apartmentsMenu: 3, apartmentNew: 3, 'awaiting-apartment': 3, apartmentPopupClose: 3,
  openTenantsMenu: 4, tenantsMenu: 4, tenantNew: 4, 'awaiting-tenant': 4,
};

function isDone(status, key) {
  return !!status?.steps?.find((step) => step.id === key)?.done;
}

function nextSetupStage(status) {
  if (!isDone(status, 'locations')) return 'openLocationsMenu';
  if (!isDone(status, 'apartment')) return 'openApartmentsMenu';
  if (!isDone(status, 'tenant')) return 'openTenantsMenu';
  return 'complete';
}

function initialStage(status, savedStage) {
  if (status?.required_complete) return 'complete';
  if (savedStage === 'awaiting-profile') return isDone(status, 'profile') ? 'settingsClose' : 'businessSave';
  if (savedStage === 'awaiting-location') return isDone(status, 'locations') ? 'locationPopupClose' : 'locationNew';
  if (savedStage === 'awaiting-apartment') return isDone(status, 'apartment') ? 'apartmentPopupClose' : 'apartmentNew';
  if (savedStage === 'awaiting-tenant') return isDone(status, 'tenant') ? 'complete' : 'tenantNew';
  if (savedStage && (Object.prototype.hasOwnProperty.call(TOUR_STEPS, savedStage)
    || Object.prototype.hasOwnProperty.call(SAVE_STAGE, savedStage))) {
    if (isDone(status, 'profile') && ['settingsOpen', 'settingsSection', 'businessSave', 'awaiting-profile'].includes(savedStage)) {
      return 'settingsClose';
    }
    if (isDone(status, 'locations') && savedStage === 'awaiting-location') return 'locationPopupClose';
    if (isDone(status, 'locations') && savedStage === 'locationPopupClose') return savedStage;
    if (isDone(status, 'apartment') && savedStage === 'awaiting-apartment') return 'apartmentPopupClose';
    if (isDone(status, 'apartment') && savedStage === 'apartmentPopupClose') return savedStage;
    if (isDone(status, 'tenant') && savedStage === 'awaiting-tenant') return 'complete';
    const savedGroup = STAGE_GROUPS[savedStage];
    if (isDone(status, 'locations') && savedGroup === 2) return nextSetupStage(status);
    if (isDone(status, 'apartment') && savedGroup === 3) return nextSetupStage(status);
    if (isDone(status, 'tenant') && savedGroup === 4) return 'complete';
    return savedStage;
  }
  if (!isDone(status, 'profile')) return 'settingsOpen';
  return nextSetupStage(status);
}

function isMobileViewport() {
  return window.matchMedia?.('(max-width: 767px)').matches ?? window.innerWidth < 768;
}

export default function KioskSetupTour({ enabled, companyId, onComplete }) {
  const [initialized, setInitialized] = useState(false);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stage, setStageState] = useState('');
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mobile, setMobile] = useState(isMobileViewport);
  const [rect, setRect] = useState(null);
  const targetRef = useRef(null);
  const key = `kiosk_setup_tour_stage_${companyId}`;

  const setStage = useCallback((next) => {
    setStageState(next);
    try { localStorage.setItem(key, next); } catch { /* Tour remains usable without local storage. */ }
  }, [key]);

  const loadStatus = useCallback(async () => {
    setLoadError('');
    try {
      const { data } = await api.get('/companies/me/setup-status');
      setStatus(data);
      return data;
    } catch (error) {
      setLoadError(error?.response?.data?.detail || error?.message || 'Voortgang kon niet worden geladen.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !companyId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(`kiosk_setup_tour_completed_${companyId}`) === '1') {
          setInitialized(true);
          return;
        }
      } catch { /* Continue without persisted completion state. */ }
      const currentStatus = await loadStatus();
      if (cancelled) return;
      if (!currentStatus) {
        setInitialized(true);
        setVisible(true);
        return;
      }
      setInitialized(true);
      if (currentStatus.required_complete) return;
      let savedStage = null;
      try { savedStage = localStorage.getItem(key); } catch { /* Resume from server status instead. */ }
      setStage(initialStage(currentStatus, savedStage));
      setVisible(true);
    })();
    return () => { cancelled = true; };
  }, [enabled, companyId, key, loadStatus, setStage]);

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 767px)');
    const update = () => setMobile(isMobileViewport());
    if (!query) {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (stage === 'complete' && companyId) {
      try {
        localStorage.setItem(`kiosk_setup_tour_completed_${companyId}`, '1');
        localStorage.removeItem(key);
      } catch { /* Completion still works for this session. */ }
    }
  }, [stage, companyId, key]);

  const step = TOUR_STEPS[stage];
  const selector = useMemo(() => {
    if (!step) return null;
    return typeof step.target === 'function' ? step.target(mobile) : step.target;
  }, [step, mobile]);

  useEffect(() => {
    if (!visible || !selector) {
      setRect(null);
      targetRef.current = null;
      return undefined;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = document.querySelector(selector);
        if (element && targetRef.current !== element) {
          targetRef.current = element;
          const bounds = element.getBoundingClientRect();
          if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
            element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
        if (!element) {
          setRect(null);
          return;
        }
        const bounds = element.getBoundingClientRect();
        const next = {
          top: bounds.top - 5, left: bounds.left - 5,
          width: bounds.width + 10, height: bounds.height + 10,
        };
        setRect((current) => current && Math.abs(current.top - next.top) < 1
          && Math.abs(current.left - next.left) < 1
          && Math.abs(current.width - next.width) < 1
          && Math.abs(current.height - next.height) < 1 ? current : next);
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible, selector, stage]);

  useEffect(() => {
    if (!visible) return undefined;
    const onClick = (event) => {
      if (!selector) return;
      const element = event.target?.closest?.(selector);
      if (!element) return;
      if (step?.nextMobile) {
        setStage(mobile ? nextSetupStage(status) : step.next);
      } else if (step?.next === 'nextSetupStep') {
        setStage(nextSetupStage(status));
      } else if (step?.next) {
        setStage(step.next);
      }
    };
    const onSaved = (event) => {
      const pending = SAVE_STAGE[stage];
      if (!pending || event.detail !== pending.key) return;
      setStage(pending.next);
    };
    const onProfileInput = (event) => {
      if (stage !== 'businessSave' || !event.target?.closest?.('[data-testid="business-info-page"]')) return;
      setStage('awaiting-profile');
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onProfileInput, true);
    window.addEventListener('kiosk-setup-saved', onSaved);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onProfileInput, true);
      window.removeEventListener('kiosk-setup-saved', onSaved);
    };
  }, [visible, step, selector, setStage, status, stage, mobile]);

  const pause = () => {
    setVisible(false);
    setPaused(true);
  };
  const finish = () => {
    setVisible(false);
    setPaused(false);
    onComplete?.();
  };
  const retryLoad = async () => {
    const currentStatus = await loadStatus();
    if (!currentStatus) return;
    setInitialized(true);
    if (currentStatus.required_complete) {
      setVisible(false);
      return;
    }
    setStage(initialStage(currentStatus, stage || null));
  };

  if (!enabled || !companyId || !initialized) return null;
  if (!visible) {
    return paused ? createPortal((
      <button type="button" onClick={() => { setPaused(false); setVisible(true); }}
        className="fixed bottom-24 right-4 z-[180] inline-flex h-11 items-center gap-2 rounded-full bg-[#FF5C00] px-4 text-sm font-bold text-white shadow-xl"
        data-testid="kiosk-setup-tour-resume">
        <RotateCw className="h-4 w-4" /> Rondleiding hervatten
      </button>
    ), document.body) : null;
  }

  const group = stage === 'complete' ? 4 : (STAGE_GROUPS[stage] || 1);
  const message = step?.text?.(mobile) || step?.text;
  const panelAtTop = rect ? rect.top + rect.height / 2 > window.innerHeight / 2 : true;
  const profileSaveOnly = stage === 'businessSave' || stage === 'awaiting-profile';

  return createPortal((
    <div className="fixed inset-0 z-[180] pointer-events-none" data-testid="kiosk-setup-tour">
      {rect && (
        <>
          <div className={`fixed rounded-2xl border-2 border-orange-400 pointer-events-none ${profileSaveOnly ? 'animate-pulse' : 'shadow-[0_0_0_9999px_rgba(15,23,42,0.68)] animate-pulse'}`}
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
          <div className="fixed text-3xl drop-shadow-md animate-bounce pointer-events-none"
            style={{ top: Math.max(4, rect.top - 34), left: Math.max(4, rect.left + rect.width / 2 - 12) }}>👇</div>
        </>
      )}
      <section className={`fixed pointer-events-auto w-[calc(100vw-24px)] max-w-[360px] rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200 ${profileSaveOnly ? 'hidden' : ''}`}
        style={{
          width: 'calc(100vw - 24px)',
          left: '50%',
          transform: 'translateX(-50%)',
          top: panelAtTop ? 12 : undefined,
          bottom: panelAtTop ? undefined : 12,
          maxHeight: 'min(48dvh, 360px)',
          overflowY: 'auto',
        }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#FF5C00]">
            {stage === 'complete' ? 'Rondleiding afgerond' : `Stap ${group} van 4`}
          </p>
          <button type="button" onClick={pause} aria-label="Rondleiding later vervolgen"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        {loadError ? (
          <>
            <h2 className="text-lg font-black text-slate-900">Rondleiding niet beschikbaar</h2>
            <p className="mt-1 text-sm text-slate-600">{loadError}</p>
            <button type="button" onClick={retryLoad}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-4 text-sm font-bold text-white">
              <RotateCw className="h-4 w-4" /> Opnieuw proberen
            </button>
          </>
        ) : stage === 'complete' ? (
          <>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Check className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-black text-slate-900">Je Kiosk is klaar voor gebruik</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Bedrijfsgegevens, locatie, appartement en huurder zijn ingesteld. Rond een eventuele borgstap af als die wordt getoond.
            </p>
            <button type="button" onClick={finish}
              className="mt-4 h-11 w-full rounded-xl bg-[#FF5C00] px-4 text-sm font-black text-white">
              Afronden
            </button>
          </>
        ) : SAVE_STAGE[stage] ? null : (
          <>
            <h2 className="text-lg font-black text-slate-900">{step?.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{message}</p>
            {!rect && <p className="mt-3 text-xs font-semibold text-amber-700">De knop wordt gezocht. Open zo nodig het aangegeven menu.</p>}
            <p className="mt-3 text-[11px] font-semibold text-slate-400">De volgende stap verschijnt nadat je op de aangewezen knop tikt.</p>
            <button type="button" onClick={pause}
              className="mt-4 h-10 w-full rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-600 hover:bg-slate-200">
              Later verdergaan
            </button>
          </>
        )}
      </section>
    </div>
  ), document.body);
}
