/**
 * fixtures.ts — construtores de historico para os testes.
 * Sem rede, sem chave, sem fs. Tudo literal e deterministico.
 */

import type { ToolCall, Turn, TurnRole } from '../../lib/core/types';

export interface TurnSpec {
  readonly role?: TurnRole;
  readonly text: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly stateHash?: string;
  readonly errorSignature?: string;
  readonly artifacts?: readonly string[];
}

/** Monta turnos com indices sequenciais a partir de 0. */
export function makeTurns(specs: readonly TurnSpec[]): readonly Turn[] {
  return specs.map((spec, index) => {
    const turn: {
      index: number;
      role: TurnRole;
      text: string;
      toolCalls?: readonly ToolCall[];
      stateHash?: string;
      errorSignature?: string;
      artifacts?: readonly string[];
    } = {
      index,
      role: spec.role ?? 'assistant',
      text: spec.text,
    };
    if (spec.toolCalls !== undefined) turn.toolCalls = spec.toolCalls;
    if (spec.stateHash !== undefined) turn.stateHash = spec.stateHash;
    if (spec.errorSignature !== undefined) turn.errorSignature = spec.errorSignature;
    if (spec.artifacts !== undefined) turn.artifacts = spec.artifacts;
    return turn as Turn;
  });
}

/** Objetivo usado por todos os cenarios de deriva de topico. */
export const OBJETIVO = 'implementar autenticacao oauth no servidor next.js do saintpetrus';

/** Texto claramente dentro do objetivo, variando o final para nao virar repeticao. */
export function onTopic(suffix: string): string {
  return `Ajustando a autenticacao oauth do servidor next.js no saintpetrus: ${suffix}`;
}

/** Texto sem nenhuma sobreposicao lexica com OBJETIVO. */
export function offTopic(suffix: string): string {
  return `Discutindo receita de bolo de chocolate com cobertura de brigadeiro e morango: ${suffix}`;
}

export function toolCall(name: string, args: unknown): ToolCall {
  return { name, args };
}
