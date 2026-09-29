import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearVerification, providerStatus, recordVerification, selectProvider, verificationGeneration } from '../lib/providers/runtime';
import { POST } from '../app/api/provider/route';

async function withSelection(run: () => Promise<void>) {
  const names = ['saintpetrusSelection', 'saintpetrusVerification', 'saintpetrusVerificationGeneration', 'saintpetrusTokens'];
  const saved = new Map(names.map((name): [string, unknown] => [name, Reflect.get(globalThis, name)]));
  const mock = process.env.SAINTPETRUS_MOCK; process.env.SAINTPETRUS_MOCK = 'true';
  try { selectProvider({ provider: 'mock', model: 'mock-v1' }); await run(); }
  finally {
    for (const [name, value] of saved) Reflect.set(globalThis, name, value);
    if (mock === undefined) delete process.env.SAINTPETRUS_MOCK; else process.env.SAINTPETRUS_MOCK = mock;
  }
}

test('R1 a verdict proved before a key or selection changed cannot verify what replaced it', async () => {
  await withSelection(async () => {
    const before = verificationGeneration();
    selectProvider({ provider: 'mock', model: 'mock-v1' });
    recordVerification(true, undefined, before);
    assert.equal(providerStatus().verified, false, 'the late verdict is dropped');
    recordVerification(true);
    assert.equal(providerStatus().verified, true, 'a verdict for the current generation still counts');
  });
});

test('R1 a probe that finishes after a credential change leaves the new pair unverified', async () => {
  await withSelection(async () => {
    // Stands in for the token service: while the probe runs, a credential change arrives, as from another tab.
    Reflect.set(globalThis, 'saintpetrusTokens', { execute: async () => { clearVerification(); return { text: 'OK', cached: false }; } });
    const response = await POST(new Request('http://127.0.0.1:3000/api/provider', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: '{"action":"test"}' }));
    assert.equal(response.status, 200);
    assert.equal(providerStatus().verified, false);
  });
});
