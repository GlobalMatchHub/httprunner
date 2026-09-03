'use strict';
// The extension host is not available here, so stub the vscode module and
// exercise the parts that are pure logic: activation wiring and CodeLens.
const path = require('path');
const Module = require('module');
const calls = { commands: [], providers: [] };
class Range { constructor(a,b,c,d){ this.a=a; this.b=b; this.c=c; this.d=d; } }
class CodeLens { constructor(range, cmd){ this.range=range; this.command=cmd; } }
const stub = {
  Range, CodeLens,
  EventEmitter: class { constructor(){ this.event = () => ({ dispose(){} }); } fire(){} },
  Uri: { parse: s => ({ toString: () => s, fsPath: s }) },
  ViewColumn: { Beside: 2 },
  ProgressLocation: { Window: 10 },
  window: { createOutputChannel: () => ({ show(){}, appendLine(){} }), showErrorMessage(){}, showWarningMessage(){}, showInformationMessage(){}, withProgress: (o,f)=>f() },
  workspace: {
    registerTextDocumentContentProvider: (s,p) => { calls.providers.push('content:'+s); return { dispose(){} }; },
    getConfiguration: () => ({ get: () => undefined, update: async () => {} }),
    workspaceFolders: null,
  },
  languages: { registerCodeLensProvider: (sel, p) => { calls.providers.push('lens'); calls.lens = p; return { dispose(){} }; } },
  commands: { registerCommand: (id, fn) => { calls.commands.push(id); return { dispose(){} }; } },
  env: { openExternal(){} },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode';
  return origResolve.call(this, request, ...rest);
};
require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: stub };

const ext = require('../ext/src/extension.js');
const subs = [];
ext.activate({ subscriptions: subs });

let failed = 0;
const check = (n, c, e) => { console.log(`  ${c ? 'v' : 'x'} ${n}`); if (!c) { failed++; if (e) console.log('        ' + e); } };

check('활성화가 예외 없이 끝남', subs.length > 0);
check('명령 4개 등록', calls.commands.length === 4, calls.commands.join(', '));
check('응답 문서 제공자 등록', calls.providers.includes('content:httprunner'));
check('CodeLens 제공자 등록', calls.providers.includes('lens'));

const file = path.join(__dirname, 'fixtures', 'api.http');
const doc = { getText: () => require('fs').readFileSync(file, 'utf8'), uri: { fsPath: file, toString: () => file } };
const lenses = calls.lens.provideCodeLenses(doc);
check('요청마다 보내기 + 파일 위 전부 실행 = 4개', lenses.length === 4, JSON.stringify(lenses.map(l => l.command.title)));
check('첫 렌즈가 전부 실행', lenses[0].command.title === 'Run all (3)', lenses[0].command.title);
check('보내기 렌즈가 요청 줄을 가리킴', lenses[1].command.arguments[0].line > 0, JSON.stringify(lenses[1].command.arguments));
console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
