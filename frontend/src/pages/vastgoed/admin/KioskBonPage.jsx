import SettingsPage from './Settings';

export default function KioskBonPage({ onBack }) {
  return <SettingsPage initialSection="receipts" hideSubNav kioskLayout onBack={onBack} />;
}
