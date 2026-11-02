import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, RotateCw, X } from 'lucide-react';
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
  locationSave: '[data-testid="loc-form-save"]',
  locationPopupClose: '[data-testid="kiosk-popup-locaties-close"]',
  apartmentsMenu: '[data-testid="kiosk-admin-menu-appartementen"]',
  apartmentNew: '[data-testid="kiosk-popup-appartementen-new"]',
  apartmentLocation: '[data-testid="apt-location"]',
  apartmentSave: '[data-testid="apt-save"]',
  apartmentPopupClose: '[data-testid="kiosk-popup-appartementen-close"]',
  tenantsMenu: '[data-testid="kiosk-admin-menu-huurders"]',
  tenantNew: '[data-testid="kiosk-popup-huurders-new"]',
  tenantApartment: '[data-testid="tenant-apartment"]',
  tenantSave: '[data-testid="tenant-save"]',
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
    target: '[data-testid="business-info-save"]', verify: 'profile',
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
    text: () => 'Tik op Nieuwe locatie en vul de naam in. Het adres is optioneel.',
    target: selectors.locationNew, next: 'locationSave',
  },
  locationSave: {
    group: 2, title: 'Sla de locatie op',
    text: () => 'Tik op Opslaan. We gaan pas verder wanneer de locatie is aangemaakt.',
    target: selectors.locationSave, verify: 'locations',
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
    text: () => 'Tik op Nieuw appartement en vul de gegevens in.',
    target: selectors.apartmentNew, next: 'apartmentLocation',
  },
  apartmentLocation: {
    group: 3, title: 'Koppel het appartement aan een locatie',
    text: () => 'Kies hier de locatie die je zojuist hebt aangemaakt.',
    target: selectors.apartmentLocation, changeTo: 'apartmentSave',
  },
  apartmentSave: {
    group: 3, title: 'Sla het appartement op',
    text: () => 'Tik op Opslaan om het appartement aan te maken.',
    target: selectors.apartmentSave, verify: 'apartment',
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
    text: () => 'Tik op Nieuwe huurder en vul minimaal de naam in.',
    target: selectors.tenantNew, next: 'tenantApartment',
  },
  tenantApartment: {
    group: 4, title: 'Koppel de huurder',
    text: () => 'Kies bij Appartement het appartement dat je net hebt aangemaakt.',
    target: selectors.tenantApartment, changeTo: 'tenantSave',
  },
  tenantSave: {
    group: 4, title: 'Sla de huurder op',
    text: () => 'Tik op Opslaan om de huurder aan het appartement te koppelen.',
    target: selectors.tenantSave, verify: 'tenant',
  },
};

const VERIFY_STAGE = {
  'verify-profile': { key: 'profile', next: 'settingsClose' },
  'verify-locations': { key: 'locations', next: 'locationPopupClose' },
  'verify-apartment': { key: 'apartment', next: 'apartmentPopupClose' },
  'verify-tenant': { key: 'tenant', next: 'complete' },
};

const STAGE_GROUPS = {
  settingsOpen: 1, settingsSection: 1, businessSave: 1, 'verify-profile': 1, settingsClose: 1, settingsMenuClose: 1,
  openLocationsMenu: 2, locationsMenu: 2, locationNew: 2, locationSave: 2, 'verify-locations': 2, locationPopupClose: 2,
  openApartmentsMenu: 3, apartmentsMenu: 3, apartmentNew: 3, apartmentLocation: 3, apartmentSave: 3,
  'verify-apartment': 3, apartmentPopupClose: 3,
  openTenantsMenu: 4, tenantsMenu: 4, tenantNew: 4, tenantApartment: 4, tenantSave: 4, 'verify-tenant': 4,
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
  if (savedStage && (Object.prototype.hasOwnProperty.call(TOUR_STEPS, savedStage)
    || Object.prototype.hasOwnProperty.call(VERIFY_STAGE, savedStage))) {
    if (isDone(status, 'profile') && ['settingsOpen', 'settingsSection', 'businessSave', 'verify-profile'].includes(savedStage)) {
      return 'settingsClose';
    }
    if (isDone(status, 'locations') && savedStage === 'verify-locations') return 'locationPopupClose';
    if (isDone(status, 'locations') && savedStage === 'locationPopupClose') return savedStage;
    if (isDone(status, 'apartment') && savedStage === 'verify-apartment') return 'apartmentPopupClose';
    if (isDone(status, 'apartment') && savedStage === 'apartmentPopupClose') return savedStage;
    const savedGroup = STAGE_GROUPS[savedStage] || STAGE_GROUPS[savedStage.replace('verify-', '')];
    if (isDone(status, 'locations') && savedGroup === 2) return nextSetupStage(status);
    if (isDone(status, 'apartment') && savedGroup === 3) return nextSetupStage(status);
    if (isDone(status, 'tenant') && savedGroup === 4) return 'complete';
    return savedStage;
  }
  if (!isDone(status, 'profile')) return 'settingsOpen';
  return nextSetupStage(status);
}

function matchesVerification(status, key) {
  if (key === 'profile') return isDone(status, 'profile');
  if (key === 'locations') return isDone(status, 'locations');
  if (key === 'apartment') return isDone(status, 'apartment');
  if (key === 'tenant') return isDone(status, 'tenant');
  return false;
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
  const [verifyError, setVerifyError] = useState('');
  const [verifyTimedOut, setVerifyTimedOut] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
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
    if (!visible || !step) return undefined;
    const onClick = (event) => {
      const element = event.target?.closest?.(selector);
      if (!element) return;
      if (step.verify) {
        setVerifyError('');
        setVerifyTimedOut(false);
        setStage(`verify-${step.verify}`);
      } else if (step.nextMobile) {
        setStage(mobile ? nextSetupStage(status) : step.next);
      } else if (step.next === 'nextSetupStep') {
        setStage(nextSetupStage(status));
      } else if (step.next) {
        setStage(step.next);
      }
    };
    const onChange = (event) => {
      const element = event.target?.closest?.(selector);
      if (element && element.value && step.changeTo) setStage(step.changeTo);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
    };
  }, [visible, step, selector, setStage, status]);

  const verification = VERIFY_STAGE[stage];
  useEffect(() => {
    if (!visible || !verification) return undefined;
    let active = true;
    let attempts = 0;
    setVerifyError('');
    setVerifyTimedOut(false);
    const check = async () => {
      while (active && attempts < 20) {
        try {
          const { data } = await api.get('/companies/me/setup-status');
          if (!active) return;
          setStatus(data);
          if (matchesVerification(data, verification.key)) {
            const next = verification.next || nextSetupStage(data);
            setStage(next);
            return;
          }
        } catch (error) {
          if (!active) return;
          setVerifyError(error?.response?.data?.detail || error?.message || 'Voortgang kon niet worden gecontroleerd.');
          return;
        }
        attempts += 1;
        if (attempts < 20) await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (active) setVerifyTimedOut(true);
    };
    check();
    return () => { active = false; };
  }, [visible, verification, retryToken, setStage]);

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
  const panelWidth = Math.min(360, window.innerWidth - 24);
  const panelLeft = rect
    ? Math.max(12, Math.min(window.innerWidth - panelWidth - 12, rect.left + rect.width / 2 - panelWidth / 2))
    : Math.max(12, (window.innerWidth - panelWidth) / 2);
  const panelTop = rect && rect.top + rect.height + 220 < window.innerHeight
    ? rect.top + rect.height + 18
    : rect ? Math.max(12, rect.top - 220) : Math.max(16, window.innerHeight / 2 - 100);

  return createPortal((
    <div className="fixed inset-0 z-[180] pointer-events-none" data-testid="kiosk-setup-tour">
      {rect && (
        <>
          <div className="fixed rounded-2xl border-2 border-orange-400 shadow-[0_0_0_9999px_rgba(15,23,42,0.68)] animate-pulse pointer-events-none"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
          <div className="fixed text-3xl drop-shadow-md animate-bounce pointer-events-none"
            style={{ top: Math.max(4, rect.top - 34), left: Math.max(4, rect.left + rect.width / 2 - 12) }}>👇</div>
        </>
      )}
      <section className="fixed pointer-events-auto w-[calc(100vw-24px)] max-w-[360px] rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200"
        style={{ left: panelLeft, top: panelTop }}>
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
        ) : verification ? (
          <>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-orange-50 text-[#FF5C00]">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
            <h2 className="text-lg font-black text-slate-900">Voortgang controleren</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {verifyError || (verifyTimedOut
                ? 'Deze stap is nog niet bevestigd. Controleer of alles is opgeslagen.'
                : 'We wachten tot de wijziging is opgeslagen. Dit kan even duren.')}
            </p>
            {(verifyError || verifyTimedOut) && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setStage(verification.key === 'profile' ? 'businessSave'
                  : verification.key === 'locations' ? 'locationSave'
                    : verification.key === 'apartment' ? 'apartmentSave' : 'tenantSave')}
                  className="h-10 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-700">
                  Terug naar opslaan
                </button>
                <button type="button" onClick={() => setRetryToken((value) => value + 1)}
                  className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-[#FF5C00] px-3 text-xs font-bold text-white">
                  <RotateCw className="h-3.5 w-3.5" /> Opnieuw controleren
                </button>
              </div>
            )}
          </>
        ) : (
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
