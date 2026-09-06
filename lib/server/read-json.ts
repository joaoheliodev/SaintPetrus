export async function readJson(request: Request, maxBytes = 16384): Promise<unknown> {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Invalid request.');
  let text = ''; const decoder = new TextDecoder(); let bytes = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new Error('Request too large.'); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}
