'use strict';
// End to end against a real HTTP server. Runs in-process: this sandbox blocks
// network access from child processes, so spawning the CLI would only ever
// measure the sandbox.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { runFile } = require('../src/run');
const report = require('../src/report');

const FIX = path.join(__dirname, 'fixtures');
const SNAP = path.join(FIX, '__http__');
const FILE = path.join(FIX, 'api.http');

function makeServer(state) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      res.setHeader('content-type', 'application/json');
      res.setHeader('date', new Date().toISOString());
      if (url.pathname === '/login') {
        res.end(JSON.stringify({ token: 'T-' + Math.random().toString(36).slice(2), expiresIn: 3600 }));
      } else if (url.pathname === '/me') {
        if (!(req.headers.authorization || '').startsWith('Bearer T-')) {
          res.statusCode = 401; return res.end(JSON.stringify({ error: 'no token' }));
        }
        if (state.mode === 'regress') { res.statusCode = 500; return res.end(JSON.stringify({ id: 'seven', tags: [] })); }
        res.end(JSON.stringify({ id: Math.floor(Math.random() * 1e6), name: '이상윤', tags: ['a', 'b'], meta: { ok: true } }));
      } else if (url.pathname === '/echo') {
        res.end(JSON.stringify({ method: req.method, got: body ? JSON.parse(body) : null }));
      } else { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); }
    });
  });
}

let failed = 0;
function check(name, cond, extra) {
  console.log(`  ${cond ? 'v' : 'x'} ${name}`);
  if (!cond) { failed++; if (extra) console.log(String(extra).split('\n').map(l => '        ' + l).join('\n')); }
}
const show = t => console.log(t.split('\n').map(l => '    ' + l).join('\n'));

(async () => {
  process.env.NO_COLOR = '1';
  fs.rmSync(SNAP, { recursive: true, force: true });
  const state = { mode: 'good' };
  const server = makeServer(state);
  await new Promise(r => server.listen(0, r));
  process.env.PORT = String(server.address().port);

  console.log('\n[1] 처음 실행 - 사용자가 테스트를 한 줄도 쓰지 않는다. 응답이 정답이 된다');
  let runs = [await runFile(FILE)];
  let rep = report.pretty(runs);
  show(rep.text);
  check('실패 0', rep.fail === 0, rep.text);
  check('세 요청 모두 기록됨', (rep.text.match(/\(recorded\)/g) || []).length === 3, rep.text);
  check('스냅샷 파일이 만들어짐', fs.existsSync(path.join(SNAP, 'api.snap.json')));
  check('토큰이 다음 요청으로 이어짐 (401 아님)', runs[0].results[1].response.status === 200, JSON.stringify(runs[0].results[1].response?.body));

  console.log('\n[2] 다시 실행 - id 도 토큰도 매번 바뀌지만 헛경보가 없어야 한다');
  runs = [await runFile(FILE)];
  rep = report.pretty(runs);
  show(rep.text);
  check('실패 0', rep.fail === 0, rep.text);
  check('세 요청 모두 통과', /3 passed/.test(rep.text), rep.text);

  console.log('\n[3] 서버를 망가뜨린다 - 500, name 사라짐, id 가 문자열로');
  state.mode = 'regress';
  runs = [await runFile(FILE)];
  rep = report.pretty(runs);
  show(rep.text);
  check('실패를 잡아냄', rep.fail > 0, rep.text);
  check('상태 코드 변화 (200 -> 500)', /status: 200 -> 500/.test(rep.text), rep.text);
  check('타입 변화 (id: number -> string)', /body\.id: number -> string/.test(rep.text), rep.text);
  check('사라진 필드 (name)', /body\.name/.test(rep.text), rep.text);

  console.log('\n[4] CI 가 읽는 JUnit XML');
  const x = report.junit(runs);
  fs.writeFileSync(path.join(SNAP, 'junit.xml'), x.text);
  check('testsuites 와 failure 가 들어감', /<testsuites>/.test(x.text) && /<failure/.test(x.text), x.text.slice(0, 400));
  show(x.text.split('\n').slice(0, 8).join('\n'));

  console.log('\n[5] --update 로 새 응답을 정답으로 승인하면 다시 통과');
  await runFile(FILE, { update: true });
  runs = [await runFile(FILE)];
  rep = report.pretty(runs);
  const kinds = runs[0].results.flatMap(r => (r.failures || []).map(f => f.kind));
  check('승인 뒤 응답 차이는 사라짐', !kinds.includes('snapshot'), rep.text);
  check('사용자가 직접 쓴 기대값은 그대로 살아있음', kinds.includes('expect'), rep.text);

  console.log('\n[6] --only 로 하나만, --no-snapshot 으로 기록 없이');
  runs = [await runFile(FILE, { only: '로그인' })];
  check('요청 하나만 실행됨', runs[0].results.length === 1, JSON.stringify(runs[0].results.map(r => r.req.title)));

  console.log('\n[7] 서버가 죽었을 때');
  server.close();
  await new Promise(r => setTimeout(r, 200));
  runs = [await runFile(FILE, { timeout: 2000 })];
  rep = report.pretty(runs);
  check('연결 실패를 실패로 보고함', rep.fail === 3, rep.text);
  const saved = JSON.parse(fs.readFileSync(path.join(SNAP, 'api.snap.json'), 'utf8'));
  check('죽었다고 기록을 덮어쓰지 않음', saved['login'] != null && saved['login'].status === 200, JSON.stringify(Object.keys(saved)));

  console.log('\n[8] 문서 생성 - 비밀값이 절대 새면 안 된다');
  const docs = require('../src/docs');
  const md = docs.generate([FILE], { title: 'T' });
  const leaks = ['hunter2', 'k-live', 'supersecret', 'Bearer T-'];
  const found = leaks.filter(x => md.includes(x));
  check('생성됨', md.includes('# T') && md.includes('```http'), md.slice(0, 200));
  check('평문 비밀값이 하나도 없음', found.length === 0, '샌 것: ' + found.join(', '));
  check('가림 표시가 실제로 들어감', md.includes('<redacted>'), md.slice(0, 400));
  check('응답 구조가 문서에 들어감', /\*\*Response\*\* — `[0-9]{3}`/.test(md), md.slice(0, 400));

  console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})();
