/**
 * token-estimate.ts — contagem de tokens ATRAVES DE UMA INTERFACE INJETAVEL.
 *
 * AVISO DE PRECISAO (repetido no HANDOFF.md, de proposito):
 * `heuristicTokenCounter` NAO e um tokenizer. Ele nao carrega vocabulario BPE, nao
 * conhece o merge table de nenhum modelo e NAO PODE acertar a contagem real. E uma
 * aproximacao estrutural, marcada em runtime por `approximate: true`. Todo consumidor
 * que precise de exatidao (cobranca, corte duro de janela, limite de API) deve
 * injetar um `TokenCounter` de verdade — a interface existe exatamente para isso.
 *
 * MAGNITUDE DO ERRO: NAO MEDIDA. Medir exigiria o vocabulario BPE do modelo alvo,
 * isto e, uma dependencia — o oposto do requisito deste pacote. Nao ha aqui nenhum
 * numero de acuracia porque nao ha nenhum experimento por tras dele. O que se sabe
 * pela construcao das regras:
 *  - SUPERESTIMA texto com pontuacao densa (codigo, JSON, tabelas markdown), porque
 *    cobra por corrida de simbolos sem saber quais fundem no merge table.
 *  - SUBESTIMA palavras raras, nomes proprios, identificadores camelCase longos e
 *    base64, que na pratica estilhacam em muitos tokens.
 *  - CJK e tratado como 1 token por caractere; o valor real varia de 0.5 a 2.
 * Trate o desvio como da ordem de DEZENAS DE POR CENTO e sempre deixe margem.
 * Nunca use esta heuristica como corte duro de janela ou base de cobranca.
 *
 * DETERMINISMO: funcao pura de string -> inteiro. Sem tempo, aleatoriedade ou I/O.
 */

export interface TokenCounter {
  /** Identificador estavel, usado em relatorios para dizer QUEM contou. */
  readonly name: string;
  /** true = estimativa. Deve ser propagado para a UI, nunca escondido. */
  readonly approximate: boolean;
  /** Contagem de tokens de `text`. Deve ser deterministica e >= 0. */
  count(text: string): number;
}

/** Pesos da heuristica. Exportados para permitir recalibracao sem fork. */
export interface HeuristicWeights {
  /** Caracteres por token dentro de uma palavra alfabetica. */
  readonly charsPerAlphaToken: number;
  /** Digitos por token dentro de um numero. */
  readonly digitsPerToken: number;
  /** Caracteres por token em sequencias de simbolos/pontuacao. */
  readonly charsPerSymbolToken: number;
  /** Tokens por code point fora do alfabeto latino (CJK, emoji, etc). */
  readonly tokensPerWideChar: number;
  /** Tokens cobrados por quebra de linha. */
  readonly tokensPerNewline: number;
}

/**
 * Calibragem: `charsPerAlphaToken: 5` foi escolhido porque 4 fazia toda palavra de
 * 5+ letras custar 2 tokens ("hello world" -> 4, quando o valor real e 2). Com 5,
 * palavras comuns caem em 1 token e palavras longas escalam. Nao ha ajuste fino
 * possivel sem um tokenizer de referencia — ver o aviso no topo do arquivo.
 */
export const DEFAULT_HEURISTIC_WEIGHTS: HeuristicWeights = {
  charsPerAlphaToken: 5,
  digitsPerToken: 3,
  charsPerSymbolToken: 2,
  tokensPerWideChar: 1,
  tokensPerNewline: 1,
};

type CharClass = 'alpha' | 'digit' | 'symbol' | 'wide' | 'space' | 'newline';

function classify(codePoint: number): CharClass {
  const ch = String.fromCodePoint(codePoint);
  if (ch === '\n' || ch === '\r') return 'newline';
  if (/\s/u.test(ch)) return 'space';
  if (/\p{Nd}/u.test(ch)) return 'digit';
  if (/\p{L}/u.test(ch)) {
    // Latino/Cirilico/Grego seguem a regra de "palavra"; o resto (CJK, silabarios)
    // e caro por caractere nos tokenizers BPE atuais.
    return /\p{Script=Latin}|\p{Script=Cyrillic}|\p{Script=Greek}/u.test(ch) ? 'alpha' : 'wide';
  }
  if (/\p{M}/u.test(ch)) return 'alpha';
  if (codePoint > 0x2000) return 'wide';
  return 'symbol';
}

/**
 * Heuristica estrutural: segmenta o texto em corridas homogeneas e cobra cada
 * corrida pela regra da sua classe.
 *
 * Racional de cada regra (todas aproximadas):
 *  - palavra alfabetica: BPE funde o espaco a esquerda com a palavra, e palavras
 *    comuns viram 1 token. ceil(len/5) com minimo 1 aproxima isso.
 *  - digitos: tokenizers modernos quebram numeros em grupos de ate 3 digitos.
 *  - simbolos: pontuacao isolada costuma ser 1 token, mas corridas ("---", "})")
 *    fundem; ceil(len/2) fica no meio.
 *  - espaco simples entre palavras: 0, ja contabilizado na palavra seguinte.
 *    Corridas de espaco (indentacao) cobram ceil(len/2).
 *  - quebra de linha: 1 token cada.
 *
 * Custo: O(n) sobre code points, uma passagem, sem alocacao proporcional ao texto.
 */
export function estimateTokensHeuristic(
  text: string,
  weights: HeuristicWeights = DEFAULT_HEURISTIC_WEIGHTS,
): number {
  if (text.length === 0) return 0;
  let total = 0;
  let runClass: CharClass | null = null;
  let runLength = 0;

  const flush = (): void => {
    if (runClass === null || runLength === 0) return;
    switch (runClass) {
      case 'alpha':
        total += Math.max(1, Math.ceil(runLength / weights.charsPerAlphaToken));
        break;
      case 'digit':
        total += Math.max(1, Math.ceil(runLength / weights.digitsPerToken));
        break;
      case 'symbol':
        total += Math.max(1, Math.ceil(runLength / weights.charsPerSymbolToken));
        break;
      case 'wide':
        total += runLength * weights.tokensPerWideChar;
        break;
      case 'newline':
        total += runLength * weights.tokensPerNewline;
        break;
      case 'space':
        // Um unico espaco e absorvido pela palavra seguinte; indentacao custa.
        if (runLength > 1) total += Math.ceil(runLength / weights.charsPerSymbolToken);
        break;
    }
    runLength = 0;
  };

  for (const ch of text) {
    const cls = classify(ch.codePointAt(0) as number);
    if (cls !== runClass) {
      flush();
      runClass = cls;
    }
    runLength += Array.from(ch).length;
  }
  flush();
  return total;
}

/** Contador padrao. SEMPRE aproximado. Nao use onde exatidao importa. */
export const heuristicTokenCounter: TokenCounter = {
  name: 'heuristic-structural-v1',
  approximate: true,
  count: (text: string): number => estimateTokensHeuristic(text),
};

/**
 * Contador trivial chars/N. Existe para comparacao e para casos em que o
 * integrador ja tem uma razao calibrada do proprio corpus.
 */
export function fixedRatioTokenCounter(charsPerToken = 4): TokenCounter {
  const ratio = Math.max(1, charsPerToken);
  return {
    name: `fixed-ratio-${ratio}`,
    approximate: true,
    count: (text: string): number => Math.ceil(Array.from(text).length / ratio),
  };
}

/**
 * PONTO DE SUBSTITUICAO. Envolve um tokenizer real (tiktoken, @anthropic-ai/tokenizer,
 * endpoint de count_tokens ja resolvido para sincrono) em um `TokenCounter`.
 * Passe `approximate: false` apenas se a contagem for de fato exata para o modelo alvo.
 */
export function tokenCounterFrom(
  name: string,
  count: (text: string) => number,
  approximate = false,
): TokenCounter {
  return { name, approximate, count };
}

/** Soma a contagem de varios textos com o mesmo contador. */
export function countAll(texts: readonly string[], counter: TokenCounter = heuristicTokenCounter): number {
  let total = 0;
  for (const t of texts) total += counter.count(t);
  return total;
}

export interface WindowOccupancy {
  readonly usedTokens: number;
  readonly maxTokens: number;
  /** usedTokens / maxTokens, em [0, +inf). 0 se maxTokens <= 0. */
  readonly ratio: number;
  readonly counterName: string;
  readonly approximate: boolean;
}

/** Ocupacao da janela. `usedTokens` explicito tem precedencia sobre a estimativa. */
export function windowOccupancy(
  maxTokens: number,
  texts: readonly string[],
  counter: TokenCounter = heuristicTokenCounter,
  usedTokensOverride?: number,
): WindowOccupancy {
  const used = usedTokensOverride ?? countAll(texts, counter);
  const ratio = maxTokens > 0 ? used / maxTokens : 0;
  return {
    usedTokens: used,
    maxTokens,
    ratio: Math.round(ratio * 1e6) / 1e6,
    counterName: usedTokensOverride === undefined ? counter.name : 'caller-supplied',
    approximate: usedTokensOverride === undefined ? counter.approximate : false,
  };
}
