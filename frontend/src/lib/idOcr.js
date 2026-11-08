import { api } from './api';

// ID-kaart OCR in de browser via Tesseract.js (geen externe LLM-key nodig).
let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng')).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

const pad = (n) => String(n).padStart(2, '0');
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());
const cleanName = (s) => titleCase(s.replace(/[^A-Za-zÀ-ÿ'\- ]/g, ' ').replace(/\s+/g, ' ').trim());

function isoFromParts(d, m, y) {
  const day = Number(d); const mon = Number(m); let year = Number(y);
  if (year < 100) year += year > new Date().getFullYear() % 100 ? 1900 : 2000;
  if (day < 1 || day > 31 || mon < 1 || mon > 12 || year < 1900 || year > new Date().getFullYear()) return '';
  return `${year}-${pad(mon)}-${pad(day)}`;
}

function parseMrz(lines) {
  const out = {};
  const mrz = lines.map((l) => l.replace(/\s+/g, '').toUpperCase()).filter((l) => l.length >= 20 && /^[A-Z0-9<]+$/.test(l));
  const nameLine = mrz.find((l) => l.includes('<<') && /^[A-Z<]+$/.test(l.replace(/^[A-Z0-9]{2}[A-Z<]{3}/, '')));
  if (nameLine) {
    const body = /^P[A-Z<]/.test(nameLine) ? nameLine.slice(5) : nameLine;
    const [sur, given = ''] = body.split('<<');
    const full = `${given.replace(/</g, ' ')} ${sur.replace(/</g, ' ')}`;
    if (cleanName(full).length > 2) out.name = cleanName(full);
  }
  for (const l of mrz) {
    const m = l.match(/(?:^|[A-Z<]{3})(\d{6})\d[MF<]/);
    if (m && !out.birth_date) {
      const iso = isoFromParts(m[1].slice(4, 6), m[1].slice(2, 4), m[1].slice(0, 2));
      if (iso) out.birth_date = iso;
    }
  }
  const td3 = mrz.find((l) => l.length >= 40 && /^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}/.test(l));
  const td1 = mrz.find((l) => /^[AIC][A-Z<][A-Z<]{3}[A-Z0-9<]{9}/.test(l));
  const num = td3 ? td3.slice(0, 9) : td1 ? td1.slice(5, 14) : '';
  if (num) out.id_number = num.replace(/</g, '');
  return out;
}

function parseLabels(lines) {
  const out = {};
  const text = lines.join('\n');
  const dateRe = /(\d{1,2})\s*[-./ ]\s*(\d{1,2})\s*[-./ ]\s*(\d{4})/g;
  const dates = [...text.matchAll(dateRe)].map((m) => ({ idx: m.index, iso: isoFromParts(m[1], m[2], m[3]) })).filter((d) => d.iso);
  const birthLbl = text.search(/birth|geboorte|geb\.|naissance/i);
  if (dates.length) {
    const near = birthLbl >= 0 ? dates.find((d) => d.idx >= birthLbl) || dates[0] : dates.slice().sort((a, b) => a.iso.localeCompare(b.iso))[0];
    out.birth_date = near.iso;
  }
  const grab = (re) => {
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(re);
      if (!m) continue;
      const same = (m[1] || '').trim();
      const val = same.length > 1 ? same : (lines[i + 1] || '').trim();
      if (val) return val;
    }
    return '';
  };
  const sur = grab(/(?:surname|achternaam|familienaam|naam)\s*[:/]?\s*(.*)$/i);
  const given = grab(/(?:given names?|voornamen?|first name)\s*[:/]?\s*(.*)$/i);
  const full = cleanName(`${given} ${sur}`);
  if (full.length > 2) out.name = full;
  const idRaw = grab(/(?:document\s*(?:no|nr|number)|id\s*(?:no|nr|number)|nummer|number|no\.?)\s*[:/]?\s*([A-Z0-9 -]{5,})/i);
  const idm = idRaw.replace(/[\s-]/g, '').match(/[A-Z0-9]{6,12}/i);
  if (idm && /\d/.test(idm[0])) out.id_number = idm[0].toUpperCase();
  return out;
}

export function parseIdText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const mrz = parseMrz(lines);
  const lab = parseLabels(lines);
  return {
    name: mrz.name || lab.name || '',
    id_number: mrz.id_number || lab.id_number || '',
    birth_date: mrz.birth_date || lab.birth_date || '',
    hasMrz: !!(mrz.name || mrz.id_number),
  };
}

export async function ocrIdCard(file) {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(file);
    const p = parseIdText(data?.text);
    const found = [p.name, p.id_number, p.birth_date].filter(Boolean).length;
    const base = Math.min(1, Math.max(0, (data?.confidence || 0) / 100));
    const confidence = found ? Math.min(0.99, p.hasMrz ? Math.max(base, 0.8) : base * (found / 3) + 0.1) : 0;
    return { name: p.name, id_number: p.id_number, birth_date: p.birth_date, confidence };
  } catch {
    return { name: '', id_number: '', birth_date: '', confidence: 0 };
  }
}

// Leest de kaart lokaal (Tesseract) en stuurt foto + herkende velden naar de server.
export async function postIdOcr(url, file, extra = {}) {
  const r = await ocrIdCard(file);
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  fd.append('ocr_done', '1');
  fd.append('ocr_name', r.name);
  fd.append('ocr_id_number', r.id_number);
  fd.append('ocr_birth_date', r.birth_date);
  fd.append('ocr_confidence', String(r.confidence));
  return api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
}
