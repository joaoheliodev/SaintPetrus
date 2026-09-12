import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoots = ['app', 'components', 'lib', 'scripts'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs']);
const adapterFiles = ['lib/providers/openai.ts', 'lib/providers/gemini.ts', 'lib/providers/deepseek.ts'];
const directFetchAllowlist = new Map([
  ['components/provider-status.tsx', 3],
  ['components/token-panel.tsx', 2],
  ['lib/use-graph-transport.ts', 2],
  ['scripts/key.mjs', 1],
]);
const directFetchPin = 8;
const reactFlowConsumerAllowlist = new Map([['components/workspace.tsx', 'nodes']]);
const reactFlowConsumerPin = 1;
const typeAssertionPin = 107;
const gitleaksSuppressionAllowlist = new Map([
  ['tests/core/token-estimate.test.ts', { fingerprint: 'heuristic-structural-v1', reason: 'Public deterministic counter name, not a credential.' }],
]);
const gitleaksSuppressionPin = 1;

function filesUnder(directory: string): string[] {
  const entries = readdirSync(join(root, directory), { withFileTypes: true });
  return entries.flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

const runtimeFiles = runtimeRoots.flatMap(filesUnder).sort();
const testFiles = filesUnder('tests').sort();
const rootFiles = readdirSync(root).filter(name => sourceExtensions.has(extname(name))).sort();
const authoredFiles = [...runtimeFiles, ...testFiles, ...rootFiles];
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function sourceFile(path: string): ts.SourceFile {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, kind);
}

function visit(node: ts.Node, inspect: (node: ts.Node) => void): void {
  inspect(node);
  node.forEachChild(child => visit(child, inspect));
}

function directFetches(path: string): number {
  let count = 0;
  visit(sourceFile(path), node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') count++;
  });
  return count;
}

test('O2 direct fetch calls stay behind the provider boundary or the shrinking legacy allowlist', () => {
  const actual = new Map<string, number>();
  for (const path of authoredFiles) {
    if (path.startsWith('lib/providers/')) continue;
    const count = directFetches(path);
    if (count) actual.set(path, count);
  }
  const count = [...actual.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(count <= directFetchPin, 'A direct fetch was added outside lib/providers. Migrate it; never raise the pin.');
  assert.equal(count, directFetchPin, `Direct fetch calls fell to ${count}. Lower directFetchPin to lock in the improvement.`);
  assert.deepEqual(actual, directFetchAllowlist, 'A direct fetch appeared outside the provider boundary. Migrate it; never extend the allowlist.');
});

test('O2 authored code has zero browser storage references', () => {
  const forbidden = ['local' + 'Storage', 'session' + 'Storage'];
  for (const path of authoredFiles) {
    const violations: string[] = []; const file = sourceFile(path);
    visit(file, node => {
      if (ts.isIdentifier(node) && forbidden.includes(node.text)) violations.push(node.text);
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && forbidden.includes(node.argumentExpression.text)) violations.push(node.argumentExpression.text);
    });
    assert.deepEqual(violations, [], `${path} accesses browser storage; server memory or the encrypted vault owns credentials.`);
  }
});

function isResponseOkGuard(node: ts.IfStatement): boolean {
  const expression = node.expression;
  return ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.ExclamationToken
    && ts.isPropertyAccessExpression(expression.operand)
    && ts.isIdentifier(expression.operand.expression)
    && expression.operand.expression.text === 'response'
    && expression.operand.name.text === 'ok';
}

function responsePath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return node.text === 'response' ? [] : null;
  if (ts.isPropertyAccessExpression(node)) {
    const parent = responsePath(node.expression);
    return parent ? [...parent, node.name.text] : null;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    const parent = responsePath(node.expression);
    return parent ? [...parent, node.argumentExpression.text] : null;
  }
  return null;
}

test('O2 every provider rejects HTTP errors without reading the response body', () => {
  for (const path of adapterFiles) {
    const file = sourceFile(path); const guards: ts.IfStatement[] = [];
    visit(file, node => { if (ts.isIfStatement(node) && isResponseOkGuard(node)) guards.push(node); });
    assert.equal(guards.length, 1, `${path} must keep one explicit response.ok error boundary.`);
    const violations: string[] = [];
    visit(guards[0].thenStatement, node => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const path = responsePath(node);
        if (path && !['status', 'body', 'body.cancel'].includes(path.join('.'))) violations.push(node.getText(file));
      }
      if (ts.isIdentifier(node) && node.text === 'response') {
        const parent = node.parent;
        if (!((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node)) violations.push(node.getText(file));
      }
    });
    assert.deepEqual(violations, [], `${path} reads or passes a provider error response. Keep only status and body cancellation; never widen this boundary.`);
  }
});

function isModelReference(node: ts.Expression): boolean {
  return (ts.isIdentifier(node) && node.text === 'model') || (ts.isPropertyAccessExpression(node) && node.name.text === 'model');
}

test('O2 provider adapters contain zero model-literal branches', () => {
  const equality = new Set<ts.SyntaxKind>([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
  for (const path of adapterFiles) {
    const violations: string[] = []; const file = sourceFile(path);
    visit(file, node => {
      if (!ts.isBinaryExpression(node) || !equality.has(node.operatorToken.kind)) return;
      if ((isModelReference(node.left) && ts.isStringLiteralLike(node.right)) || (ts.isStringLiteralLike(node.left) && isModelReference(node.right))) violations.push(node.getText(file));
    });
    assert.deepEqual(violations, [], `${path} branches on a model literal; move the capability into policy data.`);
  }
});

test('O2 React Flow receives the node array owned by useNodesState', () => {
  const actual = new Map<string, string>();
  for (const path of authoredFiles.filter(path => path.endsWith('.tsx'))) {
    const file = sourceFile(path); const owners = new Set<string>();
    visit(file, node => {
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(file) === 'useNodesState') {
        const first = node.name.elements[0];
        const name = first && ts.isBindingElement(first) ? first.name.getText(file) : undefined;
        if (name) owners.add(name);
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'ReactFlow') {
        const property = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'nodes');
        if (property && ts.isJsxAttribute(property) && property.initializer && ts.isJsxExpression(property.initializer) && property.initializer.expression) {
          const name = property.initializer.expression.getText(file);
          assert.ok(owners.has(name), `${path} passes ${name} to ReactFlow without owning it through useNodesState; never replace it with useMemo.`);
          actual.set(path, name);
        }
      }
    });
  }
  assert.equal(actual.size, reactFlowConsumerPin, 'A React Flow consumer changed. Preserve useNodesState ownership; never raise this pin as a workaround.');
  assert.deepEqual(actual, reactFlowConsumerAllowlist, 'React Flow consumers changed. Review the owner and never extend the allowlist as a workaround.');
});

test('O2 authored type assertions stay at the shrinking pin', () => {
  let count = 0;
  for (const path of authoredFiles.filter(path => ['.ts', '.tsx'].includes(extname(path)))) {
    visit(sourceFile(path), node => { if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) count++; });
  }
  assert.ok(count <= typeAssertionPin, `Authored type assertions rose from ${typeAssertionPin} to ${count}. Remove the new assertion; never raise the pin.`);
  assert.equal(count, typeAssertionPin, `Authored type assertions fell to ${count}. Lower typeAssertionPin to lock in the improvement.`);
});

test('O2 Gitleaks suppressions stay on the shrinking justified allowlist', () => {
  const marker = 'gitleaks' + ':allow'; const actual = new Map<string, number>();
  for (const path of authoredFiles) {
    const count = read(path).split(marker).length - 1;
    if (count) actual.set(path, count);
  }
  const count = [...actual.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(count <= gitleaksSuppressionPin, 'A Gitleaks suppression was added. Remove it; never raise the pin.');
  assert.equal(count, gitleaksSuppressionPin, `Gitleaks suppressions fell to ${count}. Lower gitleaksSuppressionPin to lock in the improvement.`);
  assert.deepEqual([...actual.keys()], [...gitleaksSuppressionAllowlist.keys()], 'A Gitleaks suppression lacks a reviewed justification; remove it rather than extending the allowlist.');
  for (const [path, metadata] of gitleaksSuppressionAllowlist) {
    assert.match(read(path), new RegExp(metadata.fingerprint), `${path} no longer contains the reviewed public fingerprint; remove it from the allowlist.`);
    assert.ok(metadata.reason.length > 20, `${path} needs a concrete suppression justification.`);
  }
});
