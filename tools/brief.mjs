#!/usr/bin/env node
/*
 * Daily Brief publishing tool for agents. No dependencies (Node 18+).
 *
 *   node tools/brief.mjs init
 *       Create data/crypto.json (random salt). Run once.
 *
 *   BRIEF_PASSPHRASE=... node tools/brief.mjs publish --section school --in school.json [--date YYYY-MM-DD]
 *       Validate a section, encrypt it, write data/days/<date>/<section>.json.
 *       --in - reads JSON from stdin. --date defaults to today in America/New_York.
 *
 *   BRIEF_PASSPHRASE=... node tools/brief.mjs publish-dir --dir /path/to/folder [--date YYYY-MM-DD]
 *       Publish every <section>.json in a folder at once (encrypted).
 *
 *   BRIEF_PASSPHRASE=... node tools/brief.mjs read --section school [--date YYYY-MM-DD]
 *       Decrypt and print a published section (to check what's there).
 *
 *   node tools/brief.mjs validate --in school.json --section school
 *       Check a section file against the format without writing anything.
 *
 * --plain writes unencrypted JSON to demo/<section>.json (sample data only; never real personal data).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BriefCrypto = require(path.join(root, 'crypto.js'));

const SECTION_IDS = ['brief', 'schedule', 'school', 'career', 'work', 'inbox', 'fitness', 'goals', 'money', 'news', 'coming_up'];
const ITEM_KEYS = ['id', 'title', 'detail', 'time', 'end', 'kind', 'due', 'date', 'url', 'tag', 'from', 'priority', 'checkable'];

function args() {
  const a = process.argv.slice(2);
  const out = { _: a[0] };
  for (let i = 1; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const next = a[i + 1];
      if (next === undefined || (next.startsWith('--') && next !== '-')) out[k] = true;
      else { out[k] = next; i++; }
    }
  }
  return out;
}

function todayET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function die(msg) { console.error('error: ' + msg); process.exit(1); }

function readInput(p) {
  const text = p === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(p, 'utf8');
  try { return JSON.parse(text); } catch (e) { die('input is not valid JSON: ' + e.message); }
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function validate(section, data) {
  const errs = [];
  if (!SECTION_IDS.includes(section)) errs.push(`unknown section "${section}". Use one of: ${SECTION_IDS.join(', ')}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) { errs.push('section must be a JSON object'); return errs; }
  const checkItems = (items, where) => {
    if (!Array.isArray(items)) { errs.push(`${where} must be an array`); return; }
    items.forEach((it, i) => {
      const w = `${where}[${i}]`;
      if (typeof it === 'string' && where === 'top3') return;
      if (!it || typeof it !== 'object') { errs.push(`${w} must be an object`); return; }
      if (!it.title) errs.push(`${w}.title is required`);
      Object.keys(it).forEach((k) => { if (!ITEM_KEYS.includes(k)) errs.push(`${w}.${k} is not a known field (allowed: ${ITEM_KEYS.join(', ')})`); });
      if (it.due && !isDate(it.due)) errs.push(`${w}.due must be YYYY-MM-DD`);
      if (it.date && !isDate(it.date)) errs.push(`${w}.date must be YYYY-MM-DD`);
      if (it.url && !/^https?:\/\//.test(it.url)) errs.push(`${w}.url must start with http(s)://`);
      if (it.priority && !['high', 'normal'].includes(it.priority)) errs.push(`${w}.priority must be "high" or "normal"`);
      if (it.kind && !['fixed', 'suggested', 'open'].includes(it.kind)) errs.push(`${w}.kind must be fixed, suggested or open`);
    });
  };
  if (data.items) checkItems(data.items, 'items');
  if (data.top3) checkItems(data.top3, 'top3');
  if (data.groups) {
    if (!Array.isArray(data.groups)) errs.push('groups must be an array');
    else data.groups.forEach((g, i) => { if (!g.title) errs.push(`groups[${i}].title is required`); checkItems(g.items || [], `groups[${i}].items`); });
  }
  if (data.stats) (Array.isArray(data.stats) ? data.stats : []).forEach((s, i) => { if (!s.label || s.value == null) errs.push(`stats[${i}] needs label and value`); });
  if (data.progress) (Array.isArray(data.progress) ? data.progress : []).forEach((p, i) => {
    if (!p.label || typeof p.current !== 'number' || typeof p.target !== 'number') errs.push(`progress[${i}] needs label, numeric current and target`);
  });
  if (data.quote && (!data.quote.text || !data.quote.author)) errs.push('quote needs text and author');
  return errs;
}

async function key() {
  const pass = process.env.BRIEF_PASSPHRASE;
  if (!pass) die('BRIEF_PASSPHRASE is not set. Set it as an environment secret, never in the repo.');
  const cfgPath = path.join(root, 'data', 'crypto.json');
  if (!fs.existsSync(cfgPath)) die('data/crypto.json missing. Run: node tools/brief.mjs init');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  return BriefCrypto.deriveKey(pass, cfg.salt, cfg.iterations);
}

async function main() {
  const a = args();
  const cmd = a._;
  if (cmd === 'init') {
    const p = path.join(root, 'data', 'crypto.json');
    if (fs.existsSync(p) && !a.force) die('data/crypto.json already exists (use --force to replace; old briefs will stop opening)');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const salt = BriefCrypto.toB64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    fs.writeFileSync(p, JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iterations: 210000, salt }, null, 2) + '\n');
    console.log('wrote data/crypto.json');
    return;
  }
  const section = a.section;
  const date = a.date && a.date !== true ? a.date : todayET();
  if (!isDate(date)) die('--date must be YYYY-MM-DD');

  if (cmd === 'validate') {
    if (!a.in) die('--in is required');
    const errs = validate(section, readInput(a.in));
    if (errs.length) { errs.forEach((e) => console.error('  ' + e)); process.exit(1); }
    console.log('ok');
    return;
  }

  if (cmd === 'publish') {
    if (!section || !a.in) die('usage: publish --section <id> --in <file|-> [--date YYYY-MM-DD]');
    const data = readInput(a.in);
    const errs = validate(section, data);
    if (errs.length) { errs.forEach((e) => console.error('  ' + e)); process.exit(1); }
    if (!data.updated) data.updated = new Date().toISOString();
    const dir = a.plain ? path.join(root, 'demo') : path.join(root, 'data', 'days', date);
    fs.mkdirSync(dir, { recursive: true });
    const out = a.plain ? data : await BriefCrypto.encryptJSON(await key(), data);
    const file = path.join(dir, section + '.json');
    fs.writeFileSync(file, JSON.stringify(out, null, a.plain ? 2 : 0) + '\n');
    console.log('wrote ' + path.relative(root, file) + (a.plain ? ' (plain, demo)' : ' (encrypted)'));
    return;
  }

  if (cmd === 'publish-dir') {
    // Publish every <section>.json found in a folder, e.g. one written by the editor agent.
    if (!a.dir) die('usage: publish-dir --dir <folder> [--date YYYY-MM-DD]');
    const files = fs.readdirSync(a.dir).filter((f) => f.endsWith('.json') && SECTION_IDS.includes(f.slice(0, -5)));
    if (!files.length) die('no section files (' + SECTION_IDS.join(', ') + ') in ' + a.dir);
    const k = await key();
    let bad = 0;
    for (const f of files) {
      const section = f.slice(0, -5);
      const data = readInput(path.join(a.dir, f));
      const errs = validate(section, data);
      if (errs.length) { bad++; console.error(section + ':'); errs.forEach((e) => console.error('  ' + e)); continue; }
      if (!data.updated) data.updated = new Date().toISOString();
      const dir = path.join(root, 'data', 'days', date);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, section + '.json'), JSON.stringify(await BriefCrypto.encryptJSON(k, data)) + '\n');
      console.log('wrote data/days/' + date + '/' + section + '.json (encrypted)');
    }
    if (bad) process.exit(1);
    return;
  }

  if (cmd === 'read') {
    if (!section) die('usage: read --section <id> [--date YYYY-MM-DD]');
    const file = path.join(root, 'data', 'days', date, section + '.json');
    if (!fs.existsSync(file)) die('nothing published at ' + path.relative(root, file));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const data = BriefCrypto.isEnvelope(raw) ? await BriefCrypto.decryptJSON(await key(), raw) : raw;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
}

main().catch((e) => die(e.message));
