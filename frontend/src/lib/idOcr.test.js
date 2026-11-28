import { idOcrProviderLabel } from './idOcr';

test('shows only a recognized ID scan provider', () => {
  expect(idOcrProviderLabel('azure')).toBe('Azure Document Intelligence');
  expect(idOcrProviderLabel('gemini')).toBe('Gemini');
  expect(idOcrProviderLabel(undefined)).toBe('');
  expect(idOcrProviderLabel('unknown')).toBe('');
});
