import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import OnboardingModal from './OnboardingModal';
import SetupWizardSheet from '../pages/vastgoed/admin/SetupWizardSheet';

export function KioskAdminOnboarding({ enabled, onWizardClosed }) {
  const { user, activeCompany, refresh } = useAuth();
  const isCompanyAdmin = enabled && user?.role === 'admin';
  const cid = user?.company_id;
  const needsOnboarding = isCompanyAdmin && !!activeCompany?.needs_onboarding;
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!isCompanyAdmin || !cid || needsOnboarding) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/companies/me/setup-status');
        if (!cancelled && data?.required_complete === false) setWizardOpen(true);
      } catch {
        // A temporary network error should not prevent the wizard from starting later.
      }
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
    <SetupWizardSheet key={cid} open={wizardOpen} zClass="z-[130]"
      onClose={() => { setWizardOpen(false); onWizardClosed?.(); }} />
  );
}
