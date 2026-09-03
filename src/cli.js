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
  --text-out <file>   also write the plain terminal report, whatever --reporter
                      is set to, so one run can feed both a machine and a human
  --no-snapshot       just run, record nothing
  --badge <file>      write a shields.io endpoint JSON for a README badge
  --docs <file>       write a Markdown API reference from the requests and the
                      responses that were recorded (secrets are redacted)
  --docs-title <text> heading for that document
  --badge-label <text>  label shown on the badge (default: api)

Bringing in what you already have
  httprunner import <postman-or-insomnia-export.json> [-o api.http]
    Reads a Postman v2.1 collection or an Insomnia v4 export and writes plain
    .http files. Variables are collected and left blank at the top.

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
    else if (a === '--text-out') o.textOut = argv[++i];
    else if (a === '--docs') o.docs = argv[++i];
    else if (a === '--docs-title') o.docsTitle = argv[++i];
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
  if (argv[0] === 'import') {
    const rest = argv.slice(1);
    const src = rest.find(x => !x.startsWith('-'));
    const oi = rest.indexOf('-o') >= 0 ? rest.indexOf('-o') : rest.indexOf('--out');
    const dest = oi >= 0 ? rest[oi + 1] : null;
    if (!src) { console.error('usage: httprunner import <postman-or-insomnia-export.json> [-o api.http]'); process.exit(2); }
    let r;
    try { r = require('./import').importFile(path.resolve(src)); }
    catch (e) { console.error(`could not import ${src}: ${e.message}`); process.exit(2); }
    if (dest) {
      fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
      fs.writeFileSync(dest, r.text);
      console.log(`  ${r.count} request${r.count === 1 ? '' : 's'} from your ${r.kind} export -> ${dest}`);
      console.log('  Variables were left blank at the top of the file. Fill them in, or');
      console.log('  put the secret ones in http-client.private.env.json and gitignore it.');
    } else process.stdout.write(r.text);
    process.exit(0);
  }

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
      'It also writes API.md, a reference generated from your requests and the',
      'responses that came back. Secrets are redacted before anything is written.',
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

  if (o.docs) {
    const md = require('./docs').generate(files, { title: o.docsTitle });
    fs.mkdirSync(path.dirname(path.resolve(o.docs)), { recursive: true });
    fs.writeFileSync(o.docs, md);
  }

  if (o.badge) {
    fs.mkdirSync(path.dirname(path.resolve(o.badge)), { recursive: true });
    fs.writeFileSync(o.badge, JSON.stringify(report.badge(runs, o.badgeLabel), null, 2) + '\n');
  }

  if (o.textOut) {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    fs.mkdirSync(path.dirname(path.resolve(o.textOut)), { recursive: true });
    fs.writeFileSync(o.textOut, report.pretty(runs).text + '\n');
    if (prev === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = prev;
  }

  const fn = report[o.reporter] || report.pretty;
  const { text, fail } = fn(runs);
  if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(o.out, text + '\n'); console.log(report.pretty(runs).text); }
  else console.log(text);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e && e.stack || e); process.exit(2); });
