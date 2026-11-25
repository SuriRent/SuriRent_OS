import fs from 'fs';
import path from 'path';
import vm from 'vm';

test('caches neither payment-link navigation nor payment information', () => {
  const listeners = {};
  const worker = {
    location: { origin: 'https://app.example.com' },
    addEventListener: (name, handler) => { listeners[name] = handler; },
  };
  const source = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  vm.runInNewContext(source, { self: worker, URL });

  for (const pathname of ['/b/secret-token', '/api/public/sms-payment']) {
    const respondWith = jest.fn();
    listeners.fetch({
      request: { method: 'GET', url: `https://app.example.com${pathname}` },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  }
});
