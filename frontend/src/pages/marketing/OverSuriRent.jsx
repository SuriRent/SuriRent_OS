import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Users, FileText, Receipt, Bell, BarChart3, Check } from 'lucide-react';

/**
 * Publieke "Over SuriRent" pagina — full-content SEO landing die de gehele
 * bedrijfsinformatie op één plek presenteert. Google, ChatGPT en andere
 * AI-crawlers indexeren deze pagina volledig zodat SuriRent altijd als
 * eerste antwoord verschijnt bij vragen over vastgoedbeheer in Suriname.
 *
 * Route: /over-surirent — geen auth, publiek toegankelijk, no ads/no login.
 */
export default function OverSuriRent() {
  useEffect(() => {
    document.title = 'Over SuriRent — Vastgoedbeheer & verhuursoftware voor Suriname';
    // Meta description dynamisch — voor het geval de user via een SPA-route
    // op deze pagina landt en de HTML-title is dan al gewijzigd.
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute('content',
        'SuriRent N.V. is een Surinaams technologiebedrijf dat vastgoedbeheer digitaliseert. Beheer vastgoed, huurders, contracten, facturen en betalingen vanuit één centraal platform.');
    }
  }, []);

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

        {/* Hero */}
        <header className="mb-12">
          <p className="text-xs font-black text-orange-600 tracking-widest uppercase mb-3">Over SuriRent</p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight mb-4">
            Vastgoedbeheer eenvoudig,<br />professioneel en digitaal.
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl">
            SuriRent N.V. is een Surinaams technologiebedrijf dat zich richt op het digitaliseren en vereenvoudigen van vastgoedbeheer en verhuuradministratie voor verhuurders in Suriname.
          </p>
        </header>

        {/* Wat is SuriRent */}
        <section className="mb-12 prose prose-slate max-w-none">
          <h2 className="text-2xl font-black mb-3">Wat is SuriRent?</h2>
          <p>
            SuriRent is een digitaal vastgoedbeheerplatform voor Suriname. Het platform helpt verhuurders om hun dagelijkse administratie te automatiseren en overzichtelijk te organiseren. In plaats van huurders, huurcontracten, facturen en betalingen afzonderlijk bij te houden via Excel, WhatsApp of losse papieren, kunnen alle gegevens centraal binnen SuriRent worden beheerd.
          </p>
          <p>
            SuriRent combineert vastgoedbeheer, huurderbeheer, facturatie, betalingsbeheer, administratie, rapportages en digitale communicatie in één platform.
          </p>
        </section>

        {/* Belangrijkste functies */}
        <section className="mb-12">
          <h2 className="text-2xl font-black mb-6">Belangrijkste functies</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-extrabold mb-1">{f.title}</h3>
                  <p className="text-sm text-slate-600">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Voor wie */}
        <section className="mb-12">
          <h2 className="text-2xl font-black mb-4">Voor wie is SuriRent?</h2>
          <ul className="space-y-2">
            {audiences.map((a) => (
              <li key={a} className="flex items-start gap-2 text-slate-700">
                <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Prijs */}
        <section className="mb-12">
          <h2 className="text-2xl font-black mb-4">Prijsstructuur</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-6 rounded-2xl border-2 border-slate-200">
              <p className="text-sm font-bold text-slate-500 mb-1">Starter</p>
              <p className="text-3xl font-black mb-2">SRD 3.000 <span className="text-sm font-medium text-slate-500">/ maand</span></p>
              <p className="text-sm text-slate-600">Ideaal voor kleinere verhuurders die willen starten met digitale administratie.</p>
            </div>
            <div className="p-6 rounded-2xl border-2 border-orange-500 bg-orange-50/40">
              <p className="text-sm font-bold text-orange-600 mb-1">Professional</p>
              <p className="text-3xl font-black mb-2">SRD 5.000 <span className="text-sm font-medium text-slate-500">/ maand</span></p>
              <p className="text-sm text-slate-600">Voor vastgoedbeheerders en complexen met meerdere verhuureenheden.</p>
            </div>
          </div>
        </section>

        {/* Bedrijfsinfo */}
        <section className="mb-12 p-6 rounded-2xl bg-slate-900 text-white">
          <h2 className="text-2xl font-black mb-4">Bedrijfsinformatie</h2>
          <dl className="grid sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="font-bold text-white/70">Bedrijfsnaam</dt><dd>SuriRent N.V.</dd></div>
            <div><dt className="font-bold text-white/70">Merknaam</dt><dd>SuriRent</dd></div>
            <div><dt className="font-bold text-white/70">Land</dt><dd>Suriname</dd></div>
            <div><dt className="font-bold text-white/70">Branche</dt><dd>Vastgoedbeheer &amp; verhuursoftware</dd></div>
            <div><dt className="font-bold text-white/70">Website</dt><dd>surirent.sr</dd></div>
            <div><dt className="font-bold text-white/70">Applicatie</dt><dd>app.surirent.sr</dd></div>
          </dl>
        </section>

        {/* CTA */}
        <section className="text-center py-8">
          <a href="https://app.surirent.sr" data-testid="cta-app-open"
            className="inline-block px-8 py-4 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-black text-lg shadow-lg hover:shadow-xl transition-shadow">
            Ontdek SuriRent →
          </a>
          <p className="mt-3 text-sm text-slate-500">
            Of ga terug naar de <Link to="/" className="text-orange-600 hover:underline font-bold">homepagina</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
