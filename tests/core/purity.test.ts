/**
 * purity.test.ts — verifica mecanicamente os requisitos de DESIGN, nao de comportamento.
 *
 * Os requisitos "funcoes puras, sem I/O, sem Date.now(), sem Math.random(), sem any"
 * sao facilmente violados por um edit futuro sem que nenhum teste de comportamento
 * quebre. Este arquivo transforma cada um deles em falha de build.
 *
 * Este e o UNICO teste que toca o disco, e so para ler o proprio src/.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../lib/core/', import.meta.url).pathname;

const arquivos = readdirSync(SRC).filter((f) => f.endsWith('.ts')).sort();

function ler(arquivo: string): string {
  return readFileSync(join(SRC, arquivo), 'utf8');
}

/** Remove comentarios de bloco e de linha, para nao acusar mencoes na documentacao. */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('pureza: o modulo nao tem dependencias de runtime', () => {
  it('src/ contem exatamente os modulos esperados', () => {
    assert.deepEqual(arquivos, [
      'dirty-context.ts',
      'handoff.ts',
      'index.ts',
      'loop-detector.ts',
      'similarity.ts',
      'token-estimate.ts',
      'types.ts',
    ]);
  });

  it('nenhum import de pacote externo ou de modulo do node', () => {
    for (const arquivo of arquivos) {
      const codigo = semComentarios(ler(arquivo));
      const imports = [...codigo.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
      for (const especificador of imports) {
        assert.ok(
          especificador.startsWith('./') || especificador.startsWith('../'),
          `${arquivo} importa "${especificador}", que nao e relativo`,
        );
      }
    }
  });

  it('package.json declara zero dependencias de runtime', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../lib/core/package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    assert.deepEqual(pkg.dependencies ?? {}, {});
  });
});

describe('pureza: sem I/O na logica', () => {
  it('nenhum uso de fs, rede ou processo', () => {
    const proibidos = [
      /\bnode:fs\b/, /\brequire\s*\(/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/,
      /\bprocess\.env\b/, /\bprocess\.cwd\b/, /\breadFileSync\b/, /\bwriteFileSync\b/,
    ];
    for (const arquivo of arquivos) {
      const codigo = semComentarios(ler(arquivo));
      for (const padrao of proibidos) {
        assert.ok(!padrao.test(codigo), `${arquivo} usa ${padrao}`);
      }
    }
  });

  it('nenhum console.* deixado para tras', () => {
    for (const arquivo of arquivos) {
      assert.ok(!/\bconsole\.\w+/.test(semComentarios(ler(arquivo))), `${arquivo} tem console.*`);
    }
  });
});

describe('pureza: sem tempo nem aleatoriedade na logica', () => {
  it('Date.now() so aparece em systemClock, dentro de types.ts', () => {
    for (const arquivo of arquivos) {
      const codigo = semComentarios(ler(arquivo));
      const ocorrencias = [...codigo.matchAll(/Date\.now\(\)/g)];
      if (arquivo === 'types.ts') {
        assert.equal(ocorrencias.length, 1, 'types.ts deve ter exatamente um Date.now(), no systemClock');
        assert.ok(/systemClock[^;]*Date\.now\(\)/s.test(codigo), 'o Date.now() deve estar em systemClock');
      } else {
        assert.equal(ocorrencias.length, 0, `${arquivo} chama Date.now() fora de systemClock`);
      }
    }
  });

  it('nenhum outro uso de Date em nenhum modulo', () => {
    for (const arquivo of arquivos) {
      const codigo = semComentarios(ler(arquivo));
      assert.ok(!/new\s+Date\b/.test(codigo), `${arquivo} instancia Date`);
      assert.ok(!/performance\.now/.test(codigo), `${arquivo} usa performance.now`);
    }
  });

  it('nenhum Math.random()', () => {
    for (const arquivo of arquivos) {
      assert.ok(!/Math\.random/.test(semComentarios(ler(arquivo))), `${arquivo} usa Math.random`);
    }
  });

  it('nenhum crypto.randomUUID ou getRandomValues', () => {
    for (const arquivo of arquivos) {
      const codigo = semComentarios(ler(arquivo));
      assert.ok(!/randomUUID|getRandomValues/.test(codigo), `${arquivo} usa aleatoriedade de crypto`);
    }
  });
});

describe('pureza: tipagem', () => {
  it('nenhum `any` em nenhum modulo', () => {
    for (const arquivo of arquivos) {
      const codigo = semComentarios(ler(arquivo));
      assert.ok(!/(^|[^.\w])any(\s*[>,;)\]]|\s*\[\]|\s*$)/m.test(codigo), `${arquivo} usa any`);
      assert.ok(!/:\s*any\b/.test(codigo), `${arquivo} usa : any`);
      assert.ok(!/<any\b/.test(codigo), `${arquivo} usa <any>`);
    }
  });

  it('nenhum @ts-ignore ou @ts-nocheck', () => {
    for (const arquivo of arquivos) {
      const codigo = ler(arquivo);
      assert.ok(!/@ts-ignore|@ts-nocheck|@ts-expect-error/.test(codigo), `${arquivo} suprime o typecheck`);
    }
  });

  it('nenhuma sintaxe nao-apagavel (enum, namespace, parameter property)', () => {
    // Node roda estes .ts por type stripping: sintaxe nao-apagavel quebra em runtime.
    for (const arquivo of arquivos) {
      const codigo = semComentarios(ler(arquivo));
      assert.ok(!/\benum\s+\w/.test(codigo), `${arquivo} declara enum`);
      assert.ok(!/\bnamespace\s+\w/.test(codigo), `${arquivo} declara namespace`);
      assert.ok(!/constructor\s*\([^)]*\b(private|public|protected|readonly)\s/.test(codigo),
        `${arquivo} usa parameter property`);
    }
  });
});
