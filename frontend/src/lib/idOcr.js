import { api } from './api';

export function idOcrProviderLabel(provider) {
  if (provider === 'azure') return 'Azure Document Intelligence';
  if (provider === 'gemini') return 'Gemini';
  return '';
}

// Stuurt de ID-foto naar de server voor OCR.
export function postIdOcr(url, file, extra = {}) {
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  return api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
}
