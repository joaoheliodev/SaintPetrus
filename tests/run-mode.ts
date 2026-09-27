// Tests pin the run mode the way the server does at startup; real mode is needed to reach a (mocked) keyed provider.
export async function withRunMode<T>(mode: 'mock' | 'real', run: () => Promise<T> | T): Promise<T> {
  const previous = Reflect.get(globalThis, 'saintpetrusRunMode');
  Reflect.set(globalThis, 'saintpetrusRunMode', { mode });
  try { return await run(); } finally { Reflect.set(globalThis, 'saintpetrusRunMode', previous); }
}
