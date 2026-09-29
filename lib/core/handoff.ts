/**
 * handoff.ts — serializa o dossie de handoff (RF-07) respeitando um teto de tokens.
 *
 * GARANTIA ESTRUTURAL CONTRA TRANSCRIPT BRUTO:
 * a unica entrada e `HandoffDossier`, que nao possui campo algum para transcript,
 * mensagens ou historico. Nao ha caminho de codigo que leia turnos aqui. Alem disso
 * cada item de lista passa por `maxItemChars` (default 300) — quem tentar colar um
 * transcript dentro de um "fato relevante" tera o item truncado e marcado em
 * `truncated`, de forma visivel no resultado. Isso e defesa em profundidade, nao
 * substituto de disciplina do produtor.
 *
 * ORDEM DE CORTE (do primeiro descartado ao ultimo). Fixa e testada:
 *   1. fatos_relevantes        — contexto util; reconstituivel; cai primeiro
 *   2. artefatos_produzidos    — o proximo agente reencontra no disco/repo
 *   3. decisoes_tomadas        — caro reconstruir, mas nao bloqueia a retomada
 *   4. (parada) pendencias e bloqueios NUNCA sao descartados
 *
 * Dentro de cada lista o corte remove SEMPRE do fim para o inicio: a ordem dos
 * itens e tratada como prioridade decrescente e isso e contrato com o produtor do
 * dossie. Coloque o mais importante primeiro.
 *
 * Se apos esgotar os passos 1-3 o texto ainda estourar o teto, entra a degradacao
 * final, nesta ordem:
 *   5. `objetivo` e truncado (nunca removido)
 *   6. itens de `pendencias` e depois de `bloqueios` sao truncados individualmente
 *      (o item CONTINUA presente; so o texto encolhe)
 *   7. se ainda assim nao couber, devolve o melhor esforco com `withinBudget: false`
 * Um bloqueio jamais desaparece em silencio: no pior caso vira uma linha truncada.
 *
 * PUREZA: funcao pura. Sem I/O, sem tempo, sem aleatoriedade. A contagem de tokens
 * vem do `TokenCounter` injetado (default: a heuristica APROXIMADA — ver
 * token-estimate.ts). Com a heuristica, "respeitar o teto" significa respeitar o
 * teto SEGUNDO A ESTIMATIVA. Para um teto duro, injete um tokenizer real.
 */

import { heuristicTokenCounter, type TokenCounter } from './token-estimate';

export interface HandoffDossier {
  readonly role: string;
  readonly objetivo: string;
  readonly decisoes_tomadas: readonly string[];
  readonly artefatos_produzidos: readonly string[];
  readonly pendencias: readonly string[];
  readonly bloqueios: readonly string[];
  readonly fatos_relevantes: readonly string[];
}

/** Campos que podem ter itens descartados, na ordem em que sao sacrificados. */
export type TrimmableField = 'fatos_relevantes' | 'artefatos_produzidos' | 'decisoes_tomadas';

/** Ordem de corte oficial. Exportada para que o teste e a UI leiam a MESMA fonte. */
export const TRIM_ORDER: readonly TrimmableField[] = [
  'fatos_relevantes',
  'artefatos_produzidos',
  'decisoes_tomadas',
];

/** Campos protegidos: nunca perdem itens, no maximo tem texto truncado. */
export const PROTECTED_FIELDS: readonly ['bloqueios', 'pendencias'] = ['bloqueios', 'pendencias'];

export const DEFAULT_HANDOFF_BUDGET = 800;

export interface HandoffOptions {
  /** Teto em tokens. Default 800. */
  readonly budgetTokens?: number;
  readonly tokenCounter?: TokenCounter;
  /** Limite de caracteres por item de lista. Default 300. */
  readonly maxItemChars?: number;
  /** Limite de caracteres do objetivo antes da degradacao final. Default 400. */
  readonly maxObjectiveChars?: number;
}

export interface DroppedEntry {
  readonly field: TrimmableField;
  /** Indice do item na lista ORIGINAL. */
  readonly index: number;
  readonly excerpt: string;
}

export interface TruncatedEntry {
  readonly field: keyof HandoffDossier;
  /** Indice na lista original; -1 para campos escalares (role, objetivo). */
  readonly index: number;
  readonly originalChars: number;
  readonly keptChars: number;
}

export interface HandoffResult {
  /** Dossie serializado, pronto para ir no prompt do proximo agente. */
  readonly text: string;
  /** Tokens de `text` segundo o contador usado. */
  readonly tokens: number;
  readonly budget: number;
  /** true se tokens <= budget. */
  readonly withinBudget: boolean;
  /** Itens removidos, na ordem em que foram sacrificados. */
  readonly dropped: readonly DroppedEntry[];
  /** Itens cujo texto foi encurtado (o item permanece). */
  readonly truncated: readonly TruncatedEntry[];
  readonly counterName: string;
  /** Propaga a incerteza da contagem. Se true, o teto e uma estimativa. */
  readonly approximate: boolean;
}

/* ------------------------------- serializacao ------------------------------ */

const LABELS: Readonly<Record<keyof HandoffDossier, string>> = {
  role: 'ROLE',
  objetivo: 'OBJETIVO',
  bloqueios: 'BLOQUEIOS',
  pendencias: 'PENDENCIAS',
  decisoes_tomadas: 'DECISOES',
  artefatos_produzidos: 'ARTEFATOS',
  fatos_relevantes: 'FATOS',
};

/**
 * Ordem de LEITURA no texto final: o proximo agente pode ser truncado por um
 * limite que nao e o nosso, entao o que ele mais precisa vem primeiro. Note que
 * essa ordem e o INVERSO util da ordem de corte, de proposito.
 */
const RENDER_ORDER: readonly (keyof HandoffDossier)[] = [
  'role',
  'objetivo',
  'bloqueios',
  'pendencias',
  'decisoes_tomadas',
  'artefatos_produzidos',
  'fatos_relevantes',
];

function clip(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= maxChars) return flat;
  return chars.slice(0, Math.max(1, maxChars - 1)).join('') + '…';
}

/**
 * Formato de texto rotulado, nao JSON: gasta menos tokens em chaves, aspas e
 * escapes, e um LLM le igualmente bem. Listas vazias sao omitidas (uma secao vazia
 * so consome orcamento).
 */
function render(dossier: HandoffDossier): string {
  const lines: string[] = [];
  for (const field of RENDER_ORDER) {
    const value = dossier[field];
    if (typeof value === 'string') {
      if (value.trim().length === 0) continue;
      lines.push(`${LABELS[field]}: ${value.trim()}`);
      continue;
    }
    if (value.length === 0) continue;
    lines.push(`${LABELS[field]}:`);
    for (const item of value) lines.push(`- ${item}`);
  }
  return lines.join('\n');
}

/** Serializa sem aplicar nenhum corte. Util para inspecao e teste. */
export function renderHandoff(dossier: HandoffDossier): string {
  return render(dossier);
}

/* --------------------------------- fachada -------------------------------- */

type MutableDossier = {
  role: string;
  objetivo: string;
  decisoes_tomadas: string[];
  artefatos_produzidos: string[];
  pendencias: string[];
  bloqueios: string[];
  fatos_relevantes: string[];
};

/**
 * Serializa o dossie respeitando `budgetTokens`.
 *
 * Algoritmo: normaliza (clip por item) -> mede -> enquanto estourar, sacrifica o
 * proximo candidato pela ordem de corte -> mede de novo. Guloso e deterministico.
 * Custo: O(k) renderizacoes/medicoes, com k = numero de itens sacrificaveis. Para
 * dossies do tamanho previsto (dezenas de itens) isso e irrelevante; se algum dia
 * um dossie tiver milhares de itens, troque por busca binaria sobre o corte.
 */
export function serializeHandoff(
  dossier: HandoffDossier,
  options: HandoffOptions = {},
): HandoffResult {
  const budget = options.budgetTokens ?? DEFAULT_HANDOFF_BUDGET;
  const counter = options.tokenCounter ?? heuristicTokenCounter;
  const maxItemChars = options.maxItemChars ?? 300;
  const maxObjectiveChars = options.maxObjectiveChars ?? 400;

  const dropped: DroppedEntry[] = [];
  const truncated: TruncatedEntry[] = [];

  // Passo 0: normalizacao. Todo item e achatado e limitado a maxItemChars. E aqui
  // que um transcript colado num "fato" para de ser um transcript.
  const normalizeList = (field: keyof HandoffDossier, items: readonly string[]): string[] =>
    items.map((item, index) => {
      const flat = item.replace(/\s+/gu, ' ').trim();
      const clipped = clip(flat, maxItemChars);
      if (clipped !== flat) {
        truncated.push({
          field,
          index,
          originalChars: Array.from(flat).length,
          keptChars: Array.from(clipped).length,
        });
      }
      return clipped;
    }).filter((item) => item.length > 0);

  const working: MutableDossier = {
    role: clip(dossier.role, maxItemChars),
    objetivo: dossier.objetivo.replace(/\s+/gu, ' ').trim(),
    bloqueios: normalizeList('bloqueios', dossier.bloqueios),
    pendencias: normalizeList('pendencias', dossier.pendencias),
    decisoes_tomadas: normalizeList('decisoes_tomadas', dossier.decisoes_tomadas),
    artefatos_produzidos: normalizeList('artefatos_produzidos', dossier.artefatos_produzidos),
    fatos_relevantes: normalizeList('fatos_relevantes', dossier.fatos_relevantes),
  };

  const measure = (): { text: string; tokens: number } => {
    const text = render(working);
    return { text, tokens: counter.count(text) };
  };

  let current = measure();

  // Passos 1-3: descarta itens inteiros, do fim de cada lista, na TRIM_ORDER.
  for (const field of TRIM_ORDER) {
    while (current.tokens > budget && working[field].length > 0) {
      const removed = working[field].pop() as string;
      dropped.push({
        field,
        index: working[field].length,
        excerpt: clip(removed, 120),
      });
      current = measure();
    }
    if (current.tokens <= budget) break;
  }

  // Passo 5: encolhe o objetivo (nunca remove).
  if (current.tokens > budget) {
    const before = working.objetivo;
    const after = clip(before, maxObjectiveChars);
    if (after !== before) {
      working.objetivo = after;
      truncated.push({
        field: 'objetivo',
        index: -1,
        originalChars: Array.from(before).length,
        keptChars: Array.from(after).length,
      });
      current = measure();
    }
  }

  // Passo 6: encolhe itens protegidos progressivamente. Pendencias primeiro,
  // bloqueios por ultimo. O item permanece na lista em qualquer caso.
  const shrinkSteps = [200, 120, 80, 40];
  for (const field of ['pendencias', 'bloqueios'] as const) {
    for (const limit of shrinkSteps) {
      if (current.tokens <= budget) break;
      let changed = false;
      working[field] = working[field].map((item, index) => {
        const next = clip(item, limit);
        if (next !== item) {
          changed = true;
          truncated.push({
            field,
            index,
            originalChars: Array.from(item).length,
            keptChars: Array.from(next).length,
          });
        }
        return next;
      });
      if (changed) current = measure();
    }
    if (current.tokens <= budget) break;
  }

  return {
    text: current.text,
    tokens: current.tokens,
    budget,
    withinBudget: current.tokens <= budget,
    dropped,
    truncated,
    counterName: counter.name,
    approximate: counter.approximate,
  };
}
