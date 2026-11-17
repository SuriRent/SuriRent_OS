import { isSlowConnectionEstimate } from './SlowConnectionBanner';

describe('isSlowConnectionEstimate', () => {
  test.each(['slow-2g', '2g'])('flags %s as slow', (effectiveType) => {
    expect(isSlowConnectionEstimate({ effectiveType })).toBe(true);
  });

  test.each(['3g', '4g', undefined])('does not flag %s as slow', (effectiveType) => {
    expect(isSlowConnectionEstimate({
      effectiveType,
      rtt: 5000,
      downlink: 0.1,
    })).toBe(false);
  });

  test('handles browsers without the Network Information API', () => {
    expect(isSlowConnectionEstimate(undefined)).toBe(false);
  });
});
