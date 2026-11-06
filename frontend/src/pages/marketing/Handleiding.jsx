import { ArrowRight, BookOpen, CheckCircle2, CircleHelp, ShieldCheck } from 'lucide-react';
import { appLink } from '../../lib/env';
import { EditableText, EditableImage, EditableLink } from '../../lib/landing-editable';

const fieldKey = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const SECTIONS = [
  ['start', 'Begin hier'],
  ['inrichten', 'Eerste inrichting'],
  ['kiosk', 'Medewerkerskiosk'],
  ['huurdersportaal', 'Huurdersportaal'],
  ['beheer', 'Kiosk Beheer'],
  ['instellingen', 'Instellingen'],
  ['problemen', 'Problemen oplossen'],
];

const ADMIN_MODULES = [
  ['Overzicht', 'Begin hier voor de belangrijkste aantallen en financiële stand. Gebruik het dashboard als dagelijkse controle en open vanuit een melding de bijbehorende beheerpagina.'],
  ['Locaties', 'Maak een locatie aan met een herkenbare naam en voeg optioneel adres en foto toe. Koppel appartementen eraan zodat medewerkers op de kiosk eerst het juiste gebouw kunnen kiezen.'],
  ['Appartementen', 'Maak per verhuureenheid een appartement aan. Vul nummer, huurprijs en valuta in, koppel de locatie en controleer of de gegevens juist zijn voordat je huurders laat betalen. Vanuit een appartement kun je ook een printbare QR-plaat als PDF openen.'],
  ['Huurders', 'Voeg een huurder toe of open een bestaande huurder om contactgegevens en appartementkoppeling te controleren. Vanuit de huurderacties kun je ook portaltoegang beheren; koppel NFC alleen nadat je de kaart/tag aan de juiste huurder hebt toegewezen.'],
  ['Contracten', 'Registreer contractgegevens en koppel de juiste huurder en verhuureenheid. Controleer huurprijs, looptijd en afspraken aan de hand van de overeenkomst die je met de huurder hebt gesloten.'],
  ['Betalingen', 'Zoek betalingen en controleer bedrag, valuta, methode en periode. Gebruik handmatige registratie alleen als de betaling daadwerkelijk is ontvangen. Controleer daarnaast of er betalingen zijn die op goedkeuring wachten.'],
  ['Facturen', 'Bekijk, maak of beheer facturen vanuit de facturenpagina. Controleer huurder, bedrag, periode en vervaldatum; automatische aanmaak en herinneringen stel je apart in bij Facturen automatisering.'],
  ['Betalingsregelingen', 'Leg een afgesproken betaling in termijnen vast en volg de termijnen in deze pagina. Controleer bij ontvangst welke termijn bij de betaling hoort.'],
  ['Borg', 'Bekijk de borgstatus per huurder en registreer borgbetalingen volgens de gemaakte afspraken. Als de borg nog openstaat, kan het systeem huurbetaling blokkeren totdat de borg is voldaan.'],
  ['Onderhoud', 'Registreer een onderhoudspunt bij de juiste woning, houd de voortgang bij en werk de melding bij zodra de klus is opgepakt of afgerond.'],
  ['Kasgeld', 'Gebruik de kaspagina om kasbewegingen bij te houden en controleer de stand met de werkelijke kas. Registreer geen kasontvangst voordat het bedrag is gecontroleerd.'],
  ['Werknemers', 'Maak een account aan, kies de passende rol en stel een persoonlijke kiosk-PIN van vier cijfers in. Geef alleen de benodigde toegang en deel de PIN veilig met de medewerker.'],
  ['Notificaties', 'Controleer meldingen regelmatig op openstaande taken, betalingsstatus en andere aandachtspunten. Open de melding om de bijbehorende informatie te bekijken.'],
  ['Instellingen', 'Beheer bedrijfsgegevens en branding, e-mail, factuurautomatisering, Stripe, bonnen en printers, kiosk-apparaten en backup/herstel. Wijzig alleen de opties die je organisatie gebruikt.'],
];

function StepCard({ number, title, children }) {
  const key = fieldKey(title);
  return (
    <article className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-sm font-black text-[#E65300]">{number}</span>
      <div className="min-w-0">
        <EditableText path={`marketing.manual.steps.${key}.title`} fallback={title} as="h3" label={`Handleiding · ${title}`} className="font-black text-[#0B1B3F}" />
        <EditableText path={`marketing.manual.steps.${key}.body`} as="div" multiline label={`Handleiding · ${title} uitleg`} className="mt-2 text-sm leading-6 text-slate-600">{children}</EditableText>
      </div>
    </article>
  );
}

function InfoCard({ title, children, tone = 'orange' }) {
  const key = fieldKey(title);
  const styles = tone === 'blue'
    ? 'border-blue-200 bg-blue-50 text-blue-950'
    : 'border-orange-200 bg-orange-50 text-[#71310F]';
  return (
    <aside className={`rounded-2xl border p-5 ${styles}`}>
      <EditableText path={`marketing.manual.info.${key}.title`} fallback={title} as="h3" label={`Handleiding · Tip ${title}`} className="font-black" />
      <EditableText path={`marketing.manual.info.${key}.body`} as="div" multiline label={`Handleiding · Tip ${title} uitleg`} className="mt-2 text-sm leading-6 opacity-90">{children}</EditableText>
    </aside>
  );
}

export default function Handleiding({ onDemo }) {
  return (
    <main className="bg-[#F8F9FC] text-[#0B1B3F]" data-testid="manual-page">
      <section className="relative isolate overflow-hidden bg-white">
        <div className="absolute -right-32 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-[#FF5C00]/10 blur-3xl" />
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#E65300]">
            <BookOpen className="h-4 w-4" /> <EditableText path="marketing.manual.hero.eyebrow" fallback="SuriRent handleiding" as="span" label="Handleiding · Label" />
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.05] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
            <EditableText path="marketing.manual.hero.title" fallback="Van eerste inrichting tot" as="span" label="Handleiding · Titel" />{' '}
            <EditableText path="marketing.manual.hero.title_accent" fallback="dagelijks kioskgebruik." as="span" label="Handleiding · Titelaccent" className="text-[#FF5C00]" />
          </h1>
          <EditableText path="marketing.manual.hero.description" fallback="Deze gids legt stap voor stap uit hoe je SuriRent klaarzet, de medewerkerskiosk gebruikt en huurders zelfstandig laat betalen via het huurdersportaal."
            as="p" multiline label="Handleiding · Introductie" className="mt-5 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8" />
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={onDemo} data-testid="manual-demo"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#FF5C00] px-5 text-sm font-black text-white transition hover:bg-[#E65300]">
              <EditableText path="marketing.manual.hero.demo_cta" fallback="Bekijk de demo" as="span" label="Handleiding · Demoknop" /> <ArrowRight className="h-4 w-4" />
            </button>
            <EditableLink path="marketing.manual.hero.start_href" href="#inrichten" label="Handleiding · Startlink"
              className="inline-flex h-12 items-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-[#0B1B3F] transition hover:border-orange-300">
              <EditableText path="marketing.manual.hero.start_cta" fallback="Start met inrichten" as="span" label="Handleiding · Startknop" />
            </EditableLink>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1280px] gap-8 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[230px_minmax(0,1fr)] lg:px-10">
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Handleiding navigatie">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <EditableText path="marketing.manual.navigation.heading" fallback="In deze handleiding" as="p" label="Handleiding · Navigatiekop" className="mb-3 px-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400" />
            <nav className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Inhoud van de handleiding">
              {SECTIONS.map(([id, label], index) => (
                <EditableLink key={id} path={`marketing.manual.navigation.${id}.href`} href={`#${id}`} label={`Handleiding · Link ${label}`}
                  className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-orange-50 hover:text-[#E65300]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-black text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                  <EditableText path={`marketing.manual.navigation.${id}.label`} fallback={label} as="span" label={`Handleiding · Link ${label}`} />
                </EditableLink>
              ))}
            </nav>
          </div>
          <EditableLink path="marketing.manual.navigation.admin_href" href={appLink('/login?view=admin')} label="Handleiding · Beheerloginlink"
            className="mt-3 hidden items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-4 py-3 text-sm font-black text-white transition hover:bg-[#E65300] lg:flex">
            <EditableText path="marketing.manual.navigation.admin_label" fallback="Naar beheerlogin" as="span" label="Handleiding · Beheerlogin" /> <ArrowRight className="h-4 w-4" />
          </EditableLink>
        </aside>
        <div className="min-w-0 space-y-6">
        <section id="start" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-5">
            <EditableText path="marketing.manual.sections.start.eyebrow" fallback="Eerst het onderscheid" as="p" label="Handleiding · Intro label" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
            <EditableText path="marketing.manual.sections.start.title" fallback="Twee manieren om de kiosk te gebruiken." as="h2" label="Handleiding · Intro titel" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-3xl bg-[#0B1B3F] p-6 text-white sm:p-7">
              <EditableText path="marketing.manual.sections.start.employee_label" fallback="Voor personeel" as="p" label="Handleiding · Personeelslabel" className="text-xs font-black uppercase tracking-[0.16em] text-[#FF8A3D]" />
              <EditableText path="marketing.manual.sections.start.employee_title" fallback="Medewerkerskiosk · /kiosk" as="h3" label="Handleiding · Medewerkerskiosk" className="mt-2 text-xl font-black" />
              <EditableText path="marketing.manual.sections.start.employee_description" fallback="Een medewerker of beheerder zoekt een locatie, appartement of huurder, bekijkt het financiële overzicht en registreert een ontvangen betaling."
                as="p" multiline label="Handleiding · Medewerkerskiosk uitleg" className="mt-3 text-sm leading-6 text-white/75" />
            </article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
              <EditableText path="marketing.manual.sections.start.tenant_label" fallback="Voor huurders" as="p" label="Handleiding · Huurderslabel" className="text-xs font-black uppercase tracking-[0.16em] text-[#E65300]" />
              <EditableText path="marketing.manual.sections.start.tenant_title" fallback="Huurdersportaal · /kiosk/huurder" as="h3" label="Handleiding · Huurdersportaal" className="mt-2 text-xl font-black" />
              <EditableText path="marketing.manual.sections.start.tenant_description" fallback="Een huurder meldt zich aan met de methode die op het portaal beschikbaar is, controleert het saldo en kan een betaling met bankbewijs ter controle indienen."
                as="p" multiline label="Handleiding · Huurdersportaal uitleg" className="mt-3 text-sm leading-6 text-slate-600" />
            </article>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <InfoCard title="Wie mag beheren?" tone="blue">
              De beheerder heeft toegang tot het beheermenu. Medewerkers zien alleen de onderdelen die bij hun account horen. Deel geen beheer-PIN met huurders.
            </InfoCard>
            <InfoCard title="PIN’s zijn niet hetzelfde">
              De kiosk-login-PIN voor personeel, de persoonlijke inlog-PIN en eventuele portaltoegang voor huurders zijn verschillende gegevens. Deel PIN’s alleen met de bedoelde gebruiker.
            </InfoCard>
          </div>
        </section>

        <section id="inrichten" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <EditableText path="marketing.manual.sections.setup.eyebrow" fallback="A tot Z · eerste keer" as="p" label="Handleiding · Inrichten label" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
          <EditableText path="marketing.manual.sections.setup.title" fallback="Richt je beheer in deze volgorde in." as="h2" label="Handleiding · Inrichten titel" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl" />
          <EditableText path="marketing.manual.sections.setup.description" fallback="Volg eerst deze vier verplichte stappen in Kiosk Beheer. De Setup Wizard opent automatisch voor nieuwe beheerders en helpt je met dezelfde volgorde."
            as="p" multiline label="Handleiding · Inrichten uitleg" className="mt-3 max-w-3xl text-sm leading-6 text-slate-600" />
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <StepCard number="01" title="Instellingen: vul bedrijfsgegevens in">
              Open <strong>Instellingen</strong> in Kiosk Beheer. Vul de bedrijfsnaam en minimaal één contactgegeven (e-mail of telefoon) in. Controleer ook het adres; deze gegevens kunnen op communicatie en documenten verschijnen.
            </StepCard>
            <StepCard number="02" title="Maak een locatie aan">
              Ga naar <strong>Locaties</strong> en maak het gebouw, complex of de vestiging aan. Geef de locatie een herkenbare naam en vul het adres in.
            </StepCard>
            <StepCard number="03" title="Voeg een appartement toe">
              Maak het appartement aan, vul het nummer en de maandhuur in en koppel het aan de locatie uit stap 2. Controleer valuta en gegevens voordat je opslaat.
            </StepCard>
            <StepCard number="04" title="Maak een huurder en koppel die">
              Voeg de huurder toe en selecteer het juiste appartement. Controleer de koppeling; zo verschijnt de huurder bij de juiste woning in Kiosk Beheer en de kiosk.
            </StepCard>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <InfoCard title="Niet alles is verplicht">
              De basis is compleet als je bedrijfsgegevens, een locatie, een appartement en een gekoppelde huurder hebt ingesteld.
            </InfoCard>
            <InfoCard title="Daarna: breid je beheer uit" tone="blue">
              Voeg indien nodig contracten, borg en medewerkers toe. SMTP, factuurautomatisering, Stripe, printers en branding kun je later instellen.
            </InfoCard>
          </div>
        </section>

        <section id="kiosk" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <EditableText path="marketing.manual.sections.kiosk.eyebrow" fallback="Voor medewerkers" as="p" label="Handleiding · Kiosk label" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
          <EditableText path="marketing.manual.sections.kiosk.title" fallback="Een betaling registreren in de kiosk." as="h2" label="Handleiding · Kiosk titel" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl" />
          <div className="mt-6 grid gap-3">
            <StepCard number="01" title="Meld je aan">
              Open <strong>/kiosk</strong> en voer je viercijferige PIN in. De beheerder-PIN en medewerkers-PIN geven verschillende toegangsrechten.
            </StepCard>
            <StepCard number="02" title="Zoek de juiste woning of huurder">
              Kies zo nodig eerst een locatie en daarna het appartement. Gebruik zoeken of een gekoppelde NFC-tag als dat op jouw apparaat is ingericht.
            </StepCard>
            <StepCard number="03" title="Controleer het financiële overzicht">
              Controleer de naam van de huurder, het appartement, het openstaande saldo en de relevante factuurperiode. Klopt de informatie niet, registreer dan nog geen betaling en vraag de beheerder om de gegevens te controleren.
            </StepCard>
            <StepCard number="04" title="Kies het te betalen bedrag">
              Tik op <strong>Betalen</strong>, selecteer de openstaande factuur of termijn en controleer bedrag en omschrijving. Controleer extra goed bij een deelbetaling of vooruitbetaling.
            </StepCard>
            <StepCard number="05" title="Kies de betaalmethode">
              Kies de methode die overeenkomt met de betaling die je daadwerkelijk hebt ontvangen. Creditcard/iDEAL verschijnt alleen als de online betaalintegratie is ingesteld.
            </StepCard>
            <StepCard number="06" title="Bevestig en geef de kwitantie">
              Controleer huurder, appartement, bedrag en betaalmethode nogmaals en bevestig. De kiosk toont daarna de kwitantie en het resterende saldo. Print of deel de kwitantie als de beschikbare opties en printer dat ondersteunen.
            </StepCard>
            <StepCard number="07" title="Rond af voor de volgende huurder">
              Kies <strong>Volgende huurder</strong> of wacht tot het scherm terugkeert. Op de kiosk kun je met de thema-knop wisselen tussen de witte en oranje weergave. Gebruik <strong>Uit</strong> om de kiosksessie op een gedeeld toestel veilig af te sluiten.
            </StepCard>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <EditableLink path="marketing.manual.images.staff.href" href="/kiosk-icons/screenshots/02_kiosk_pin.jpg" label="Handleiding · Medewerkerscreenshot link" target="_blank" rel="noreferrer"
                aria-label="Kiosk PIN-login screenshot openen op ware grootte">
                <EditableImage path="marketing.manual.images.staff.src" fallback="/kiosk-icons/screenshots/02_kiosk_pin.jpg" alt="Startscherm van de medewerkerskiosk met viercijferige PIN-toetsen"
                  label="Handleiding · Medewerkerscreenshot" className="max-h-[520px] w-full bg-orange-50 object-contain" />
              </EditableLink>
              <EditableText path="marketing.manual.images.staff.caption" fallback="Voorbeeld · medewerkerskiosk aanmelden met PIN" as="figcaption" label="Handleiding · Medewerkerscreenshot bijschrift" className="px-4 py-3 text-xs font-bold text-slate-700" />
            </figure>
            <div className="flex items-center rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
              <EditableText path="marketing.manual.sections.kiosk.security_note" fallback="Meld je aan met de PIN van jouw account. Het voorbeeld toont alleen het PIN-scherm; voer altijd je eigen PIN in en deel die niet."
                as="div" multiline label="Handleiding · PIN veiligheidsnotitie" />
            </div>
          </div>
        </section>

        <section id="huurdersportaal" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <EditableText path="marketing.manual.sections.tenant.eyebrow" fallback="Voor huurders" as="p" label="Handleiding · Huurderslabel" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
          <EditableText path="marketing.manual.sections.tenant.title" fallback="Een betaling aanmelden via het huurdersportaal." as="h2" label="Handleiding · Huurderstitel" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl" />
          <EditableText path="marketing.manual.sections.tenant.description" fallback="Het huurdersportaal is een andere omgeving dan de medewerkerskiosk. De beschikbare betaal- en aanmeldopties kunnen afhangen van de bedrijfsinrichting."
            as="p" multiline label="Handleiding · Huurdersportaal uitleg" className="mt-3 max-w-3xl text-sm leading-6 text-slate-600" />
          <div className="mt-6 grid gap-3">
            <StepCard number="01" title="Open het huurdersportaal">
              Ga naar <strong>/kiosk/huurder</strong> of open de link die de verhuurder heeft verstrekt. Meld je aan met de methode die op het scherm wordt getoond. Als NFC wordt gevraagd, gebruik dan de aan jou gekoppelde kaart/tag of volg de instructie van je verhuurder.
            </StepCard>
            <StepCard number="02" title="Controleer je saldo">
              Controleer in het financiële overzicht je naam, appartement, openstaande posten en factuurperiode. Neem bij onjuiste gegevens contact op met de beheerder voordat je betaalt.
            </StepCard>
            <StepCard number="03" title="Selecteer wat je wilt betalen">
              Kies de factuur of termijn die je wilt voldoen en controleer het bedrag en de periode voordat je verdergaat.
            </StepCard>
            <StepCard number="04" title="Maak de bankoverschrijving">
              Volg de getoonde betaalinstructies en kies de juiste bank/land-optie. Gebruik de gegevens op het scherm en bewaar je betalingsbewijs.
            </StepCard>
            <StepCard number="05" title="Upload het betalingsbewijs">
              Voeg het gevraagde bewijs toe (PDF, JPG of PNG; maximaal 5 MB) en controleer de samenvatting. Verstuur de betaling ter controle.
            </StepCard>
            <StepCard number="06" title="Bewaar de bevestiging">
              Wacht op de bevestiging in het portaal. Een aangemelde betaling is niet altijd meteen als definitief verwerkt zichtbaar; controle en verwerking kunnen nodig zijn. Je kunt eerdere betalingen terugvinden in de betalingsgeschiedenis.
            </StepCard>
          </div>
          <div className="mt-4">
            <InfoCard title="Aanmelden kan per portaal verschillen" tone="blue">
              Beheer kan portaltoegang voor een huurder instellen, maar het portaal kan ook om een NFC-tag vragen. Volg de aanmeldmethode die daadwerkelijk op het scherm staat en vraag de beheerder om hulp als die niet werkt.
            </InfoCard>
          </div>
          <figure className="mt-6 max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <EditableLink path="marketing.manual.images.tenant.href" href="/kiosk-icons/screenshots/03_tenant_login.jpg" label="Handleiding · Huurderscreenshot link" target="_blank" rel="noreferrer"
              aria-label="Huurdersportaal login screenshot openen op ware grootte">
              <EditableImage path="marketing.manual.images.tenant.src" fallback="/kiosk-icons/screenshots/03_tenant_login.jpg" alt="Aanmeldscherm van het SuriRent-huurdersportaal"
                label="Handleiding · Huurderscreenshot" className="max-h-[520px] w-full bg-orange-50 object-contain" />
            </EditableLink>
            <EditableText path="marketing.manual.images.tenant.caption" fallback="Voorbeeld · aanmelden bij het huurdersportaal" as="figcaption" label="Handleiding · Huurderscreenshot bijschrift" className="px-4 py-3 text-xs font-bold text-slate-700" />
          </figure>
        </section>

        <section id="beheer" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <EditableText path="marketing.manual.sections.admin.eyebrow" fallback="Voor beheerders" as="p" label="Handleiding · Beheerlabel" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
          <EditableText path="marketing.manual.sections.admin.title" fallback="Kiosk Beheer: wat vind je waar?" as="h2" label="Handleiding · Beheertitel" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl" />
          <EditableText path="marketing.manual.sections.admin.description" fallback="Open Beheer vanuit het dashboard of het beheermenu in de kiosk. De beschikbare pagina’s hangen af van je rol; een boekhouder heeft bijvoorbeeld minder menu’s dan een beheerder."
            as="p" multiline label="Handleiding · Beheerintro" className="mt-3 max-w-3xl text-sm leading-6 text-slate-600" />
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {ADMIN_MODULES.map(([title, description], index) => (
              <article key={title} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-5" data-testid={`manual-admin-module-${index + 1}`}>
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#FF5C00]" />
                <div>
                  <EditableText path={`marketing.manual.admin_modules.${index}.title`} fallback={title} as="h3" label={`Handleiding · Beheermodule ${index + 1}`} className="font-black text-[#0B1B3F]" />
                  <EditableText path={`marketing.manual.admin_modules.${index}.description`} fallback={description} as="p" multiline label={`Handleiding · Beheermodule ${index + 1} uitleg`} className="mt-1.5 text-sm leading-6 text-slate-600" />
                </div>
              </article>
            ))}
          </div>
          <div className="mt-4">
            <InfoCard title="Betalingen van medewerkers">
              Controleer regelmatig het onderdeel <strong>Betalingen</strong>, waaronder eventuele betalingen die op goedkeuring wachten. De beschikbare goedkeuringsstappen kunnen afhangen van de gebruikersrol en de manier waarop de betaling is ingediend.
            </InfoCard>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <InfoCard title="Beheerder" tone="blue">
              Voor de volledige inrichting en het beheren van gebruikers en instellingen.
            </InfoCard>
            <InfoCard title="Boekhouder" tone="blue">
              Voor financiële werkzaamheden; niet alle beheer- en instellingsmenu’s zijn beschikbaar.
            </InfoCard>
            <InfoCard title="Kioskmedewerker" tone="blue">
              Voor werkzaamheden aan de balie en betalingen in de kiosk. Geef deze rol geen beheerdersgegevens.
            </InfoCard>
          </div>
          <EditableText path="marketing.manual.sections.admin.screenshot_note" fallback="Deze uitleg volgt de huidige onderdelen van Kiosk Beheer. Er zijn geen oude beheerscreenshots opgenomen, zodat afbeeldingen geen verouderde interface tonen."
            as="div" multiline label="Handleiding · Beheer opmerking" className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-[#71310F]" />
        </section>

        <section id="instellingen" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <EditableText path="marketing.manual.sections.settings.eyebrow" fallback="Optioneel, maar handig" as="p" label="Handleiding · Instellingenlabel" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
          <EditableText path="marketing.manual.sections.settings.title" fallback="Koppel functies die jouw organisatie nodig heeft." as="h2" label="Handleiding · Instellingentitel" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl" />
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <StepCard number="01" title="E-mail (SMTP)">
              Configureer SMTP als facturen of kwitanties via je eigen e-mailadres moeten worden verstuurd. Vul de servergegevens in en gebruik <strong>Test verbinding</strong>.
            </StepCard>
            <StepCard number="02" title="Facturen automatisering">
              Schakel dit alleen in als je facturen automatisch wilt laten aanmaken of herinneringen wilt gebruiken. Stel de factuur- en betaaltermijnen zorgvuldig in.
            </StepCard>
            <StepCard number="03" title="Stripe betalingen">
              Configureer Stripe als je huurders online met creditcard of iDEAL wilt laten betalen. Test de integratie voordat je deze betaalmethode aan huurders aanbiedt.
            </StepCard>
            <StepCard number="04" title="Bon en printer">
              Kies het bonformaat en configureer de bonprinter onder Instellingen. Bekijk bij <strong>Kiosk apparaten</strong> of gekoppelde printers online zijn en gebruik de diagnose als dat nodig is.
            </StepCard>
            <StepCard number="05" title="Backup en herstel">
              Gebruik de backupinstellingen voor een veilige kopie en volg de herstelprocedure wanneer je gegevens moet terugzetten.
            </StepCard>
            <StepCard number="06" title="NFC en QR">
              Koppel een NFC-tag aan de juiste huurder of woning voordat je deze in gebruik neemt en test hem op het doelapparaat. Een QR-plaat is een printbare PDF die je vanuit het appartement opent; kies daar het passende formaat en test de afdruk.
            </StepCard>
          </div>
        </section>

        <section id="problemen" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <EditableText path="marketing.manual.sections.problems.eyebrow" fallback="Snelle hulp" as="p" label="Handleiding · Probleemlabel" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
          <EditableText path="marketing.manual.sections.problems.title" fallback="Veelvoorkomende controles." as="h2" label="Handleiding · Probleemtitel" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl" />
          <div className="mt-6 grid gap-3">
            <StepCard number="?" title="Ik zie geen locatie of appartement">
              Controleer of de locatie en verhuureenheid zijn aangemaakt en of het appartement aan de juiste locatie is gekoppeld. Appartementen zonder locatie kunnen onder <strong>Overige</strong> staan.
            </StepCard>
            <StepCard number="?" title="De huurder of het saldo klopt niet">
              Controleer in Beheer de huurder-appartementkoppeling, huurprijs, valuta, contract- en factuurperiode en eventuele borgstatus.
            </StepCard>
            <StepCard number="?" title="De huurder kan niet aanmelden">
              Controleer of de gebruikte kaart/tag aan de juiste huurder is gekoppeld en of het portaal onder de juiste bedrijfslink wordt geopend. Laat de huurder geen beheerder-PIN gebruiken.
            </StepCard>
            <StepCard number="?" title="Een betaling of kwitantie is niet zichtbaar">
              Controleer de betalingsgeschiedenis en Beheer → Betalingen. Kijk of de betaling nog ter controle staat en controleer de verbinding, e-mail- en printerinstellingen indien van toepassing.
            </StepCard>
            <StepCard number="?" title="De printer werkt niet">
              Controleer stroom en netwerk/bluetooth, de geselecteerde printer bij Instellingen en de online-status onder Kiosk apparaten. Probeer daarna opnieuw met een kleine testbon.
            </StepCard>
          </div>
          <div className="mt-4">
            <InfoCard title="Veilig gebruik" tone="blue">
              Houd wachtwoorden en PIN’s privé, controleer bedragen vóór bevestiging en meld je af op gedeelde kiosktoestellen. Upload of deel alleen betalingsbewijzen van de bedoelde betaling.
            </InfoCard>
          </div>
        </section>

        <section className="scroll-mt-28">
          <div className="flex flex-col gap-5 rounded-3xl bg-[#0B1B3F] p-7 text-white sm:p-9 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[#FF8A3D]"><CircleHelp className="h-4 w-4" /> <EditableText path="marketing.manual.support.eyebrow" fallback="Hulp nodig?" as="span" label="Handleiding · Hulp label" /></p>
              <EditableText path="marketing.manual.support.title" fallback="Kom je er niet uit?" as="h2" label="Handleiding · Hulptitel" className="mt-2 text-2xl font-black sm:text-3xl" />
              <EditableText path="marketing.manual.support.description" fallback="Neem contact op met je SuriRent-beheerder of stuur ons een bericht voor hulp met de inrichting."
                as="p" multiline label="Handleiding · Hulptoelichting" className="mt-2 max-w-xl text-sm leading-6 text-white/70" />
            </div>
            <EditableLink path="marketing.manual.support.href" href="/contact" label="Handleiding · Contactlink"
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-5 text-sm font-black text-white transition hover:bg-[#E65300]">
              <EditableText path="marketing.manual.support.button" fallback="Contact opnemen" as="span" label="Handleiding · Contactknop" /> <ArrowRight className="h-4 w-4" />
            </EditableLink>
          </div>
        </section>
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] px-5 pb-10 sm:px-8 lg:px-10">
        <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <EditableText path="marketing.manual.disclaimer" fallback="De exacte opties kunnen verschillen per accountrol, abonnement, ingestelde betaalmethoden en aangesloten apparaten. Volg altijd de actuele instructies op het scherm."
            as="span" multiline label="Handleiding · Disclaimer" />
        </p>
      </div>
    </main>
  );
}
