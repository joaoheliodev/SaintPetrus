'use client';
import { useRef, useState, type FormEvent } from 'react';
import type { TokenSnapshot } from '../lib/tokens/service';
import type { ModelPrice } from '../lib/tokens/pricing';
import { modelProviders } from '../lib/providers/model-id';
import { Button } from './ui/button';

type Props = {
  catalog: TokenSnapshot['catalog'] | undefined;
  pending: boolean;
  error: string;
  onAppend: (body: object) => Promise<boolean>;
};
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const rateFields = [
  { name: 'inputCacheHitPerMillion', label: 'Input cache hit' },
  { name: 'inputCacheMissPerMillion', label: 'Input cache miss' },
  { name: 'outputPerMillion', label: 'Output' },
];

function PriceDetails({ price }: { price: ModelPrice }) {
  return <div>
    <p>Provider: {price.provider ?? 'Not recorded (legacy)'} · Effective: {price.effectiveAt} · Expires: {price.expiresAt ?? 'Open-ended'} (midnight UTC, exclusive end)</p>
    <p>Verified: {price.verifiedAt} · Source: {price.sourceUrl ? <a href={price.sourceUrl} target="_blank" rel="noreferrer">{price.sourceUrl}</a> : 'Not recorded (legacy)'}</p>
    <div className="token-table"><table><caption>USD per million tokens</caption>
      <thead><tr><th>Band</th><th>Input cache hit</th><th>Input cache miss</th><th>Output</th></tr></thead>
      <tbody>{[{ label: 'Off-peak', band: price.offPeak }, { label: 'Peak', band: price.peak }].map(({ label, band }) =>
        <tr key={label}><th>{label}</th><td>{band.inputCacheHitPerMillion}</td><td>{band.inputCacheMissPerMillion}</td><td>{band.outputPerMillion}</td></tr>)}</tbody>
    </table></div>
    <p>UTC peak windows: {price.peakWindowsUtc.length === 0 ? 'None; off-peak applies all day.' : price.peakWindowsUtc.map(window => `${window.weekdays.map(day => weekdays[day]).join(', ')}: minutes ${window.startMinute}–${window.endMinute}`).join('; ')}</p>
    {price.note && <p>{price.note}</p>}
  </div>;
}

export function PricePanel({ catalog, pending, error, onAppend }: Props) {
  const [windows, setWindows] = useState<number[]>([]);
  const [saved, setSaved] = useState(false);
  const nextWindow = useRef(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    // Draft conversion is UX only; the server validates every field before writing.
    const number = (name: string) => { const value = data.get(name); return value === null || value === '' ? null : Number(value); };
    const band = (name: string) => Object.fromEntries(rateFields.map(field => [field.name, number(`${name}.${field.name}`)]));
    setSaved(false);
    const accepted = await onAppend({ model: data.get('model'), price: {
      provider: data.get('provider'), effectiveAt: data.get('effectiveAt'), verifiedAt: data.get('verifiedAt'), sourceUrl: data.get('sourceUrl'),
      ...(data.get('expiresAt') ? { expiresAt: data.get('expiresAt') } : {}),
      ...(data.get('note') ? { note: data.get('note') } : {}),
      offPeak: band('offPeak'), peak: band('peak'),
      peakWindowsUtc: windows.map(id => ({ weekdays: data.getAll(`days-${id}`).map(Number), startMinute: number(`start-${id}`), endMinute: number(`end-${id}`) })),
    } });
    if (accepted) { form.reset(); setWindows([]); setSaved(true); }
  }
  return <div className="price-panel">
    <p>Prices are verified and selected by the server. New validities apply to new reservations; work already in flight keeps its captured tariff. All dates use midnight UTC.</p>
    {error && <p role="alert">{error}</p>}
    {saved && !error && <p role="status">Price validity saved.</p>}
    {!catalog && <p role="status">Loading server prices…</p>}
    {catalog?.models.length === 0 && <p className="price-warning">No prices configured — execution refused.</p>}
    {catalog?.models.map(row => <section key={row.model} aria-label={`Prices for ${row.model}`}>
      <h3>{row.model}</h3>
      {row.current ? <div data-current-price={row.current.id}><h4>Current validity</h4><PriceDetails price={row.current.price} /></div>
        : <p className="price-warning">No current price — execution refused.</p>}
      <details><summary>View history</summary>
        <p>Newest first, as published by the server. Closing this section only hides history; no stored tariff is deleted.</p>
        {row.versions.filter(version => version.id !== row.current?.id).map(version => <section key={version.id} data-price-version={version.id}>
          <h4>{version.state === 'future' ? 'Scheduled validity' : 'Past validity'}</h4><PriceDetails price={version.price} />
        </section>)}
      </details>
    </section>)}
    <form onSubmit={submit} aria-label="Add price validity">
      <fieldset disabled={pending || !catalog}><legend>Add price validity</legend>
        <p>Enter the numbers from your verified source. The server fills the open predecessor’s expiry from the new effective date; its other fields stay unchanged.</p>
        <div className="price-form-grid">
          <label>Model ID<input name="model" required maxLength={100} /></label>
          <label>Provider<select name="provider" required defaultValue=""><option value="" disabled>Select provider</option>{modelProviders.map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label>
          <label>Effective date (UTC)<input name="effectiveAt" type="date" required /></label>
          <label>Expiry date (UTC, optional)<input name="expiresAt" type="date" /></label>
          <label>Verified date<input name="verifiedAt" type="date" required /></label>
          <label>Source URL<input name="sourceUrl" type="url" required maxLength={2048} /></label>
        </div>
        {[{ name: 'offPeak', label: 'Off-peak' }, { name: 'peak', label: 'Peak' }].map(band => <fieldset key={band.name}>
          <legend>{band.label} rates — USD per million tokens</legend><div className="price-form-grid">
            {rateFields.map(field => <label key={field.name}>{band.label} {field.label.toLowerCase()}<input name={`${band.name}.${field.name}`} type="number" min={0} step="any" required /></label>)}
          </div>
        </fieldset>)}
        <fieldset><legend>Peak windows (UTC)</legend>
          <p>No windows means off-peak all day. Preflight still reserves at peak with no cache hits. Minutes run from 0 to 1440; end is exclusive.</p>
          {windows.map((id, index) => <fieldset key={id}><legend>Window {index + 1}</legend>
            <div className="price-weekdays">{weekdays.map((day, value) => <label key={day}><input type="checkbox" name={`days-${id}`} value={value} />{day}</label>)}</div>
            <div className="price-form-grid"><label>Start minute<input name={`start-${id}`} type="number" min={0} max={1439} step={1} required /></label>
              <label>End minute<input name={`end-${id}`} type="number" min={1} max={1440} step={1} required /></label></div>
            <Button type="button" variant="outline" onClick={() => setWindows(windows.filter(value => value !== id))}>Remove draft window {index + 1}</Button>
          </fieldset>)}
          <Button type="button" variant="outline" onClick={() => setWindows([...windows, nextWindow.current++])}>Add peak window</Button>
        </fieldset>
        <label>Note (optional)<textarea name="note" /></label>
        <Button type="submit" disabled={pending || !catalog}>{pending ? 'Saving…' : 'Add validity'}</Button>
      </fieldset>
    </form>
  </div>;
}
