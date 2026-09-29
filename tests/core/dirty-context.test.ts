import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BAND_CRITICAL_MIN,
  BAND_WARNING_MIN,
  DIRTY_SIGNAL_ORDER,
  DIRTY_SIGNAL_WEIGHTS,
  bandForScore,
  extractDirectives,
  scoreDirtyContext,
  type DirtySignalId,
} from '../../lib/core/dirty-context';
import { fixedClock, type Turn } from '../../lib/core/types';
import { makeTurns, OBJETIVO, offTopic, onTopic, toolCall } from './fixtures';

const janelaFolgada = { maxTokens: 1000, usedTokens: 100 } as const;
const janelaCheia = { maxTokens: 1000, usedTokens: 800 } as const;

function firedIds(turns: readonly Turn[], window = janelaFolgada, extra = {}): readonly DirtySignalId[] {
  return scoreDirtyContext({ turns, window, objective: OBJETIVO, ...extra }).fired.map((s) => s.signal);
}

/* -------------------------------------------------------------------------- */

describe('dirty-context: invariantes de peso', () => {
  it('os seis pesos somam exatamente 100', () => {
    const soma = Object.values(DIRTY_SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(soma, 100);
  });

  it('os pesos sao exatamente os especificados', () => {
    assert.deepEqual(DIRTY_SIGNAL_WEIGHTS, {
      'window-occupancy': 25,
      stagnation: 20,
      repetition: 20,
      'recurring-error': 15,
      'topic-drift': 10,
      'contradictory-instruction': 10,
    });
  });

  it('a ordem de saida cobre todos os sinais sem repeticao', () => {
    assert.equal(DIRTY_SIGNAL_ORDER.length, 6);
    assert.equal(new Set(DIRTY_SIGNAL_ORDER).size, 6);
  });

  it('39 e 69 sao inatingiveis: todo score alcancavel e multiplo de 5', () => {
    // Documenta a consequencia dos pesos. Se este teste quebrar, algum peso deixou
    // de ser multiplo de 5 e os limites de faixa passaram a ser atingiveis.
    const pesos = Object.values(DIRTY_SIGNAL_WEIGHTS);
    const alcancaveis = new Set<number>([0]);
    for (const peso of pesos) {
      for (const atual of [...alcancaveis]) alcancaveis.add(atual + peso);
    }
    assert.ok(!alcancaveis.has(39), '39 nao deve ser alcancavel');
    assert.ok(!alcancaveis.has(69), '69 nao deve ser alcancavel');
    assert.ok(alcancaveis.has(40) && alcancaveis.has(70) && alcancaveis.has(100));
    for (const s of alcancaveis) assert.equal(s % 5, 0);
  });
});

describe('dirty-context: faixas nos limites exatos', () => {
  it('39 e saudavel', () => assert.equal(bandForScore(39), 'healthy'));
  it('40 e atencao', () => assert.equal(bandForScore(40), 'warning'));
  it('69 e atencao', () => assert.equal(bandForScore(69), 'warning'));
  it('70 e critico', () => assert.equal(bandForScore(70), 'critical'));

  it('extremos', () => {
    assert.equal(bandForScore(0), 'healthy');
    assert.equal(bandForScore(100), 'critical');
  });

  it('os limites publicados batem com a funcao', () => {
    assert.equal(BAND_WARNING_MIN, 40);
    assert.equal(BAND_CRITICAL_MIN, 70);
    assert.equal(bandForScore(BAND_WARNING_MIN - 1), 'healthy');
    assert.equal(bandForScore(BAND_WARNING_MIN), 'warning');
    assert.equal(bandForScore(BAND_CRITICAL_MIN - 1), 'warning');
    assert.equal(bandForScore(BAND_CRITICAL_MIN), 'critical');
  });

  it('a faixa e monotona em todo o intervalo 0..100', () => {
    const ordem = { healthy: 0, warning: 1, critical: 2 } as const;
    let anterior = 0;
    for (let s = 0; s <= 100; s++) {
      const atual = ordem[bandForScore(s)];
      assert.ok(atual >= anterior, `faixa regrediu em ${s}`);
      anterior = atual;
    }
  });
});

describe('dirty-context: cenarios completos por faixa', () => {
  const limpo = makeTurns([
    { role: 'user', text: onTopic('preciso do fluxo de callback') },
    { text: onTopic('li o arquivo de rotas'), toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h1' },
    { text: onTopic('escrevi o handler de token'), toolCalls: [toolCall('write', { path: 'b.ts' })], stateHash: 'h2' },
  ]);

  const comErros = makeTurns([
    { role: 'user', text: onTopic('roda o build') },
    { text: onTopic('build falhou uma vez'), toolCalls: [toolCall('build', { t: 1 })], stateHash: 'h1', errorSignature: 'TS2345: argumento incompativel' },
    { text: onTopic('tentando de outro jeito com flags'), toolCalls: [toolCall('build', { t: 2 })], stateHash: 'h2', errorSignature: 'TS2345: argumento incompativel' },
    { text: onTopic('mudando a assinatura do handler'), toolCalls: [toolCall('build', { t: 3 })], stateHash: 'h3', errorSignature: 'TS2345: argumento incompativel' },
  ]);

  const derivaEstagnada = makeTurns([
    { role: 'user', text: onTopic('resolve o build') },
    { text: offTopic('primeiro um desvio longo sobre confeitaria e tecnicas de ganache'), stateHash: 'h1' },
    { text: offTopic('segundo desvio sobre temperagem e cristalizacao do chocolate'), stateHash: 'h1', errorSignature: 'E_TIMEOUT: conexao expirou' },
    { text: offTopic('terceiro desvio sobre calda de morango e ponto de fio'), stateHash: 'h1', errorSignature: 'E_TIMEOUT: conexao expirou' },
    { text: offTopic('quarto desvio sobre montagem de camadas e recheio'), stateHash: 'h1', errorSignature: 'E_TIMEOUT: conexao expirou' },
  ]);

  const repetido = 'Nao consegui avancar, vou tentar a mesma abordagem mais uma vez.';
  const tudoRuim = makeTurns([
    { role: 'user', text: 'Sempre inclua os logs de debug no output.' },
    { role: 'user', text: 'Nunca inclua os logs de debug no output.' },
    { text: offTopic('desvio um sobre confeitaria e ganache'), stateHash: 'h1', errorSignature: 'E_TIMEOUT' },
    { text: repetido, stateHash: 'h1', errorSignature: 'E_TIMEOUT' },
    { text: repetido, stateHash: 'h1', errorSignature: 'E_TIMEOUT' },
    { text: repetido, stateHash: 'h1' },
  ]);

  it('saudavel: score 0, nenhum sinal disparado', () => {
    const r = scoreDirtyContext({ turns: limpo, window: janelaFolgada, objective: OBJETIVO });
    assert.equal(r.score, 0);
    assert.equal(r.band, 'healthy');
    assert.deepEqual(r.fired, []);
  });

  it('saudavel na borda superior: score 25 com so a janela cheia', () => {
    const r = scoreDirtyContext({ turns: limpo, window: janelaCheia, objective: OBJETIVO });
    assert.equal(r.score, 25);
    assert.equal(r.band, 'healthy');
    assert.deepEqual(r.fired.map((s) => s.signal), ['window-occupancy']);
  });

  it('atencao: score exatamente 40 (janela 25 + erro recorrente 15)', () => {
    const r = scoreDirtyContext({ turns: comErros, window: janelaCheia, objective: OBJETIVO });
    assert.equal(r.score, 40);
    assert.equal(r.band, 'warning');
    assert.deepEqual(r.fired.map((s) => s.signal), ['window-occupancy', 'recurring-error']);
  });

  it('critico: score exatamente 70 (25 + 20 + 15 + 10)', () => {
    const r = scoreDirtyContext({ turns: derivaEstagnada, window: janelaCheia, objective: OBJETIVO });
    assert.equal(r.score, 70);
    assert.equal(r.band, 'critical');
    assert.deepEqual(r.fired.map((s) => s.signal), [
      'window-occupancy', 'stagnation', 'recurring-error', 'topic-drift',
    ]);
  });

  it('critico maximo: score 100 com os seis sinais', () => {
    const r = scoreDirtyContext({ turns: tudoRuim, window: { maxTokens: 1000, usedTokens: 900 }, objective: OBJETIVO });
    assert.equal(r.score, 100);
    assert.equal(r.band, 'critical');
    assert.equal(r.fired.length, 6);
    assert.deepEqual(r.notEvaluated, []);
  });

  it('o score nunca ultrapassa 100 nem fica negativo', () => {
    for (const turns of [limpo, comErros, derivaEstagnada, tudoRuim]) {
      const r = scoreDirtyContext({ turns, window: janelaCheia, objective: OBJETIVO });
      assert.ok(r.score >= 0 && r.score <= 100);
    }
  });
});

describe('dirty-context: sinais isolados e evidencia', () => {
  it('ocupacao: > 0.75 dispara, exatamente 0.75 nao (comparacao estrita)', () => {
    const turns = makeTurns([{ text: onTopic('a') }]);
    const noLimite = scoreDirtyContext({ turns, window: { maxTokens: 1000, usedTokens: 750 }, objective: OBJETIVO });
    const acima = scoreDirtyContext({ turns, window: { maxTokens: 1000, usedTokens: 751 }, objective: OBJETIVO });
    assert.equal(noLimite.window.ratio, 0.75);
    assert.ok(!noLimite.fired.some((s) => s.signal === 'window-occupancy'));
    assert.ok(acima.fired.some((s) => s.signal === 'window-occupancy'));
  });

  it('ocupacao: usedTokens explicito marca a medida como nao aproximada', () => {
    const turns = makeTurns([{ text: onTopic('a') }]);
    const explicito = scoreDirtyContext({ turns, window: janelaCheia, objective: OBJETIVO });
    assert.equal(explicito.window.approximate, false);
    assert.equal(explicito.window.counterName, 'caller-supplied');

    const estimado = scoreDirtyContext({ turns, window: { maxTokens: 1000 }, objective: OBJETIVO });
    assert.equal(estimado.window.approximate, true);
    assert.equal(estimado.window.counterName, 'heuristic-structural-v1');
  });

  it('ocupacao: maxTokens <= 0 marca o sinal como nao avaliado', () => {
    const r = scoreDirtyContext({ turns: makeTurns([{ text: 'x' }]), window: { maxTokens: 0 } });
    assert.ok(r.notEvaluated.includes('window-occupancy'));
    assert.equal(r.score, 0);
  });

  it('estagnacao: 2 turnos nao disparam, 3 disparam', () => {
    const dois = makeTurns([
      { text: onTopic('a'), toolCalls: [toolCall('x', {})], stateHash: 'h1' },
      { text: onTopic('b'), stateHash: 'h1' },
      { text: onTopic('c'), stateHash: 'h1' },
    ]);
    assert.ok(!firedIds(dois).includes('stagnation'));

    const tres = makeTurns([
      { text: onTopic('a'), toolCalls: [toolCall('x', {})], stateHash: 'h1' },
      { text: onTopic('b'), stateHash: 'h1' },
      { text: onTopic('c'), stateHash: 'h1' },
      { text: onTopic('d'), stateHash: 'h1' },
    ]);
    assert.ok(firedIds(tres).includes('stagnation'));
  });

  it('estagnacao: uma tool call no ultimo turno quebra a corrida', () => {
    const turns = makeTurns([
      { text: onTopic('a'), stateHash: 'h1' },
      { text: onTopic('b'), stateHash: 'h1' },
      { text: onTopic('c'), stateHash: 'h1', toolCalls: [toolCall('x', {})] },
    ]);
    assert.ok(!firedIds(turns).includes('stagnation'));
  });

  it('estagnacao: mudanca de stateHash quebra a corrida', () => {
    const turns = makeTurns([
      { text: onTopic('a'), stateHash: 'h1' },
      { text: onTopic('b'), stateHash: 'h1' },
      { text: onTopic('c'), stateHash: 'h2' },
    ]);
    assert.ok(!firedIds(turns).includes('stagnation'));
  });

  it('estagnacao: a evidencia traz os indices e um trecho', () => {
    const turns = makeTurns([
      { text: onTopic('a'), toolCalls: [toolCall('x', {})], stateHash: 'h1' },
      { text: onTopic('b'), stateHash: 'h1' },
      { text: onTopic('c'), stateHash: 'h1' },
      { text: onTopic('ultimo turno parado'), stateHash: 'h1' },
    ]);
    const sinal = scoreDirtyContext({ turns, window: janelaFolgada, objective: OBJETIVO })
      .fired.find((s) => s.signal === 'stagnation');
    assert.ok(sinal);
    assert.deepEqual(sinal.evidence[0]?.turnIndexes, [1, 2, 3]);
    assert.ok(sinal.evidence[0]?.excerpt.includes('ultimo turno parado'));
    assert.equal(sinal.evidence[0]?.value, 3);
  });

  it('repeticao: duas saidas identicas nas ultimas 3 disparam com evidencia dos dois lados', () => {
    const turns = makeTurns([
      { text: 'Vou reler o arquivo de rotas e tentar de novo.' },
      { text: 'Passo intermediario totalmente distinto sobre migracoes.' },
      { text: 'Vou reler o arquivo de rotas e tentar de novo.' },
    ]);
    const sinal = scoreDirtyContext({ turns, window: janelaFolgada, objective: OBJETIVO })
      .fired.find((s) => s.signal === 'repetition');
    assert.ok(sinal);
    assert.equal(sinal.evidence[0]?.value, 1);
    assert.deepEqual(sinal.evidence[0]?.turnIndexes, [0, 2]);
    assert.equal(sinal.evidence.length, 2, 'evidencia deve mostrar os dois lados do par');
  });

  it('repeticao: nao dispara com menos de 2 saidas do assistente', () => {
    const r = scoreDirtyContext({
      turns: makeTurns([{ text: 'unica saida' }]),
      window: janelaFolgada,
      objective: OBJETIVO,
    });
    assert.ok(r.notEvaluated.includes('repetition'));
  });

  it('repeticao: so olha as ultimas 3 saidas', () => {
    const turns = makeTurns([
      { text: 'Repeticao antiga que saiu da janela.' },
      { text: 'Repeticao antiga que saiu da janela.' },
      { text: 'Assunto A completamente diferente sobre indices.' },
      { text: 'Assunto B completamente diferente sobre cache.' },
      { text: 'Assunto C completamente diferente sobre filas.' },
    ]);
    assert.ok(!firedIds(turns).includes('repetition'));
  });

  it('erro recorrente: 2 ocorrencias nao disparam, 3 disparam com as ocorrencias listadas', () => {
    const duas = makeTurns([
      { text: onTopic('a'), errorSignature: 'E_X', toolCalls: [toolCall('t', { i: 1 })] },
      { text: onTopic('b'), errorSignature: 'E_X', toolCalls: [toolCall('t', { i: 2 })] },
    ]);
    assert.ok(!firedIds(duas).includes('recurring-error'));

    const tres = makeTurns([
      { text: onTopic('a'), errorSignature: 'E_X', toolCalls: [toolCall('t', { i: 1 })] },
      { text: onTopic('b'), errorSignature: 'E_X', toolCalls: [toolCall('t', { i: 2 })] },
      { text: onTopic('c'), errorSignature: 'E_X', toolCalls: [toolCall('t', { i: 3 })] },
    ]);
    const sinal = scoreDirtyContext({ turns: tres, window: janelaFolgada, objective: OBJETIVO })
      .fired.find((s) => s.signal === 'recurring-error');
    assert.ok(sinal);
    assert.equal(sinal.evidence[0]?.value, 3);
    assert.deepEqual(sinal.evidence[0]?.turnIndexes, [0, 1, 2]);
    assert.equal(sinal.evidence[0]?.excerpt, 'E_X');
  });

  it('erro recorrente: erros diferentes nao se somam', () => {
    const turns = makeTurns([
      { text: onTopic('a'), errorSignature: 'E_A', toolCalls: [toolCall('t', { i: 1 })] },
      { text: onTopic('b'), errorSignature: 'E_B', toolCalls: [toolCall('t', { i: 2 })] },
      { text: onTopic('c'), errorSignature: 'E_C', toolCalls: [toolCall('t', { i: 3 })] },
    ]);
    assert.ok(!firedIds(turns).includes('recurring-error'));
  });

  it('deriva: sem objetivo o sinal fica nao avaliado em vez de "ok"', () => {
    const r = scoreDirtyContext({ turns: makeTurns([{ text: offTopic('x') }]), window: janelaFolgada });
    assert.ok(r.notEvaluated.includes('topic-drift'));
    assert.ok(!r.fired.some((s) => s.signal === 'topic-drift'));
  });

  it('deriva: contexto todo no tema nao dispara', () => {
    const turns = makeTurns([
      { text: onTopic('parte um'), toolCalls: [toolCall('t', { i: 1 })] },
      { text: onTopic('parte dois'), toolCalls: [toolCall('t', { i: 2 })] },
    ]);
    assert.ok(!firedIds(turns).includes('topic-drift'));
  });

  it('deriva: contexto majoritariamente fora do objetivo dispara com o trecho', () => {
    const turns = makeTurns([
      { text: onTopic('parte um'), toolCalls: [toolCall('t', { i: 1 })] },
      { text: offTopic('conversa longa sobre confeitaria e ganache'), toolCalls: [toolCall('t', { i: 2 })] },
      { text: offTopic('mais conversa sobre temperagem de chocolate'), toolCalls: [toolCall('t', { i: 3 })] },
    ]);
    const sinal = scoreDirtyContext({ turns, window: janelaFolgada, objective: OBJETIVO })
      .fired.find((s) => s.signal === 'topic-drift');
    assert.ok(sinal);
    assert.ok(sinal.evidence.length > 0);
    assert.ok(sinal.evidence[0]?.excerpt.includes('bolo de chocolate'));
    assert.ok(sinal.detail.includes('heuristica lexica'));
  });

  it('contradicao: par com polaridade oposta sobre o mesmo corpo dispara', () => {
    const r = scoreDirtyContext({
      turns: makeTurns([{ text: 'ok' }]),
      window: janelaFolgada,
      objective: OBJETIVO,
      directives: [
        { id: 'd1', text: 'Sempre inclua os logs de debug no output.', turnIndex: 0 },
        { id: 'd2', text: 'Nunca inclua os logs de debug no output.', turnIndex: 1 },
      ],
    });
    const sinal = r.fired.find((s) => s.signal === 'contradictory-instruction');
    assert.ok(sinal);
    assert.deepEqual(sinal.evidence[0]?.turnIndexes, [0, 1]);
    assert.ok(sinal.evidence[0]?.detail.includes('polaridades opostas'));
  });

  it('contradicao: antonimo do lexico e detectado sem palavra de negacao', () => {
    const r = scoreDirtyContext({
      turns: makeTurns([{ text: 'ok' }]),
      window: janelaFolgada,
      directives: [
        { id: 'd1', text: 'Adicione os comentarios explicativos no modulo.', turnIndex: 0 },
        { id: 'd2', text: 'Remova os comentarios explicativos no modulo.', turnIndex: 1 },
      ],
    });
    assert.ok(r.fired.some((s) => s.signal === 'contradictory-instruction'));
  });

  it('contradicao: diretivas concordantes nao disparam', () => {
    const r = scoreDirtyContext({
      turns: makeTurns([{ text: 'ok' }]),
      window: janelaFolgada,
      directives: [
        { id: 'd1', text: 'Sempre inclua os logs de debug no output.', turnIndex: 0 },
        { id: 'd2', text: 'Sempre inclua os logs de debug no arquivo.', turnIndex: 1 },
      ],
    });
    assert.ok(!r.fired.some((s) => s.signal === 'contradictory-instruction'));
  });

  it('contradicao: polaridade oposta sobre assuntos distintos nao dispara', () => {
    const r = scoreDirtyContext({
      turns: makeTurns([{ text: 'ok' }]),
      window: janelaFolgada,
      directives: [
        { id: 'd1', text: 'Sempre inclua os logs de debug no output.', turnIndex: 0 },
        { id: 'd2', text: 'Nunca altere o esquema do banco de producao.', turnIndex: 1 },
      ],
    });
    assert.ok(!r.fired.some((s) => s.signal === 'contradictory-instruction'));
  });

  it('contradicao: menos de 2 diretivas fica nao avaliado', () => {
    const r = scoreDirtyContext({ turns: makeTurns([{ text: 'ok' }]), window: janelaFolgada });
    assert.ok(r.notEvaluated.includes('contradictory-instruction'));
  });

  it('extractDirectives so olha turnos user/system e exige marcador normativo', () => {
    const turns = makeTurns([
      { role: 'user', text: 'Sempre use tipos explicitos. O tempo esta bom hoje.' },
      { role: 'assistant', text: 'Sempre use tipos explicitos tambem.' },
    ]);
    const directives = extractDirectives(turns);
    assert.equal(directives.length, 1);
    assert.equal(directives[0]?.text, 'Sempre use tipos explicitos.');
    assert.equal(directives[0]?.turnIndex, 0);
  });
});

describe('dirty-context: pureza e determinismo', () => {
  it('todo sinal aparece no relatorio, disparado ou nao', () => {
    const r = scoreDirtyContext({ turns: makeTurns([{ text: 'x' }]), window: janelaFolgada });
    assert.equal(r.signals.length, 6);
    assert.deepEqual(r.signals.map((s) => s.signal), DIRTY_SIGNAL_ORDER);
  });

  it('sinal nao avaliado nunca contribui para o score', () => {
    const r = scoreDirtyContext({ turns: makeTurns([{ text: 'x' }]), window: { maxTokens: 0 } });
    for (const sinal of r.signals) {
      if (!sinal.evaluated) assert.equal(sinal.fired, false);
    }
  });

  it('sem clock injetado, evaluatedAt e 0 (nenhum Date.now na logica)', () => {
    const r = scoreDirtyContext({ turns: makeTurns([{ text: 'x' }]), window: janelaFolgada });
    assert.equal(r.evaluatedAt, 0);
  });

  it('com clock injetado, evaluatedAt e exatamente o valor do clock', () => {
    const r = scoreDirtyContext(
      { turns: makeTurns([{ text: 'x' }]), window: janelaFolgada },
      { clock: fixedClock(1234567890) },
    );
    assert.equal(r.evaluatedAt, 1234567890);
  });

  it('mesma entrada produz relatorio identico em execucoes repetidas', () => {
    const turns = makeTurns([
      { role: 'user', text: 'Sempre inclua os logs. Nunca inclua os logs.' },
      { text: offTopic('desvio'), stateHash: 'h1', errorSignature: 'E' },
      { text: offTopic('desvio dois'), stateHash: 'h1', errorSignature: 'E' },
      { text: offTopic('desvio tres'), stateHash: 'h1', errorSignature: 'E' },
    ]);
    const entrada = { turns, window: janelaCheia, objective: OBJETIVO };
    const primeiro = JSON.stringify(scoreDirtyContext(entrada));
    for (let i = 0; i < 20; i++) {
      assert.equal(JSON.stringify(scoreDirtyContext(entrada)), primeiro);
    }
  });

  it('nao muta a entrada', () => {
    const turns = makeTurns([{ text: onTopic('a'), stateHash: 'h1' }]);
    const antes = JSON.stringify(turns);
    scoreDirtyContext({ turns, window: janelaCheia, objective: OBJETIVO });
    assert.equal(JSON.stringify(turns), antes);
  });

  it('historico vazio nao quebra', () => {
    const r = scoreDirtyContext({ turns: [], window: { maxTokens: 1000 } });
    assert.equal(r.score, 0);
    assert.equal(r.band, 'healthy');
  });
});
