import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import OnboardingModal from './OnboardingModal';
import SetupWizardSheet from '../pages/vastgoed/admin/SetupWizardSheet';

// Portalnaam-keuze (na Google-registratie) + startwizard voor beheerders in de Kiosk.
export function KioskAdminOnboarding({ enabled, onWizardClosed }) {
  const { user, activeCompany, refresh } = useAuth();
  const [wizardOpen, setWizardOpen] = useState(false);
  const isCompanyAdmin = enabled && user && user.role === 'admin';
  const cid = user?.company_id;
  const needsOnboarding = isCompanyAdmin && !!activeCompany?.needs_onboarding;

  useEffect(() => {
    if (!isCompanyAdmin || !cid || needsOnboarding) return undefined;
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(`setup_wizard_dismissed_${cid}`) === '1') return;
        const { data } = await api.get('/companies/me/setup-status');
        if (!cancelled && (data?.completed ?? 0) < 2) setWizardOpen(true);
      } catch { /* netwerkfout — wizard overslaan */ }
    })();
    return () => { cancelled = true; };
  }, [isCompanyAdmin, cid, needsOnboarding]);

  if (!isCompanyAdmin) return null;
  if (needsOnboarding) {
    return (
      <OnboardingModal zClass="z-[140]" initialName={activeCompany.name || user?.name || ''}
        initialSlug={activeCompany.slug || ''} onDone={() => { refresh(); }} />
    );
  }
  return (
    <SetupWizardSheet zClass="z-[130]" open={wizardOpen} companyId={cid}
      onClose={() => { setWizardOpen(false); onWizardClosed?.(); }} />
  );
}
