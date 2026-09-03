'use strict';
// .http / .rest parser. Deliberately compatible with the files 7.5M REST Client
// users already have, because the whole product rests on not asking them to migrate.

const METHODS = ['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS','TRACE','CONNECT','LOCK','UNLOCK','PROPFIND','PURGE'];
const SEPARATOR = /^\s*#{3,}(.*)$/;
const FILE_VAR = /^\s*@([A-Za-z0-9_\-.]+)\s*=\s*(.*)$/;
const META = /^\s*(?:#|\/\/)\s*@([A-Za-z0-9_\-]+)(?:\s+(.*))?$/;
const COMMENT = /^\s*(?:#|\/\/)/;
const REQUEST_LINE = new RegExp('^\\s*(?:(' + METHODS.join('|') + ')\\s+)?(\\S+)(?:\\s+HTTP\\/[\\d.]+)?\\s*$', 'i');

/**
 * @returns {{fileVars: Object, requests: Array}}
 */
function parse(text, filePath) {
  const lines = text.split(/\r?\n/);
  const fileVars = {};
  const requests = [];

  // Blocks are separated by ### lines. Everything before the first request line
  // in a block is metadata/comments; everything after the first blank line
  // following the headers is the body.
  let block = { title: '', startLine: 0, lines: [] };
  const blocks = [];
  const flush = () => { if (block.lines.some(l => l.text.trim() !== '')) blocks.push(block); };

  for (let i = 0; i < lines.length; i++) {
    const m = SEPARATOR.exec(lines[i]);
    if (m) {
      flush();
      block = { title: m[1].trim(), startLine: i + 1, lines: [] };
    } else {
      block.lines.push({ text: lines[i], n: i });
    }
  }
  flush();

  for (const b of blocks) {
    const req = parseBlock(b, fileVars, filePath);
    if (req) requests.push(req);
  }
  return { fileVars, requests };
}

function parseBlock(block, fileVars, filePath) {
  const meta = {};
  let i = 0;
  const L = block.lines;

  // Leading variables, metadata and comments.
  for (; i < L.length; i++) {
    const t = L[i].text;
    if (t.trim() === '') continue;
    const mv = FILE_VAR.exec(t);
    if (mv) { fileVars[mv[1]] = mv[2].trim(); continue; }
    const mm = META.exec(t);
    if (mm) { meta[mm[1].toLowerCase()] = (mm[2] || '').trim(); continue; }
    if (COMMENT.test(t)) continue;
    break;
  }
  if (i >= L.length) return null;

  const reqLineNo = L[i].n;
  let rawLine = L[i].text.trim();
  i++;
  // A URL may be continued on following lines that begin with whitespace
  // (query strings split across lines are common in real files).
  while (i < L.length && /^\s+[?&]/.test(L[i].text)) { rawLine += L[i].text.trim(); i++; }

  const rm = REQUEST_LINE.exec(rawLine);
  if (!rm) return null;
  const method = (rm[1] || 'GET').toUpperCase();
  const url = rm[2];

  const headers = [];
  for (; i < L.length; i++) {
    const t = L[i].text;
    if (t.trim() === '') { i++; break; }
    if (COMMENT.test(t)) continue;
    const c = t.indexOf(':');
    if (c === -1) break;
    headers.push([t.slice(0, c).trim(), t.slice(c + 1).trim()]);
  }

  let body = L.slice(i).map(l => l.text).join('\n');
  // Trailing blank lines are noise, but interior ones matter (multipart).
  body = body.replace(/\s+$/, '');

  return {
    name: meta.name || null,
    title: block.title || meta.name || `${method} ${url}`,
    meta,
    method,
    url,
    headers,
    body: body === '' ? null : body,
    line: reqLineNo,
    file: filePath || null,
  };
}

module.exports = { parse, METHODS };
