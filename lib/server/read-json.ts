// Reads at most maxBytes of a request body; null means it was larger and the rest was never read.
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Invalid request.');
  let text = ''; const decoder = new TextDecoder(); let bytes = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); return null; }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
export async function readJson(request: Request, maxBytes = 16384): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes);
  if (text === null) throw new Error('Request too large.');
  return JSON.parse(text);
}
