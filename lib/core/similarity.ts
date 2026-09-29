/**
 * similarity.ts — similaridade textual normalizada, deterministica, sem dependencias.
 *
 * ESCOLHA DE ALGORITMO: shingles de caracteres (k-gramas sobre code points) + Jaccard.
 *
 * Por que shingles+Jaccard e nao bag-of-tokens+cosseno:
 *  - Nao precisa de vocabulario global nem de IDF. Cosseno com TF puro sofre com
 *    textos curtos (um token em comum domina); com IDF precisaria de um corpus,
 *    o que quebra a pureza (o resultado passaria a depender de estado externo).
 *  - k-gramas de caractere capturam repeticao parcial e reformulacao leve, que e
 *    exatamente o caso de uso: saidas de agente quase iguais, com um numero ou uma
 *    palavra trocada. Bag-of-tokens daria 1.0 nesses casos (perde a diferenca) ou
 *    cairia demais com reordenacao.
 *  - Jaccard e simetrico, limitado a [0,1] e nao precisa de normalizacao de norma.
 *
 * CUSTO: para textos de tamanho n e m, construir os conjuntos e O(n+m) tempo e
 * O(n+m) memoria (numero de shingles distintos <= n-k+1). A intersecao itera o
 * menor conjunto: O(min(n,m)). Nao ha alocacao quadratica.
 * Para comparacoes n-a-n (`findSimilarClique`) o custo e O(w^2) de similaridades
 * mais O(w^3) de busca de clique, com w limitado por `maxWindow` (default 12).
 *
 * DETERMINISMO: nenhuma fonte de tempo, aleatoriedade ou I/O. O resultado depende
 * apenas das strings de entrada e das opcoes. Conjuntos sao usados so para contagem,
 * portanto a ordem de iteracao nao influencia o resultado. Todo valor retornado
 * passa por `roundScore` (6 casas), o que remove ruido de ponto flutuante e torna
 * a saida byte-a-byte estavel entre execucoes e plataformas.
 */

export const DEFAULT_SHINGLE_SIZE = 3;

/** Casas decimais mantidas em todo score publico deste modulo. */
export const SCORE_PRECISION = 6;

export interface NormalizeOptions {
  /** Minusculas. Default: true. */
  readonly caseFold?: boolean;
  /** Remove marcas de acentuacao (NFD + descarte de \p{M}). Default: true. */
  readonly stripAccents?: boolean;
  /** Colapsa qualquer sequencia de espacos/quebras em um unico espaco. Default: true. */
  readonly collapseWhitespace?: boolean;
}

export interface SimilarityOptions extends NormalizeOptions {
  /** Tamanho do k-grama. Default: 3. Valores < 1 sao elevados para 1. */
  readonly shingleSize?: number;
}

export interface PairMatch {
  readonly indexA: number;
  readonly indexB: number;
  readonly similarity: number;
}

export interface CliqueMatch {
  readonly indexes: readonly number[];
  /** Menor similaridade entre os pares do grupo. */
  readonly minSimilarity: number;
}

/** Arredonda para SCORE_PRECISION casas. Evita 0.30000000000000004 em saidas publicas. */
export function roundScore(value: number): number {
  const factor = 10 ** SCORE_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * Normalizacao canonica aplicada antes de qualquer comparacao.
 * NAO remove pontuacao: em saidas de agente a pontuacao carrega estrutura
 * (listas, blocos de codigo) que e sinal util de repeticao.
 */
export function normalizeText(text: string, options: NormalizeOptions = {}): string {
  const caseFold = options.caseFold ?? true;
  const stripAccents = options.stripAccents ?? true;
  const collapseWhitespace = options.collapseWhitespace ?? true;

  let out = text.normalize('NFC');
  if (stripAccents) {
    out = out.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
  }
  if (caseFold) out = out.toLowerCase();
  if (collapseWhitespace) out = out.replace(/\s+/gu, ' ').trim();
  return out;
}

/**
 * Conjunto de k-gramas sobre code points (nao unidades UTF-16), para nao partir
 * pares substitutos (emoji, alguns ideogramas) no meio.
 * Se o texto for menor que `size`, devolve o texto inteiro como shingle unico —
 * assim textos curtos identicos ainda batem 1.0.
 */
export function shingleSet(text: string, size: number = DEFAULT_SHINGLE_SIZE): ReadonlySet<string> {
  const k = Math.max(1, Math.floor(size));
  const chars = Array.from(text);
  const set = new Set<string>();
  if (chars.length === 0) return set;
  if (chars.length <= k) {
    set.add(chars.join(''));
    return set;
  }
  for (let i = 0; i + k <= chars.length; i++) {
    set.add(chars.slice(i, i + k).join(''));
  }
  return set;
}

/** Jaccard: |A n B| / |A u B|. Dois conjuntos vazios sao considerados identicos (1). */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const item of small) {
    if (large.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : roundScore(intersection / union);
}

/**
 * Similaridade normalizada em [0,1].
 *  - Entradas identicas apos normalizacao => exatamente 1 (curto-circuito explicito,
 *    inclusive para strings vazias).
 *  - Sem nenhum k-grama em comum => exatamente 0.
 */
export function similarity(a: string, b: string, options: SimilarityOptions = {}): number {
  const na = normalizeText(a, options);
  const nb = normalizeText(b, options);
  if (na === nb) return 1;
  const size = options.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  return jaccard(shingleSet(na, size), shingleSet(nb, size));
}

/**
 * Primeiro par (i<j) com similaridade >= threshold, varrendo em ordem estavel.
 * Devolve null se nenhum par atingir o limiar. Custo O(n^2) similaridades.
 */
export function firstPairAtLeast(
  texts: readonly string[],
  threshold: number,
  options: SimilarityOptions = {},
): PairMatch | null {
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const s = similarity(texts[i] ?? '', texts[j] ?? '', options);
      if (s >= threshold) return { indexA: i, indexB: j, similarity: s };
    }
  }
  return null;
}

/**
 * Grupo de `minSize` textos MUTUAMENTE similares (clique, nao estrela).
 * A distincao importa: tres saidas onde a do meio parece com as outras duas, mas as
 * pontas nao parecem entre si, nao e um loop — e uma transicao. Por isso exigimos
 * clique.
 *
 * Implementacao: matriz de similaridade O(w^2) + busca exaustiva de clique O(w^3)
 * para minSize=3, com w = min(texts.length, maxWindow). Com maxWindow=12 o pior
 * caso e ~1.7k comparacoes de booleanos. Para minSize > 3 a busca e recursiva e
 * continua limitada por maxWindow.
 */
export function findSimilarClique(
  texts: readonly string[],
  threshold: number,
  minSize = 3,
  options: SimilarityOptions & { readonly maxWindow?: number } = {},
): CliqueMatch | null {
  const maxWindow = options.maxWindow ?? 12;
  const start = Math.max(0, texts.length - maxWindow);
  const window = texts.slice(start);
  const n = window.length;
  if (n < minSize) return null;

  const sim: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(n).fill(0);
    sim.push(row);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = similarity(window[i] ?? '', window[j] ?? '', options);
      (sim[i] as number[])[j] = s;
      (sim[j] as number[])[i] = s;
    }
  }

  const chosen: number[] = [];
  const search = (from: number): boolean => {
    if (chosen.length === minSize) return true;
    for (let i = from; i < n; i++) {
      let ok = true;
      for (const c of chosen) {
        if (((sim[c] as number[])[i] ?? 0) < threshold) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      chosen.push(i);
      if (search(i + 1)) return true;
      chosen.pop();
    }
    return false;
  };

  if (!search(0)) return null;

  let min = 1;
  for (let a = 0; a < chosen.length; a++) {
    for (let b = a + 1; b < chosen.length; b++) {
      const s = (sim[chosen[a] as number] as number[])[chosen[b] as number] ?? 0;
      if (s < min) min = s;
    }
  }
  return {
    indexes: chosen.map((i) => i + start),
    minSimilarity: roundScore(min),
  };
}

/* ------------------------------------------------------------------------- *
 * Utilitarios lexicais compartilhados por dirty-context.ts e loop-detector.ts
 * ------------------------------------------------------------------------- */

/**
 * Stopwords PT-BR + EN. Lista curta e deliberadamente conservadora: remover demais
 * degrada frases curtas ate o vazio. Exportada para o integrador estender.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'ao', 'aos', 'as', 'ate', 'com', 'como', 'da', 'das', 'de', 'dele', 'dela',
  'do', 'dos', 'e', 'ele', 'ela', 'em', 'entre', 'era', 'essa', 'esse', 'esta',
  'este', 'eu', 'foi', 'isso', 'ja', 'la', 'mais', 'mas', 'me', 'mesmo', 'meu',
  'na', 'nas', 'nem', 'no', 'nos', 'num', 'numa', 'o', 'os', 'ou', 'para', 'pela',
  'pelo', 'per', 'por', 'que', 'quem', 'se', 'sem', 'ser', 'seu', 'sua', 'sao',
  'so', 'tem', 'um', 'uma', 'voce', 'vou', 'ter', 'foi', 'esta', 'estao',
  'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'i',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'then', 'there',
  'these', 'this', 'to', 'was', 'were', 'will', 'with', 'you', 'your',
]);

/** Comprimento minimo de um token de conteudo. Tokens menores viram ruido. */
export const MIN_CONTENT_TOKEN_LENGTH = 3;

/**
 * Tokens de conteudo: normaliza, quebra em sequencias alfanumericas, descarta
 * stopwords e tokens curtos. Determinístico; devolve um Set (multiplicidade
 * descartada de proposito — para deriva e contradicao a presenca e o que importa).
 */
export function contentTokens(text: string, stopwords: ReadonlySet<string> = STOPWORDS): ReadonlySet<string> {
  const normalized = normalizeText(text);
  const out = new Set<string>();
  for (const raw of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_CONTENT_TOKEN_LENGTH) continue;
    if (stopwords.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Jaccard sobre tokens de conteudo. Usado onde reordenacao de palavras NAO deve contar. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 && tb.size === 0) return normalizeText(a) === normalizeText(b) ? 1 : 0;
  return jaccard(ta, tb);
}

/** Recorte curto e estavel para evidencia de UI. Nunca devolve o texto inteiro. */
export function excerpt(text: string, maxChars = 160): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= maxChars) return flat;
  return chars.slice(0, Math.max(1, maxChars - 1)).join('') + '…';
}

/** Quebra ingenua em sentencas. Aproximada: nao trata abreviacoes nem decimais. */
export function splitSentences(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?;\n])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
