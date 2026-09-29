/**
 * index.ts — superficie publica do @saintpetrus/core.
 *
 * Zero dependencias de runtime. Todas as funcoes exportadas sao puras:
 * sem I/O, sem rede, sem fs, sem Date.now(), sem Math.random().
 * O unico ponto que toca Date e `systemClock`, que nunca e default de nada.
 */

export * from './types';
export * from './similarity';
export * from './token-estimate';
export * from './dirty-context';
export * from './loop-detector';
export * from './handoff';
