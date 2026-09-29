import { execFileSync } from 'node:child_process';
const names = execFileSync('git', process.argv.includes('--tracked') ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0');
const forbidden = names.some(name => name && name !== '.env.example' && (/(^|\/)\.env(?:\.|$)/.test(name) || /\.(key|pem)$/.test(name) || /^(data|logs)\//.test(name) || /^config\/secrets/.test(name)));
if (forbidden) { console.error('Commit blocked: restricted credential/data path is tracked or staged.'); process.exit(1); }
