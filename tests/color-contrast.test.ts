import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/globals.css', 'utf8');
const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
const declared = new Map([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const color = (name: string): number[] => {
  const value = declared.get(name) ?? '';
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return color(alias[1]);
  assert.match(value, /^#[0-9a-f]{6}$/i, `--${name} resolves to a six-digit hex color`);
  return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
};
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map(channel => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(color(a)), luminance(color(b))].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

test('Q3 text tokens meet WCAG AA contrast on every surface they are drawn on', () => {
  const pairs: [string, string][] = [
    ['foreground', 'background'], ['foreground', 'card'], ['foreground', 'accent'],
    ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'muted'], ['muted-foreground', 'accent'],
    ['primary', 'background'], ['primary', 'card'], ['primary-foreground', 'primary'],
    ['destructive', 'background'], ['destructive', 'card'],
  ];
  for (const [text, surface] of pairs) assert.ok(contrast(text, surface) >= 4.5, `--${text} on --${surface}: ${contrast(text, surface).toFixed(2)}:1`);
});

test('Q3 field edges and the focus ring keep 3:1 against the surfaces around them', () => {
  for (const [part, surface] of [['input', 'card'], ['input', 'background'], ['ring', 'card'], ['ring', 'background']]) {
    assert.ok(contrast(part, surface) >= 3, `--${part} on --${surface}: ${contrast(part, surface).toFixed(2)}:1`);
  }
  const fieldRules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, selector, body]) => /\b(input|select|textarea)\b/.test(selector) && !selector.includes(':focus') && /(^|[;\s])border:/.test(body));
  assert.ok(fieldRules.length >= 3, 'the field rules were found');
  for (const [, selector, body] of fieldRules) assert.match(body, /(^|[;\s])border: 1px solid var\(--input\)/, `${selector.trim()} draws its edge with --input`);
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--ring\); outline-offset: 2px; \}/, 'every focusable element shows the ring');
});
