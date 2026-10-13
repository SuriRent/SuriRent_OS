import { Crown, Briefcase, Palette, Database, Mail, FileText, CreditCard, Printer } from 'lucide-react';

// Eén bron voor de Instellingen-onderdelen: gebruikt door zijmenu-dropdown,
// mobiele sheet en InstellingenHub.
export const INSTELLINGEN_SECTIONS = [
  { id: 'abonnement', label: 'Mijn abonnement', desc: 'Bekijk en wijzig je plan, betalingen en facturen.', icon: Crown },
  { id: 'bedrijf', label: 'Bedrijfsgegevens', desc: 'Naam, adres, KvK en contactgegevens van je bedrijf.', icon: Briefcase },
  { id: 'branding', label: 'Branding', desc: 'Logo, kleuren en visuele identiteit.', icon: Palette },
  { id: 'smtp', label: 'E-mail (SMTP)', desc: 'Verstuur kwitanties en facturen via je eigen SMTP server.', icon: Mail },
  { id: 'invoicing', label: 'Facturen automatisering', desc: 'Automatische maand-facturen na grace periode.', icon: FileText },
  { id: 'stripe', label: 'Stripe betalingen', desc: 'Laat huurders in de Kiosk betalen met Creditcard of iDEAL.', icon: CreditCard },
  { id: 'bon', label: 'Bon & afdrukken', desc: 'Kies het afdrukformaat en de lettergrootte van de kwitantie.', icon: Printer },
  { id: 'backup', label: 'Backup & herstel', desc: 'Maak veilige kopieën en herstel data wanneer nodig.', icon: Database },
];

export const activeInstellingenSection = (hash) => {
  const h = (hash || '').replace('#', '').trim();
  return INSTELLINGEN_SECTIONS.some((s) => s.id === h) ? h : 'abonnement';
};
