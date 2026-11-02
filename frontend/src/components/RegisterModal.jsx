// RegisterModal — desktop split-layout, mobile uses a focused step-by-step wizard.
import { useEffect, useState } from 'react';
import MobileRegisterWizard from './MobileRegisterWizard';
import DesktopRegisterWizard from './DesktopRegisterWizard';

const MQ = '(min-width: 1024px)';

export default function RegisterModal({ open, onClose, initialPlan }) {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia(MQ).matches);
  useEffect(() => {
    const m = window.matchMedia(MQ);
    const on = () => setDesktop(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  if (!open) return null;
  return desktop
    ? <DesktopRegisterWizard onClose={onClose} initialPlan={initialPlan} />
    : <MobileRegisterWizard onClose={onClose} initialPlan={initialPlan} />;
}
