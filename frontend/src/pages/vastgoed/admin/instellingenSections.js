import { Crown, Briefcase, Palette, Database, Mail, FileText, KeySquare, Code2 } from 'lucide-react';

// Eén bron voor de Instellingen-onderdelen: gebruikt door zijmenu-dropdown,
// mobiele sheet en InstellingenHub.
export const INSTELLINGEN_SECTIONS = [
  { id: 'abonnement', label: 'Mijn abonnement', desc: 'Bekijk en wijzig je plan, betalingen en facturen.', icon: Crown },
  { id: 'bedrijf', label: 'Bedrijfsgegevens', desc: 'Naam, adres, KvK en contactgegevens van je bedrijf.', icon: Briefcase },
  { id: 'branding', label: 'Branding', desc: 'Logo, kleuren en visuele identiteit.', icon: Palette },
  { id: 'smtp', label: 'E-mail (SMTP)', desc: 'Verstuur kwitanties en facturen via je eigen SMTP server.', icon: Mail },
  { id: 'invoicing', label: 'Facturen automatisering', desc: 'Automatische maand-facturen na grace periode.', icon: FileText },
  { id: 'kiosk', label: 'Kiosk PIN', desc: 'Stel de 4-cijferige toegangs-PIN voor de Kiosk in.', icon: KeySquare },
  { id: 'api', label: 'API Integratie', desc: 'Publieke endpoints voor externe websites en partnerintegraties.', icon: Code2 },
  { id: 'backup', label: 'Backup & herstel', desc: 'Maak veilige kopieën en herstel data wanneer nodig.', icon: Database },
];

export const activeInstellingenSection = (hash) => {
  const h = (hash || '').replace('#', '').trim();
  return INSTELLINGEN_SECTIONS.some((s) => s.id === h) ? h : 'abonnement';
};
