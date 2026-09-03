'use strict';
const fs = require('fs');
const path = require('path');
const { parse } = require('./parse');

// Generating documentation means publishing it. Anything that could carry a
// secret is redacted before it can reach a public README, and the list errs
// heavily on the side of hiding too much.
const SECRET_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|auth-token|x-access-token|access-token|x-csrf-token|x-amz-security-token|private-token|x-shopify-access-token)$/i;
const SECRET_KEYS = /(pass(word)?|secret|token|api_?key|credential|private_?key|refresh|session|signature|authorization)/i;
const SECRET_VALUE = /^(bearer|basic|token)\s+\S+/i;

function redactHeaderValue(name, value) {
  if (SECRET_HEADERS.test(name) || SECRET_VALUE.test(value)) return '<redacted>';
  // A raw {{placeholder}} is safe: it names a variable, it is not the value.
  return value;
}

function redactJson(v, depth) {
  if (depth > 6 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 3).map(x => redactJson(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SECRET_KEYS.test(k) ? '<redacted>' : redactJson(val, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string' && SECRET_VALUE.test(v)) return '<redacted>';
  return v;
}

function fence(lang, body) {
  return '```' + lang + '\n' + body.replace(/```/g, "'''") + '\n```';
}

function bodyBlock(body) {
  if (!body) return null;
  const t = body.trim();
  if (t.length > 4000) return fence('', t.slice(0, 4000) + '\n...');
  try {
    const j = JSON.parse(t);
    return fence('json', JSON.stringify(redactJson(j, 0), null, 2));
  } catch { /* not json */ }
  return fence('', t);
}

function loadSnapshots(file) {
  const p = path.join(path.dirname(path.resolve(file)), '__http__',
    path.basename(file).replace(/\.(http|rest)$/i, '') + '.snap.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function shapeLines(shape, indent, out) {
  if (!shape || typeof shape.type !== 'string') return;
  if (shape.type === 'object') {
    for (const [k, v] of Object.entries(shape.keys || {})) {
      out.push(`${'  '.repeat(indent)}- \`${k}\` — ${typeName(v)}`);
      if (v && (v.type === 'object' || v.type === 'array')) shapeLines(v.type === 'array' ? v.of : v, indent + 1, out);
    }
  } else if (shape.type === 'array' && shape.of) {
    shapeLines(shape.of, indent, out);
  }
}

function typeName(s) {
  if (!s || typeof s.type !== 'string') return 'unknown';
  if (s.type === 'object') return 'object';
  if (s.type === 'array') return `array of ${s.of ? typeName(s.of) : 'unknown'}`;
  return s.type;
}

function generate(files, opts = {}) {
  const parts = [`# ${opts.title || 'API reference'}`, ''];
  if (opts.intro) parts.push(opts.intro, '');
  let count = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const { requests } = parse(text, file);
    if (!requests.length) continue;
    const snaps = loadSnapshots(file);
    if (files.length > 1) parts.push(`## ${path.basename(file)}`, '');

    for (const req of requests) {
      count++;
      parts.push(`### ${req.title}`, '');
      parts.push(fence('http', `${req.method} ${req.url}`));
      parts.push('');

      const headers = req.headers.filter(([k]) => k.toLowerCase() !== 'content-length');
      if (headers.length) {
        parts.push('| Header | Value |', '| --- | --- |');
        for (const [k, v] of headers) parts.push(`| \`${k}\` | \`${redactHeaderValue(k, v)}\` |`);
        parts.push('');
      }

      const bb = bodyBlock(req.body);
      if (bb) { parts.push('**Request body**', '', bb, ''); }

      const snap = snaps[req.name || req.title];
      if (snap) {
        parts.push(`**Response** — \`${snap.status}\``, '');
        if (snap.body && snap.body.type) {
          const lines = [];
          shapeLines(snap.body, 0, lines);
          if (lines.length) parts.push(...lines, '');
          else parts.push(`\`${typeName(snap.body)}\``, '');
        } else if (snap.body !== undefined) {
          parts.push(bodyBlock(typeof snap.body === 'string' ? snap.body : JSON.stringify(snap.body, null, 2)) || '', '');
        }
      }
    }
  }

  parts.push('---', '',
    `${count} request${count === 1 ? '' : 's'}. Generated from the \`.http\` files in this repository by ` +
    `[HTTP Runner](https://marketplace.visualstudio.com/items?itemName=sellerkit.httprunner), ` +
    `which replays them and records what came back. Secrets are redacted.`);
  return parts.join('\n') + '\n';
}

module.exports = { generate, redactJson, redactHeaderValue };
