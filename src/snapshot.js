'use strict';
// The idea that makes tests worth having: you never write one.
// The first run records the answer, later runs report what changed.
//
// Default comparison is by SHAPE, not by value, because real responses carry
// ids, timestamps and tokens that change every call. Comparing values exactly
// is what makes people delete their tests after a week of false alarms.

const VOLATILE_HEADERS = new Set([
  'date','etag','last-modified','set-cookie','age','expires','server',
  'x-request-id','x-correlation-id','x-amzn-requestid','x-runtime',
  'cf-ray','request-id','traceparent','content-length','keep-alive','connection',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Reduce a JSON value to its structure. Arrays collapse to their element shape. */
function shapeOf(v) {
  const t = typeOf(v);
  if (t === 'array') {
    if (v.length === 0) return { type: 'array', of: null };
    // Union the element shapes so a mixed array does not flap between runs.
    const shapes = v.map(shapeOf).map(s => JSON.stringify(s));
    const uniq = [...new Set(shapes)].sort().map(s => JSON.parse(s));
    return { type: 'array', of: uniq.length === 1 ? uniq[0] : uniq };
  }
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = shapeOf(v[k]);
    return { type: 'object', keys: out };
  }
  return { type: t };
}

function capture(res, mode) {
  const headers = {};
  for (const [k, val] of Object.entries(res.headers || {})) {
    const lk = k.toLowerCase();
    if (!VOLATILE_HEADERS.has(lk)) headers[lk] = val;
  }
  const snap = { status: res.status, headers, mode };
  if (res.json !== undefined) snap.body = mode === 'exact' ? res.json : shapeOf(res.json);
  else if (typeof res.body === 'string') snap.body = mode === 'exact' ? res.body : { type: 'string' };
  return snap;
}

/** @returns {Array<{path:string, was:*, now:*, kind:string}>} */
function diff(expected, actual) {
  const out = [];
  if (expected.status !== actual.status) {
    out.push({ path: 'status', was: expected.status, now: actual.status, kind: 'changed' });
  }
  walk('body', expected.body, actual.body, out);
  for (const k of Object.keys(expected.headers || {})) {
    if (!(k in (actual.headers || {}))) {
      out.push({ path: `headers.${k}`, was: expected.headers[k], now: undefined, kind: 'removed' });
    }
  }
  return out;
}

function walk(p, e, a, out) {
  if (e === undefined && a === undefined) return;
  if (e === undefined) { out.push({ path: p, was: undefined, now: brief(a), kind: 'added' }); return; }
  if (a === undefined) { out.push({ path: p, was: brief(e), now: undefined, kind: 'removed' }); return; }

  const isShape = e && typeof e === 'object' && typeof e.type === 'string';
  if (isShape) {
    if (!a || a.type !== e.type) {
      out.push({ path: p, was: e.type, now: a && a.type, kind: 'type' });
      return;
    }
    if (e.type === 'object') {
      const ek = e.keys || {}, ak = (a.keys || {});
      for (const k of Object.keys(ek)) walk(`${p}.${k}`, ek[k], ak[k], out);
      for (const k of Object.keys(ak)) if (!(k in ek)) walk(`${p}.${k}`, undefined, ak[k], out);
      return;
    }
    if (e.type === 'array') { walk(`${p}[]`, e.of ?? undefined, a.of ?? undefined, out); return; }
    return;
  }
  // exact mode
  if (typeOf(e) !== typeOf(a)) { out.push({ path: p, was: brief(e), now: brief(a), kind: 'type' }); return; }
  if (e && typeof e === 'object') {
    const ks = new Set([...Object.keys(e), ...Object.keys(a)]);
    for (const k of ks) walk(`${p}.${k}`, e[k], a[k], out);
    return;
  }
  if (e !== a) out.push({ path: p, was: e, now: a, kind: 'changed' });
}

function brief(v) {
  if (v === undefined) return undefined;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? String(v) : (s.length > 60 ? s.slice(0, 57) + '...' : s);
}

module.exports = { capture, diff, shapeOf };
