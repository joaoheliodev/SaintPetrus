import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOOP_CONDITION_ORDER,
  LOOP_IDLE_CYCLES,
  canonicalJson,
  detectLoop,
  extractQuestions,
  toolCallKey,
  type LoopConditionId,
} from '../../lib/core/loop-detector';
import { fixedClock, type Turn } from '../../lib/core/types';
import { makeTurns, toolCall } from './fixtures';

function fired(turns: readonly Turn[]): readonly LoopConditionId[] {
  return detectLoop(turns).fired.map((c) => c.condition);
}

/**
 * Turnos que avancam de verdade: estado novo, ferramenta nova e texto GENUINAMENTE
 * distinto. Os textos precisam divergir de fato — uma serie tipo "Passo 0 ...",
 * "Passo 1 ..." fica acima de 0.90 de similaridade e dispara `repeated-output`
 * corretamente, o que faria deste fixture um falso teste.
 */
const TEXTOS_DISTINTOS: readonly string[] = [
  'Localizei o roteador de autenticacao e mapeei os handlers existentes.',
  'Escrevi a validacao do parametro state contra CSRF no callback.',
  'Troquei o armazenamento de sessao por cookie assinado com httpOnly.',
  'Adicionei o teste de expiracao do refresh token com relogio injetado.',
  'Documentei o contrato do provedor OIDC no README do modulo.',
  'Removi o console.log que vazava o access token nos logs de erro.',
  'Extrai a leitura de variaveis de ambiente para um unico ponto tipado.',
  'Renomeei o middleware para refletir que ele so protege rotas privadas.',
  'Cobri o caminho de erro 401 com um teste de integracao do handler.',
  'Ajustei o tempo de vida do cookie para bater com o do provedor.',
];

function progresso(n: number): readonly Turn[] {
  return makeTurns(
    Array.from({ length: n }, (_, i) => ({
      text: TEXTOS_DISTINTOS[i % TEXTOS_DISTINTOS.length] as string,
      toolCalls: [toolCall('edit', { path: `arquivo-${i}.ts` })],
      stateHash: `h${i}`,
    })),
  );
}

/* -------------------------------------------------------------------------- */

describe('loop-detector: nenhuma condicao em historico saudavel', () => {
  it('trabalho com progresso real nao dispara nada', () => {
    const r = detectLoop(progresso(8));
    assert.equal(r.looping, false);
    assert.deepEqual(r.fired, []);
  });

  it('todas as condicoes aparecem no relatorio, na ordem publicada', () => {
    const r = detectLoop(progresso(8));
    assert.equal(r.conditions.length, 4);
    assert.deepEqual(r.conditions.map((c) => c.condition), LOOP_CONDITION_ORDER);
  });

  it('historico vazio nao quebra e nao dispara', () => {
    const r = detectLoop([]);
    assert.equal(r.looping, false);
    assert.equal(r.notEvaluated.length, 4);
  });
});

/* --------------------------- condicao 1 isolada ---------------------------- */

describe('loop-detector: condicao 1 — saidas repetidas', () => {
  const saida = 'Vou reler o arquivo de configuracao e tentar exatamente a mesma coisa.';

  it('3 saidas mutuamente similares disparam SOMENTE esta condicao', () => {
    // stateHash distinto por turno impede no-progress de disparar junto.
    const turns = makeTurns([
      { text: saida, stateHash: 'h1' },
      { text: saida, stateHash: 'h2' },
      { text: saida, stateHash: 'h3' },
    ]);
    assert.deepEqual(fired(turns), ['repeated-output']);
  });

  it('2 saidas iguais nao bastam', () => {
    const turns = makeTurns([
      { text: saida, stateHash: 'h1' },
      { text: saida, stateHash: 'h2' },
      { text: 'Algo completamente distinto sobre indices do banco.', stateHash: 'h3' },
    ]);
    assert.ok(!fired(turns).includes('repeated-output'));
  });

  it('estrela nao e clique: 3 saidas com um centro comum nao disparam', () => {
    const turns = makeTurns([
      { text: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', stateHash: 'h1' },
      { text: 'aaaaaaaaaaaaaaabbbbbbbbbbbbbbb', stateHash: 'h2' },
      { text: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', stateHash: 'h3' },
    ]);
    assert.ok(!fired(turns).includes('repeated-output'));
  });

  it('so conta saidas do assistente', () => {
    const turns = makeTurns([
      { role: 'user', text: saida, stateHash: 'h1' },
      { role: 'user', text: saida, stateHash: 'h2' },
      { role: 'user', text: saida, stateHash: 'h3' },
    ]);
    assert.ok(!fired(turns).includes('repeated-output'));
  });

  it('a evidencia lista os turnos do grupo e a similaridade minima', () => {
    const turns = makeTurns([
      { text: saida, stateHash: 'h1' },
      { text: saida, stateHash: 'h2' },
      { text: saida, stateHash: 'h3' },
    ]);
    const c = detectLoop(turns).fired.find((x) => x.condition === 'repeated-output');
    assert.ok(c);
    assert.equal(c.evidence.length, 3);
    assert.deepEqual(c.evidence[0]?.turnIndexes, [0, 1, 2]);
    assert.equal(c.evidence[0]?.value, 1);
    assert.ok(c.evidence[0]?.excerpt.includes('reler o arquivo'));
  });
});

/* --------------------------- condicao 2 isolada ---------------------------- */

describe('loop-detector: condicao 2 — mesma ferramenta com argumentos identicos', () => {
  it('3 chamadas identicas disparam SOMENTE esta condicao', () => {
    const turns = makeTurns([
      { text: 'Primeira leitura do arquivo de rotas.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h1' },
      { text: 'Agora conferindo o mesmo arquivo por outro angulo.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h2' },
      { text: 'Revisando novamente esse mesmo trecho do codigo.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h3' },
    ]);
    assert.deepEqual(fired(turns), ['repeated-tool-call']);
  });

  it('2 chamadas identicas nao bastam', () => {
    const turns = makeTurns([
      { text: 'Primeira leitura.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h1' },
      { text: 'Segunda leitura distinta em texto.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h2' },
    ]);
    assert.ok(!fired(turns).includes('repeated-tool-call'));
  });

  it('argumentos diferentes nao contam como repeticao', () => {
    const turns = makeTurns([
      { text: 'Leitura A.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h1' },
      { text: 'Leitura B.', toolCalls: [toolCall('read', { path: 'b.ts' })], stateHash: 'h2' },
      { text: 'Leitura C.', toolCalls: [toolCall('read', { path: 'c.ts' })], stateHash: 'h3' },
    ]);
    assert.ok(!fired(turns).includes('repeated-tool-call'));
  });

  it('ordem das chaves nos argumentos nao importa (canonicalizacao)', () => {
    const turns = makeTurns([
      { text: 'Chamada com uma ordem de chaves.', toolCalls: [{ name: 'q', args: { a: 1, b: 2 } }], stateHash: 'h1' },
      { text: 'Chamada com outra ordem de chaves.', toolCalls: [{ name: 'q', args: { b: 2, a: 1 } }], stateHash: 'h2' },
      { text: 'Chamada com uma terceira permutacao.', toolCalls: [{ name: 'q', args: { a: 1, b: 2 } }], stateHash: 'h3' },
    ]);
    assert.ok(fired(turns).includes('repeated-tool-call'));
  });

  it('mesma assinatura em ferramentas diferentes nao agrupa', () => {
    const turns = makeTurns([
      { text: 'A.', toolCalls: [toolCall('read', { p: 1 })], stateHash: 'h1' },
      { text: 'B.', toolCalls: [toolCall('write', { p: 1 })], stateHash: 'h2' },
      { text: 'C.', toolCalls: [toolCall('list', { p: 1 })], stateHash: 'h3' },
    ]);
    assert.ok(!fired(turns).includes('repeated-tool-call'));
  });

  it('3 chamadas identicas dentro de um unico turno tambem disparam', () => {
    const turns = makeTurns([
      {
        text: 'Tentei tres vezes seguidas no mesmo turno.',
        toolCalls: [toolCall('read', { p: 1 }), toolCall('read', { p: 1 }), toolCall('read', { p: 1 })],
        stateHash: 'h1',
      },
    ]);
    assert.ok(fired(turns).includes('repeated-tool-call'));
  });

  it('a evidencia nomeia a ferramenta, os argumentos e os turnos', () => {
    const turns = makeTurns([
      { text: 'A.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h1' },
      { text: 'B.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h2' },
      { text: 'C.', toolCalls: [toolCall('read', { path: 'a.ts' })], stateHash: 'h3' },
    ]);
    const c = detectLoop(turns).fired.find((x) => x.condition === 'repeated-tool-call');
    assert.ok(c);
    assert.deepEqual(c.evidence[0]?.turnIndexes, [0, 1, 2]);
    assert.equal(c.evidence[0]?.value, 3);
    assert.equal(c.evidence[0]?.excerpt, 'read({"path":"a.ts"})');
  });

  it('sem nenhuma tool call a condicao fica nao avaliada', () => {
    const r = detectLoop(makeTurns([{ text: 'so texto', stateHash: 'h1' }]));
    assert.ok(r.notEvaluated.includes('repeated-tool-call'));
  });
});

describe('loop-detector: canonicalJson', () => {
  it('ordena chaves recursivamente', () => {
    assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
    assert.equal(canonicalJson({ x: { d: 4, c: 3 } }), '{"x":{"c":3,"d":4}}');
  });

  it('preserva a ordem de arrays', () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  it('trata undefined e nao-finitos como null', () => {
    assert.equal(canonicalJson(undefined), 'null');
    assert.equal(canonicalJson([undefined, Number.NaN, Infinity]), '[null,null,null]');
  });

  it('toolCallKey distingue nome e argumentos', () => {
    assert.notEqual(toolCallKey({ name: 'a', args: {} }), toolCallKey({ name: 'b', args: {} }));
    assert.equal(toolCallKey({ name: 'a' }), toolCallKey({ name: 'a', args: null }));
  });
});

/* --------------------------- condicao 3 isolada ---------------------------- */

describe('loop-detector: condicao 3 — pergunta equivalente repetida', () => {
  it('a mesma pergunta duas vezes dispara SOMENTE esta condicao', () => {
    const turns = makeTurns([
      { text: 'Qual arquivo devo editar primeiro?', stateHash: 'h1' },
      { text: 'Segui em frente com outra analise completamente diferente aqui.', stateHash: 'h2' },
      { text: 'Qual arquivo devo editar primeiro?', stateHash: 'h3' },
    ]);
    assert.deepEqual(fired(turns), ['repeated-question']);
  });

  it('reordenacao das mesmas palavras conta como equivalente', () => {
    const turns = makeTurns([
      { text: 'Qual arquivo devo editar primeiro?', stateHash: 'h1' },
      { text: 'Devo editar qual arquivo primeiro?', stateHash: 'h2' },
    ]);
    assert.ok(fired(turns).includes('repeated-question'));
  });

  it('LIMITACAO CONHECIDA: reformulacao que troca o vocabulario NAO e detectada', () => {
    // "Qual arquivo devo editar primeiro?" vs "Primeiro, qual arquivo editar?"
    // sao a mesma pergunta para um humano, mas a sobreposicao de tokens e 4/5 = 0.80,
    // abaixo do limiar de 0.85. A deteccao e LEXICA, nao semantica. Este teste existe
    // para registrar a falha, nao para celebra-la: se um dia entrar embedding ou LLM,
    // ele deve ser invertido de proposito, nunca apagado em silencio.
    const turns = makeTurns([
      { text: 'Qual arquivo devo editar primeiro?', stateHash: 'h1' },
      { text: 'Primeiro, qual arquivo editar?', stateHash: 'h2' },
    ]);
    assert.ok(!fired(turns).includes('repeated-question'));
  });

  it('perguntas sobre assuntos distintos nao disparam', () => {
    const turns = makeTurns([
      { text: 'Qual arquivo devo editar primeiro?', stateHash: 'h1' },
      { text: 'Prefere postgres ou sqlite para o ambiente local?', stateHash: 'h2' },
    ]);
    assert.ok(!fired(turns).includes('repeated-question'));
  });

  it('so conta perguntas do assistente', () => {
    const turns = makeTurns([
      { role: 'user', text: 'Qual arquivo devo editar primeiro?', stateHash: 'h1' },
      { role: 'user', text: 'Qual arquivo devo editar primeiro?', stateHash: 'h2' },
    ]);
    assert.ok(!fired(turns).includes('repeated-question'));
  });

  it('uma unica pergunta deixa a condicao nao avaliada', () => {
    const r = detectLoop(makeTurns([{ text: 'Qual arquivo devo editar?', stateHash: 'h1' }]));
    assert.ok(r.notEvaluated.includes('repeated-question'));
  });

  it('a evidencia traz o texto da pergunta e os turnos', () => {
    const turns = makeTurns([
      { text: 'Qual arquivo devo editar primeiro?', stateHash: 'h1' },
      { text: 'Qual arquivo devo editar primeiro?', stateHash: 'h2' },
    ]);
    const c = detectLoop(turns).fired.find((x) => x.condition === 'repeated-question');
    assert.ok(c);
    assert.deepEqual(c.evidence[0]?.turnIndexes, [0, 1]);
    assert.equal(c.evidence[0]?.excerpt, 'Qual arquivo devo editar primeiro?');
    assert.ok(c.detail.includes('LEXICA'), 'o detalhe deve admitir que a equivalencia e lexica');
  });

  it('extractQuestions pega so sentencas interrogativas', () => {
    const q = extractQuestions(makeTurns([
      { text: 'Fiz a leitura. Devo continuar? Vou aguardar.' },
    ]));
    assert.equal(q.length, 1);
    assert.equal(q[0]?.text, 'Devo continuar?');
  });
});

/* --------------------------- condicao 4 isolada ---------------------------- */

describe('loop-detector: condicao 4 — zero progresso por LOOP_IDLE_CYCLES', () => {
  it('LOOP_IDLE_CYCLES default e 5', () => {
    assert.equal(LOOP_IDLE_CYCLES, 5);
  });

  /** Turnos sem estado novo, sem artefato novo, sem ferramenta inedita e sem repetir texto. */
  function parado(n: number): readonly Turn[] {
    return makeTurns([
      { text: 'Comeco: li o arquivo de rotas.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      ...Array.from({ length: n }, (_, i) => ({
        text: `Reflexao ${i} sobre ${'abcdefgh'[i] ?? 'x'} sem tocar em nada do projeto.`,
        toolCalls: [toolCall('read', { p: 'a' })],
        stateHash: 'h1',
      })),
    ]);
  }

  it('4 ciclos parados nao disparam; 5 disparam', () => {
    assert.ok(!fired(parado(4)).includes('no-progress'));
    assert.ok(fired(parado(5)).includes('no-progress'));
  });

  it('5 ciclos parados disparam SOMENTE esta condicao', () => {
    // As tool calls repetidas sao as mesmas do turno inicial, entao repeated-tool-call
    // tambem dispararia; usamos turnos sem ferramenta nenhuma para isolar.
    const turns = makeTurns([
      { text: 'Comeco: li o arquivo de rotas.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Pensando na abordagem alfa sem mexer em nada.', stateHash: 'h1' },
      { text: 'Considerando a alternativa beta, ainda sem agir.', stateHash: 'h1' },
      { text: 'Avaliando o caminho gama, nada foi alterado.', stateHash: 'h1' },
      { text: 'Ponderando a opcao delta, seguimos parados.', stateHash: 'h1' },
      { text: 'Revendo a hipotese epsilon, nenhum arquivo mudou.', stateHash: 'h1' },
    ]);
    assert.deepEqual(fired(turns), ['no-progress']);
  });

  it('mudanca de stateHash conta como progresso e zera a corrida', () => {
    const turns = makeTurns([
      { text: 'Comeco.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Parado alfa.', stateHash: 'h1' },
      { text: 'Parado beta.', stateHash: 'h1' },
      { text: 'Parado gama.', stateHash: 'h1' },
      { text: 'Parado delta.', stateHash: 'h1' },
      { text: 'Aqui mudei o estado de verdade.', stateHash: 'h2' },
    ]);
    assert.ok(!fired(turns).includes('no-progress'));
  });

  it('artefato novo conta como progresso', () => {
    const turns = makeTurns([
      { text: 'Comeco.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Parado alfa.', stateHash: 'h1' },
      { text: 'Parado beta.', stateHash: 'h1' },
      { text: 'Parado gama.', stateHash: 'h1' },
      { text: 'Parado delta.', stateHash: 'h1' },
      { text: 'Gerei um relatorio novo.', stateHash: 'h1', artifacts: ['relatorio.md'] },
    ]);
    assert.ok(!fired(turns).includes('no-progress'));
  });

  it('ferramenta inedita conta como progresso; repetir a mesma NAO conta', () => {
    const comInedita = makeTurns([
      { text: 'Comeco.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Parado alfa.', stateHash: 'h1' },
      { text: 'Parado beta.', stateHash: 'h1' },
      { text: 'Parado gama.', stateHash: 'h1' },
      { text: 'Parado delta.', stateHash: 'h1' },
      { text: 'Chamei outra coisa.', toolCalls: [toolCall('grep', { q: 'x' })], stateHash: 'h1' },
    ]);
    assert.ok(!fired(comInedita).includes('no-progress'));
    assert.ok(fired(parado(5)).includes('no-progress'), 'repetir a mesma chamada nao e progresso');
  });

  it('idleCycles e configuravel', () => {
    const turns = parado(3);
    assert.ok(!detectLoop(turns).fired.some((c) => c.condition === 'no-progress'));
    const r = detectLoop(turns, { thresholds: { idleCycles: 3 } });
    assert.ok(r.fired.some((c) => c.condition === 'no-progress'));
  });

  it('a evidencia lista os turnos parados', () => {
    const c = detectLoop(parado(5)).fired.find((x) => x.condition === 'no-progress');
    assert.ok(c);
    assert.deepEqual(c.evidence[0]?.turnIndexes, [1, 2, 3, 4, 5]);
    assert.equal(c.evidence[0]?.value, 5);
  });
});

/* -------------------------------------------------------------------------- */

describe('loop-detector: pureza e determinismo', () => {
  it('sem clock injetado, evaluatedAt e 0', () => {
    assert.equal(detectLoop(progresso(3)).evaluatedAt, 0);
  });

  it('com clock injetado, evaluatedAt e o valor do clock', () => {
    assert.equal(detectLoop(progresso(3), { clock: fixedClock(999) }).evaluatedAt, 999);
  });

  it('mesma entrada produz relatorio identico em execucoes repetidas', () => {
    const turns = makeTurns([
      { text: 'Vou tentar de novo do mesmo jeito.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Vou tentar de novo do mesmo jeito.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Vou tentar de novo do mesmo jeito.', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
    ]);
    const primeiro = JSON.stringify(detectLoop(turns));
    for (let i = 0; i < 20; i++) assert.equal(JSON.stringify(detectLoop(turns)), primeiro);
  });

  it('nao muta a entrada', () => {
    const turns = progresso(4);
    const antes = JSON.stringify(turns);
    detectLoop(turns);
    assert.equal(JSON.stringify(turns), antes);
  });

  it('varias condicoes podem disparar juntas', () => {
    const turns = makeTurns([
      { text: 'Qual arquivo devo editar primeiro?', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Qual arquivo devo editar primeiro?', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
      { text: 'Qual arquivo devo editar primeiro?', toolCalls: [toolCall('read', { p: 'a' })], stateHash: 'h1' },
    ]);
    const ids = fired(turns);
    assert.ok(ids.includes('repeated-output'));
    assert.ok(ids.includes('repeated-tool-call'));
    assert.ok(ids.includes('repeated-question'));
    assert.equal(detectLoop(turns).looping, true);
  });
});
