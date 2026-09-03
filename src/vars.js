'use strict';
const fs = require('fs');
const path = require('path');

// Environment files. We read every shape people already have so that nobody has
// to rewrite anything: IntelliJ's http-client.env.json (which is also the format
// REST Client users asked for, issue #85), and plain .env.
const ENV_FILES = ['http-client.env.json', 'rest-client.env.json'];
const PRIVATE_ENV_FILES = ['http-client.private.env.json', 'rest-client.private.env.json'];

function findUp(startDir, names) {
  let dir = path.resolve(startDir);
  const found = [];
  for (;;) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) found.push(p);
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return found;
}

function loadEnv(fromDir, envName) {
  const out = {};
  // Public first, private last: secrets win, and they are the file people
  // actually gitignore.
  const files = [...findUp(fromDir, ENV_FILES).reverse(), ...findUp(fromDir, PRIVATE_ENV_FILES).reverse()];
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { throw new Error(`could not read env file: ${f}\n  ${e.message}`); }
    Object.assign(out, doc.$shared || {});
    if (envName && doc[envName]) Object.assign(out, doc[envName]);
  }
  return out;
}

function loadDotenv(fromDir) {
  const out = {};
  for (const f of findUp(fromDir, ['.env']).reverse()) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([\w.\-]+)\s*=\s*(.*)$/.exec(line);
      if (!m || /^\s*#/.test(line)) continue;
      out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
  return out;
}

function systemVar(expr) {
  const [name, ...args] = expr.trim().split(/\s+/);
  switch (name) {
    case '$guid':
    case '$uuid':
      return require('crypto').randomUUID();
    case '$randomInt': {
      const lo = parseInt(args[0] ?? '0', 10), hi = parseInt(args[1] ?? '1000', 10);
      return String(lo + Math.floor(Math.random() * (hi - lo)));
    }
    case '$timestamp': {
      let t = Date.now();
      if (args.length >= 2) t += offsetMs(parseInt(args[0], 10), args[1]);
      return String(Math.floor(t / 1000));
    }
    case '$datetime': {
      const fmt = args[0] || 'iso8601';
      let t = Date.now();
      if (args.length >= 3) t += offsetMs(parseInt(args[1], 10), args[2]);
      const d = new Date(t);
      return fmt === 'rfc1123' ? d.toUTCString() : d.toISOString();
    }
    case '$localDatetime':
      return new Date().toISOString();
    case '$processEnv':
      return process.env[args[0]] ?? '';
    case '$dotenv':
      return null; // resolved by the caller, which knows the file location
    default:
      return null;
  }
}

function offsetMs(n, unit) {
  const u = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, y: 31536e6 };
  return n * (u[(unit || 's')[0]] || 1e3);
}

/**
 * Resolve {{...}} placeholders. `named` holds results of previously executed
 * requests so that {{login.response.body.$.token}} works, which is how people
 * chain auth without writing any code.
 */
function resolve(input, ctx, seen) {
  if (input == null) return input;
  seen = seen || new Set();
  return String(input).replace(/\{\{([^{}]+)\}\}/g, (whole, expr) => {
    const key = expr.trim();
    if (seen.has(key)) return whole; // cycle guard
    const v = lookup(key, ctx);
    if (v == null) {
      ctx.missing.add(key);
      return whole;
    }
    const next = new Set(seen); next.add(key);
    return resolve(v, ctx, next);
  });
}

function lookup(key, ctx) {
  if (key.startsWith('$')) {
    if (key.startsWith('$dotenv')) {
      const n = key.split(/\s+/)[1];
      return ctx.dotenv[n] ?? null;
    }
    return systemVar(key);
  }
  const dot = key.indexOf('.');
  if (dot > 0) {
    const head = key.slice(0, dot);
    if (ctx.named[head]) return requestVar(ctx.named[head], key.slice(dot + 1));
  }
  if (Object.prototype.hasOwnProperty.call(ctx.vars, key)) return ctx.vars[key];
  if (Object.prototype.hasOwnProperty.call(ctx.env, key)) return ctx.env[key];
  if (Object.prototype.hasOwnProperty.call(ctx.dotenv, key)) return ctx.dotenv[key];
  return null;
}

function requestVar(entry, rest) {
  const parts = rest.split('.');
  const which = parts.shift(); // request | response
  const source = which === 'request' ? entry.request : entry.response;
  if (!source) return null;
  const part = parts.shift(); // body | headers
  if (part === 'headers') return source.headers?.[parts.join('.').toLowerCase()] ?? null;
  if (part !== 'body') return null;
  let body = source.body;
  const pathExpr = parts.join('.');
  if (!pathExpr || pathExpr === '$') return typeof body === 'string' ? body : JSON.stringify(body);
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return null; } }
  return jsonPath(body, pathExpr);
}

// A deliberately small JSONPath: $.a.b[0].c — the shape people actually write.
function jsonPath(obj, expr) {
  let cur = obj;
  const tokens = expr.replace(/^\$\.?/, '').match(/[^.[\]]+/g) || [];
  for (const t of tokens) {
    if (cur == null) return null;
    cur = cur[/^\d+$/.test(t) ? Number(t) : t];
  }
  if (cur == null) return null;
  return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
}

function makeContext({ fileVars, envName, dir }) {
  return {
    vars: { ...(fileVars || {}) },
    env: loadEnv(dir, envName),
    dotenv: { ...loadDotenv(dir), ...process.env },
    named: {},
    missing: new Set(),
  };
}

module.exports = { makeContext, resolve, loadEnv, loadDotenv, jsonPath, systemVar };
