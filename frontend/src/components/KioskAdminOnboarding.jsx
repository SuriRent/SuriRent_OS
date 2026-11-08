import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import OnboardingModal from './OnboardingModal';
import KioskFeatureTour from './KioskFeatureTour';
import SetupWizardSheet from '../pages/vastgoed/admin/SetupWizardSheet';

export function KioskAdminOnboarding({ enabled, onWizardClosed }) {
  const { user, activeCompany, refresh } = useAuth();
  const isCompanyAdmin = enabled && user?.role === 'admin';
  const cid = user?.company_id;
  const needsOnboarding = isCompanyAdmin && !!activeCompany?.needs_onboarding;
  const [wizardOpen, setWizardOpen] = useState(false);
  const [tourPromptOpen, setTourPromptOpen] = useState(false);
  const [tourActive, setTourActive] = useState(false);

  const tourPromptKey = `kiosk_feature_tour_prompted_${cid}`;
  const markTourSeen = useCallback(() => {
    try { localStorage.setItem(tourPromptKey, '1'); } catch { /* Server flag is the source of truth. */ }
    api.post('/companies/me/kiosk-tour-seen').catch(() => {});
  }, [tourPromptKey]);
  const refreshSetup = useCallback(async (showWizardIfIncomplete = true) => {
    if (!isCompanyAdmin || !cid || needsOnboarding) return;
    try {
      const { data } = await api.get('/companies/me/setup-status');
      if (data?.required_complete === false) {
        if (showWizardIfIncomplete) setWizardOpen(true);
        setTourPromptOpen(false);
        return;
      }
      if (data?.required_complete !== true) return;
      setWizardOpen(false);
      let prompted = false;
      try { prompted = localStorage.getItem(tourPromptKey) === '1'; } catch { /* Continue without persisted preference. */ }
      if (data?.tour_seen) prompted = true;
      if (!prompted) { setTourPromptOpen(true); markTourSeen(); }
    } catch {
      // A temporary network error should not prevent the wizard from starting later.
    }
  }, [isCompanyAdmin, cid, needsOnboarding, tourPromptKey, markTourSeen]);

  useEffect(() => {
    setWizardOpen(false);
    setTourPromptOpen(false);
    setTourActive(false);
    refreshSetup();
  }, [refreshSetup]);

  useEffect(() => {
    if (!isCompanyAdmin || !cid) return undefined;
    const startTour = () => {
      markTourSeen();
      setTourPromptOpen(false);
      setTourActive(true);
    };
    window.addEventListener('kiosk-tour-start', startTour);
    return () => window.removeEventListener('kiosk-tour-start', startTour);
  }, [isCompanyAdmin, cid, markTourSeen]);

  if (!isCompanyAdmin) return null;
  if (needsOnboarding) {
    return (
      <OnboardingModal zClass="z-[140]" initialName={activeCompany.name || user?.name || ''}
        initialSlug={activeCompany.slug || ''} onDone={() => { refresh(); }} />
    );
  }
  return (
    <>
      <SetupWizardSheet key={cid} open={wizardOpen} zClass="z-[130]"
        onClose={() => { setWizardOpen(false); refreshSetup(false); onWizardClosed?.(); }} />
      <KioskFeatureTour promptOpen={tourPromptOpen} active={tourActive}
        onStart={() => {
          markTourSeen();
          setTourPromptOpen(false);
          setTourActive(true);
        }}
        onSkip={() => {
          markTourSeen();
          window.dispatchEvent(new CustomEvent('kiosk-tour-navigate', { detail: { type: 'home' } }));
          setTourPromptOpen(false);
          setTourActive(false);
        }}
        onFinish={() => {
          markTourSeen();
          window.dispatchEvent(new CustomEvent('kiosk-tour-navigate', { detail: { type: 'home' } }));
          setTourActive(false);
        }} />
    </>
  );
}
