import { useAuth } from '../lib/auth';
import OnboardingModal from './OnboardingModal';
import KioskSetupTour from './KioskSetupTour';

export function KioskAdminOnboarding({ enabled, onWizardClosed }) {
  const { user, activeCompany, refresh } = useAuth();
  const isCompanyAdmin = enabled && user?.role === 'admin';
  const cid = user?.company_id;
  const needsOnboarding = isCompanyAdmin && !!activeCompany?.needs_onboarding;

  if (!isCompanyAdmin) return null;
  if (needsOnboarding) {
    return (
      <OnboardingModal zClass="z-[140]" initialName={activeCompany.name || user?.name || ''}
        initialSlug={activeCompany.slug || ''} onDone={() => { refresh(); }} />
    );
  }
  return (
    <KioskSetupTour key={cid} enabled companyId={cid} onComplete={onWizardClosed} />
  );
}
