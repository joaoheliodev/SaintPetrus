import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HANDOFF_BUDGET,
  PROTECTED_FIELDS,
  TRIM_ORDER,
  renderHandoff,
  serializeHandoff,
  type HandoffDossier,
} from '../../lib/core/handoff';
import { fixedRatioTokenCounter, heuristicTokenCounter, tokenCounterFrom } from '../../lib/core/token-estimate';

/** Itens longos o bastante para que o corte tenha de acontecer. */
function itens(prefixo: string, n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `${prefixo} ${i}: ${'detalhe relevante sobre o estado do trabalho '.repeat(3)}`,
  );
}

function dossie(overrides: Partial<HandoffDossier> = {}): HandoffDossier {
  return {
    role: 'implementador do nucleo de heuristicas',
    objetivo: 'entregar o modulo core standalone com testes verdes',
    decisoes_tomadas: itens('decisao', 8),
    artefatos_produzidos: itens('artefato', 8),
    pendencias: itens('pendencia', 4),
    bloqueios: itens('bloqueio', 3),
    fatos_relevantes: itens('fato', 12),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

describe('handoff: teto de tokens', () => {
  it('o default e 800', () => {
    assert.equal(DEFAULT_HANDOFF_BUDGET, 800);
  });

  it('respeita o teto default', () => {
    const r = serializeHandoff(dossie());
    assert.ok(r.tokens <= r.budget, `${r.tokens} > ${r.budget}`);
    assert.equal(r.budget, 800);
    assert.equal(r.withinBudget, true);
  });

  it('respeita tetos apertados em toda uma faixa de valores atingiveis', () => {
    // 200 e o menor teto atingivel para este dossie: abaixo disso, os 3 bloqueios e
    // as 4 pendencias protegidas ja custam ~131 tokens mesmo truncados ao minimo.
    for (const budget of [200, 400, 600, 800, 1600]) {
      const r = serializeHandoff(dossie(), { budgetTokens: budget });
      assert.ok(r.tokens <= budget, `budget ${budget}: gerou ${r.tokens} tokens`);
      assert.equal(r.withinBudget, true);
      // O contador precisa concordar com o texto efetivamente devolvido.
      assert.equal(heuristicTokenCounter.count(r.text), r.tokens);
    }
  });

  it('respeita o teto medido pelo contador INJETADO, nao pelo default', () => {
    const contador = fixedRatioTokenCounter(2);
    for (const budget of [400, 800, 1500]) {
      const r = serializeHandoff(dossie(), { budgetTokens: budget, tokenCounter: contador });
      assert.ok(r.tokens <= budget, `budget ${budget}: gerou ${r.tokens}`);
      assert.equal(contador.count(r.text), r.tokens);
      assert.equal(r.counterName, 'fixed-ratio-2');
    }
  });

  it('dossie pequeno passa intacto e nao corta nada', () => {
    const pequeno: HandoffDossier = {
      role: 'revisor',
      objetivo: 'revisar o modulo',
      decisoes_tomadas: ['usei shingles'],
      artefatos_produzidos: ['src/similarity.ts'],
      pendencias: ['faltou o benchmark'],
      bloqueios: [],
      fatos_relevantes: ['node 26 faz type stripping'],
    };
    const r = serializeHandoff(pequeno, { budgetTokens: 800 });
    assert.deepEqual(r.dropped, []);
    assert.deepEqual(r.truncated, []);
    assert.equal(r.text, renderHandoff(pequeno));
  });

  it('propaga a incerteza da contagem', () => {
    const aproximado = serializeHandoff(dossie());
    assert.equal(aproximado.approximate, true);
    assert.equal(aproximado.counterName, 'heuristic-structural-v1');

    const exato = serializeHandoff(dossie(), {
      tokenCounter: tokenCounterFrom('tokenizer-falso', (t) => t.length, false),
      budgetTokens: 5000,
    });
    assert.equal(exato.approximate, false);
    assert.equal(exato.counterName, 'tokenizer-falso');
  });
});

describe('handoff: ordem de corte', () => {
  it('a ordem publicada e fatos -> artefatos -> decisoes', () => {
    assert.deepEqual(TRIM_ORDER, ['fatos_relevantes', 'artefatos_produzidos', 'decisoes_tomadas']);
    assert.deepEqual(PROTECTED_FIELDS, ['bloqueios', 'pendencias']);
  });

  it('fatos_relevantes cai primeiro', () => {
    // 1000 obriga a cortar um pouco (o dossie inteiro custa ~1401 tokens), mas nao
    // o bastante para chegar em artefatos.
    const r = serializeHandoff(dossie(), { budgetTokens: 1000 });
    assert.ok(r.dropped.length > 0, 'algo deveria ter sido cortado');
    assert.equal(r.dropped[0]?.field, 'fatos_relevantes');
    assert.ok(r.dropped.every((d) => d.field === 'fatos_relevantes'));
  });

  it('artefatos so caem depois de fatos acabarem', () => {
    const r = serializeHandoff(dossie(), { budgetTokens: 320 });
    const campos = r.dropped.map((d) => d.field);
    assert.ok(campos.includes('artefatos_produzidos'));
    // Todo fato precisa ter sido descartado antes do primeiro artefato.
    const primeiroArtefato = campos.indexOf('artefatos_produzidos');
    const fatosAntes = campos.slice(0, primeiroArtefato).filter((c) => c === 'fatos_relevantes').length;
    assert.equal(fatosAntes, 12, 'todos os 12 fatos deviam cair antes do primeiro artefato');
  });

  it('decisoes so caem depois de artefatos acabarem', () => {
    const r = serializeHandoff(dossie(), { budgetTokens: 120 });
    const campos = r.dropped.map((d) => d.field);
    assert.ok(campos.includes('decisoes_tomadas'));
    const primeiraDecisao = campos.indexOf('decisoes_tomadas');
    const anteriores = campos.slice(0, primeiraDecisao);
    assert.equal(anteriores.filter((c) => c === 'fatos_relevantes').length, 12);
    assert.equal(anteriores.filter((c) => c === 'artefatos_produzidos').length, 8);
  });

  it('a sequencia global de campos cortados segue exatamente TRIM_ORDER', () => {
    const r = serializeHandoff(dossie(), { budgetTokens: 90 });
    const ordemVista: string[] = [];
    for (const d of r.dropped) {
      if (ordemVista[ordemVista.length - 1] !== d.field) ordemVista.push(d.field);
    }
    assert.deepEqual(ordemVista, TRIM_ORDER.slice(0, ordemVista.length));
  });

  it('dentro de uma lista, corta do FIM para o inicio (prioridade decrescente)', () => {
    const d = dossie({ fatos_relevantes: ['fato-primeiro', ...itens('fato', 12)] });
    const r = serializeHandoff(d, { budgetTokens: 1000 });
    // O ultimo item da lista e o primeiro a cair.
    assert.equal(r.dropped[0]?.index, d.fatos_relevantes.length - 1);
    // Se sobrou algum fato, o primeiro da lista continua la.
    if (r.text.includes('FATOS:')) assert.ok(r.text.includes('fato-primeiro'));
  });
});

describe('handoff: campos protegidos', () => {
  it('bloqueios e pendencias sobrevivem a um teto agressivo mas atingivel', () => {
    const r = serializeHandoff(dossie(), { budgetTokens: 200 });
    assert.ok(r.text.includes('BLOQUEIOS:'));
    assert.ok(r.text.includes('PENDENCIAS:'));
    assert.ok(r.tokens <= 200);
    assert.equal(r.withinBudget, true);
  });

  it('PISO: abaixo do custo dos protegidos, o teto e violado em vez de perder um bloqueio', () => {
    // Regra de projeto deliberada: preferimos estourar o teto a descartar um
    // bloqueio. O estouro fica VISIVEL em withinBudget, nunca silencioso.
    const r = serializeHandoff(dossie(), { budgetTokens: 60 });
    assert.equal(r.withinBudget, false);
    assert.ok(r.tokens > 60);
    assert.ok(r.text.includes('BLOQUEIOS:'));
    assert.ok(r.text.includes('PENDENCIAS:'));
    // Tudo o que era sacrificavel ja foi sacrificado.
    assert.ok(!r.text.includes('FATOS:'));
    assert.ok(!r.text.includes('ARTEFATOS:'));
    assert.ok(!r.text.includes('DECISOES:'));
  });

  it('nenhum item de bloqueio ou pendencia e jamais descartado', () => {
    for (const budget of [40, 60, 90, 150, 400]) {
      const r = serializeHandoff(dossie(), { budgetTokens: budget });
      const camposCortados = new Set(r.dropped.map((d) => d.field));
      assert.ok(!camposCortados.has('bloqueios' as never), `budget ${budget} cortou bloqueio`);
      assert.ok(!camposCortados.has('pendencias' as never), `budget ${budget} cortou pendencia`);
    }
  });

  it('todos os bloqueios continuam presentes, ainda que truncados', () => {
    const d = dossie({
      bloqueios: ['BLOQ-ALFA ' + 'x'.repeat(400), 'BLOQ-BETA ' + 'y'.repeat(400)],
    });
    const r = serializeHandoff(d, { budgetTokens: 60 });
    assert.ok(r.text.includes('BLOQ-ALFA'), 'o primeiro bloqueio sumiu');
    assert.ok(r.text.includes('BLOQ-BETA'), 'o segundo bloqueio sumiu');
    // Conta so as linhas da secao BLOQUEIOS, parando na proxima secao.
    const linhas = r.text.split('\n');
    const inicio = linhas.indexOf('BLOQUEIOS:') + 1;
    let fim = inicio;
    while (fim < linhas.length && (linhas[fim] as string).startsWith('- ')) fim++;
    assert.equal(fim - inicio, 2);
  });

  it('pendencias sao encurtadas antes de bloqueios', () => {
    const d = dossie({
      pendencias: ['PEND ' + 'p'.repeat(600)],
      bloqueios: ['BLOQ ' + 'b'.repeat(600)],
      fatos_relevantes: [],
      artefatos_produzidos: [],
      decisoes_tomadas: [],
    });
    const r = serializeHandoff(d, { budgetTokens: 70 });
    const pendTrunc = r.truncated.filter((t) => t.field === 'pendencias');
    const bloqTrunc = r.truncated.filter((t) => t.field === 'bloqueios');
    assert.ok(pendTrunc.length > 0, 'pendencia deveria ter sido encurtada');
    const menorPend = Math.min(...pendTrunc.map((t) => t.keptChars));
    const menorBloq = bloqTrunc.length > 0 ? Math.min(...bloqTrunc.map((t) => t.keptChars)) : Infinity;
    assert.ok(menorPend <= menorBloq, 'pendencia deve encolher pelo menos tanto quanto bloqueio');
  });
});

describe('handoff: nunca inclui transcript bruto', () => {
  it('o tipo de entrada nao possui campo de transcript', () => {
    const chaves = Object.keys(dossie()).sort();
    assert.deepEqual(chaves, [
      'artefatos_produzidos',
      'bloqueios',
      'decisoes_tomadas',
      'fatos_relevantes',
      'objetivo',
      'pendencias',
      'role',
    ]);
  });

  it('um transcript colado dentro de um fato e truncado e marcado', () => {
    const transcript = Array.from({ length: 40 }, (_, i) =>
      `[turno ${i}] usuario: faz isso\n[turno ${i}] assistente: ok, fazendo isso agora mesmo`,
    ).join('\n');
    const r = serializeHandoff(dossie({ fatos_relevantes: [transcript] }), { budgetTokens: 800 });
    const marca = r.truncated.find((t) => t.field === 'fatos_relevantes');
    assert.ok(marca, 'o item deveria ter sido marcado como truncado');
    assert.ok(marca.keptChars <= 300);
    assert.ok(marca.originalChars > 1000);
    assert.ok(!r.text.includes('[turno 39]'), 'o fim do transcript nao pode aparecer');
  });

  it('maxItemChars e configuravel e limita todo item de lista', () => {
    const r = serializeHandoff(dossie({ fatos_relevantes: ['z'.repeat(1000)] }), {
      budgetTokens: 800,
      maxItemChars: 50,
    });
    for (const linha of r.text.split('\n')) {
      if (linha.startsWith('- ')) assert.ok(Array.from(linha).length <= 52);
    }
  });

  it('quebras de linha internas sao achatadas: um item nunca vira um bloco', () => {
    // Dossie minimo: com o dossie grande o unico fato seria o primeiro a cair.
    const r = serializeHandoff(
      {
        role: 'r',
        objetivo: 'o',
        decisoes_tomadas: [],
        artefatos_produzidos: [],
        pendencias: [],
        bloqueios: [],
        fatos_relevantes: ['linha um\nlinha dois\nlinha tres'],
      },
      { budgetTokens: 800 },
    );
    assert.ok(r.text.includes('- linha um linha dois linha tres'));
  });
});

describe('handoff: formato e determinismo', () => {
  it('o texto comeca pelo que o proximo agente mais precisa', () => {
    const linhas = serializeHandoff(dossie()).text.split('\n');
    assert.ok(linhas[0]?.startsWith('ROLE:'));
    assert.ok(linhas[1]?.startsWith('OBJETIVO:'));
    assert.equal(linhas[2], 'BLOQUEIOS:');
    const iBloq = linhas.indexOf('BLOQUEIOS:');
    const iPend = linhas.indexOf('PENDENCIAS:');
    assert.ok(iBloq >= 0 && iPend > iBloq, 'bloqueios devem vir antes de pendencias');
  });

  it('secoes vazias sao omitidas para nao gastar orcamento', () => {
    const r = serializeHandoff(dossie({ bloqueios: [], fatos_relevantes: [] }), { budgetTokens: 1600 });
    // Comparacao por LINHA: 'ARTEFATOS:' contem a substring 'FATOS:'.
    const linhas = r.text.split('\n');
    assert.ok(!linhas.includes('BLOQUEIOS:'));
    assert.ok(!linhas.includes('FATOS:'));
    assert.ok(linhas.includes('ARTEFATOS:'), 'artefatos nao vazios devem continuar presentes');
  });

  it('e deterministico em execucoes repetidas', () => {
    const d = dossie();
    const primeiro = JSON.stringify(serializeHandoff(d, { budgetTokens: 300 }));
    for (let i = 0; i < 20; i++) {
      assert.equal(JSON.stringify(serializeHandoff(d, { budgetTokens: 300 })), primeiro);
    }
  });

  it('nao muta o dossie de entrada', () => {
    const d = dossie();
    const antes = JSON.stringify(d);
    serializeHandoff(d, { budgetTokens: 80 });
    assert.equal(JSON.stringify(d), antes);
  });

  it('dossie completamente vazio nao quebra', () => {
    const r = serializeHandoff({
      role: '',
      objetivo: '',
      decisoes_tomadas: [],
      artefatos_produzidos: [],
      pendencias: [],
      bloqueios: [],
      fatos_relevantes: [],
    });
    assert.equal(r.text, '');
    assert.equal(r.tokens, 0);
    assert.equal(r.withinBudget, true);
  });

  it('teto impossivel devolve melhor esforco e marca withinBudget: false', () => {
    // Um unico bloqueio nao pode ser descartado; com teto 1 ele nao cabe.
    const r = serializeHandoff(
      {
        role: 'r',
        objetivo: 'o',
        decisoes_tomadas: [],
        artefatos_produzidos: [],
        pendencias: [],
        bloqueios: ['um bloqueio que precisa sobreviver de qualquer jeito'],
        fatos_relevantes: [],
      },
      { budgetTokens: 1 },
    );
    assert.equal(r.withinBudget, false);
    assert.ok(r.text.includes('BLOQUEIOS:'), 'o bloqueio precisa sobreviver mesmo estourando o teto');
  });
});
