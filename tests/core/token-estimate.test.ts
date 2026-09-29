import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HEURISTIC_WEIGHTS,
  countAll,
  estimateTokensHeuristic,
  fixedRatioTokenCounter,
  heuristicTokenCounter,
  tokenCounterFrom,
  windowOccupancy,
  type TokenCounter,
} from '../../lib/core/token-estimate';

describe('token-estimate: contrato do TokenCounter', () => {
  it('a heuristica se declara APROXIMADA', () => {
    assert.equal(heuristicTokenCounter.approximate, true);
    assert.equal(heuristicTokenCounter.name, 'heuristic-structural-v1'); // gitleaks:allow -- public deterministic counter name, not a credential
  });

  it('fixedRatioTokenCounter tambem se declara aproximado', () => {
    assert.equal(fixedRatioTokenCounter(4).approximate, true);
  });

  it('tokenCounterFrom permite declarar um tokenizer exato', () => {
    const real = tokenCounterFrom('bpe-de-verdade', (t) => t.split(' ').length, false);
    assert.equal(real.approximate, false);
    assert.equal(real.name, 'bpe-de-verdade');
    assert.equal(real.count('a b c'), 3);
  });

  it('tokenCounterFrom marca aproximado por padrao quando pedido', () => {
    assert.equal(tokenCounterFrom('x', () => 1, true).approximate, true);
  });

  it('um TokenCounter customizado substitui a heuristica em toda a superficie', () => {
    const fake: TokenCounter = { name: 'fake', approximate: false, count: () => 42 };
    assert.equal(countAll(['a', 'b'], fake), 84);
    assert.equal(windowOccupancy(100, ['qualquer'], fake).usedTokens, 42);
  });
});

describe('token-estimate: propriedades da heuristica', () => {
  it('string vazia custa 0', () => {
    assert.equal(estimateTokensHeuristic(''), 0);
  });

  it('nunca e negativa e sempre e inteira', () => {
    const amostras = ['a', 'ab', 'hello world', '   ', '\n\n', '{}', '你好', '🙂', '12345', 'a1!b2?'];
    for (const s of amostras) {
      const n = estimateTokensHeuristic(s);
      assert.ok(n >= 0, `${JSON.stringify(s)} => ${n}`);
      assert.ok(Number.isInteger(n), `${JSON.stringify(s)} => ${n}`);
    }
  });

  it('e deterministica', () => {
    const texto = 'const resultado = await fetchToken({ scope: "openid profile" });';
    const primeiro = estimateTokensHeuristic(texto);
    for (let i = 0; i < 50; i++) assert.equal(estimateTokensHeuristic(texto), primeiro);
  });

  it('e monotona: concatenar texto nunca reduz a contagem', () => {
    const base = 'autenticacao oauth no servidor';
    const extra = ' com refresh token e rotacao de chaves';
    assert.ok(estimateTokensHeuristic(base + extra) >= estimateTokensHeuristic(base));
  });

  it('palavras comuns curtas custam 1 token', () => {
    assert.equal(estimateTokensHeuristic('hello'), 1);
    assert.equal(estimateTokensHeuristic('token'), 1);
  });

  it('o espaco simples entre palavras nao e cobrado separadamente', () => {
    assert.equal(estimateTokensHeuristic('hello world'), 2);
  });

  it('palavra longa custa mais de um token', () => {
    assert.ok(estimateTokensHeuristic('internacionalizacao') > 1);
  });

  it('quebras de linha sao cobradas', () => {
    assert.ok(estimateTokensHeuristic('a\nb') > estimateTokensHeuristic('a b'));
  });

  it('caracteres largos (CJK) custam 1 cada com os pesos default', () => {
    assert.equal(estimateTokensHeuristic('你好世界'), 4);
  });

  it('os pesos sao configuraveis e mudam o resultado', () => {
    const texto = 'palavra longa para testar o peso alfabetico';
    const apertado = estimateTokensHeuristic(texto, { ...DEFAULT_HEURISTIC_WEIGHTS, charsPerAlphaToken: 2 });
    const folgado = estimateTokensHeuristic(texto, { ...DEFAULT_HEURISTIC_WEIGHTS, charsPerAlphaToken: 10 });
    assert.ok(apertado > folgado);
  });

  it('o peso alfabetico default e 5 (calibragem documentada)', () => {
    assert.equal(DEFAULT_HEURISTIC_WEIGHTS.charsPerAlphaToken, 5);
  });
});

describe('token-estimate: ocupacao de janela', () => {
  it('razao = usados / limite', () => {
    const o = windowOccupancy(1000, [], heuristicTokenCounter, 750);
    assert.equal(o.ratio, 0.75);
    assert.equal(o.usedTokens, 750);
  });

  it('usedTokens explicito marca a medida como exata', () => {
    const o = windowOccupancy(1000, ['ignorado'], heuristicTokenCounter, 100);
    assert.equal(o.approximate, false);
    assert.equal(o.counterName, 'caller-supplied');
  });

  it('sem usedTokens, a medida herda a incerteza do contador', () => {
    const o = windowOccupancy(1000, ['algum texto aqui'], heuristicTokenCounter);
    assert.equal(o.approximate, true);
    assert.equal(o.counterName, 'heuristic-structural-v1');
  });

  it('limite zero ou negativo devolve razao 0 em vez de dividir por zero', () => {
    assert.equal(windowOccupancy(0, ['x']).ratio, 0);
    assert.equal(windowOccupancy(-5, ['x']).ratio, 0);
  });

  it('countAll soma os textos', () => {
    const fake: TokenCounter = { name: 'f', approximate: false, count: (t) => t.length };
    assert.equal(countAll(['ab', 'cde'], fake), 5);
    assert.equal(countAll([], fake), 0);
  });
});
