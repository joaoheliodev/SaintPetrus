/**
 * dirty-context.ts — score 0-100 de "sujeira" do contexto, com evidencia por sinal.
 *
 * Seis sinais, pesos fixos somando exatamente 100:
 *   window-occupancy         25   ocupacao da janela > 0.75
 *   stagnation               20   >=3 turnos sem mudanca de estado e sem tool call
 *   repetition               20   similaridade >=0.90 entre as 3 ultimas saidas
 *   recurring-error          15   mesmo erro >=3 vezes
 *   topic-drift              10   >=30% do contexto fora do objetivo
 *   contradictory-instruction 10  2+ diretivas conflitantes
 *
 * Faixas: <40 healthy | 40-69 warning | >=70 critical.
 *
 * CONSEQUENCIA DOS PESOS (importante, verificado por teste): todos os pesos sao
 * multiplos de 5, logo TODO score alcancavel e multiplo de 5. Os valores 39 e 69
 * sao INATINGIVEIS por combinacao de sinais. Eles sao, ainda assim, limites reais
 * da funcao de faixa e por isso `bandForScore` e publica e testada em 39/40/69/70
 * de forma isolada. Se algum dia um peso deixar de ser multiplo de 5, os limites
 * passam a ser atingiveis e os testes de faixa continuam validos.
 *
 * PUREZA: sem I/O, sem rede, sem Date.now(), sem Math.random(). O unico tempo que
 * aparece na saida vem do `Clock` injetado (default `zeroClock` => 0).
 */

import {
  contentTokens,
  excerpt,
  firstPairAtLeast,
  normalizeText,
  splitSentences,
  tokenSimilarity,
} from './similarity';
import { heuristicTokenCounter, type TokenCounter } from './token-estimate';
import { zeroClock, type Clock, type Evidence, type Turn } from './types';

/* ------------------------------- vocabulario ------------------------------ */

export type DirtySignalId =
  | 'window-occupancy'
  | 'stagnation'
  | 'repetition'
  | 'recurring-error'
  | 'topic-drift'
  | 'contradictory-instruction';

export type DirtyBand = 'healthy' | 'warning' | 'critical';

/** Pesos oficiais. A soma DEVE ser 100 (garantido por teste). */
export const DIRTY_SIGNAL_WEIGHTS: Readonly<Record<DirtySignalId, number>> = {
  'window-occupancy': 25,
  stagnation: 20,
  repetition: 20,
  'recurring-error': 15,
  'topic-drift': 10,
  'contradictory-instruction': 10,
};

/** Ordem fixa de avaliacao e de saida. Garante relatorio estavel. */
export const DIRTY_SIGNAL_ORDER: readonly DirtySignalId[] = [
  'window-occupancy',
  'stagnation',
  'repetition',
  'recurring-error',
  'topic-drift',
  'contradictory-instruction',
];

export const BAND_WARNING_MIN = 40;
export const BAND_CRITICAL_MIN = 70;

export interface DirtyThresholds {
  /** Ocupacao acima da qual o sinal dispara. Comparacao ESTRITA (>). Default 0.75. */
  readonly windowOccupancy: number;
  /** Turnos consecutivos estagnados para disparar. Default 3. */
  readonly stagnationTurns: number;
  /** Similaridade para considerar duas saidas repetidas. Default 0.90. */
  readonly repetitionSimilarity: number;
  /** Quantas das ultimas saidas entram na janela de repeticao. Default 3. */
  readonly repetitionWindow: number;
  /** Ocorrencias da mesma assinatura de erro para disparar. Default 3. */
  readonly recurringErrorCount: number;
  /** Fracao minima da massa de contexto fora do objetivo. Default 0.30 (>=). */
  readonly topicDriftRatio: number;
  /** Sobreposicao lexica minima com o objetivo para um turno contar como no tema. Default 0.08. */
  readonly onTopicTokenRatio: number;
  /** Pares conflitantes minimos para disparar contradicao. Default 1 (= 2 diretivas). */
  readonly contradictionPairs: number;
  /** Similaridade minima entre os corpos de duas diretivas de polaridade oposta. Default 0.6. */
  readonly contradictionBodySimilarity: number;
  /** Tamanho maximo de qualquer trecho de evidencia. Default 160. */
  readonly maxExcerptChars: number;
}

export const DEFAULT_DIRTY_THRESHOLDS: DirtyThresholds = {
  windowOccupancy: 0.75,
  stagnationTurns: 3,
  repetitionSimilarity: 0.9,
  repetitionWindow: 3,
  recurringErrorCount: 3,
  topicDriftRatio: 0.3,
  onTopicTokenRatio: 0.08,
  contradictionPairs: 1,
  contradictionBodySimilarity: 0.6,
  maxExcerptChars: 160,
};

/* --------------------------------- entrada -------------------------------- */

export interface WindowUsage {
  /** Limite da janela em tokens. <= 0 desativa o sinal de ocupacao. */
  readonly maxTokens: number;
  /**
   * Tokens realmente usados. Se fornecido, tem PRECEDENCIA sobre a estimativa e o
   * relatorio marca a medida como nao-aproximada. Prefira sempre fornecer.
   */
  readonly usedTokens?: number;
}

export interface Directive {
  readonly id: string;
  readonly text: string;
  readonly turnIndex?: number;
}

export interface DirtyContextInput {
  readonly turns: readonly Turn[];
  readonly window: WindowUsage;
  /** Objetivo declarado da sessao. Sem ele, `topic-drift` nao e avaliado. */
  readonly objective?: string;
  /** Diretivas explicitas. Se ausente, sao extraidas dos turnos user/system. */
  readonly directives?: readonly Directive[];
}

export interface DirtyContextOptions {
  readonly tokenCounter?: TokenCounter;
  readonly clock?: Clock;
  readonly thresholds?: Partial<DirtyThresholds>;
}

/* ---------------------------------- saida --------------------------------- */

export interface SignalResult {
  readonly signal: DirtySignalId;
  readonly weight: number;
  readonly fired: boolean;
  /**
   * false quando o sinal nao pode ser avaliado por falta de dado de entrada
   * (ex.: `topic-drift` sem objetivo). Um sinal nao avaliado NUNCA contribui
   * para o score e e reportado como tal em vez de ser silenciosamente "ok".
   */
  readonly evaluated: boolean;
  readonly detail: string;
  readonly evidence: readonly Evidence[];
}

export interface DirtyContextReport {
  readonly score: number;
  readonly band: DirtyBand;
  /** Todos os seis sinais, em DIRTY_SIGNAL_ORDER. */
  readonly signals: readonly SignalResult[];
  /** Subconjunto de `signals` com fired === true, mesma ordem. */
  readonly fired: readonly SignalResult[];
  /** Sinais que nao puderam ser avaliados. Util para a UI explicar lacunas. */
  readonly notEvaluated: readonly DirtySignalId[];
  /** Medida de janela usada, incluindo se veio de estimativa. */
  readonly window: {
    readonly usedTokens: number;
    readonly maxTokens: number;
    readonly ratio: number;
    readonly approximate: boolean;
    readonly counterName: string;
  };
  /** 0 quando nenhum clock foi injetado. */
  readonly evaluatedAt: number;
}

/** Classificacao de faixa. Publica e testada isoladamente nos limites 39/40/69/70. */
export function bandForScore(score: number): DirtyBand {
  if (score >= BAND_CRITICAL_MIN) return 'critical';
  if (score >= BAND_WARNING_MIN) return 'warning';
  return 'healthy';
}

/* --------------------------- lexicos de contradicao ------------------------ */

/**
 * Marcadores de negacao PT/EN. 'no' e 'sem' foram DELIBERADAMENTE omitidos: em
 * portugues 'no' e contracao ("no arquivo") e 'sem' aparece em contexto nao
 * normativo com frequencia alta demais. Incluir os dois dispara falso positivo.
 */
export const NEGATION_MARKERS: ReadonlySet<string> = new Set([
  'nao', 'nunca', 'jamais', 'evite', 'evitar', 'proibido', 'proibida', 'vedado',
  'never', 'not', 'dont', 'doesnt', 'shouldnt', 'avoid', 'forbidden', 'without',
]);

/**
 * Antonimos canonicos: mapeia um termo para a sua forma positiva e sinaliza que a
 * polaridade da diretiva deve ser invertida. Assim "remova os logs" e "inclua os
 * logs" viram o MESMO corpo com polaridades opostas, e o conflito e detectado sem
 * um leitor semantico.
 * Lista curta de proposito — cada entrada e uma aposta que pode gerar falso
 * positivo. Exportada para o integrador estender com o vocabulario do dominio.
 */
export const ANTONYM_CANON: Readonly<Record<string, { readonly canonical: string; readonly flip: boolean }>> = {
  remova: { canonical: 'inclua', flip: true },
  remover: { canonical: 'inclua', flip: true },
  remove: { canonical: 'inclua', flip: true },
  exclua: { canonical: 'inclua', flip: true },
  excluir: { canonical: 'inclua', flip: true },
  exclude: { canonical: 'inclua', flip: true },
  omita: { canonical: 'inclua', flip: true },
  adicione: { canonical: 'inclua', flip: false },
  adicionar: { canonical: 'inclua', flip: false },
  incluir: { canonical: 'inclua', flip: false },
  include: { canonical: 'inclua', flip: false },
  add: { canonical: 'inclua', flip: false },
  desative: { canonical: 'ative', flip: true },
  desativar: { canonical: 'ative', flip: true },
  disable: { canonical: 'ative', flip: true },
  desligue: { canonical: 'ative', flip: true },
  ativar: { canonical: 'ative', flip: false },
  enable: { canonical: 'ative', flip: false },
  ligue: { canonical: 'ative', flip: false },
  resuma: { canonical: 'detalhe', flip: true },
  resumir: { canonical: 'detalhe', flip: true },
  encurte: { canonical: 'detalhe', flip: true },
  detalhar: { canonical: 'detalhe', flip: false },
  detalhe: { canonical: 'detalhe', flip: false },
  expanda: { canonical: 'detalhe', flip: false },
};

/** Termos que marcam uma sentenca como normativa (candidata a diretiva). */
export const DIRECTIVE_MARKERS: ReadonlySet<string> = new Set([
  'sempre', 'nunca', 'jamais', 'deve', 'devem', 'devera', 'precisa', 'obrigatorio',
  'use', 'usar', 'utilize', 'nao', 'evite', 'garanta', 'mantenha', 'inclua',
  'remova', 'exclua', 'ative', 'desative', 'resuma', 'expanda', 'gere', 'escreva',
  'always', 'never', 'must', 'should', 'ensure', 'avoid', 'keep', 'include',
  'remove', 'enable', 'disable', 'write', 'generate', 'use',
]);

interface ParsedDirective {
  readonly directive: Directive;
  readonly polarity: 'affirm' | 'negate';
  readonly body: string;
}

/**
 * Extrai diretivas de turnos `user`/`system` por marcador normativo.
 * APROXIMADO: e um filtro por palavra-chave sobre uma quebra ingenua de sentencas.
 * Perde diretivas implicitas e captura sentencas descritivas que por acaso contem
 * um marcador ("eu nunca consegui rodar isso"). Prefira fornecer `directives`
 * explicitamente quando a UI ja souber quais sao.
 */
export function extractDirectives(turns: readonly Turn[]): readonly Directive[] {
  const out: Directive[] = [];
  for (const turn of turns) {
    if (turn.role !== 'user' && turn.role !== 'system') continue;
    const sentences = splitSentences(turn.text);
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i] as string;
      const tokens = normalizeText(sentence).split(/[^\p{L}\p{N}]+/u);
      if (!tokens.some((t) => DIRECTIVE_MARKERS.has(t))) continue;
      out.push({ id: `t${turn.index}s${i}`, text: sentence, turnIndex: turn.index });
    }
  }
  return out;
}

function parseDirective(directive: Directive): ParsedDirective {
  const tokens = normalizeText(directive.text).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
  let negated = false;
  const bodyTokens: string[] = [];
  for (const token of tokens) {
    if (NEGATION_MARKERS.has(token)) {
      negated = !negated;
      continue;
    }
    const antonym = ANTONYM_CANON[token];
    if (antonym) {
      if (antonym.flip) negated = !negated;
      bodyTokens.push(antonym.canonical);
      continue;
    }
    bodyTokens.push(token);
  }
  return {
    directive,
    polarity: negated ? 'negate' : 'affirm',
    // O corpo e reconstruido como texto para que `tokenSimilarity` aplique a mesma
    // remocao de stopwords usada no resto do pacote.
    body: bodyTokens.join(' '),
  };
}

/* ------------------------------ sinais isolados ---------------------------- */

function evalWindowOccupancy(
  input: DirtyContextInput,
  th: DirtyThresholds,
  counter: TokenCounter,
): { result: SignalResult; used: number; ratio: number; approximate: boolean; counterName: string } {
  const weight = DIRTY_SIGNAL_WEIGHTS['window-occupancy'];
  const max = input.window.maxTokens;
  const supplied = input.window.usedTokens;
  const used = supplied ?? input.turns.reduce((acc, t) => acc + counter.count(t.text), 0);
  const approximate = supplied === undefined ? counter.approximate : false;
  const counterName = supplied === undefined ? counter.name : 'caller-supplied';
  const ratio = max > 0 ? Math.round((used / max) * 1e6) / 1e6 : 0;

  if (max <= 0) {
    return {
      result: {
        signal: 'window-occupancy',
        weight,
        fired: false,
        evaluated: false,
        detail: 'maxTokens <= 0: limite da janela desconhecido, sinal nao avaliado.',
        evidence: [],
      },
      used, ratio, approximate, counterName,
    };
  }

  const fired = ratio > th.windowOccupancy;
  return {
    result: {
      signal: 'window-occupancy',
      weight,
      fired,
      evaluated: true,
      detail: `ocupacao ${ratio} (limiar > ${th.windowOccupancy})${approximate ? ' [estimativa aproximada]' : ''}`,
      evidence: fired
        ? [{
            kind: 'window-ratio',
            detail: `${used} de ${max} tokens${approximate ? ` estimados por ${counterName}` : ''}`,
            excerpt: `${used}/${max}`,
            turnIndexes: [],
            value: ratio,
          }]
        : [],
    },
    used, ratio, approximate, counterName,
  };
}

function evalStagnation(input: DirtyContextInput, th: DirtyThresholds): SignalResult {
  const weight = DIRTY_SIGNAL_WEIGHTS.stagnation;
  const turns = input.turns;
  if (turns.length === 0) {
    return { signal: 'stagnation', weight, fired: false, evaluated: false, detail: 'sem turnos.', evidence: [] };
  }

  // Corrida final de turnos SEM tool call e SEM mudanca de stateHash.
  const run: Turn[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i] as Turn;
    const hasToolCall = (turn.toolCalls?.length ?? 0) > 0;
    if (hasToolCall) break;
    const previous = turns[i - 1];
    // Sem turno anterior nao ha "mudanca" observavel: a corrida termina aqui.
    if (previous === undefined) { run.push(turn); break; }
    if (previous.stateHash !== turn.stateHash) break;
    run.push(turn);
  }
  run.reverse();

  const anyStateHash = turns.some((t) => t.stateHash !== undefined);
  const fired = run.length >= th.stagnationTurns;
  const indexes = run.map((t) => t.index);
  return {
    signal: 'stagnation',
    weight,
    fired,
    evaluated: true,
    detail: `${run.length} turno(s) finais sem tool call e sem mudanca de estado (limiar ${th.stagnationTurns})`
      + (anyStateHash ? '' : ' [nenhum stateHash fornecido: deteccao baseada so em ausencia de tool call]'),
    evidence: fired
      ? [{
          kind: 'stagnant-run',
          detail: `stateHash inalterado: ${String((run[0] as Turn).stateHash ?? 'nao fornecido')}`,
          excerpt: excerpt((run[run.length - 1] as Turn).text, th.maxExcerptChars),
          turnIndexes: indexes,
          value: run.length,
        }]
      : [],
  };
}

function evalRepetition(input: DirtyContextInput, th: DirtyThresholds): SignalResult {
  const weight = DIRTY_SIGNAL_WEIGHTS.repetition;
  const outputs = input.turns.filter((t) => t.role === 'assistant');
  const recent = outputs.slice(-th.repetitionWindow);
  if (recent.length < 2) {
    return {
      signal: 'repetition', weight, fired: false, evaluated: false,
      detail: `menos de 2 saidas do assistente (${recent.length}); sinal nao avaliado.`,
      evidence: [],
    };
  }

  // INTERPRETACAO: "similaridade >=0.90 entre as 3 ultimas saidas" e lido como
  // "existe ALGUM par entre as 3 ultimas acima do limiar". Exigir que as tres
  // fossem mutuamente similares atrasaria a deteccao em um turno inteiro.
  // O loop-detector usa o criterio mais rigido (clique de 3) de proposito.
  const pair = firstPairAtLeast(recent.map((t) => t.text), th.repetitionSimilarity);
  if (pair === null) {
    return {
      signal: 'repetition', weight, fired: false, evaluated: true,
      detail: `nenhum par das ultimas ${recent.length} saidas atingiu ${th.repetitionSimilarity}`,
      evidence: [],
    };
  }
  const a = recent[pair.indexA] as Turn;
  const b = recent[pair.indexB] as Turn;
  return {
    signal: 'repetition', weight, fired: true, evaluated: true,
    detail: `saidas dos turnos ${a.index} e ${b.index} com similaridade ${pair.similarity}`,
    evidence: [
      {
        kind: 'repeated-output',
        detail: `similaridade ${pair.similarity} >= ${th.repetitionSimilarity}`,
        excerpt: excerpt(a.text, th.maxExcerptChars),
        turnIndexes: [a.index, b.index],
        value: pair.similarity,
      },
      {
        kind: 'repeated-output-counterpart',
        detail: `contraparte do par (turno ${b.index})`,
        excerpt: excerpt(b.text, th.maxExcerptChars),
        turnIndexes: [b.index],
        value: pair.similarity,
      },
    ],
  };
}

function evalRecurringError(input: DirtyContextInput, th: DirtyThresholds): SignalResult {
  const weight = DIRTY_SIGNAL_WEIGHTS['recurring-error'];
  const groups = new Map<string, number[]>();
  for (const turn of input.turns) {
    const sig = turn.errorSignature;
    if (sig === undefined || sig.length === 0) continue;
    const list = groups.get(sig);
    if (list) list.push(turn.index);
    else groups.set(sig, [turn.index]);
  }
  if (groups.size === 0) {
    return {
      signal: 'recurring-error', weight, fired: false, evaluated: true,
      detail: 'nenhum turno com errorSignature.', evidence: [],
    };
  }

  // Ordem determinstica: maior contagem primeiro, desempate pelo primeiro turno.
  const ranked = [...groups.entries()].sort((x, y) => {
    if (y[1].length !== x[1].length) return y[1].length - x[1].length;
    return (x[1][0] as number) - (y[1][0] as number);
  });
  const [topSig, topIdx] = ranked[0] as [string, number[]];
  const fired = topIdx.length >= th.recurringErrorCount;
  return {
    signal: 'recurring-error', weight, fired, evaluated: true,
    detail: `erro mais frequente ocorreu ${topIdx.length}x (limiar ${th.recurringErrorCount})`,
    evidence: fired
      ? ranked
          .filter(([, idx]) => idx.length >= th.recurringErrorCount)
          .map(([sig, idx]) => ({
            kind: 'recurring-error',
            detail: `${idx.length} ocorrencias`,
            excerpt: excerpt(sig, th.maxExcerptChars),
            turnIndexes: idx,
            value: idx.length,
          }))
      : [],
  };
}

function evalTopicDrift(input: DirtyContextInput, th: DirtyThresholds, counter: TokenCounter): SignalResult {
  const weight = DIRTY_SIGNAL_WEIGHTS['topic-drift'];
  const objective = input.objective ?? '';
  const vocabulary = contentTokens(objective);
  if (vocabulary.size === 0) {
    return {
      signal: 'topic-drift', weight, fired: false, evaluated: false,
      detail: 'objetivo ausente ou sem tokens de conteudo; sinal nao avaliado.',
      evidence: [],
    };
  }

  let totalMass = 0;
  let offMass = 0;
  const offenders: Array<{ turn: Turn; mass: number; overlap: number }> = [];
  for (const turn of input.turns) {
    const tokens = contentTokens(turn.text);
    // Turno sem token de conteudo ("ok", "sim") nao e evidencia de deriva nem de
    // foco: sai do denominador em vez de ser contado como no tema.
    if (tokens.size === 0) continue;
    const mass = counter.count(turn.text);
    if (mass <= 0) continue;
    let hits = 0;
    for (const token of tokens) if (vocabulary.has(token)) hits++;
    const overlap = hits / tokens.size;
    totalMass += mass;
    if (overlap < th.onTopicTokenRatio) {
      offMass += mass;
      offenders.push({ turn, mass, overlap: Math.round(overlap * 1e6) / 1e6 });
    }
  }

  if (totalMass === 0) {
    return {
      signal: 'topic-drift', weight, fired: false, evaluated: false,
      detail: 'nenhum turno com conteudo mensuravel; sinal nao avaliado.',
      evidence: [],
    };
  }

  const ratio = Math.round((offMass / totalMass) * 1e6) / 1e6;
  const fired = ratio >= th.topicDriftRatio;
  offenders.sort((a, b) => (b.mass !== a.mass ? b.mass - a.mass : a.turn.index - b.turn.index));
  return {
    signal: 'topic-drift', weight, fired, evaluated: true,
    detail: `${ratio} da massa de contexto abaixo de ${th.onTopicTokenRatio} de sobreposicao lexica com o objetivo (limiar ${th.topicDriftRatio}) [heuristica lexica]`,
    evidence: fired
      ? offenders.slice(0, 3).map((o) => ({
          kind: 'off-topic-turn',
          detail: `sobreposicao ${o.overlap} com o objetivo, ~${o.mass} tokens`,
          excerpt: excerpt(o.turn.text, th.maxExcerptChars),
          turnIndexes: [o.turn.index],
          value: o.overlap,
        }))
      : [],
  };
}

function evalContradiction(input: DirtyContextInput, th: DirtyThresholds): SignalResult {
  const weight = DIRTY_SIGNAL_WEIGHTS['contradictory-instruction'];
  const directives = input.directives ?? extractDirectives(input.turns);
  if (directives.length < 2) {
    return {
      signal: 'contradictory-instruction', weight, fired: false, evaluated: false,
      detail: `menos de 2 diretivas identificadas (${directives.length}); sinal nao avaliado.`,
      evidence: [],
    };
  }

  const parsed = directives.map(parseDirective);
  const conflicts: Evidence[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i] as ParsedDirective;
      const b = parsed[j] as ParsedDirective;
      if (a.polarity === b.polarity) continue;
      const bodySim = tokenSimilarity(a.body, b.body);
      if (bodySim < th.contradictionBodySimilarity) continue;
      const turnIndexes = [a.directive.turnIndex, b.directive.turnIndex]
        .filter((x): x is number => typeof x === 'number')
        .sort((x, y) => x - y);
      conflicts.push({
        kind: 'contradictory-pair',
        detail: `polaridades opostas sobre o mesmo corpo (similaridade ${bodySim}): "${excerpt(a.directive.text, th.maxExcerptChars)}" vs "${excerpt(b.directive.text, th.maxExcerptChars)}"`,
        excerpt: excerpt(`${a.directive.text} || ${b.directive.text}`, th.maxExcerptChars),
        turnIndexes,
        value: bodySim,
      });
    }
  }

  const fired = conflicts.length >= th.contradictionPairs;
  return {
    signal: 'contradictory-instruction', weight, fired, evaluated: true,
    detail: `${conflicts.length} par(es) conflitante(s) entre ${directives.length} diretivas (limiar ${th.contradictionPairs}) [heuristica de polaridade + antonimos]`,
    evidence: fired ? conflicts.slice(0, 3) : [],
  };
}

/* --------------------------------- fachada -------------------------------- */

/**
 * Avalia os seis sinais e devolve score, faixa, sinais disparados e evidencia.
 * Funcao pura: mesma entrada e mesmas opcoes produzem exatamente a mesma saida.
 */
export function scoreDirtyContext(
  input: DirtyContextInput,
  options: DirtyContextOptions = {},
): DirtyContextReport {
  const th: DirtyThresholds = { ...DEFAULT_DIRTY_THRESHOLDS, ...options.thresholds };
  const counter = options.tokenCounter ?? heuristicTokenCounter;
  const clock = options.clock ?? zeroClock;

  const windowEval = evalWindowOccupancy(input, th, counter);
  const bySignal: Record<DirtySignalId, SignalResult> = {
    'window-occupancy': windowEval.result,
    stagnation: evalStagnation(input, th),
    repetition: evalRepetition(input, th),
    'recurring-error': evalRecurringError(input, th),
    'topic-drift': evalTopicDrift(input, th, counter),
    'contradictory-instruction': evalContradiction(input, th),
  };

  const signals = DIRTY_SIGNAL_ORDER.map((id) => bySignal[id]);
  const fired = signals.filter((s) => s.fired);
  const score = Math.min(100, Math.max(0, fired.reduce((acc, s) => acc + s.weight, 0)));

  return {
    score,
    band: bandForScore(score),
    signals,
    fired,
    notEvaluated: signals.filter((s) => !s.evaluated).map((s) => s.signal),
    window: {
      usedTokens: windowEval.used,
      maxTokens: input.window.maxTokens,
      ratio: windowEval.ratio,
      approximate: windowEval.approximate,
      counterName: windowEval.counterName,
    },
    evaluatedAt: clock.now(),
  };
}
