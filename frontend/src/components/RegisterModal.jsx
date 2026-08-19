// =====================================================================
// RegisterModal — thin wrapper rond MobileRegisterWizard.
//
// Historisch was er een split-panel modal voor desktop (2 kolommen) en
// een aparte wizard voor mobiel. Op verzoek van gebruiker (2026-02-28)
// gebruikt zowel desktop als mobiel nu dezelfde oranje step-wizard —
// consistent, moderner, mobiel-first. De wizard is fullscreen op
// mobiel en wordt op desktop nog altijd fullscreen weergegeven met
// max-w-lg centered content.
// =====================================================================
import { MobileRegisterWizard } from './MobileAuthShell';

export default function RegisterModal({ open, onClose }) {
  if (!open) return null;
  return <MobileRegisterWizard onClose={onClose} />;
}
