import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, Check, KeySquare, Mail,
  AlertCircle, ChevronRight, Shield, Power, PowerOff, FileText,
} from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import { useAutoRefresh } from '../../../lib/auto-refresh';

const SECTIONS = [
  { id: 'smtp', label: 'E-mail (SMTP)', icon: Mail, desc: 'Verstuur kwitanties en facturen via je eigen SMTP server.' },
  { id: 'invoicing', label: 'Facturen automatisering', icon: FileText, desc: 'Automatische maand-facturen na grace periode.' },
  { id: 'kiosk', label: 'Kiosk PIN', icon: KeySquare, desc: 'Stel de 4-cijferige toegangs-PIN voor de Kiosk in.' },
];

function FieldLabel({ children }) {
  return <label className="text-xs font-bold uppercase tracking-widest text-slate-500">{children}</label>;
}

function TextField({ label, value, onChange, type = 'text', placeholder, disabled, testid, helper }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} data-testid={testid}
        className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none disabled:bg-slate-50 disabled:text-slate-400" />
      {helper && <p className="text-[11px] text-slate-400 mt-1">{helper}</p>}
    </div>
  );
}

function SwitchField({ label, value, onChange, testid, desc }) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
      <div>
        <p className="text-sm font-bold text-slate-900">{label}</p>
        {desc && <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>}
      </div>
      <button onClick={() => onChange(!value)} data-testid={testid}
        className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-[#FF5C00]' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${value ? 'left-[1.4rem]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function SectionShell({ children, msg, err }) {
  return (
    <div className="bg-white rounded-2xl border border-orange-100 p-5 md:p-6 space-y-4">
      {err && <div className="flex gap-2 items-start text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{err}</div>}
      {msg && <div className="flex gap-2 items-start text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2"><Check className="w-4 h-4 mt-0.5 shrink-0" />{msg}</div>}
      {children}
    </div>
  );
}

function ActionRow({ onSave, onTest, saving, testing, canTest }) {
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      <button onClick={onSave} disabled={saving} data-testid="settings-save"
        className="h-11 px-5 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Bewaar
      </button>
      {onTest && (
        <button onClick={onTest} disabled={testing || !canTest} data-testid="settings-test"
          className="h-11 px-5 rounded-xl border-2 border-[#FF5C00] text-[#FF5C00] hover:bg-orange-50 font-bold flex items-center gap-2 disabled:opacity-50">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Test verbinding
        </button>
      )}
    </div>
  );
}

function useSection(section, initial) {
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // Live-sync: als de parent (SettingsPage) via useAutoRefresh een verse
  // /settings-payload heeft opgehaald (bv. een andere admin heeft SMTP
  // aangepast), krijgt deze form een NIEUWE `initial`-prop maar useState
  // hield de oude snapshot. Dirty-guard: we overschrijven de lokale state
  // alléén als de gebruiker géén ongesavede wijzigingen heeft. Anders zou
  // een SSE-refresh de invoer van een actief typende admin wissen.
  const initialRef = useRef(initial);
  const dirtyRef = useRef(false);
  useEffect(() => {
    const prev = initialRef.current;
    initialRef.current = initial;
    if (dirtyRef.current) return;
    if (JSON.stringify(prev) === JSON.stringify(initial)) return;
    setData(initial);
  }, [initial]);
  const onField = (k, v) => {
    dirtyRef.current = true;
    setData((p) => ({ ...p, [k]: v }));
  };
  const save = async () => {
    setErr(''); setMsg(''); setSaving(true);
    try {
      const { data: res } = await api.put(`/settings/${section}`, data);
      setData(res.data);
      dirtyRef.current = false;
      setMsg('Instellingen opgeslagen.');
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };
  const test = async () => {
    setErr(''); setMsg(''); setTesting(true);
    try {
      const { data: res } = await api.post(`/settings/${section}/test`);
      if (res.ok) setMsg(res.detail || 'Test geslaagd.');
      else setErr(res.detail || 'Test mislukt.');
    } catch (e) { setErr(formatError(e)); }
    finally { setTesting(false); }
  };
  return { data, setData, onField, save, test, saving, testing, msg, err, setMsg, setErr };
}

// ============== Per-section forms ==============
export function SmtpForm({ initial }) {
  const s = useSection('smtp', initial);
  const d = s.data;
  return (
    <SectionShell msg={s.msg} err={s.err}>
      <SwitchField label="Ingeschakeld" testid="smtp-enabled"
        desc="Wanneer aan kun je via e-mail kwitanties, facturen en herinneringen versturen."
        value={d.enabled} onChange={(v) => s.onField('enabled', v)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="SMTP host" testid="smtp-host" value={d.host} onChange={(v) => s.onField('host', v)} placeholder="smtp.gmail.com" />
        <TextField label="Poort" testid="smtp-port" type="number" value={d.port} onChange={(v) => s.onField('port', parseInt(v, 10) || 587)} placeholder="587" helper="465 voor SSL, 587 voor STARTTLS" />
        <TextField label="Gebruikersnaam" testid="smtp-username" value={d.username} onChange={(v) => s.onField('username', v)} placeholder="info@bedrijf.sr" />
        <TextField label="Wachtwoord" testid="smtp-password" type="password" value={d.password ?? ''} onChange={(v) => s.onField('password', v)} placeholder="••••• (laat leeg om huidige te behouden)" />
        <TextField label="Afzender naam" testid="smtp-from-name" value={d.from_name} onChange={(v) => s.onField('from_name', v)} placeholder="SuriRent N.V." />
        <TextField label="Afzender e-mail" testid="smtp-from-email" value={d.from_email} onChange={(v) => s.onField('from_email', v)} placeholder="info@surirent.sr" />
      </div>
      <SwitchField label="TLS gebruiken (STARTTLS)" testid="smtp-tls"
        value={d.use_tls} onChange={(v) => s.onField('use_tls', v)}
        desc="Aan voor poort 587. Uit voor poort 465 (impliciete SSL)." />
      <ActionRow onSave={s.save} onTest={s.test} saving={s.saving} testing={s.testing} canTest={d.enabled} />
    </SectionShell>
  );
}

export function TwilioForm({ initial }) {
  const s = useSection('twilio', initial);
  const d = s.data;
  return (
    <SectionShell msg={s.msg} err={s.err}>
      <SwitchField label="Ingeschakeld" testid="twilio-enabled"
        value={d.enabled} onChange={(v) => s.onField('enabled', v)}
        desc="Wanneer aan kun je WhatsApp- en SMS-berichten naar huurders sturen." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="Account SID" testid="twilio-sid" value={d.account_sid} onChange={(v) => s.onField('account_sid', v)} placeholder="ACxxxxxxxx..." />
        <TextField label="Auth Token" testid="twilio-token" type="password" value={d.auth_token ?? ''} onChange={(v) => s.onField('auth_token', v)} placeholder="••••• (laat leeg om huidige te behouden)" />
        <TextField label="WhatsApp afzender" testid="twilio-wa-from" value={d.whatsapp_from} onChange={(v) => s.onField('whatsapp_from', v)} placeholder="whatsapp:+14155238886" helper="Inclusief 'whatsapp:' prefix" />
        <TextField label="SMS afzender" testid="twilio-sms-from" value={d.sms_from} onChange={(v) => s.onField('sms_from', v)} placeholder="+597 xxx xxxx" />
      </div>
      <ActionRow onSave={s.save} onTest={s.test} saving={s.saving} testing={s.testing} canTest={d.enabled} />
    </SectionShell>
  );
}

export function ShellyForm({ initial }) {
  const s = useSection('shelly', initial);
  const d = s.data;
  return (
    <SectionShell msg={s.msg} err={s.err}>
      <SwitchField label="Ingeschakeld" testid="shelly-enabled"
        value={d.enabled} onChange={(v) => s.onField('enabled', v)}
        desc="Wanneer aan kun je Shelly smart breakers per appartement aan/uit zetten en verbruik aflezen." />
      <TextField label="Shelly Cloud token" testid="shelly-token" type="password" value={d.cloud_token ?? ''} onChange={(v) => s.onField('cloud_token', v)} placeholder="••••• (laat leeg om huidige te behouden)" helper="Te vinden in je Shelly Cloud account onder Gebruikersinstellingen > Authorization key" />
      <TextField label="Server (regionaal)" testid="shelly-server" value={d.server} onChange={(v) => s.onField('server', v)} placeholder="shelly-cloud.shelly.cloud" helper="Standaard: shelly-cloud.shelly.cloud" />
      <ActionRow onSave={s.save} onTest={s.test} saving={s.saving} testing={s.testing} canTest={d.enabled} />
    </SectionShell>
  );
}

export function DomainForm({ initial }) {
  const s = useSection('domain', initial);
  const d = s.data;
  // Haal het echte productie target-host + IP op van de backend zodat de
  // DNS instructie exacte waarden toont (i.p.v. placeholders). Deze
  // env-vars worden op de productie server geconfigureerd door Emergent.
  const [target, setTarget] = useState({ host: '', ip: '', configured: false, error: '' });
  useEffect(() => {
    let alive = true;
    api.get('/settings/domain/target')
      .then((r) => { if (alive) setTarget(r.data || {}); })
      .catch(() => { /* stil — fallback naar placeholder */ });
    return () => { alive = false; };
  }, []);
  const exampleTarget = target.host || 'app.surirent.sr';
  const exampleIp = target.ip || '<IP van je productie server>';

  // Live DNS + SSL status — refresh elke 30s zodat gebruiker realtime
  // ziet wanneer HTTPS certificaat actief is (via Cloudflare of eigen proxy).
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const refreshStatus = useCallback(async () => {
    if (!d.custom_domain) { setStatus(null); return; }
    setStatusLoading(true);
    try {
      const r = await api.get('/settings/domain/status');
      setStatus(r.data);
    } catch { /* stil */ }
    finally { setStatusLoading(false); }
  }, [d.custom_domain]);
  useEffect(() => {
    // Éénmalig laden bij mount + wanneer domain-veld verandert.
    // Polling (voorheen 30s setInterval) VERWIJDERD — de widget heeft
    // een expliciete refresh-knop en de user opent deze pagina zelden.
    // SSE dekt overige mutations; DNS/SSL status is een externe check
    // die niet via SSE binnenkomt, dus we vertrouwen op de refresh-knop.
    refreshStatus();
  }, [refreshStatus]);

  return (
    <SectionShell msg={s.msg} err={s.err}>
      <SwitchField label="Ingeschakeld" testid="domain-enabled"
        value={d.enabled} onChange={(v) => s.onField('enabled', v)}
        desc="Wanneer aan, herkent het platform inkomende requests op jouw domein." />
      <TextField label="Custom domein" testid="domain-custom" value={d.custom_domain} onChange={(v) => s.onField('custom_domain', v.trim().toLowerCase())} placeholder="vastgoed.mijnbedrijf.com" helper="Zonder https:// en zonder pad." />

      {/* Live status widget — vervangt de losse verificatie-badge */}
      {d.custom_domain && (
        <DomainStatusWidget status={status} loading={statusLoading} onRefresh={refreshStatus} />
      )}

      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-xs text-slate-700 space-y-2">
        <p className="font-bold flex items-center gap-2 text-slate-900"><Shield className="w-4 h-4 text-[#FF5C00]" /> DNS configuratie</p>
        {!target.configured && target.error && (
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <b>Let op:</b> {target.error} — De onderstaande waarden zijn placeholders totdat dit door Emergent support is ingesteld.
          </p>
        )}
        <p>Maak bij je domeinregistrar één van deze records aan:</p>
        <pre className="bg-white border border-slate-200 rounded-lg p-2 font-mono text-[11px] overflow-x-auto">
{`Type:   CNAME
Naam:   ${d.custom_domain || 'vastgoed'}
Waarde: ${exampleTarget}
TTL:    3600

OF (als CNAME niet kan op root):

Type:   A
Naam:   ${d.custom_domain || '@'}
Waarde: ${exampleIp}
TTL:    3600`}
        </pre>
        <p className="text-slate-500">Na DNS-propagatie (max 24u): klik <b>Test verbinding</b> om te verifiëren.</p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SSL / HTTPS — belangrijke tekst dat de tenant dit ZELF moet
          regelen. Emergent stelt geen certificaat uit voor custom
          domeinen; anders krijgt de tenant een certificaat waarmee zijn
          eindgebruikers zien dat de site door Emergent gehost wordt.
          Aanbevolen: Cloudflare Proxy (gratis, geeft ook DDoS-protectie
          en SSL "Flexible" of "Full" mode werkt direct).
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-slate-700 space-y-2">
        <p className="font-bold flex items-center gap-2 text-slate-900"><Shield className="w-4 h-4 text-blue-600" /> HTTPS / SSL — u regelt dit zelf</p>
        <p>Voor uw eigen domein <b>bent u zelf verantwoordelijk voor het SSL/HTTPS certificaat</b>. Wij stellen geen certificaat uit voor custom domeinen — anders zouden uw huurders zien dat de site via een externe host loopt.</p>
        <p className="font-semibold text-slate-800 mt-1.5">Aanbevolen aanpak (gratis, 5 min):</p>
        <ol className="list-decimal ml-4 space-y-1 text-slate-600">
          <li>Maak een gratis <a href="https://cloudflare.com" target="_blank" rel="noreferrer" className="text-blue-700 font-semibold hover:underline">Cloudflare</a> account aan en voeg uw domein toe.</li>
          <li>Verander de nameservers bij uw registrar naar de Cloudflare nameservers.</li>
          <li>In Cloudflare: zet de CNAME/A record (zoals hierboven) met de <b>oranje wolk aan</b> (proxied).</li>
          <li>SSL/TLS → Overzicht → kies mode <b>&ldquo;Full&rdquo;</b> (of &ldquo;Flexible&rdquo; als tijdelijke test).</li>
        </ol>
        <p className="text-slate-500 mt-1.5">Cloudflare geeft u dan automatisch een geldig HTTPS-certificaat, DDoS-bescherming en een snelheidsboost via hun CDN. Alternatief: uw eigen reverse-proxy (nginx / Traefik) met Let&rsquo;s Encrypt.</p>
      </div>
      <ActionRow onSave={s.save} onTest={s.test} saving={s.saving} testing={s.testing} canTest={d.enabled && !!d.custom_domain} />
    </SectionShell>
  );
}

// =====================================================================
// DomainStatusWidget — live 4-staps status kaart. Toont waar in de flow
// de gebruiker is (DNS → Emergent linking → SSL → Live) met kleuren en
// duidelijke volgende-stap aanwijzing.
// =====================================================================
function DomainStatusWidget({ status, loading, onRefresh }) {
  if (!status) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Status ophalen…
      </div>
    );
  }
  const STATE_META = {
    not_configured: { color: 'slate', label: 'Niet ingesteld', icon: '○', desc: 'Vul een domein in en sla op.' },
    disabled: { color: 'slate', label: 'Uitgeschakeld', icon: '⏸', desc: 'Zet Ingeschakeld aan om te activeren.' },
    dns_missing: { color: 'red', label: 'DNS ontbreekt', icon: '✕', desc: 'DNS record is nog niet gepropageerd of niet ingesteld.' },
    dns_wrong: { color: 'red', label: 'DNS wijst verkeerd', icon: '✕', desc: 'CNAME/A-record wijst niet naar de juiste target.' },
    dns_ok_ssl_pending: { color: 'amber', label: 'SSL vereist', icon: '⏳', desc: 'DNS ✓ — regel zelf HTTPS via Cloudflare of eigen reverse-proxy.' },
    cloudflare_loop: { color: 'red', label: 'Cloudflare loop', icon: '⚠', desc: 'DNS + SSL ✓ maar Cloudflare blokkeert — zet CNAME op DNS-only (grijze wolk).' },
    live: { color: 'emerald', label: 'Live', icon: '✓', desc: 'Domein is bereikbaar via HTTPS.' },
  };
  const m = STATE_META[status.status] || STATE_META.not_configured;
  const colorMap = {
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    red: 'bg-red-50 border-red-200 text-red-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  };
  const dotMap = {
    slate: 'bg-slate-400', red: 'bg-red-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500',
  };
  return (
    <div className={`border rounded-xl p-4 ${colorMap[m.color]}`} data-testid="domain-status-widget">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${dotMap[m.color]} ${m.color === 'amber' || m.color === 'emerald' ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-black uppercase tracking-widest">Status: {m.label}</span>
        </div>
        <button onClick={onRefresh} disabled={loading}
          data-testid="domain-status-refresh"
          className="text-[10px] font-bold hover:opacity-70 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : '↻'} Vernieuwen
        </button>
      </div>
      <p className="text-xs mb-3">{status.message}</p>

      {/* 4-stappen progress */}
      <div className="grid grid-cols-4 gap-2 mb-3" data-testid="domain-status-steps">
        <StatusStep label="Domein" ok={!!status.custom_domain} />
        <StatusStep label="DNS" ok={status.dns_ok} />
        <StatusStep label="SSL" ok={status.ssl_ok} />
        <StatusStep label="Live" ok={status.status === 'live'} />
      </div>

      {/* Details */}
      <div className="text-[10px] space-y-0.5 opacity-80">
        {status.custom_domain && <p>Domein: <code className="font-mono">{status.custom_domain}</code></p>}
        {status.target_host && <p>Target: <code className="font-mono">{status.target_host}</code>{status.target_ip ? ` (${status.target_ip})` : ''}</p>}
        {status.resolved_ip && <p>Resolveert naar: <code className="font-mono">{status.resolved_ip}</code></p>}
        {status.https_status_code && <p>HTTPS response: <b>{status.https_status_code}</b></p>}
        {status.ssl_provider_label && (
          <p className="text-emerald-700 font-bold" data-testid="domain-status-ssl-provider">
            ✓ SSL provider: {status.ssl_provider_label}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusStep({ label, ok }) {
  return (
    <div className={`text-center p-2 rounded-lg text-[10px] font-bold ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-slate-400 border border-slate-200'}`}>
      <div className="text-base mb-0.5">{ok ? '✓' : '○'}</div>
      {label}
    </div>
  );
}

export function InvoicingForm({ initial }) {
  const s = useSection('invoicing', initial);
  const d = s.data;
  const mode = d.mode || 'grace_workdays';
  return (
    <SectionShell msg={s.msg} err={s.err}>
      <SwitchField label="Ingeschakeld" testid="invoicing-enabled"
        value={d.enabled} onChange={(v) => s.onField('enabled', v)}
        desc="Wanneer aan, kan het systeem automatisch maandelijkse huur-facturen aanmaken." />
      <SwitchField label="Automatisch genereren" testid="invoicing-auto"
        value={d.auto_generate} onChange={(v) => s.onField('auto_generate', v)}
        desc="Genereer facturen automatisch voor elke bewoonde woning na het verlopen van de deadline." />

      {/* Modus-keuze */}
      <div>
        <FieldLabel>Factuur-datum bepalen op basis van</FieldLabel>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            {
              id: 'grace_workdays',
              title: 'Grace-periode (werkdagen)',
              desc: 'Na einde vorige maand + N werkdagen. Slaat weekenden over.',
            },
            {
              id: 'fixed_day',
              title: 'Vaste dag van de maand',
              desc: 'Altijd op een specifieke dag (bv. de 5e). 31 wordt indien nodig teruggezet naar de laatste van de maand.',
            },
            {
              id: 'due_next_month',
              title: 'Vervalt in volgende maand',
              desc: 'Factuur op vaste dag van huidige maand, vervalt op vaste dag van de volgende maand (bv. 1 juli → vervalt 10 augustus).',
            },
          ].map((opt) => (
            <button type="button" key={opt.id}
              onClick={() => s.onField('mode', opt.id)}
              data-testid={`invoicing-mode-${opt.id}`}
              className={`text-left rounded-xl border-2 p-3 transition ${
                mode === opt.id
                  ? 'border-[#FF5C00] bg-orange-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-4 h-4 rounded-full border-2 ${mode === opt.id ? 'border-[#FF5C00] bg-[#FF5C00]' : 'border-slate-300'}`} />
                <span className="font-bold text-sm text-slate-900">{opt.title}</span>
              </div>
              <p className="text-[11px] text-slate-500">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {mode === 'fixed_day' || mode === 'due_next_month' ? (
          <TextField label="Vaste factuurdag (1–31)" testid="invoicing-billing-day"
            type="number"
            value={d.billing_day} onChange={(v) => s.onField('billing_day', Math.max(1, Math.min(31, parseInt(v, 10) || 1)))}
            placeholder="1"
            helper="Dag van elke maand waarop de facturen worden aangemaakt. 30/31 wordt naar laatste dag verplaatst indien nodig." />
        ) : (
          <TextField label="Grace periode (werkdagen)" testid="invoicing-grace"
            type="number"
            value={d.grace_workdays} onChange={(v) => s.onField('grace_workdays', parseInt(v, 10) || 0)}
            placeholder="10"
            helper="Aantal werkdagen na einde van de maand voordat de volgende factuur automatisch wordt aangemaakt." />
        )}
        {mode === 'due_next_month' ? (
          <TextField label="Vervaldag (in volgende maand)" testid="invoicing-due-day"
            type="number"
            value={d.due_day} onChange={(v) => s.onField('due_day', Math.max(1, Math.min(31, parseInt(v, 10) || 1)))}
            placeholder="10"
            helper="Dag van de VOLGENDE maand waarop de factuur vervalt. Bv. juli-factuur + 10 → vervalt 10 augustus." />
        ) : (
          <TextField label="Betaaltermijn (dagen)" testid="invoicing-payment-term"
            type="number"
            value={d.payment_term_days} onChange={(v) => s.onField('payment_term_days', Math.max(0, Math.min(180, parseInt(v, 10) || 0)))}
            placeholder="14"
            helper="Aantal KALENDERdagen tussen factuurdatum en vervaldatum. De factuur wordt overdue zodra deze datum is verstreken." />
        )}
        <TextField label="Herinnering (dagen vóór vervaldatum)" testid="invoicing-reminder-days"
          type="number"
          value={d.reminder_days_before} onChange={(v) => s.onField('reminder_days_before', Math.max(0, Math.min(14, parseInt(v, 10) || 0)))}
          placeholder="3"
          helper="Aantal dagen vóór vervaldatum waarop een herinnering (WhatsApp/SMS + email) wordt gestuurd. 0 = uit. Bericht wordt max. 1× per drempel verstuurd." />
        <div>
          <FieldLabel>Laatst uitgevoerd</FieldLabel>
          <input type="text" value={d.last_auto_run || '—'} disabled
            data-testid="invoicing-last-run"
            className="w-full mt-1 h-11 px-3 rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-400" />
          <p className="text-[11px] text-slate-400 mt-1">Read-only: laatste keer dat de auto-generatie liep.</p>
        </div>
      </div>
      {(d.reminder_days_before || 0) > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-slate-700 flex items-start gap-2"
          data-testid="invoicing-reminder-info">
          <span className="text-purple-600 text-lg leading-none">🔔</span>
          <div className="flex-1">
            <b className="text-purple-800">Automatische reminder actief:</b>{' '}
            huurders krijgen <b>{d.reminder_days_before}</b> dag{Number(d.reminder_days_before) === 1 ? '' : 'en'} vóór de vervaldatum
            een WhatsApp/SMS-bericht + email (mits kanaal is ingeschakeld en huurder een telefoon/email heeft).
            De loop draait dagelijks om 09:00 (Suriname-tijd).
          </div>
          <button type="button"
            onClick={async () => {
              try {
                await api.post('/admin/run-upcoming-invoice-reminders');
                s.setMsg('Reminder-cyclus handmatig uitgevoerd. Controleer WhatsApp/mail-log voor bezorging.');
              } catch (e) { s.setErr(formatError(e)); }
            }}
            data-testid="invoicing-reminder-run-now"
            className="shrink-0 h-8 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold">
            Test nu
          </button>
        </div>
      )}
      {(d.next_auto_run || d.billing_day_of_month) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4"
          data-testid="invoicing-next-run-info">
          <p className="text-[11px] font-black uppercase tracking-widest text-blue-700 mb-1">Volgende automatische run</p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-black text-slate-900">
              {d.next_auto_run
                ? new Date(d.next_auto_run).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
                : '—'}
            </span>
            {d.billing_day_of_month && (
              <span className="text-xs text-slate-600">
                (= dag <b>{d.billing_day_of_month}</b> van de maand)
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {mode === 'fixed_day'
              ? <>Vaste factuurdag: <b>dag {d.billing_day || 1}</b> van elke maand. Wijzig hierboven om eerder of later te factureren.</>
              : mode === 'due_next_month'
              ? <>Factuur op <b>dag {d.billing_day || 1}</b> van de maand, vervalt op <b>dag {d.due_day || 10}</b> van de volgende maand.</>
              : <>Berekend uit: einde vorige maand + {d.grace_workdays || 10} werkdagen (weekenden overslaan). Verlaag om eerder in de maand te factureren.</>}
          </p>
        </div>
      )}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-slate-700">
        <p className="font-bold text-emerald-800 mb-1">Hoe werkt het?</p>
        <ol className="list-decimal pl-5 space-y-1">
          {mode === 'fixed_day' ? (
            <>
              <li>Op dag <b>{d.billing_day || 1}</b> van elke maand genereert het systeem de facturen voor alle bewoonde woningen.</li>
              <li>Valt de dag niet in de maand (bv. 31 februari) → laatste dag van die maand.</li>
              <li>Vervaldatum = factuurdatum + <b>{d.payment_term_days || 14}</b> kalenderdagen.</li>
              <li>Eventueel vooruitbetaald saldo wordt automatisch verrekend.</li>
            </>
          ) : mode === 'due_next_month' ? (
            <>
              <li>Op dag <b>{d.billing_day || 1}</b> van elke maand genereert het systeem de facturen voor alle bewoonde woningen.</li>
              <li>De vervaldatum wordt gezet op dag <b>{d.due_day || 10}</b> van de <b>volgende</b> maand.</li>
              <li>Voorbeeld: Huur-factuur aangemaakt op {d.billing_day || 1} juli → vervalt op {d.due_day || 10} augustus.</li>
              <li>Handig als je huurders altijd tot een vaste dag in de volgende maand tijd wil geven om te betalen.</li>
              <li>Eventueel vooruitbetaald saldo wordt automatisch verrekend.</li>
            </>
          ) : (
            <>
              <li>Aan het einde van elke maand wordt de huidige huur als verlopen beschouwd.</li>
              <li>De huurder krijgt <b>{d.grace_workdays || 10}</b> werkdagen om alsnog te betalen.</li>
              <li>Daarna genereert het systeem automatisch de volgende factuur voor elke bewoonde woning.</li>
              <li>Vervaldatum = factuurdatum + <b>{d.payment_term_days || 14}</b> kalenderdagen.</li>
              <li>Eventueel vooruitbetaald saldo wordt automatisch verrekend.</li>
            </>
          )}
        </ol>
        <p className="mt-2 text-slate-500">De achtergrond-taak loopt elk uur — meestal binnen 1 uur na de deadline staat alles klaar.</p>
      </div>

      <RecomputeDueDatesButton />

      <ActionRow onSave={s.save} saving={s.saving} canTest={false} />
    </SectionShell>
  );
}

// Knop om de vervaldata van alle open+partial facturen bij te werken naar
// de HUIDIGE instellingen. Handig na een wijziging in de factureringsmodus.
function RecomputeDueDatesButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const run = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const { data } = await api.post('/invoices/recompute-due-dates');
      setResult(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Herberekenen is mislukt.');
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-slate-700 space-y-2">
      <p className="font-bold text-amber-800">Bestaande openstaande facturen bijwerken</p>
      <p className="text-slate-600">
        Bestaande facturen behouden de vervaldatum waarmee ze zijn aangemaakt.
        Klik hieronder om de vervaldatum van alle <b>open</b> en <b>gedeeltelijk betaalde</b>
        facturen te herberekenen volgens de instellingen hierboven. Betaalde en
        verwijderde facturen worden overgeslagen.
      </p>
      {result && (
        <p className="text-emerald-700 font-semibold" data-testid="recompute-result">
          ✓ {result.updated} facturen bijgewerkt{result.skipped ? ` — ${result.skipped} overgeslagen` : ''}.
        </p>
      )}
      {err && <p className="text-red-600 font-semibold" data-testid="recompute-err">{err}</p>}
      {!confirmOpen ? (
        <button type="button" onClick={() => setConfirmOpen(true)}
          data-testid="recompute-btn"
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg px-4 py-2 text-xs">
          Vervaldata herberekenen
        </button>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-amber-800 font-semibold">Weet je het zeker?</span>
          <button type="button" onClick={run} disabled={busy}
            data-testid="recompute-confirm"
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg px-4 py-2 text-xs disabled:opacity-50">
            {busy ? 'Bezig…' : 'Ja, bijwerken'}
          </button>
          <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy}
            data-testid="recompute-cancel"
            className="inline-flex items-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg px-4 py-2 text-xs">
            Annuleren
          </button>
        </div>
      )}
    </div>
  );
}


export function KioskPinForm() {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    setErr(''); setMsg('');
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setErr('PIN moet exact 4 cijfers zijn'); return; }
    if (pin !== confirm) { setErr('PINs komen niet overeen'); return; }
    setLoading(true);
    try {
      await api.post('/auth/kiosk-set-pin', { pin });
      setMsg('Kiosk PIN bijgewerkt.'); setPin(''); setConfirm('');
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  };
  return (
    <SectionShell msg={msg} err={err}>
      <p className="text-xs text-slate-500">De PIN moet uniek zijn binnen het platform — geen ander bedrijf kan dezelfde PIN hebben.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FieldLabel>Nieuwe PIN</FieldLabel>
          <input type="password" inputMode="numeric" maxLength={4} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            data-testid="kiosk-pin"
            className="w-full mt-1 h-14 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-2xl tracking-[0.5em] text-center font-bold" />
        </div>
        <div>
          <FieldLabel>Bevestig PIN</FieldLabel>
          <input type="password" inputMode="numeric" maxLength={4} value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
            data-testid="kiosk-pin-confirm"
            className="w-full mt-1 h-14 px-4 rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-2xl tracking-[0.5em] text-center font-bold" />
        </div>
      </div>
      <button onClick={save} disabled={loading || !pin || !confirm} data-testid="settings-save"
        className="h-11 px-5 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] text-white font-bold flex items-center gap-2 disabled:opacity-50">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Opslaan
      </button>
    </SectionShell>
  );
}

// ============== Main ==============
export default function SettingsPage({ initialSection, hideSubNav = false }) {
  const [section, setSection] = useState(initialSection || 'smtp');
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const { data } = await api.get('/settings');
      setSettings(data);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Live-sync: settings van andere admin refreshen automatisch.
  useAutoRefresh(load);

  // Content-blok — hergebruikt in beide modes (met/zonder sub-nav).
  const contentBlock = loading || !settings ? (
    <div className="bg-white rounded-2xl border border-orange-100 p-10 flex items-center justify-center text-slate-400 text-sm">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Laden...
    </div>
  ) : (
    <>
      {!hideSubNav && (
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{SECTIONS.find((s) => s.id === section)?.label}</p>
          <p className="text-sm text-slate-600 mt-0.5">{SECTIONS.find((s) => s.id === section)?.desc}</p>
        </div>
      )}
      {section === 'smtp' && <SmtpForm initial={settings.smtp} />}
      {section === 'twilio' && <TwilioForm initial={settings.twilio} />}
      {section === 'shelly' && <ShellyForm initial={settings.shelly} />}
      {section === 'invoicing' && <InvoicingForm initial={settings.invoicing} />}
      {section === 'domain' && <DomainForm initial={settings.domain} />}
      {section === 'kiosk' && <KioskPinForm />}
    </>
  );

  // Wanneer we in InstellingenHub geëmbed worden (hideSubNav=true), tonen
  // we alleen de content — de hub levert de header + top-tabs zelf.
  if (hideSubNav) {
    return (
      <div>
        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-4">{err}</p>}
        {contentBlock}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Instellingen</h1>
        <p className="text-sm text-slate-500 mt-1">Configureer integraties per bedrijf. Wachtwoorden worden versleuteld opgeslagen.</p>
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-4">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-6">
        {/* Sub-nav */}
        <aside className="lg:sticky lg:top-4 self-start">
          <div className="bg-white rounded-2xl border border-orange-100 p-2 space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = section === s.id;
              const enabled = s.id !== 'kiosk' && settings?.[s.id]?.enabled;
              return (
                <button key={s.id} onClick={() => setSection(s.id)}
                  data-testid={`settings-tab-${s.id}`}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-left ${
                    isActive ? 'bg-[#FF5C00] text-white shadow-[0_8px_20px_-5px_rgba(255,92,0,0.55)]'
                      : 'text-slate-700 hover:bg-orange-50 hover:text-[#FF5C00]'
                  }`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate">{s.label}</span>
                  {enabled ? (
                    <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : 'bg-emerald-500'}`} title="Ingeschakeld" />
                  ) : s.id !== 'kiosk' && (
                    <PowerOff className={`w-3 h-3 ${isActive ? 'text-white/60' : 'text-slate-300'}`} />
                  )}
                  <ChevronRight className={`w-3.5 h-3.5 ${isActive ? 'text-white/70' : 'text-slate-300'}`} />
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <div className="min-w-0">
          {contentBlock}
        </div>
      </div>
    </div>
  );
}
