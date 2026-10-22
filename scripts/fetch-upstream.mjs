import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const config = JSON.parse(readFileSync(new URL('../upstream.json', import.meta.url)));
const run = (...args) => execFileSync('git', args, { stdio: 'inherit' });
const remotes = execFileSync('git', ['remote'], {encoding:'utf8'}).split('\n');
run('remote', remotes.includes('upstream') ? 'set-url' : 'add', 'upstream', `https://github.com/${config.repository}.git`);
run('fetch', 'upstream', config.branch);
run('log', '--oneline', `HEAD..upstream/${config.branch}`);
console.log('Fetched upstream. Review and merge/cherry-pick separately; preserve maintained identity and version.');
