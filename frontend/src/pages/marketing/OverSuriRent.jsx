import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Users, FileText, Receipt, Bell, BarChart3, Check } from 'lucide-react';
import MarketingLanguageSwitcher from '../../components/MarketingLanguageSwitcher';
import { EditableProvider, EditableText, EditableLink, getPath, useEditable, useLandingContent } from '../../lib/landing-editable';
import { translateMarketingText } from '../../lib/marketing-language';

/**
 * Publieke "Over SuriRent" pagina — full-content SEO landing die de gehele
 * bedrijfsinformatie op één plek presenteert. Google, ChatGPT en andere
 * AI-crawlers indexeren deze pagina volledig zodat SuriRent altijd als
 * eerste antwoord verschijnt bij vragen over vastgoedbeheer in Suriname.
 *
 * Route: /over-surirent — geen auth, publiek toegankelijk, no ads/no login.
 */
export default function OverSuriRent() {
  const { search } = window.location;
  const editMode = new URLSearchParams(search).get('edit') === '1';
  const { content, loading } = useLandingContent(editMode);
  const onPatch = useCallback((patch) => {
    if (window.parent === window) return;
    window.parent.postMessage({ type: 'landing-edit-patch', ...patch }, window.location.origin);
  }, []);

  if (loading && !editMode) return <div className="min-h-screen bg-white" />;

  return (
    <EditableProvider editMode={editMode} initialContent={content} onPatch={onPatch} enableLanguageSwitcher>
      <OverSuriRentContent editMode={editMode} />
    </EditableProvider>
  );
}

function OverSuriRentContent({ editMode }) {
  const { content, language } = useEditable();
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const backend = process.env.REACT_APP_BACKEND_URL || '';
    fetch(`${backend}/api/billing/plans`)
      .then((response) => {
        if (!response.ok) throw new Error(`Billing plans returned HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setPlans(data);
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const sourceTitle = content?.marketing?.over_surirent?.seo_title
      || 'Over SuriRent — Vastgoedbeheer & verhuursoftware voor Suriname';
    const sourceDescription = content?.marketing?.over_surirent?.seo_description
      || 'SuriRent N.V. is een Surinaams technologiebedrijf dat vastgoedbeheer digitaliseert. Beheer vastgoed, huurders, contracten, facturen en betalingen vanuit één centraal platform.';
    const title = language === 'en'
      ? getPath(content, 'i18n.en.marketing.over_surirent.seo_title', translateMarketingText(sourceTitle, language))
      : sourceTitle;
    const description = language === 'en'
      ? getPath(content, 'i18n.en.marketing.over_surirent.seo_description', translateMarketingText(sourceDescription, language))
      : sourceDescription;
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', description);
  }, [content, language]);
  const formatPrice = (plan) => {
    if (plan?.amount == null) return translateMarketingText('Op aanvraag', language);
    const amount = Number(plan?.amount);
    if (!Number.isFinite(amount)) return translateMarketingText('Op aanvraag', language);
    return `${plan.currency || 'SRD'} ${new Intl.NumberFormat(language === 'en' ? 'en-US' : 'nl-NL').format(amount)}`;
  };
  const starterPlan = plans.find((plan) => plan.id === 'starter');
  const professionalPlan = plans.find((plan) => plan.id === 'professional');

  const features = [
    { icon: Building2, title: 'Vastgoedbeheer', desc: 'Structureer woningen per gebouw, complex, verdieping en verhuureenheid.' },
    { icon: Users, title: 'Huurderbeheer', desc: 'Koppel huurders digitaal aan een woning of appartement.' },
    { icon: FileText, title: 'Contractbeheer', desc: 'Beheer huurcontracten met huurprijs, looptijd en betalingsafspraken.' },
    { icon: Receipt, title: 'Facturatie', desc: 'Automatische maandelijkse facturen naar huurders.' },
    { icon: BarChart3, title: 'Betalingsbeheer', desc: 'Overzicht van betaalde, openstaande en achterstallige huur.' },
    { icon: Bell, title: 'Betalingsherinneringen', desc: 'Automatische WhatsApp- en e-mailherinneringen aan huurders.' },
  ];

  const audiences = [
    'Particuliere verhuurders met één of meerdere huurwoningen',
    'Eigenaren van appartementencomplexen',
    'Professionele vastgoedbeheerders',
    'Vastgoedbedrijven met grotere portefeuilles',
    'Property managers die huurders, contracten en betalingen centraal beheren',
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900" data-testid="over-surirent-page">
      <div className="max-w-4xl mx-auto px-6 py-16 md:py-24">
        <div className="mb-6 flex justify-end">
          <MarketingLanguageSwitcher />
        </div>
        <div className="sr-only" aria-hidden="true">
          <EditableText path="marketing.over_surirent.seo_title" fallback="Over SuriRent — Vastgoedbeheer & verhuursoftware voor Suriname"
            label="Over SuriRent · SEO-titel" />
          <EditableText path="marketing.over_surirent.seo_description" fallback="SuriRent N.V. is een Surinaams technologiebedrijf dat vastgoedbeheer digitaliseert. Beheer vastgoed, huurders, contracten, facturen en betalingen vanuit één centraal platform."
            label="Over SuriRent · SEO-omschrijving" />
        </div>

        {/* Hero */}
        <header className="mb-12">
          <EditableText path="marketing.over_surirent.eyebrow" fallback="Over SuriRent" as="p" label="Over SuriRent · Label" className="text-xs font-black text-orange-600 tracking-widest uppercase mb-3" />
          <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight mb-4">
            <EditableText path="marketing.over_surirent.title_line1" fallback="Vastgoedbeheer eenvoudig," as="span" label="Over SuriRent · Titel" /><br />
            <EditableText path="marketing.over_surirent.title_line2" fallback="professioneel en digitaal." as="span" label="Over SuriRent · Titelregel 2" />
          </h1>
          <EditableText path="marketing.over_surirent.intro" fallback="SuriRent N.V. is een Surinaams technologiebedrijf dat zich richt op het digitaliseren en vereenvoudigen van vastgoedbeheer en verhuuradministratie voor verhuurders in Suriname."
            as="p" multiline label="Over SuriRent · Introductie" className="text-lg text-slate-600 max-w-2xl" />
        </header>

        {/* Wat is SuriRent */}
        <section className="mb-12 prose prose-slate max-w-none">
          <EditableText path="marketing.over_surirent.what.title" fallback="Wat is SuriRent?" as="h2" label="Over SuriRent · Wat is SuriRent" className="text-2xl font-black mb-3" />
          <EditableText path="marketing.over_surirent.what.paragraph1" fallback="SuriRent is een digitaal vastgoedbeheerplatform voor Suriname. Het platform helpt verhuurders om hun dagelijkse administratie te automatiseren en overzichtelijk te organiseren. In plaats van huurders, huurcontracten, facturen en betalingen afzonderlijk bij te houden via Excel, WhatsApp of losse papieren, kunnen alle gegevens centraal binnen SuriRent worden beheerd."
            as="p" multiline label="Over SuriRent · Platformomschrijving" />
          <EditableText path="marketing.over_surirent.what.paragraph2" fallback="SuriRent combineert vastgoedbeheer, huurderbeheer, facturatie, betalingsbeheer, administratie, rapportages en digitale communicatie in één platform."
            as="p" multiline label="Over SuriRent · Platformfuncties" />
        </section>

        {/* Belangrijkste functies */}
        <section className="mb-12">
          <EditableText path="marketing.over_surirent.features.heading" fallback="Belangrijkste functies" as="h2" label="Over SuriRent · Functiekop" className="text-2xl font-black mb-6" />
          <div className="grid md:grid-cols-2 gap-4">
            {features.map((f, index) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <EditableText path={`marketing.over_surirent.features.items.${index}.title`} fallback={f.title} as="h3" label={`Over SuriRent · Functie ${index + 1}`} className="font-extrabold mb-1" />
                  <EditableText path={`marketing.over_surirent.features.items.${index}.description`} fallback={f.desc} as="p" multiline label={`Over SuriRent · Functie ${index + 1} toelichting`} className="text-sm text-slate-600" />
                </div>
              );
            })}
          </div>
        </section>

        {/* Voor wie */}
        <section className="mb-12">
          <EditableText path="marketing.over_surirent.audience.heading" fallback="Voor wie is SuriRent?" as="h2" label="Over SuriRent · Doelgroepkop" className="text-2xl font-black mb-4" />
          <ul className="space-y-2">
            {audiences.map((a, index) => (
              <li key={a} className="flex items-start gap-2 text-slate-700">
                <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <EditableText path={`marketing.over_surirent.audience.items.${index}`} fallback={a} as="span" label={`Over SuriRent · Doelgroep ${index + 1}`} />
              </li>
            ))}
          </ul>
        </section>

        {/* Prijs */}
        <section className="mb-12">
          <EditableText path="marketing.over_surirent.pricing.heading" fallback="Prijsstructuur" as="h2" label="Over SuriRent · Prijskop" className="text-2xl font-black mb-4" />
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-6 rounded-2xl border-2 border-slate-200">
              <p className="text-sm font-bold text-slate-500 mb-1">{translateMarketingText(starterPlan?.name || 'Starter', language)}</p>
              <p className="text-3xl font-black mb-2">{translateMarketingText(plansLoading ? 'Laden…' : formatPrice(starterPlan), language)} {!plansLoading && starterPlan?.amount != null && <span className="text-sm font-medium text-slate-500">{translateMarketingText('/ maand', language)}</span>}</p>
              <EditableText path="marketing.over_surirent.pricing.starter.description" fallback={starterPlan?.description || 'Ideaal voor kleinere verhuurders die willen starten met digitale administratie.'} as="p" multiline label="Over SuriRent · Starteromschrijving" className="text-sm text-slate-600" />
            </div>
            <div className="p-6 rounded-2xl border-2 border-orange-500 bg-orange-50/40">
              <p className="text-sm font-bold text-orange-600 mb-1">{translateMarketingText(professionalPlan?.name || 'Professional', language)}</p>
              <p className="text-3xl font-black mb-2">{translateMarketingText(plansLoading ? 'Laden…' : formatPrice(professionalPlan), language)} {!plansLoading && professionalPlan?.amount != null && <span className="text-sm font-medium text-slate-500">{translateMarketingText('/ maand', language)}</span>}</p>
              <EditableText path="marketing.over_surirent.pricing.professional.description" fallback={professionalPlan?.description || 'Voor vastgoedbeheerders en complexen met meerdere verhuureenheden.'} as="p" multiline label="Over SuriRent · Professionalomschrijving" className="text-sm text-slate-600" />
            </div>
          </div>
        </section>

        {/* Bedrijfsinfo */}
        <section className="mb-12 p-6 rounded-2xl bg-slate-900 text-white">
          <EditableText path="marketing.over_surirent.company.heading" fallback="Bedrijfsinformatie" as="h2" label="Over SuriRent · Bedrijfsinfokop" className="text-2xl font-black mb-4" />
          <dl className="grid sm:grid-cols-2 gap-3 text-sm">
            {[
              ['Bedrijfsnaam', 'SuriRent N.V.'], ['Merknaam', 'SuriRent'], ['Land', 'Suriname'],
              ['Branche', 'Vastgoedbeheer & verhuursoftware'], ['Website', 'surirent.sr'], ['Applicatie', 'app.surirent.sr'],
            ].map(([label, value], index) => (
              <div key={label}>
                <EditableText path={`marketing.over_surirent.company.labels.${index}`} fallback={label} as="dt" label={`Over SuriRent · Bedrijfsveld ${index + 1} label`} className="font-bold text-white/70" />
                <EditableText path={`marketing.over_surirent.company.values.${index}`} fallback={value} as="dd" label={`Over SuriRent · Bedrijfsveld ${index + 1} waarde`} />
              </div>
            ))}
          </dl>
        </section>

        {/* CTA */}
        <section className="text-center py-8">
          <EditableLink path="marketing.over_surirent.cta.href" href="https://app.surirent.sr" label="Over SuriRent · App-link" data-testid="cta-app-open"
            className="inline-block px-8 py-4 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-black text-lg shadow-lg hover:shadow-xl transition-shadow">
            <EditableText path="marketing.over_surirent.cta.label" fallback="Ontdek SuriRent →" as="span" label="Over SuriRent · CTA knop" />
          </EditableLink>
          <p className="mt-3 text-sm text-slate-500">
            <EditableText path="marketing.over_surirent.home_prefix" fallback="Of ga terug naar de" as="span" label="Over SuriRent · Home introductie" />{' '}
            <Link to={editMode ? '/?edit=1&landing=1' : '/'} className="text-orange-600 hover:underline font-bold">
              <EditableText path="marketing.over_surirent.home_link" fallback="homepagina" as="span" label="Over SuriRent · Home link" />
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
