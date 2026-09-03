'use strict';
const fs = require('fs');

// Getting in must be cheaper than staying out. People already have their
// requests somewhere; asking them to retype is the real barrier, not price.

function detect(doc) {
  if (doc && doc.info && /schema\.getpostman\.com/.test(doc.info.schema || '')) return 'postman';
  if (doc && Array.isArray(doc.resources) && doc.__export_format) return 'insomnia';
  if (doc && Array.isArray(doc.item)) return 'postman';
  return null;
}

const VAR = /\{\{\s*([\w.\-]+)\s*\}\}/g;

function postmanUrl(u) {
  if (!u) return '';
  if (typeof u === 'string') return u;
  if (u.raw) return u.raw;
  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host || '');
  const p = Array.isArray(u.path) ? '/' + u.path.join('/') : (u.path || '');
  const q = Array.isArray(u.query) && u.query.length
    ? '?' + u.query.filter(x => !x.disabled).map(x => `${x.key}=${x.value ?? ''}`).join('&') : '';
  return `${u.protocol ? u.protocol + '://' : ''}${host}${p}${q}`;
}

function postmanContentType(b) {
  if (!b) return null;
  if (b.mode === 'urlencoded') return 'application/x-www-form-urlencoded';
  if (b.mode === 'formdata') return 'application/x-www-form-urlencoded';
  if (b.mode === 'graphql') return 'application/json';
  return null;
}

function postmanBody(b) {
  if (!b) return null;
  if (b.mode === 'raw') return b.raw || null;
  if (b.mode === 'urlencoded') {
    return (b.urlencoded || []).filter(x => !x.disabled)
      .map(x => `${encodeURIComponent(x.key)}=${encodeURIComponent(x.value ?? '')}`).join('&');
  }
  if (b.mode === 'formdata') {
    return (b.formdata || []).filter(x => !x.disabled)
      .map(x => `${x.key}=${x.value ?? ''}`).join('&');
  }
  if (b.mode === 'graphql' && b.graphql) {
    return JSON.stringify({ query: b.graphql.query, variables: safeJson(b.graphql.variables) }, null, 2);
  }
  return null;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return undefined; } }

function walkPostman(items, out, trail) {
  for (const it of items || []) {
    if (Array.isArray(it.item)) { walkPostman(it.item, out, trail.concat(it.name || '')); continue; }
    const r = it.request;
    if (!r) continue;
    const headers = (r.header || []).filter(h => !h.disabled).map(h => [h.key, h.value ?? '']);
    if (r.auth && r.auth.type === 'bearer') {
      const t = (r.auth.bearer || [])[0];
      headers.push(['Authorization', `Bearer ${t && t.value ? t.value : '{{token}}'}`]);
    }
    out.push({
      title: [...trail.filter(Boolean), it.name || 'request'].join(' / '),
      method: (r.method || 'GET').toUpperCase(),
      url: postmanUrl(r.url),
      headers,
      body: postmanBody(r.body),
      contentType: postmanContentType(r.body),
    });
  }
}

// Insomnia writes {{ _.base }}; the underscore is its own namespace, not part
// of the name. Normalise so the file reads like every other .http file.
function normalise(s) {
  return s == null ? s : String(s).replace(/\{\{\s*_\.\s*([\w.\-]+)\s*\}\}/g, '{{$1}}')
                                  .replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, '{{$1}}');
}

function fromInsomnia(doc) {
  const out = [];
  const folders = new Map();
  for (const r of doc.resources) if (r._type === 'request_group') folders.set(r._id, r.name || '');
  for (const r of doc.resources) {
    if (r._type !== 'request') continue;
    const headers = (r.headers || []).filter(h => !h.disabled).map(h => [h.name, h.value ?? '']);
    let body = null, ctype = null;
    if (r.body && r.body.text) { body = r.body.text; ctype = r.body.mimeType || null; }
    else if (r.body && Array.isArray(r.body.params)) {
      ctype = 'application/x-www-form-urlencoded';
      body = r.body.params.filter(p => !p.disabled)
        .map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value ?? '')}`).join('&');
    }
    const folder = folders.get(r.parentId);
    out.push({
      title: [folder, r.name || 'request'].filter(Boolean).join(' / '),
      method: (r.method || 'GET').toUpperCase(),
      url: normalise(r.url || ''),
      headers: headers.map(([k, v]) => [k, normalise(v)]),
      body: normalise(body),
      contentType: ctype,
    });
  }
  return out;
}

/** Collect {{vars}} so they can be declared at the top of the file. */
function collectVars(reqs) {
  const seen = new Set();
  for (const r of reqs) {
    for (const s of [r.url, r.body, ...r.headers.map(h => h[1])]) {
      if (!s) continue;
      let m; VAR.lastIndex = 0;
      while ((m = VAR.exec(String(s)))) if (!m[1].startsWith('$')) seen.add(m[1]);
    }
  }
  return [...seen];
}

function toHttp(reqs, opts = {}) {
  const lines = [];
  const vars = collectVars(reqs);
  if (vars.length) {
    lines.push('# Variables found in the imported collection. Fill these in,',
      '# or move the secret ones into http-client.private.env.json.');
    for (const v of vars) lines.push(`@${v} = `);
    lines.push('');
  }
  for (const r of reqs) {
    lines.push(`### ${r.title}`);
    lines.push(`${r.method} ${r.url}`);
    const headers = r.headers.slice();
    // A form body without its content type is a request that silently fails.
    if (r.contentType && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', r.contentType]);
    }
    for (const [k, v] of headers) lines.push(`${k}: ${v}`);
    if (r.body) { lines.push('', r.body.trim()); }
    lines.push('');
  }
  return lines.join('\n');
}

function importFile(file, opts = {}) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kind = detect(doc);
  if (!kind) throw new Error('not a Postman or Insomnia export');
  const reqs = [];
  if (kind === 'postman') walkPostman(doc.item, reqs, []);
  else reqs.push(...fromInsomnia(doc));
  return { kind, count: reqs.length, text: toHttp(reqs, opts) };
}

module.exports = { importFile, toHttp, detect };
