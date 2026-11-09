import { api } from './api';

// Stuurt de ID-foto naar de server; die leest de kaart uit via Gemini.
export function postIdOcr(url, file, extra = {}) {
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  return api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
}
