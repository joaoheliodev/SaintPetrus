/**
 * loop-detector.ts — deteccao de loop improdutivo. Quatro condicoes independentes;
 * qualquer uma dispara.
 *
 *   repeated-output    >=3 saidas com similaridade >=0.90 ENTRE SI (clique, nao estrela)
 *   repeated-tool-call mesma ferramenta com argumentos identicos >=3 vezes
 *   repeated-question  pergunta semanticamente equivalente repetida >=2 vezes
 *   no-progress        zero progresso por LOOP_IDLE_CYCLES (default 5)
 *
 * RELACAO COM dirty-context.ts (leia antes de achar que e duplicado):
 *  - `repetition` (dirty) dispara com UM par das 3 ultimas saidas acima do limiar.
 *    `repeated-output` (aqui) exige um CLIQUE de 3 mutuamente similares. O primeiro
 *    e um alerta precoce que admite falso positivo; o segundo e uma afirmacao de
 *    que ha loop e precisa ser mais dificil de disparar.
 *  - `stagnation` (dirty) exige AUSENCIA de tool call. `no-progress` (aqui) trata
 *    uma tool call repetida com os mesmos argumentos como NAO-progresso: o agente
 *    esta agindo, so nao esta avancando. Sao estados diferentes do mundo.
 *
 * PUREZA: sem I/O, sem tempo, sem aleatoriedade. `evaluatedAt` vem do Clock injetado.
 */

import { excerpt, findSimilarClique, splitSentences, tokenSimilarity } from './similarity';
import { zeroClock, type Clock, type Evidence, type ToolCall, type Turn } from './types';

/** Ciclos sem progresso para disparar `no-progress`. */
export const LOOP_IDLE_CYCLES = 5;

export type LoopConditionId =
  | 'repeated-output'
  | 'repeated-tool-call'
  | 'repeated-question'
  | 'no-progress';

export const LOOP_CONDITION_ORDER: readonly LoopConditionId[] = [
  'repeated-output',
  'repeated-tool-call',
  'repeated-question',
  'no-progress',
];

export interface LoopThresholds {
  /** Similaridade entre saidas para contarem como iguais. Default 0.90. */
  readonly outputSimilarity: number;
  /** Tamanho do clique de saidas similares. Default 3. */
  readonly outputCliqueSize: number;
  /** Quantas saidas recentes entram na busca de clique. Default 12. */
  readonly outputWindow: number;
  /** Repeticoes da mesma (ferramenta, args) para disparar. Default 3. */
  readonly toolCallRepeats: number;
  /** Similaridade lexica para duas perguntas contarem como equivalentes. Default 0.85. */
  readonly questionSimilarity: number;
  /** Ocorrencias de uma mesma pergunta para disparar. Default 2. */
  readonly questionRepeats: number;
  /** Ciclos consecutivos sem progresso. Default LOOP_IDLE_CYCLES. */
  readonly idleCycles: number;
  readonly maxExcerptChars: number;
}

export const DEFAULT_LOOP_THRESHOLDS: LoopThresholds = {
  outputSimilarity: 0.9,
  outputCliqueSize: 3,
  outputWindow: 12,
  toolCallRepeats: 3,
  questionSimilarity: 0.85,
  questionRepeats: 2,
  idleCycles: LOOP_IDLE_CYCLES,
  maxExcerptChars: 160,
};

export interface LoopDetectorOptions {
  readonly clock?: Clock;
  readonly thresholds?: Partial<LoopThresholds>;
}

export interface LoopConditionResult {
  readonly condition: LoopConditionId;
  readonly fired: boolean;
  readonly evaluated: boolean;
  readonly detail: string;
  readonly evidence: readonly Evidence[];
}

export interface LoopReport {
  readonly looping: boolean;
  /** Todas as condicoes, em LOOP_CONDITION_ORDER. */
  readonly conditions: readonly LoopConditionResult[];
  /** Subconjunto disparado, mesma ordem. */
  readonly fired: readonly LoopConditionResult[];
  readonly notEvaluated: readonly LoopConditionId[];
  /** 0 quando nenhum clock foi injetado. */
  readonly evaluatedAt: number;
}

/**
 * Serializacao JSON canonica: chaves de objeto ordenadas recursivamente, para que
 * {a:1,b:2} e {b:2,a:1} produzam a MESMA chave de comparacao. Arrays preservam a
 * ordem (ordem de array e semantica). `undefined` vira null para nao sumir de
 * dentro de arrays. Deterministica e sem dependencia.
 */
export function canonicalJson(value: unknown): string {
  const walk = (node: unknown): string => {
    if (node === null || node === undefined) return 'null';
    const t = typeof node;
    if (t === 'number') return Number.isFinite(node as number) ? JSON.stringify(node) : 'null';
    if (t === 'boolean' || t === 'string') return JSON.stringify(node);
    if (t === 'bigint') return JSON.stringify((node as bigint).toString());
    if (Array.isArray(node)) return `[${node.map(walk).join(',')}]`;
    if (t === 'object') {
      const entries = Object.entries(node as Record<string, unknown>)
        .filter(([, v]) => typeof v !== 'function' && typeof v !== 'symbol')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${walk(v)}`).join(',')}}`;
    }
    return 'null';
  };
  return walk(value);
}

/** Chave de identidade de uma chamada de ferramenta. */
export function toolCallKey(call: ToolCall): string {
  return `${call.name} ${canonicalJson(call.args ?? null)}`;
}

/* ------------------------------- condicao 1 -------------------------------- */

function evalRepeatedOutput(turns: readonly Turn[], th: LoopThresholds): LoopConditionResult {
  const outputs = turns.filter((t) => t.role === 'assistant');
  if (outputs.length < th.outputCliqueSize) {
    return {
      condition: 'repeated-output', fired: false, evaluated: false,
      detail: `apenas ${outputs.length} saida(s); minimo ${th.outputCliqueSize}.`,
      evidence: [],
    };
  }
  const clique = findSimilarClique(
    outputs.map((t) => t.text),
    th.outputSimilarity,
    th.outputCliqueSize,
    { maxWindow: th.outputWindow },
  );
  if (clique === null) {
    return {
      condition: 'repeated-output', fired: false, evaluated: true,
      detail: `nenhum grupo de ${th.outputCliqueSize} saidas mutuamente similares em >= ${th.outputSimilarity}.`,
      evidence: [],
    };
  }
  const turnIndexes = clique.indexes.map((i) => (outputs[i] as Turn).index);
  return {
    condition: 'repeated-output', fired: true, evaluated: true,
    detail: `${clique.indexes.length} saidas mutuamente similares (minimo do grupo: ${clique.minSimilarity})`,
    evidence: clique.indexes.map((i) => ({
      kind: 'similar-output',
      detail: `membro do grupo repetido (turno ${(outputs[i] as Turn).index})`,
      excerpt: excerpt((outputs[i] as Turn).text, th.maxExcerptChars),
      turnIndexes,
      value: clique.minSimilarity,
    })),
  };
}

/* ------------------------------- condicao 2 -------------------------------- */

function evalRepeatedToolCall(turns: readonly Turn[], th: LoopThresholds): LoopConditionResult {
  const groups = new Map<string, { call: ToolCall; turnIndexes: number[] }>();
  let total = 0;
  for (const turn of turns) {
    for (const call of turn.toolCalls ?? []) {
      total++;
      const key = toolCallKey(call);
      const group = groups.get(key);
      if (group) group.turnIndexes.push(turn.index);
      else groups.set(key, { call, turnIndexes: [turn.index] });
    }
  }
  if (total === 0) {
    return {
      condition: 'repeated-tool-call', fired: false, evaluated: false,
      detail: 'nenhuma chamada de ferramenta no historico.', evidence: [],
    };
  }
  const offenders = [...groups.values()]
    .filter((g) => g.turnIndexes.length >= th.toolCallRepeats)
    .sort((a, b) => (b.turnIndexes.length !== a.turnIndexes.length
      ? b.turnIndexes.length - a.turnIndexes.length
      : (a.turnIndexes[0] as number) - (b.turnIndexes[0] as number)));

  if (offenders.length === 0) {
    return {
      condition: 'repeated-tool-call', fired: false, evaluated: true,
      detail: `nenhuma (ferramenta, args) repetida ${th.toolCallRepeats}x entre ${total} chamadas.`,
      evidence: [],
    };
  }
  return {
    condition: 'repeated-tool-call', fired: true, evaluated: true,
    detail: `${offenders.length} chamada(s) identica(s) repetida(s) >= ${th.toolCallRepeats}x`,
    evidence: offenders.slice(0, 3).map((g) => ({
      kind: 'repeated-tool-call',
      detail: `${g.call.name} chamada ${g.turnIndexes.length}x com argumentos identicos`,
      excerpt: excerpt(`${g.call.name}(${canonicalJson(g.call.args ?? null)})`, th.maxExcerptChars),
      turnIndexes: [...g.turnIndexes],
      value: g.turnIndexes.length,
    })),
  };
}

/* ------------------------------- condicao 3 -------------------------------- */

/**
 * Perguntas do assistente: sentencas terminadas em '?'.
 * APROXIMADO: perde pergunta indireta ("me diga qual arquivo usar.") e captura
 * pergunta retorica dentro de explicacao.
 */
export function extractQuestions(turns: readonly Turn[]): ReadonlyArray<{ turnIndex: number; text: string }> {
  const out: Array<{ turnIndex: number; text: string }> = [];
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    for (const sentence of splitSentences(turn.text)) {
      if (sentence.endsWith('?')) out.push({ turnIndex: turn.index, text: sentence });
    }
  }
  return out;
}

function evalRepeatedQuestion(turns: readonly Turn[], th: LoopThresholds): LoopConditionResult {
  const questions = extractQuestions(turns);
  if (questions.length < th.questionRepeats) {
    return {
      condition: 'repeated-question', fired: false, evaluated: false,
      detail: `apenas ${questions.length} pergunta(s); minimo ${th.questionRepeats}.`,
      evidence: [],
    };
  }

  // Agrupamento guloso por equivalencia lexica: cada pergunta entra no primeiro
  // grupo cujo representante seja similar o bastante. Guloso e nao otimo, mas e
  // deterministico (varredura em ordem) e estavel, que e o que a UI precisa.
  const groups: Array<{
    head: { turnIndex: number; text: string };
    members: Array<{ turnIndex: number; text: string }>;
    minSim: number;
  }> = [];
  for (const question of questions) {
    let placed = false;
    for (const group of groups) {
      const sim = tokenSimilarity(group.head.text, question.text);
      if (sim >= th.questionSimilarity) {
        group.members.push(question);
        if (sim < group.minSim) group.minSim = sim;
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ head: question, members: [question], minSim: 1 });
  }

  const offenders = groups
    .filter((g) => g.members.length >= th.questionRepeats)
    .sort((a, b) => b.members.length - a.members.length);

  if (offenders.length === 0) {
    return {
      condition: 'repeated-question', fired: false, evaluated: true,
      detail: `nenhuma pergunta equivalente repetida ${th.questionRepeats}x entre ${questions.length} perguntas.`,
      evidence: [],
    };
  }
  return {
    condition: 'repeated-question', fired: true, evaluated: true,
    detail: `${offenders.length} pergunta(s) equivalente(s) repetida(s) >= ${th.questionRepeats}x [equivalencia LEXICA, nao semantica]`,
    evidence: offenders.slice(0, 3).map((g) => ({
      kind: 'repeated-question',
      detail: `${g.members.length} ocorrencias, similaridade minima ${g.minSim}`,
      excerpt: excerpt(g.head.text, th.maxExcerptChars),
      turnIndexes: g.members.map((m) => m.turnIndex),
      value: g.members.length,
    })),
  };
}

/* ------------------------------- condicao 4 -------------------------------- */

/**
 * Progresso em um turno, na ordem de forca da evidencia:
 *  1. stateHash mudou em relacao ao turno anterior -> PROGRESSO
 *  2. produziu artefato ainda nao visto            -> PROGRESSO
 *  3. fez tool call com (nome, args) ainda nao vista -> PROGRESSO
 * Qualquer outra coisa e nao-progresso. Uma tool call identica a uma anterior NAO
 * conta: repetir a mesma acao e o sintoma, nao a cura.
 */
function evalNoProgress(turns: readonly Turn[], th: LoopThresholds): LoopConditionResult {
  if (turns.length === 0) {
    return { condition: 'no-progress', fired: false, evaluated: false, detail: 'sem turnos.', evidence: [] };
  }

  const seenTools = new Set<string>();
  const seenArtifacts = new Set<string>();
  const progressed: boolean[] = [];
  let previousHash: string | undefined;
  let firstTurn = true;

  for (const turn of turns) {
    let progress = false;
    if (turn.stateHash !== undefined && (firstTurn || turn.stateHash !== previousHash)) progress = true;
    for (const artifact of turn.artifacts ?? []) {
      if (!seenArtifacts.has(artifact)) { progress = true; seenArtifacts.add(artifact); }
    }
    for (const call of turn.toolCalls ?? []) {
      const key = toolCallKey(call);
      if (!seenTools.has(key)) { progress = true; seenTools.add(key); }
    }
    progressed.push(progress);
    if (turn.stateHash !== undefined) previousHash = turn.stateHash;
    firstTurn = false;
  }

  let run = 0;
  for (let i = progressed.length - 1; i >= 0 && progressed[i] === false; i--) run++;

  const idleTurns = turns.slice(turns.length - run);
  const fired = run >= th.idleCycles;
  return {
    condition: 'no-progress', fired, evaluated: true,
    detail: `${run} ciclo(s) finais sem progresso (limiar ${th.idleCycles})`,
    evidence: fired
      ? [{
          kind: 'idle-run',
          detail: `nenhuma mudanca de estado, artefato novo ou chamada de ferramenta inedita em ${run} turnos`,
          excerpt: excerpt((idleTurns[idleTurns.length - 1] as Turn).text, th.maxExcerptChars),
          turnIndexes: idleTurns.map((t) => t.index),
          value: run,
        }]
      : [],
  };
}

/* --------------------------------- fachada -------------------------------- */

/** Avalia as quatro condicoes. Funcao pura. */
export function detectLoop(turns: readonly Turn[], options: LoopDetectorOptions = {}): LoopReport {
  const th: LoopThresholds = { ...DEFAULT_LOOP_THRESHOLDS, ...options.thresholds };
  const clock = options.clock ?? zeroClock;

  const byCondition: Record<LoopConditionId, LoopConditionResult> = {
    'repeated-output': evalRepeatedOutput(turns, th),
    'repeated-tool-call': evalRepeatedToolCall(turns, th),
    'repeated-question': evalRepeatedQuestion(turns, th),
    'no-progress': evalNoProgress(turns, th),
  };
  const conditions = LOOP_CONDITION_ORDER.map((id) => byCondition[id]);
  const fired = conditions.filter((c) => c.fired);

  return {
    looping: fired.length > 0,
    conditions,
    fired,
    notEvaluated: conditions.filter((c) => !c.evaluated).map((c) => c.condition),
    evaluatedAt: clock.now(),
  };
}
