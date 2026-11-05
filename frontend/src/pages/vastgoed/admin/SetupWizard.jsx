import { useState, useEffect, useCallback } from 'react';
import {
  Building2, CheckCircle2, Home, User, ArrowRight, ArrowLeft,
  Loader2, Mail, Phone, MapPin, AlertCircle, Check, PartyPopper,
  FileText, ShieldCheck,
} from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import {
  SmtpForm,
  InvoicingForm,
  DepositForm,
} from './Settings';

const CORE_STEP_IDS = ['profile', 'locations', 'apartment', 'tenant'];

const STEPS = [
  { id: 'profile', label: 'Bedrijfsgegevens', icon: Building2 },
  { id: 'smtp', label: 'E-mail (SMTP)', icon: Mail, settings: true },
  { id: 'invoicing', label: 'Facturen automatisering', icon: FileText, settings: true },
  { id: 'deposit', label: 'Borg instellingen', icon: ShieldCheck, settings: true },
  { id: 'locations', label: 'Locaties aanmaken', icon: MapPin },
  { id: 'apartment', label: 'Appartementen aanmaken', icon: Home },
  { id: 'tenant', label: 'Huurders aanmaken of koppelen', icon: User },
];

export default function SetupWizard({ onFinish } = {}) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [savedSettings, setSavedSettings] = useState({});
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [profile, setProfile] = useState({});
  const [apartment, setApartment] = useState({ number: '', address: '', rent_amount: '', currency: 'SRD', location_id: '' });
  const [tenant, setTenant] = useState({ mode: 'new', name: '', phone: '', email: '', apartment_id: '', existing_tenant_id: '' });
  const [apts, setApts] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [locations, setLocations] = useState([]);
  const [location, setLocation] = useState({ name: '', address: '' });

  const loadStatus = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [{ data: st }, { data: prof }, { data: aptList }, { data: settingsData }, { data: locationList }, { data: tenantList }] = await Promise.all([
        api.get('/companies/me/setup-status'),
        api.get('/companies/me/branding'),
        api.get('/apartments'),
        api.get('/settings'),
        api.get('/locations'),
        api.get('/tenants'),
      ]);
      setStatus(st);
      setProfile(prof || {});
      setApts(aptList || []);
      setTenants(tenantList || []);
      setLocations(locationList || []);
      setSettings(settingsData);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const currentStep = STEPS[idx];
  const nextStep = () => { if (idx === STEPS.length - 1) { onFinish?.(); return; } setIdx((i) => Math.min(i + 1, STEPS.length - 1)); };
  const prevStep = () => setIdx((i) => Math.max(i - 1, 0));
  const showOk = (txt) => { setMsg(txt); setTimeout(() => setMsg(''), 2500); };

  const formStepDone = (id) => (status?.steps || []).find((s) => s.id === id)?.done;
  const stepDone = (id) => {
    if (CORE_STEP_IDS.includes(id)) return formStepDone(id);
    if (id === 'deposit') return Number(settings?.deposit?.rent_multiplier) > 0;
    // Voor settings-secties: zichtbaar als "klaar" wanneer enabled in settings
    if (settings && settings[id]?.enabled) return true;
    return false;
  };

  const requiredIds = CORE_STEP_IDS;
  const allDone = requiredIds.every((id) => stepDone(id)) && stepDone('tenant');

  const saveProfile = async () => {
    setSaving(true); setErr('');
    try {
      if (!profile.name?.trim()) { setErr('Bedrijfsnaam is verplicht'); return false; }
      if (!profile.contact_email?.trim() && !profile.contact_phone?.trim()) {
        setErr('Vul een contact-e-mailadres of telefoonnummer in'); return false;
      }
      await api.put('/companies/me/profile', {
        name: profile.name || '',
        contact_email: profile.contact_email || '',
        contact_phone: profile.contact_phone || '',
        address: profile.address || '',
        bank_account_sr: profile.bank_account_sr || '',
        bank_account_nl: profile.bank_account_nl || '',
      });
      await loadStatus();
      showOk('Opgeslagen!');
      return true;
    } catch (e) { setErr(formatError(e)); return false; }
    finally { setSaving(false); }
  };

  const createLocation = async () => {
    setSaving(true); setErr('');
    try {
      if (!location.name.trim()) { setErr('Naam van de locatie is verplicht'); return false; }
      const { data } = await api.post('/locations', {
        name: location.name.trim(),
        address: location.address.trim(),
      });
      setLocations((prev) => [...prev, data]);
      setApartment((prev) => ({ ...prev, location_id: data.id }));
      await loadStatus();
      showOk(`Locatie ${data.name} aangemaakt`);
      setLocation({ name: '', address: '' });
      return true;
    } catch (e) { setErr(formatError(e)); return false; }
    finally { setSaving(false); }
  };

  const createApartment = async () => {
    setSaving(true); setErr('');
    try {
      if (!apartment.number?.trim()) { setErr('Huisnummer is verplicht'); return false; }
      if (!apartment.location_id) { setErr('Kies de locatie van dit appartement'); return false; }
      if (!Number(apartment.rent_amount) || Number(apartment.rent_amount) <= 0) {
        setErr('Huurprijs moet > 0 zijn'); return false;
      }
      const { data } = await api.post('/apartments', {
        number: apartment.number.trim(),
        address: apartment.address || '',
        rent_amount: Number(apartment.rent_amount),
        currency: apartment.currency || 'SRD',
        location_id: apartment.location_id,
      });
      setApts((prev) => [...prev, data]);
      setTenant((t) => ({ ...t, apartment_id: data.id }));
      await loadStatus();
      showOk(`Appartement ${data.number} aangemaakt`);
      setApartment({ number: '', address: '', rent_amount: '', currency: 'SRD', location_id: '' });
      return true;
    } catch (e) { setErr(formatError(e)); return false; }
    finally { setSaving(false); }
  };

  const createTenant = async () => {
    setSaving(true); setErr('');
    try {
      if (!tenant.apartment_id) { setErr('Kies het appartement waaraan je de huurder wilt koppelen'); return false; }
      const selectedApartment = apts.find((item) => item.id === tenant.apartment_id);
      if (!selectedApartment || selectedApartment.tenant_id || selectedApartment.status === 'occupied') {
        setErr('Kies een leeg appartement om een huurder te koppelen');
        return false;
      }
      if (tenant.mode === 'existing') {
        if (!tenant.existing_tenant_id) { setErr('Kies een bestaande huurder'); return false; }
        await api.post(`/apartments/${tenant.apartment_id}/assign-tenant`, { tenant_id: tenant.existing_tenant_id });
        await loadStatus();
        const selected = tenants.find((item) => item.id === tenant.existing_tenant_id);
        showOk(`Huurder ${selected?.name || ''} gekoppeld`);
        return true;
      }
      if (!tenant.name?.trim()) { setErr('Naam is verplicht'); return false; }
      await api.post('/tenants', {
        name: tenant.name.trim(),
        phone: tenant.phone || '',
        email: tenant.email || '',
        apartment_id: tenant.apartment_id || null,
      });
      await loadStatus();
      showOk(`Huurder ${tenant.name} aangemaakt`);
      setTenant({ mode: 'new', name: '', phone: '', email: '', apartment_id: '', existing_tenant_id: '' });
      return true;
    } catch (e) { setErr(formatError(e)); return false; }
    finally { setSaving(false); }
  };

  return (
    <div className="w-full max-w-screen-2xl mx-auto space-y-4 md:space-y-5" data-testid="setup-wizard">
      {/* Step pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2" data-testid="wizard-steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = stepDone(s.id);
          const active = i === idx;
          const disabled = i > idx;
          return (
            <button key={s.id} onClick={() => setIdx(i)}
              disabled={disabled}
              data-testid={`wizard-step-${s.id}`}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-40
                ${active ? 'bg-[#0B1B3F] text-white shadow-md shadow-[#0B1B3F]/15' : done ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-white text-slate-500 border border-slate-200 hover:border-[#FF8A3D]'}`}>
              {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              <span>{i + 1}. {s.label}</span>
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="bg-white border border-slate-200/90 rounded-3xl shadow-[0_10px_35px_-24px_rgba(11,27,63,0.45)] p-4 sm:p-7">
        {err && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 mb-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-bold">
              <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 flex-shrink-0" /> {err}</span>
              <button type="button" onClick={loadStatus} className="shrink-0 underline underline-offset-2">Opnieuw proberen</button>
          </div>
        )}
        {msg && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm font-bold">
            <Check className="w-4 h-4 flex-shrink-0" /> {msg}
          </div>
        )}

        {currentStep.id === 'profile' && <StepProfile profile={profile} setProfile={setProfile} />}
        {currentStep.settings && settings && (
          <SettingsSectionWrapper
            step={currentStep}
            settings={settings}
            onSaved={(values) => {
              setSettings((current) => ({ ...current, [currentStep.id]: values }));
              setSavedSettings((current) => ({ ...current, [currentStep.id]: true }));
            }}
            onDirty={() => setSavedSettings((current) => ({ ...current, [currentStep.id]: false }))}
          />
        )}
        {currentStep.id === 'locations' && <StepLocation location={location} setLocation={setLocation} locations={locations} />}
        {currentStep.id === 'apartment' && <StepApartment apartment={apartment} setApartment={setApartment} apts={apts} locations={locations} />}
        {currentStep.id === 'tenant' && <StepTenant tenant={tenant} setTenant={setTenant} apts={apts} tenants={tenants} status={status} />}

        {/* Navigation */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 mt-6 -mx-4 px-4 py-3 border-t border-slate-200 bg-white/95 backdrop-blur-sm sm:-mx-7 sm:px-7">
          <button onClick={prevStep} disabled={idx === 0}
            data-testid="wizard-prev"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowLeft className="w-4 h-4" /> Vorige
          </button>

          {currentStep.id === 'profile' && (
            <button onClick={async () => { if (await saveProfile()) nextStep(); }} disabled={saving}
              data-testid="wizard-save-and-next"
              className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-gradient-to-r from-[#FF8A3D] to-[#FF5C00] text-white font-black shadow-md active:scale-95 transition disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Opslaan & volgende'}
              {!saving && <ArrowRight className="w-4 h-4" />}
            </button>
          )}
          {currentStep.id === 'locations' && (
            <div className="flex items-center gap-2">
              {!formStepDone('locations') ? (
                <button onClick={async () => { if (await createLocation()) nextStep(); }} disabled={saving}
                  data-testid="wizard-save-location"
                  className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-gradient-to-r from-[#FF8A3D] to-[#FF5C00] text-white font-black shadow-md active:scale-95 transition disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Locatie aanmaken'}
                  {!saving && <ArrowRight className="w-4 h-4" />}
                </button>
              ) : (
                <button onClick={nextStep} data-testid="wizard-next"
                  className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-[#0B1B3F] hover:bg-[#17325E] text-white font-black transition">
                  Volgende <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {currentStep.id === 'apartment' && (
            <div className="flex items-center gap-2">
              {!formStepDone('apartment') && (
                <button onClick={async () => { if (await createApartment()) nextStep(); }} disabled={saving}
                  data-testid="wizard-save-apartment"
                  className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-gradient-to-r from-[#FF8A3D] to-[#FF5C00] text-white font-black shadow-md active:scale-95 transition disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aanmaken & volgende'}
                  {!saving && <ArrowRight className="w-4 h-4" />}
                </button>
              )}
              {formStepDone('apartment') && (
                <button onClick={nextStep} data-testid="wizard-next"
                  className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-[#0B1B3F] hover:bg-[#17325E] text-white font-black transition">
                  Volgende <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {currentStep.id === 'tenant' && (
            <div className="flex items-center gap-2">
              {!stepDone('tenant') && (
                <button onClick={async () => { if (await createTenant()) nextStep(); }} disabled={saving}
                  data-testid="wizard-save-tenant"
                  className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-gradient-to-r from-[#FF8A3D] to-[#FF5C00] text-white font-black shadow-md active:scale-95 transition disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : tenant.mode === 'existing' ? 'Koppelen & volgende' : 'Aanmaken & volgende'}
                  {!saving && <ArrowRight className="w-4 h-4" />}
                </button>
              )}
              {stepDone('tenant') && (
                <button onClick={nextStep} data-testid="wizard-next"
                  className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-[#0B1B3F] hover:bg-[#17325E] text-white font-black transition">
                  {idx === STEPS.length - 1 ? 'Afronden' : 'Volgende'} <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {currentStep.settings && (
            <button onClick={nextStep} disabled={!savedSettings[currentStep.id]} data-testid="wizard-next"
              className="flex items-center gap-1.5 px-5 h-11 rounded-xl bg-[#0B1B3F] hover:bg-[#17325E] text-white font-black transition disabled:opacity-50 disabled:cursor-not-allowed">
              {savedSettings[currentStep.id] ? 'Volgende' : 'Bewaar eerst'} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {allDone && (
        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5 text-center" data-testid="wizard-complete">
          <PartyPopper className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
          <h3 className="text-lg font-extrabold text-emerald-800 mb-1">Setup compleet!</h3>
          <p className="text-sm text-emerald-700">
            Bedrijfsgegevens, e-mail, facturen, borg, locaties, appartementen en huurders zijn ingesteld.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SETTINGS WRAPPER — embed Settings.jsx sub-forms inline
// ============================================================
function SettingsSectionWrapper({ step, settings, onSaved, onDirty }) {
  return (
    <div data-testid={`wizard-settings-${step.id}`}>
      <div className="mb-3">
        <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
          <step.icon className="w-5 h-5" /> {step.label}
        </h3>
      </div>
      {step.id === 'smtp' && <SmtpForm initial={settings.smtp} onSaved={onSaved} onDirty={onDirty} />}
      {step.id === 'invoicing' && <InvoicingForm initial={settings.invoicing} onSaved={onSaved} onDirty={onDirty} />}
      {step.id === 'deposit' && <DepositForm initial={settings.deposit} onSaved={onSaved} onDirty={onDirty} />}
      <p className="mt-3 text-xs text-slate-500">
        Sla je instellingen op met de knop in het formulier en kies daarna <strong>Volgende</strong>.
      </p>
    </div>
  );
}

// ============================================================
// FORM-STAP COMPONENTS
// ============================================================
function FormField({ label, icon: Icon, ...inputProps }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </span>
      <input {...inputProps}
        className="w-full h-10 px-3 border-2 border-slate-200 rounded-lg text-sm focus:border-slate-900 focus:outline-none" />
    </label>
  );
}

function StepProfile({ profile, setProfile }) {
  const upd = (k, v) => setProfile((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3" data-testid="wizard-profile">
      <div className="mb-2">
        <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><Building2 className="w-5 h-5" /> Bedrijfsgegevens</h3>
        <p className="text-xs text-slate-500">Deze info verschijnt op kwitanties, contracten en de gouden QR-plaquette.</p>
      </div>
      <FormField label="Bedrijfsnaam *" value={profile.name || ''} onChange={(e) => upd('name', e.target.value)}
        placeholder="bv. SuriRent N.V." data-testid="wizard-name" />
      <FormField icon={Mail} label="Contact e-mail" type="email" value={profile.contact_email || ''}
        onChange={(e) => upd('contact_email', e.target.value)} placeholder="info@bedrijf.sr" data-testid="wizard-email" />
      <FormField icon={Phone} label="Telefoonnummer" type="tel" value={profile.contact_phone || ''}
        onChange={(e) => upd('contact_phone', e.target.value)} placeholder="+597 ..." data-testid="wizard-phone" />
      <FormField icon={MapPin} label="Adres" value={profile.address || ''} onChange={(e) => upd('address', e.target.value)}
        placeholder="Straat 123, Paramaribo" data-testid="wizard-address" />
      <div className="grid grid-cols-2 gap-3 mt-3">
        <FormField label="🇸🇷 Suriname bank (optioneel)" value={profile.bank_account_sr || ''}
          onChange={(e) => upd('bank_account_sr', e.target.value)}
          placeholder="DSB Bank — 12.34.56.789" data-testid="wizard-bank-sr" />
        <FormField label="🇳🇱 Nederlandse IBAN (optioneel)" value={profile.bank_account_nl || ''}
          onChange={(e) => upd('bank_account_nl', e.target.value)}
          placeholder="NL12RABO0123456789" data-testid="wizard-bank-nl" />
      </div>
    </div>
  );
}

function StepLocation({ location, setLocation, locations }) {
  const upd = (key, value) => setLocation((current) => ({ ...current, [key]: value }));
  return (
    <div className="space-y-3" data-testid="wizard-location">
      <div className="mb-2">
        <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><MapPin className="w-5 h-5" /> Eerste locatie</h3>
        <p className="text-xs text-slate-500">Maak een locatie aan om je appartementen overzichtelijk te groeperen.</p>
      </div>
      {locations.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Je hebt al {locations.length} {locations.length === 1 ? 'locatie' : 'locaties'}. Je kunt doorgaan of nog een locatie toevoegen.
        </div>
      )}
      <FormField label="Naam locatie *" value={location.name} onChange={(e) => upd('name', e.target.value)}
        placeholder="Bijv. Residentie Palm" data-testid="wizard-location-name" />
      <FormField label="Adres" value={location.address} onChange={(e) => upd('address', e.target.value)}
        placeholder="Straat 123, Paramaribo" data-testid="wizard-location-address" />
    </div>
  );
}

function StepApartment({ apartment, setApartment, apts, locations }) {
  const upd = (k, v) => setApartment((a) => ({ ...a, [k]: v }));
  return (
    <div className="space-y-3" data-testid="wizard-apartment">
      <div className="mb-2">
        <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><Home className="w-5 h-5" /> Appartementen</h3>
        <p className="text-xs text-slate-500">Voeg minimaal één appartement toe — daarna kun je een huurder eraan koppelen.</p>
      </div>
      {apts.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
          ✓ Je hebt al {apts.length} appartement{apts.length === 1 ? '' : 'en'}: {apts.slice(0, 5).map((a) => a.number).join(', ')}
          {apts.length > 5 ? ` en ${apts.length - 5} meer` : ''}.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Huisnummer *" value={apartment.number} onChange={(e) => upd('number', e.target.value)}
          placeholder="bv. 7B" data-testid="wizard-apt-number" />
        <FormField label="Huurprijs per maand *" type="number" value={apartment.rent_amount}
          onChange={(e) => upd('rent_amount', e.target.value)} placeholder="7000" data-testid="wizard-apt-rent" />
      </div>
      <label className="block">
        <span className="block text-xs font-bold text-slate-700 mb-1">Valuta</span>
        <select value={apartment.currency} onChange={(e) => upd('currency', e.target.value)}
          data-testid="wizard-apt-currency"
          className="w-full h-10 px-3 border-2 border-slate-200 rounded-lg text-sm focus:border-slate-900 focus:outline-none">
          <option value="SRD">SRD</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
      </label>
      <FormField label="Adres (optioneel)" value={apartment.address} onChange={(e) => upd('address', e.target.value)}
        placeholder="Hoofdstraat 12B, Paramaribo" data-testid="wizard-apt-address" />
      <label className="block">
        <span className="block text-xs font-bold text-slate-700 mb-1">Locatie *</span>
        <select value={apartment.location_id || ''} onChange={(e) => upd('location_id', e.target.value)}
          data-testid="wizard-apt-location"
          className="w-full h-10 px-3 border-2 border-slate-200 rounded-lg text-sm focus:border-slate-900 focus:outline-none bg-white">
          <option value="">Kies een locatie</option>
          {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
  );
}

function StepTenant({ tenant, setTenant, apts, tenants, status }) {
  const upd = (k, v) => setTenant((t) => ({ ...t, [k]: v }));
  const availableTenants = tenants.filter((item) => !item.apartment_id || item.apartment_id === tenant.apartment_id);
  return (
    <div className="space-y-3" data-testid="wizard-tenant">
      <div className="mb-2">
        <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><User className="w-5 h-5" /> Huurders</h3>
        <p className="text-xs text-slate-500">Maak een huurder aan of koppel een bestaande huurder aan een appartement.</p>
      </div>
      {(status?.counts?.tenants || 0) > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
          ✓ Je hebt al {status.counts.tenants} huurder{status.counts.tenants === 1 ? '' : 's'}.
        </div>
      )}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Huurder toevoegen">
        <button type="button" onClick={() => upd('mode', 'new')} data-testid="wizard-tenant-mode-new"
          className={`h-10 rounded-xl border-2 text-sm font-bold ${tenant.mode === 'new' ? 'border-[#FF5C00] bg-orange-50 text-[#C74600]' : 'border-slate-200 text-slate-600'}`}>
          Nieuwe huurder
        </button>
        <button type="button" onClick={() => upd('mode', 'existing')} data-testid="wizard-tenant-mode-existing"
          disabled={availableTenants.length === 0}
          className={`h-10 rounded-xl border-2 text-sm font-bold disabled:opacity-40 ${tenant.mode === 'existing' ? 'border-[#FF5C00] bg-orange-50 text-[#C74600]' : 'border-slate-200 text-slate-600'}`}>
          Bestaande huurder koppelen
        </button>
      </div>
      {tenant.mode === 'existing' ? (
        <label className="block">
          <span className="block text-xs font-bold text-slate-700 mb-1">Bestaande huurder *</span>
          <select value={tenant.existing_tenant_id} onChange={(e) => upd('existing_tenant_id', e.target.value)}
            data-testid="wizard-existing-tenant"
            className="w-full h-10 px-3 border-2 border-slate-200 rounded-lg text-sm focus:border-slate-900 focus:outline-none">
            <option value="">Kies een huurder</option>
            {availableTenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      ) : (
        <>
          <FormField label="Naam *" value={tenant.name} onChange={(e) => upd('name', e.target.value)}
            placeholder="bv. Jan Jansen" data-testid="wizard-tenant-name" />
          <div className="grid grid-cols-2 gap-3">
            <FormField icon={Phone} label="Telefoon" type="tel" value={tenant.phone}
              onChange={(e) => upd('phone', e.target.value)} placeholder="+597 ..." data-testid="wizard-tenant-phone" />
            <FormField icon={Mail} label="E-mail" type="email" value={tenant.email}
              onChange={(e) => upd('email', e.target.value)} placeholder="huurder@..." data-testid="wizard-tenant-email" />
          </div>
        </>
      )}
      <label className="block">
        <span className="block text-xs font-bold text-slate-700 mb-1">Appartement *</span>
        <select value={tenant.apartment_id} onChange={(e) => upd('apartment_id', e.target.value)}
          data-testid="wizard-tenant-apt"
          className="w-full h-10 px-3 border-2 border-slate-200 rounded-lg text-sm focus:border-slate-900 focus:outline-none">
          <option value="">Kies een appartement</option>
          {apts.map((a) => (
            <option key={a.id} value={a.id} disabled={!!a.tenant_id || a.status === 'occupied'}>
              {a.number}{a.status === 'occupied' ? ' (bezet)' : ''}{a.rent_amount ? ` — ${a.currency} ${a.rent_amount}` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
