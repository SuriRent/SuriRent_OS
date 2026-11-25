import { Crown, Briefcase, Palette, Database, Mail, MessageCircle, FileText, CreditCard, Printer, Tablet, Bluetooth, ShieldCheck, Zap, Globe, LayoutTemplate, Bell } from 'lucide-react';

// Eén bron voor de Instellingen-onderdelen: gebruikt door zijmenu-dropdown,
// mobiele sheet en InstellingenHub.
export const INSTELLINGEN_SECTIONS = [
  { id: 'abonnement', label: 'Mijn abonnement', desc: 'Bekijk en wijzig je plan, betalingen en facturen.', icon: Crown },
  { id: 'bedrijf', label: 'Bedrijfsgegevens', desc: 'Naam, adres, KvK en contactgegevens van je bedrijf.', icon: Briefcase },
  { id: 'branding', label: 'Branding', desc: 'Logo, kleuren en visuele identiteit.', icon: Palette },
  { id: 'smtp', label: 'E-mail (SMTP)', desc: 'Verstuur kwitanties en facturen via je eigen SMTP server.', icon: Mail },
  { id: 'messente', label: 'WhatsApp & SMS (Messente)', desc: 'Stel WhatsApp- en SMS-berichten voor huurders in via Messente.', icon: MessageCircle },
  { id: 'invoicing', label: 'Facturen automatisering', desc: 'Automatische maand-facturen na grace periode.', icon: FileText },
  { id: 'deposit', label: 'Borg', desc: 'Stel de standaardborg in als veelvoud van de maandhuur.', icon: ShieldCheck },
  { id: 'betaalmethoden', label: 'Betaalmethoden', desc: 'Beheer Stripe- en Mopé-betalingen voor uw kiosks.', icon: CreditCard, anyFeatures: ['allow_stripe', 'allow_mope'] },
  { id: 'stroom', label: 'Stroom', desc: 'Tuya-koppeling, schakelaars per appartement koppelen en automatisch afsluiten bij achterstand.', icon: Zap, feature: 'allow_power' },
  { id: 'bon', label: 'Bon & afdrukken', desc: 'Kies wat er op de bon staat: bedrijfsnaam, velden en voettekst.', icon: Printer },
  { id: 'bon-printer', label: 'Bon printer', desc: 'Kies KT-V520 of een Bluetooth bonprinter en koppel hem.', icon: Bluetooth },
  { id: 'kiosk-apparaten', label: 'Kiosk apparaten', desc: 'Printer-hardware voor alle kiosks van je bedrijf.', icon: Tablet },
  { id: 'domein', label: 'Eigen domein', desc: 'Laat klanten via hun eigen domein (bv. login.klant.nl) naar hun eigen pagina gaan.', icon: Globe, feature: 'allow_custom_domain' },
  { id: 'website', label: 'Marketing website', desc: 'Bewerk de publieke website van je bedrijf met de website-editor.', icon: LayoutTemplate, feature: 'allow_marketing_site' },
  { id: 'notificaties', label: 'Notificaties', desc: 'Push-meldingen op dit toestel (PWA): betalingen, achterstand en goedkeuringen.', icon: Bell },
  { id: 'backup', label: 'Backup & herstel', desc: 'Maak veilige kopieën en herstel data wanneer nodig.', icon: Database },
];

export const availableInstellingenSections = (limits) => INSTELLINGEN_SECTIONS.filter(
  (section) => {
    const requiredFeatures = section.features || (section.feature ? [section.feature] : []);
    if (section.anyFeatures) return section.anyFeatures.some((feature) => limits?.[feature] === true);
    return requiredFeatures.every((feature) => limits?.[feature] === true);
  },
);

export const activeInstellingenSection = (hash, limits) => {
  const raw = (hash || '').replace('#', '').trim();
  const h = ['stripe', 'mope'].includes(raw) ? 'betaalmethoden' : raw;
  return availableInstellingenSections(limits).some((s) => s.id === h) ? h : 'abonnement';
};
