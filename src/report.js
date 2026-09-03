'use strict';
// FORCE_COLOR / NO_COLOR are the conventions CI systems already set.
const COLOR = process.env.NO_COLOR ? false
  : process.env.FORCE_COLOR ? process.env.FORCE_COLOR !== '0'
  : !!process.stdout.isTTY;
const C = COLOR
  ? { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', d:'\x1b[2m', b:'\x1b[1m', x:'\x1b[0m' }
  : { g:'', r:'', y:'', d:'', b:'', x:'' };

function pretty(runs) {
  const lines = [];
  let pass = 0, fail = 0, skip = 0, rec = 0;
  for (const run of runs) {
    lines.push(`${C.b}${run.file}${C.x}`);
    for (const r of run.results) {
      if (r.skipped) { skip++; lines.push(`  ${C.d}- ${r.req.title} (skipped)${C.x}`); continue; }
      const label = r.req.title;
      if (r.error) {
        fail++;
        lines.push(`  ${C.r}x${C.x} ${label} ${C.d}${r.ms}ms${C.x}`);
        lines.push(`      ${C.r}${r.error}${C.x}`);
        continue;
      }
      const st = r.response.status;
      if (r.failures.length) {
        fail++;
        lines.push(`  ${C.r}x${C.x} ${label} ${C.d}${st} ${r.ms}ms${C.x}`);
        for (const f of r.failures) lines.push(`      ${C.r}${f.text}${C.x}`);
        for (const d of (r.diff || []).slice(0, 12)) {
          lines.push(`      ${C.y}${d.path}${C.x}: ${fmt(d.was)} ${C.d}->${C.x} ${fmt(d.now)}`);
        }
        if ((r.diff || []).length > 12) lines.push(`      ${C.d}... and ${r.diff.length - 12} more${C.x}`);
      } else if (r.snapshot === 'recorded' || r.snapshot === 'updated') {
        rec++;
        lines.push(`  ${C.y}+${C.x} ${label} ${C.d}${st} ${r.ms}ms${C.x} ${C.y}(recorded)${C.x}`);
      } else {
        pass++;
        lines.push(`  ${C.g}v${C.x} ${label} ${C.d}${st} ${r.ms}ms${C.x}`);
      }
    }
  }
  const parts = [];
  if (pass) parts.push(`${C.g}${pass} passed${C.x}`);
  if (rec) parts.push(`${C.y}${rec} recorded${C.x}`);
  if (fail) parts.push(`${C.r}${fail} failed${C.x}`);
  if (skip) parts.push(`${C.d}${skip} skipped${C.x}`);
  lines.push('', parts.join('  ') || 'no requests to run');
  return { text: lines.join('\n'), fail };
}

function fmt(v) {
  if (v === undefined) return `${C.d}(missing)${C.x}`;
  if (typeof v === 'string') {
    // Shape objects arrive here JSON-encoded. Nobody wants to read that.
    try { const o = JSON.parse(v); if (o && typeof o.type === 'string') return typeName(o); } catch { /* plain text */ }
    return v;
  }
  return JSON.stringify(v);
}

function typeName(shape) {
  if (!shape || typeof shape.type !== 'string') return String(shape);
  if (shape.type === 'object') return `object{${Object.keys(shape.keys || {}).join(', ')}}`;
  if (shape.type === 'array') return `array[${shape.of ? typeName(shape.of) : ''}]`;
  return shape.type;
}

function json(runs) {
  const out = runs.map(run => ({
    file: run.file,
    results: run.results.map(r => ({
      title: r.req.title, name: r.req.name, method: r.req.method, url: r.url,
      skipped: !!r.skipped, ms: r.ms, status: r.response?.status,
      snapshot: r.snapshot, error: r.error,
      failures: (r.failures || []).map(f => f.text),
      diff: r.diff || [],
    })),
  }));
  const fail = out.reduce((n, f) => n + f.results.filter(r => r.error || r.failures.length).length, 0);
  return { text: JSON.stringify(out, null, 2), fail };
}

function junit(runs) {
  const esc = s => String(s).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' }[c]));
  let fail = 0, body = '';
  for (const run of runs) {
    const cases = run.results.map(r => {
      const bad = r.error || (r.failures || []).length;
      if (bad) fail++;
      let inner = '';
      if (r.skipped) inner = '<skipped/>';
      else if (r.error) inner = `<error message="${esc(r.error)}"/>`;
      else if (r.failures.length) {
        const msg = r.failures.map(f => f.text).join(' / ');
        const plain = v => String(fmt(v)).replace(/\x1b\[[0-9;]*m/g, '');
        const detail = (r.diff || []).map(d => `${d.path}: ${plain(d.was)} -> ${plain(d.now)}`).join('\n');
        inner = `<failure message="${esc(msg)}">${esc(detail)}</failure>`;
      }
      return `    <testcase classname="${esc(run.file)}" name="${esc(r.req.title)}" time="${(r.ms || 0) / 1000}">${inner}</testcase>`;
    }).join('\n');
    body += `  <testsuite name="${esc(run.file)}" tests="${run.results.length}">\n${cases}\n  </testsuite>\n`;
  }
  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${body}</testsuites>`, fail };
}

module.exports = { pretty, json, junit, fmt };
