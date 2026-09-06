/**
 * types.ts — vocabulario compartilhado por dirty-context.ts e loop-detector.ts.
 *
 * Existe para que os dois detectores consumam EXATAMENTE a mesma forma de turno.
 * Se cada um definisse o seu, o integrador teria que manter duas projecoes do
 * historico e elas iriam divergir.
 */

/* --------------------------------- clock --------------------------------- */

/**
 * Relogio injetavel. Nenhuma logica deste pacote chama Date.now().
 * O default em toda API publica e `zeroClock`, entao um teste que nao injeta nada
 * continua deterministico. `systemClock` e o adaptador de borda: quem quiser
 * carimbo real de tempo injeta explicitamente, na fronteira, e assume a impureza.
 */
export interface Clock {
  now(): number;
}

/** Default de todo o pacote. `evaluatedAt: 0` significa "nenhum clock injetado". */
export const zeroClock: Clock = { now: () => 0 };

/** Unico ponto do pacote que toca Date. Nunca e default de nada. */
export const systemClock: Clock = { now: () => Date.now() };

/** Relogio congelado, para testes e replays. */
export function fixedClock(timestamp: number): Clock {
  return { now: () => timestamp };
}

/* ---------------------------------- turno --------------------------------- */

export type TurnRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ToolCall {
  readonly name: string;
  /**
   * Argumentos como estrutura JSON-serializavel. E canonicalizado (chaves ordenadas)
   * antes de qualquer comparacao, portanto {a:1,b:2} e {b:2,a:1} sao identicos.
   */
  readonly args?: unknown;
}

export interface Turn {
  /** Posicao no historico. Usado apenas como identificador em evidencias. */
  readonly index: number;
  readonly role: TurnRole;
  /** Texto do turno. NUNCA e devolvido inteiro em evidencia — sempre via `excerpt`. */
  readonly text: string;
  readonly toolCalls?: readonly ToolCall[];
  /**
   * Hash do estado do mundo APOS o turno (arquivos, banco, o que o agente controla).
   * Fortemente recomendado: sem ele, estagnacao e progresso viram inferencia por
   * ausencia de tool call, o que aumenta falso positivo. Ver dirty-context.ts.
   */
  readonly stateHash?: string;
  /**
   * Assinatura normalizada do erro do turno (classe + mensagem sem stack/ids/paths
   * volateis). A normalizacao e responsabilidade de quem constroi o Turn: este
   * pacote compara por igualdade exata de string.
   */
  readonly errorSignature?: string;
  /** Identificadores de artefatos produzidos neste turno (caminhos, ids). */
  readonly artifacts?: readonly string[];
}

/* -------------------------------- evidencia ------------------------------- */

/**
 * Evidencia de um sinal. Sem isso o score e inutil para a UI: um numero sem o
 * trecho que o causou nao permite ao usuario concordar nem discordar.
 */
export interface Evidence {
  /** Discriminador curto e estavel, seguro para usar como chave de i18n na UI. */
  readonly kind: string;
  /** Frase legivel descrevendo o que foi detectado. */
  readonly detail: string;
  /** Trecho literal detectado, sempre truncado. Pode ser string vazia. */
  readonly excerpt: string;
  /** Turnos envolvidos, em ordem crescente. */
  readonly turnIndexes: readonly number[];
  /** Valor numerico associado (similaridade, razao, contagem), quando aplicavel. */
  readonly value?: number;
}
