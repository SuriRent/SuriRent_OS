// Bluetooth thermische bonprinter (ESC/POS).
// - Browser (Chrome/Edge op Android & Windows): Web Bluetooth (BLE).
// - Android-APK: via de APK-brug (BT_SCAN / PRINT_RECEIPT printer:"bluetooth").
// - iOS: geen Bluetooth in de browser → printvenster (AirPrint).
import { useEffect, useState } from 'react';
import { apkBridge } from './kiosk-print';

const KEY = 'bt_printer';
const SERVICES = [
  0x18f0, 0xff00, 0xffe0, 0xfff0, 0xae30, 0xae00, 0xfee7,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
];

let device = null;
let chr = null;

export const hasWebBluetooth = () => typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestDevice;
// 'apk' | 'web' | 'none'
export const btSupport = () => (apkBridge() ? 'apk' : hasWebBluetooth() ? 'web' : 'none');
export const getSavedPrinter = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
export const printerMode = () => localStorage.getItem('kiosk_printer') || 'none';
export const paperWidth = () => (localStorage.getItem('kiosk_paper_width') === '80' ? 80 : 58);

function save(p) {
  localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new Event('bt-printer-changed'));
}

export function forgetPrinter() {
  try { device?.gatt?.disconnect(); } catch { /* noop */ }
  device = null; chr = null;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('bt-printer-changed'));
}

async function findWritable(server) {
  for (const s of await server.getPrimaryServices()) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.write || c.properties.writeWithoutResponse) return c;
    }
  }
  throw new Error('Deze printer heeft geen schrijfbaar kanaal (geen bonprinter?)');
}

async function attach(d) {
  device = d;
  const server = await d.gatt.connect();
  chr = await findWritable(server);
  return d;
}

// APK: vraag de app om printers in de buurt (antwoord via event 'apk-bt-devices').
export function scanApk(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { window.removeEventListener('apk-bt-devices', on); reject(new Error('Geen antwoord van de app — update de Android-app voor Bluetooth printers.')); }, timeoutMs);
    const on = (e) => { clearTimeout(t); window.removeEventListener('apk-bt-devices', on); resolve(e.detail?.devices || []); };
    window.addEventListener('apk-bt-devices', on);
    apkBridge()(JSON.stringify({ type: 'BT_SCAN' }));
  });
}

export function saveApkPrinter(p) {
  apkBridge()(JSON.stringify({ type: 'BT_SELECT', address: p.address, name: p.name }));
  save({ id: p.address, name: p.name || p.address, via: 'apk' });
}

// Browser: systeemvenster met Bluetooth-toestellen in de buurt (vereist een tik).
export async function scanWeb() {
  const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  await attach(d);
  save({ id: d.id, name: d.name || 'Bluetooth printer', via: 'web' });
  return d;
}

async function connectSaved() {
  const saved = getSavedPrinter();
  if (!saved) throw new Error('Geen Bluetooth printer gekoppeld');
  if (device?.gatt?.connected && chr && device.id === saved.id) return;
  if (!device || device.id !== saved.id) {
    const list = navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices() : [];
    device = list.find((x) => x.id === saved.id) || null;
  }
  if (!device) throw new Error('Printer niet bereikbaar — tik op "Opnieuw verbinden" in de printerinstellingen.');
  await attach(device);
}

const plain = (s) => String(s ?? '')
  .replace(/[—–]/g, '-').replace(/[€]/g, 'EUR')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x0A\x20-\x7E]/g, '?');

export function encodeEscPos(lines) {
  const out = [0x1b, 0x40];
  const ALIGN = { left: 0, center: 1, right: 2 };
  for (const l of lines) {
    out.push(0x1b, 0x61, ALIGN[l.align] ?? 0, 0x1b, 0x45, l.bold ? 1 : 0, 0x1d, 0x21, l.size === 'large' ? 0x11 : 0);
    for (const ch of plain(l.text)) out.push(ch.charCodeAt(0));
    out.push(0x0a);
  }
  out.push(0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x64, 3, 0x1d, 0x56, 0x01);
  return new Uint8Array(out);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function writeBytes(bytes) {
  const noResp = chr.properties.writeWithoutResponse && chr.writeValueWithoutResponse;
  for (let i = 0; i < bytes.length; i += 20) {
    const part = bytes.slice(i, i + 20);
    if (noResp) { await chr.writeValueWithoutResponse(part); await wait(8); }
    else if (chr.writeValueWithResponse) await chr.writeValueWithResponse(part);
    else await chr.writeValue(part);
  }
}

// Print kant-en-klare tekstregels ({text, align, bold, size}) op de gekoppelde printer.
export async function printLinesBluetooth(lines, extra = {}) {
  const saved = getSavedPrinter();
  if (!saved) throw new Error('Geen Bluetooth printer gekoppeld');
  if (saved.via === 'apk') {
    const bridge = apkBridge();
    if (!bridge) throw new Error('Deze printer is gekoppeld via de Android-app');
    bridge(JSON.stringify({ type: 'PRINT_RECEIPT', printer: 'bluetooth', bt_address: saved.id, paper_width: paperWidth(), lines, ...extra }));
    return true;
  }
  if (!hasWebBluetooth()) throw new Error('Bluetooth wordt niet ondersteund in deze browser');
  await connectSaved();
  await writeBytes(encodeEscPos(lines));
  return true;
}

export function testLines(width = paperWidth()) {
  const W = width === 80 ? 48 : 32;
  const dash = '-'.repeat(W);
  return [
    { text: 'TESTBON', align: 'center', bold: true, size: 'large' },
    { text: dash, align: 'left' },
    { text: `Papierbreedte: ${width} mm`, align: 'left' },
    { text: `Printer: ${getSavedPrinter()?.name || '-'}`, align: 'left' },
    { text: new Date().toLocaleString('nl-NL'), align: 'left' },
    { text: dash, align: 'left' },
    { text: 'De printer werkt!', align: 'center', bold: true },
    { text: '', align: 'left' },
  ];
}

// Is de gekoppelde printer nu echt bereikbaar? (browser: stille verbinding; app: gekoppeld)
export async function btReady() {
  const saved = getSavedPrinter();
  if (!saved || btSupport() === 'none') return false;
  if (saved.via === 'apk') return !!apkBridge();
  try { await connectSaved(); return true; } catch { return false; }
}

export function useBtReady(pollMs = 15000) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => btReady().then((r) => { if (alive) setReady(r); });
    check();
    const id = setInterval(check, pollMs);
    window.addEventListener('bt-printer-changed', check);
    return () => { alive = false; clearInterval(id); window.removeEventListener('bt-printer-changed', check); };
  }, [pollMs]);
  return ready;
}
