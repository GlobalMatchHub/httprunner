'use strict';
const vscode = require('vscode');
const path = require('path');

// core/ is copied in by build.sh so the packaged extension is self contained.
const { parse } = require('../core/parse');
const { runFile, runOne } = require('../core/run');
const { makeContext } = require('../core/vars');
const report = require('../core/report');
const license = require('../core/license');
const init = require('../core/init');

const SCHEME = 'httprunner';

// The free/paid line, in one place so it can never drift:
//   sending ONE request is free forever. That is what 7.5M people already do
//   with REST Client, and taking it away is how you earn a 2.39 rating.
//   Running the whole file, recording answers and wiring CI is the product.
const PAID = new Set(['runFile', 'updateFile', 'initCi']);

function activate(context) {
  const responses = new ResponseStore();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, responses),
    vscode.languages.registerCodeLensProvider(
      [{ language: 'http' }, { pattern: '**/*.{http,rest}' }],
      new Lenses()
    ),
    cmd('httprunner.send', args => send(args, responses)),
    cmd('httprunner.runFile', () => runWholeFile(false)),
    cmd('httprunner.updateFile', () => runWholeFile(true)),
    cmd('httprunner.initCi', () => setupCi())
  );
}

function cmd(id, fn) {
  return vscode.commands.registerCommand(id, async (...a) => {
    const short = id.split('.')[1];
    if (PAID.has(short) && !(await allowed(short))) return;
    try { await fn(...a); }
    catch (e) { vscode.window.showErrorMessage(`HTTP Runner: ${e && e.message || e}`); }
  });
}

async function allowed() {
  const key = vscode.workspace.getConfiguration('httprunner').get('licenseKey');
  if (key) process.env.HTTPRUNNER_KEY = key;
  const r = await license.check();
  if (r.ok) {
    if (r.trial && r.left <= 3) {
      vscode.window.showInformationMessage(`HTTP Runner trial: ${r.left} day${r.left > 1 ? 's' : ''} left.`);
    }
    return true;
  }
  const pick = await vscode.window.showInformationMessage(
    'Sending one request stays free. Running the whole file, recording responses and wiring CI need a license.',
    'Enter key', 'Learn more'
  );
  if (pick === 'Enter key') {
    const k = await vscode.window.showInputBox({ prompt: 'License key', password: true, ignoreFocusOut: true });
    if (k) {
      await vscode.workspace.getConfiguration('httprunner').update('licenseKey', k.trim(), true);
      process.env.HTTPRUNNER_KEY = k.trim();
      return (await license.check()).ok;
    }
  } else if (pick === 'Learn more') {
    vscode.env.openExternal(vscode.Uri.parse('https://buy.polar.sh/polar_cl_bhyPJGRKRgKFfCVvNW4J6HGJnaOv1FtYa0Wyb028jV3'));
  }
  return false;
}

/** CodeLens over every request, so the file itself is the interface. */
class Lenses {
  provideCodeLenses(doc) {
    let parsed;
    try { parsed = parse(doc.getText(), doc.uri.fsPath); } catch { return []; }
    const out = [];
    if (parsed.requests.length > 1) {
      out.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: `Run all (${parsed.requests.length})`,
        command: 'httprunner.runFile',
      }));
    }
    for (const req of parsed.requests) {
      const range = new vscode.Range(req.line, 0, req.line, 0);
      out.push(new vscode.CodeLens(range, {
        title: 'Send',
        command: 'httprunner.send',
        arguments: [{ file: doc.uri.fsPath, line: req.line }],
      }));
    }
    return out;
  }
}

async function send(args, responses) {
  const editor = vscode.window.activeTextEditor;
  const doc = editor && editor.document;
  if (!doc) return;
  const line = args && typeof args.line === 'number' ? args.line : editor.selection.active.line;
  const { fileVars, requests } = parse(doc.getText(), doc.uri.fsPath);

  // The request the cursor is inside: the last one that starts at or above it.
  let target = null;
  for (const r of requests) if (r.line <= line) target = r;
  if (!target) target = requests[0];
  if (!target) { vscode.window.showWarningMessage('No request found in this file'); return; }

  const cfg = vscode.workspace.getConfiguration('httprunner');
  const dir = path.dirname(doc.uri.fsPath);
  const ctx = makeContext({ fileVars, envName: cfg.get('environment') || undefined, dir });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `${target.method} ${target.url}` },
    async () => {
      const noStore = { get: () => undefined, set: () => {}, save: () => {} };
      const res = await runOne(target, ctx, dir, { timeout: cfg.get('timeout'), noSnapshot: true }, noStore);
      responses.show(doc.uri, res);
    }
  );
}

async function runWholeFile(update) {
  const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  if (!doc) return;
  await doc.save();
  const cfg = vscode.workspace.getConfiguration('httprunner');
  const out = channel();
  out.show(true);
  // Locale independent: this line is read by people in every timezone.
  out.appendLine(`${new Date().toTimeString().slice(0, 8)}  ${path.basename(doc.uri.fsPath)}`);
  const run = await runFile(doc.uri.fsPath, {
    env: cfg.get('environment') || undefined,
    assert: cfg.get('assert'),
    timeout: cfg.get('timeout'),
    update,
  });
  process.env.NO_COLOR = '1';
  const r = report.pretty([run]);
  out.appendLine(r.text);
  out.appendLine('');
  if (r.fail) vscode.window.showWarningMessage(`HTTP Runner: ${r.fail} request${r.fail > 1 ? 's' : ''} changed`);
}

async function setupCi() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) { vscode.window.showWarningMessage('Open a folder first'); return; }
  const cron = await vscode.window.showQuickPick(
    [
      { label: 'Every 30 minutes', value: '*/30 * * * *' },
      { label: 'Hourly', value: '0 * * * *' },
      { label: 'Once a day', value: '0 9 * * *' },
    ],
    { placeHolder: 'How often should the API be checked?' }
  );
  if (!cron) return;
  const written = init.init(folder.uri.fsPath, {
    dir: '.', env: vscode.workspace.getConfiguration('httprunner').get('environment') || undefined, cron: cron.value,
  });
  const out = channel();
  out.show(true);
  for (const [n, how] of written) out.appendLine(`  ${how}  .github/workflows/${n}`);
  out.appendLine('\nAdd HTTPRUNNER_KEY under Settings > Secrets in your repository.');
}

let _channel;
function channel() {
  if (!_channel) _channel = vscode.window.createOutputChannel('HTTP Runner');
  return _channel;
}

/** Responses open as a normal read-only editor tab, so they are searchable and diffable. */
class ResponseStore {
  constructor() {
    this.docs = new Map();
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
    this.n = 0;
  }
  provideTextDocumentContent(uri) { return this.docs.get(uri.toString()) || ''; }
  async show(sourceUri, res) {
    const name = path.basename(sourceUri.fsPath).replace(/\.(http|rest)$/i, '');
    const uri = vscode.Uri.parse(`${SCHEME}:/${name}-${++this.n}.http`);
    this.docs.set(uri.toString(), render(res));
    this.emitter.fire(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  }
}

function render(res) {
  if (res.error) return `# ${res.req.method} ${res.url}\n# failed: ${res.error}\n`;
  const r = res.response;
  const lines = [`HTTP/1.1 ${r.status} ${r.statusText}`];
  for (const [k, v] of Object.entries(r.headers)) lines.push(`${k}: ${v}`);
  lines.push('', r.json !== undefined ? JSON.stringify(r.json, null, 2) : r.body);
  lines.push('', `# ${res.ms}ms`);
  return lines.join('\n');
}

module.exports = { activate, deactivate() {} };
