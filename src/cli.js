#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { runFile } = require('./run');
const report = require('./report');
const license = require('./license');

const USAGE = `
httprunner - run, test and monitor the .http files you already have

  httprunner <file or folder...> [options]

Options
  --env <name>        environment from http-client.env.json
  --update            accept the current responses as the new baseline
  --assert shape|exact|off   how to compare (default shape: structure, not values)
  --only <text>       run only requests whose title or name matches
  --bail              stop at the first failure
  --timeout <ms>      default 30000
  --reporter pretty|json|junit
  --out <file>        write the report to a file
  --no-snapshot       just run, record nothing
  --badge <file>      write a shields.io endpoint JSON for a README badge
  --badge-label <text>  label shown on the badge (default: api)

Monitoring
  httprunner init <folder> [--env prod] [--cron '*/30 * * * *']
    Writes two GitHub Actions workflows. No server to host: when a response
    changes, an issue is opened in your repository.

Exits 0 when nothing failed, 1 otherwise.
`;

function parseArgs(argv) {
  const o = { files: [], reporter: 'pretty' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--env') o.env = argv[++i];
    else if (a === '--update' || a === '-u') o.update = true;
    else if (a === '--assert') o.assert = argv[++i];
    else if (a === '--only') o.only = argv[++i];
    else if (a === '--bail') o.bail = true;
    else if (a === '--timeout') o.timeout = argv[++i];
    else if (a === '--reporter') o.reporter = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--no-snapshot') o.noSnapshot = true;
    else if (a === '--badge') o.badge = argv[++i];
    else if (a === '--badge-label') o.badgeLabel = argv[++i];
    else if (a === '--cron') o.cron = argv[++i];
    else if (a === '--force') o.force = true;
    else if (a.startsWith('-')) { console.error(`unknown option: ${a}`); process.exit(2); }
    else o.files.push(a);
  }
  return o;
}

function expand(inputs) {
  const out = [];
  for (const p of inputs) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) { console.error(`no such path: ${p}`); process.exit(2); }
    if (fs.statSync(abs).isDirectory()) {
      for (const f of walk(abs)) out.push(f);
    } else out.push(abs);
  }
  return out;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(http|rest)$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'init') {
    const o = parseArgs(argv.slice(1));
    const written = require('./init').init(process.cwd(), { dir: o.files[0] || '.', env: o.env, cron: o.cron, force: o.force });
    for (const [n, how] of written) console.log(`  ${how}  .github/workflows/${n}`);
    console.log([
      '',
      'Two workflows are ready.',
      '  http-tests.yml    runs every request on each push and pull request',
      '  http-monitor.yml  runs on a schedule and opens an issue when a response changes',
      '',
      'Add HTTPRUNNER_KEY under Settings > Secrets in your repository.',
      '',
      'The monitor also writes .http-status.json. To show it in your README:',
      '',
      '  ![API status](https://img.shields.io/endpoint?url=https://raw',
      '  .githubusercontent.com/OWNER/REPO/main/.http-status.json)',
      '',
    ].join('\n'));
    process.exit(0);
  }

  const o = parseArgs(argv);
  if (o.help || !o.files.length) { console.log(USAGE); process.exit(o.help ? 0 : 2); }

  const lic = await license.check();
  if (!lic.ok) { console.error(license.message(lic)); process.exit(3); }
  if (lic.notice) console.error(lic.notice + '\n');

  const files = expand(o.files);
  if (!files.length) { console.error('no .http files found'); process.exit(2); }

  const runs = [];
  for (const f of files) runs.push(await runFile(f, o));

  if (o.badge) {
    fs.mkdirSync(path.dirname(path.resolve(o.badge)), { recursive: true });
    fs.writeFileSync(o.badge, JSON.stringify(report.badge(runs, o.badgeLabel), null, 2) + '\n');
  }

  const fn = report[o.reporter] || report.pretty;
  const { text, fail } = fn(runs);
  if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(o.out, text + '\n'); console.log(report.pretty(runs).text); }
  else console.log(text);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e && e.stack || e); process.exit(2); });
