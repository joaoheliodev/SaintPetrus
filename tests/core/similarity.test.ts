import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  contentTokens,
  excerpt,
  findSimilarClique,
  firstPairAtLeast,
  jaccard,
  normalizeText,
  shingleSet,
  similarity,
  splitSentences,
  tokenSimilarity,
} from '../../lib/core/similarity';

describe('similarity: contrato de fronteira', () => {
  it('textos identicos valem exatamente 1', () => {
    assert.equal(similarity('abc', 'abc'), 1);
    assert.equal(similarity('a', 'a'), 1);
    assert.equal(
      similarity('O agente ficou preso no mesmo passo.', 'O agente ficou preso no mesmo passo.'),
      1,
    );
  });

  it('strings vazias sao identicas entre si', () => {
    assert.equal(similarity('', ''), 1);
  });

  it('vazio contra nao-vazio vale exatamente 0', () => {
    assert.equal(similarity('', 'abc'), 0);
    assert.equal(similarity('abc', ''), 0);
  });

  it('textos disjuntos valem exatamente 0', () => {
    // Sem nenhum trigrama em comum.
    assert.equal(similarity('aaaa', 'bbbb'), 0);
    assert.equal(similarity('xxxxxx', 'yyyyyy'), 0);
  });

  it('caso intermediario fixo: abcd vs abce = 1/3', () => {
    // shingles(abcd) = {abc, bcd}; shingles(abce) = {abc, bce}
    // intersecao = {abc} = 1; uniao = {abc, bcd, bce} = 3 => 1/3
    assert.deepEqual([...shingleSet('abcd', 3)].sort(), ['abc', 'bcd']);
    assert.deepEqual([...shingleSet('abce', 3)].sort(), ['abc', 'bce']);
    assert.equal(similarity('abcd', 'abce'), 0.333333);
  });

  it('segundo caso intermediario fixo, calculado a mao', () => {
    // shingles(abcde) = {abc,bcd,cde}; shingles(abcdf) = {abc,bcd,cdf}
    // intersecao = 2; uniao = 4 => 0.5
    assert.equal(similarity('abcde', 'abcdf'), 0.5);
  });

  it('e simetrica', () => {
    const a = 'implementar o detector de loop no servidor';
    const b = 'implementar o detector de contexto no servidor';
    assert.equal(similarity(a, b), similarity(b, a));
  });

  it('e estavel: a mesma entrada produz a mesma saida em execucoes repetidas', () => {
    const a = 'Erro TS2345 ao compilar o handler de callback do OAuth.';
    const b = 'Erro TS2345 ao compilar o handler de callback do OAuth v2.';
    const first = similarity(a, b);
    for (let i = 0; i < 50; i++) assert.equal(similarity(a, b), first);
  });

  it('nunca sai do intervalo [0,1]', () => {
    const amostras = ['', 'a', 'ab', 'abc', 'aaaa', 'texto qualquer', '你好世界', '🙂🙂🙂'];
    for (const x of amostras) {
      for (const y of amostras) {
        const s = similarity(x, y);
        assert.ok(s >= 0 && s <= 1, `${JSON.stringify([x, y])} => ${s}`);
      }
    }
  });
});

describe('similarity: normalizacao', () => {
  it('ignora caixa, acento e espacamento por default', () => {
    assert.equal(normalizeText('  Ação   COMPLETA\n\n'), 'acao completa');
    assert.equal(similarity('Ação Completa', 'acao   completa'), 1);
  });

  it('respeita as opcoes desligadas', () => {
    assert.equal(normalizeText('Ação', { stripAccents: false, caseFold: false }), 'Ação');
  });
});

describe('similarity: shingles', () => {
  it('texto menor que k vira um shingle unico', () => {
    assert.deepEqual([...shingleSet('ab', 3)], ['ab']);
    assert.equal(similarity('ab', 'ab'), 1);
  });

  it('nao parte pares substitutos', () => {
    // 3 emoji = 3 code points => 1 shingle de tamanho 3.
    assert.deepEqual([...shingleSet('🙂🙂🙂', 3)], ['🙂🙂🙂']);
  });

  it('conjuntos vazios sao identicos; um vazio contra cheio e 0', () => {
    assert.equal(jaccard(new Set(), new Set()), 1);
    assert.equal(jaccard(new Set(['a']), new Set()), 0);
  });
});

describe('similarity: helpers de grupo', () => {
  it('firstPairAtLeast acha o primeiro par acima do limiar em ordem estavel', () => {
    const par = firstPairAtLeast(['alpha um', 'algo bem diferente aqui', 'alpha um'], 0.9);
    assert.notEqual(par, null);
    assert.equal(par?.indexA, 0);
    assert.equal(par?.indexB, 2);
    assert.equal(par?.similarity, 1);
  });

  it('firstPairAtLeast devolve null quando nada bate', () => {
    assert.equal(firstPairAtLeast(['aaaa', 'bbbb', 'cccc'], 0.9), null);
  });

  it('findSimilarClique exige similaridade MUTUA, nao estrela', () => {
    // b parece com a e com c, mas a e c nao parecem entre si => nao e clique.
    const a = 'xxxxxxxxxxxxxxxxxxxx';
    const b = 'xxxxxxxxxxyyyyyyyyyy';
    const c = 'yyyyyyyyyyyyyyyyyyyy';
    assert.equal(findSimilarClique([a, b, c], 0.3, 3), null);

    const clique = findSimilarClique([a, a, a], 0.9, 3);
    assert.notEqual(clique, null);
    assert.deepEqual(clique?.indexes, [0, 1, 2]);
    assert.equal(clique?.minSimilarity, 1);
  });

  it('findSimilarClique respeita maxWindow e reporta indices absolutos', () => {
    const textos = ['antigo A', 'antigo B', 'repete', 'repete', 'repete'];
    const clique = findSimilarClique(textos, 0.9, 3, { maxWindow: 3 });
    assert.deepEqual(clique?.indexes, [2, 3, 4]);
  });
});

describe('similarity: utilitarios lexicais', () => {
  it('contentTokens remove stopwords e tokens curtos', () => {
    const tokens = contentTokens('o agente de fato ficou preso no mesmo passo');
    assert.ok(tokens.has('agente'));
    assert.ok(tokens.has('preso'));
    assert.ok(!tokens.has('o'));
    assert.ok(!tokens.has('no'));
  });

  it('tokenSimilarity ignora ordem das palavras', () => {
    assert.equal(tokenSimilarity('detector loop agente', 'agente loop detector'), 1);
  });

  it('excerpt trunca e nunca devolve o texto inteiro quando estoura', () => {
    const longo = 'x'.repeat(500);
    const curto = excerpt(longo, 50);
    assert.equal(Array.from(curto).length, 50);
    assert.ok(curto.endsWith('…'));
    assert.equal(excerpt('curto', 50), 'curto');
  });

  it('splitSentences quebra em pontuacao terminal', () => {
    assert.deepEqual(splitSentences('Um. Dois? Tres!'), ['Um.', 'Dois?', 'Tres!']);
  });
});
