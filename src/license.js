'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Two rules here, both learned from watching Thunder Client's rating fall from
// four stars to 2.39 after it paywalled things people already relied on:
//
//   1. Never lock work that already exists. Files, snapshots and reports stay
//      readable forever, licensed or not.
//   2. Never break a build because OUR server is unreachable. Any network
//      failure during validation fails OPEN.

const TRIAL_DAYS = 14;
const CACHE_DAYS = 7;
const API = process.env.HTTPRUNNER_API || 'https://api.polar.sh/v1/customer-portal/license-keys/validate';
const ORG = process.env.HTTPRUNNER_ORG || '';

function home() {
  const d = path.join(os.homedir(), '.httprunner');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function statePath() { return path.join(home(), 'state.json'); }

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}
function writeState(s) {
  try { fs.writeFileSync(statePath(), JSON.stringify(s, null, 2) + '\n'); } catch { /* read-only CI, ignore */ }
}

function findKey() {
  if (process.env.HTTPRUNNER_KEY) return process.env.HTTPRUNNER_KEY.trim();
  const s = readState();
  return s.key || null;
}

async function check() {
  const state = readState();
  const key = findKey();

  if (!key) {
    if (!state.firstRun) { state.firstRun = Date.now(); writeState(state); }
    const days = Math.floor((Date.now() - state.firstRun) / 86400000);
    const left = TRIAL_DAYS - days;
    if (left > 0) return { ok: true, trial: true, left, notice: `Trial: ${left} day${left > 1 ? 's' : ''} left.` };
    return { ok: false, reason: 'trial-over' };
  }

  // A recent successful validation is trusted so that CI does not depend on us.
  if (state.validKey === key && state.validAt && Date.now() - state.validAt < CACHE_DAYS * 86400000) {
    return { ok: true };
  }

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    let res;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ORG ? { key, organization_id: ORG } : { key }),
        signal: ac.signal,
      });
    } finally { clearTimeout(t); }

    if (res.status === 404 || res.status === 403) return { ok: false, reason: 'invalid' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (body && body.status && body.status !== 'granted') return { ok: false, reason: 'invalid' };
    state.validKey = key; state.validAt = Date.now(); writeState(state);
    return { ok: true };
  } catch {
    // Offline, blocked egress, or our outage. Not the user's problem.
    if (state.validKey === key) return { ok: true, notice: 'Could not reach the license server; continuing with the last successful check.' };
    return { ok: true, notice: 'Could not reach the license server; this run continues anyway.' };
  }
}

function message(r) {
  if (r.reason === 'trial-over') {
    return [
      '',
      `The ${TRIAL_DAYS} day trial has ended.`,
      '',
      '  Sending one request at a time from the editor stays free.',
      '  Running a whole file, watching responses and using CI is the paid part.',
      '',
      '  Your .http files and recorded responses (__http__/) are untouched and still readable.',
      '',
      '  Add your key:  export HTTPRUNNER_KEY=...',
      '',
    ].join('\n');
  }
  return '\nThat license key was not accepted. Check HTTPRUNNER_KEY.\n';
}

module.exports = { check, message, TRIAL_DAYS };
