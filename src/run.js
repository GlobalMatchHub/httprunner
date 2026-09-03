'use strict';
const fs = require('fs');
const path = require('path');
const { parse } = require('./parse');
const { makeContext, resolve, jsonPath } = require('./vars');
const snapshot = require('./snapshot');

const DEFAULT_TIMEOUT = 30000;

async function runFile(filePath, opts = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(path.resolve(filePath));
  const { fileVars, requests } = parse(text, filePath);
  const ctx = makeContext({ fileVars, envName: opts.env, dir });

  const store = new SnapshotStore(filePath, opts);
  const results = [];
  for (const req of requests) {
    if (opts.only && !matches(req, opts.only)) continue;
    if ('skip' in req.meta) { results.push({ req, skipped: true }); continue; }
    const r = await runOne(req, ctx, dir, opts, store);
    results.push(r);
    if (r.error && opts.bail) break;
    if (r.failures && r.failures.length && opts.bail) break;
  }
  store.save();
  return { file: filePath, results, store };
}

function matches(req, only) {
  const hay = `${req.name || ''} ${req.title || ''}`.toLowerCase();
  return hay.includes(String(only).toLowerCase());
}

async function runOne(req, ctx, dir, opts, store) {
  const url = resolve(req.url, ctx);
  const headers = {};
  for (const [k, v] of req.headers) headers[k] = resolve(v, ctx);
  let body = req.body == null ? null : resolve(req.body, ctx);

  // `< ./payload.json` loads the body from disk, same as REST Client.
  if (body && /^\s*<\s+\S/.test(body)) {
    const f = body.trim().replace(/^<\s*/, '').replace(/^@[\w-]*\s*/, '');
    body = fs.readFileSync(path.resolve(dir, f), 'utf8');
    body = resolve(body, ctx);
  }

  const started = Date.now();
  const key = req.name || req.title;
  const out = { req, url, ms: 0, failures: [] };

  let res;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Number(opts.timeout || DEFAULT_TIMEOUT));
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        redirect: 'follow',
        signal: ac.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e) {
    out.ms = Date.now() - started;
    out.error = e.name === 'AbortError' ? `timed out after ${opts.timeout || DEFAULT_TIMEOUT}ms` : e.message;
    return out;
  }

  const raw = await res.text();
  out.ms = Date.now() - started;
  const rh = {};
  res.headers.forEach((v, k) => { rh[k.toLowerCase()] = v; });
  let json;
  const ct = rh['content-type'] || '';
  if (/json/i.test(ct) || /^\s*[[{]/.test(raw)) { try { json = JSON.parse(raw); } catch { /* keep text */ } }

  out.response = { status: res.status, statusText: res.statusText, headers: rh, body: raw, json };
  ctx.named[key] = { request: { headers, body }, response: { status: res.status, headers: rh, body: json !== undefined ? json : raw } };
  if (req.name) ctx.named[req.name] = ctx.named[key];

  applyExpectations(req, out);
  // The diff runs even when an expectation already failed. Knowing WHAT changed
  // is the whole point; "status 200 was expected" on its own tells nobody why.
  applySnapshot(req, out, store, opts, key);
  return out;
}

function applyExpectations(req, out) {
  const r = out.response;
  const list = [];
  for (const [k, v] of Object.entries(req.meta)) {
    if (k === 'expect') list.push(v);
    else if (/^expect\d+$/.test(k)) list.push(v);
  }
  for (const raw of list) {
    const [what, ...rest] = raw.split(/\s+/);
    const arg = rest.join(' ');
    if (what === 'status') {
      if (String(r.status) !== arg) out.failures.push({ kind: 'expect', text: `expected status ${arg}, got ${r.status}` });
    } else if (what === 'body') {
      const [p, op, ...val] = rest;
      const got = jsonPath(r.json !== undefined ? r.json : {}, p);
      if (op === 'exists') { if (got == null) out.failures.push({ kind: 'expect', text: `${p} is missing` }); }
      else if (op === 'equals') { if (got !== val.join(' ')) out.failures.push({ kind: 'expect', text: `expected ${p} to equal ${val.join(' ')}, got ${got}` }); }
      else if (op === 'contains') { if (!String(got ?? '').includes(val.join(' '))) out.failures.push({ kind: 'expect', text: `expected ${p} to contain ${val.join(' ')}` }); }
    } else if (what === 'header') {
      const [h, op, ...val] = rest;
      const got = r.headers[String(h).toLowerCase()];
      if (op === 'exists') { if (got == null) out.failures.push({ kind: 'expect', text: `header ${h} is missing` }); }
      else if (op === 'contains' && !String(got ?? '').includes(val.join(' '))) out.failures.push({ kind: 'expect', text: `expected header ${h} to contain ${val.join(' ')}` });
    }
  }
}

function applySnapshot(req, out, store, opts, key) {
  const mode = (req.meta.assert || opts.assert || 'shape').toLowerCase();
  if (mode === 'off' || opts.noSnapshot) return;
  const taken = snapshot.capture(out.response, mode === 'exact' ? 'exact' : 'shape');
  const prev = store.get(key);
  if (!prev || opts.update) { store.set(key, taken); out.snapshot = prev ? 'updated' : 'recorded'; return; }
  const d = snapshot.diff(prev, taken);
  if (d.length) { out.snapshot = 'changed'; out.diff = d; out.failures.push({ kind: 'snapshot', text: `response changed in ${d.length} place${d.length > 1 ? 's' : ''}` }); }
  else out.snapshot = 'ok';
}

class SnapshotStore {
  constructor(filePath, opts) {
    const dir = path.join(path.dirname(path.resolve(filePath)), '__http__');
    this.path = path.join(dir, path.basename(filePath).replace(/\.(http|rest)$/i, '') + '.snap.json');
    this.dir = dir;
    this.data = {};
    this.dirty = false;
    if (fs.existsSync(this.path)) {
      try { this.data = JSON.parse(fs.readFileSync(this.path, 'utf8')); } catch { this.data = {}; }
    }
    this.disabled = !!opts.noSnapshot;
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.dirty = true; }
  save() {
    if (this.disabled || !this.dirty) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2) + '\n');
  }
}

module.exports = { runFile, runOne };
