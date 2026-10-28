// Storage for QR codes and scans.
//  - DATABASE_URL (or POSTGRES_URL) set  -> Postgres (use this on Vercel, e.g. Neon from the Vercel Marketplace)
//  - otherwise                           -> a local JSON file (fine on your own computer)
const fs = require('fs');
const path = require('path');

const rowToScan = r => ({ t: Number(r.t), qr: r.qr, vid: r.vid, fp: r.fp, device: r.device, os: r.os });
const rowToQr = r => ({ id: r.id, name: r.name, target: r.target, created: Number(r.created), ...(r.original ? { original: r.original } : {}) });

// ---------------- Postgres ----------------
function postgresStore(pool) {
  let ready;
  const init = () => (ready ||= pool.query(`
    CREATE TABLE IF NOT EXISTS qrs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, target TEXT NOT NULL, created BIGINT NOT NULL, original TEXT
    );
    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY, t BIGINT NOT NULL, qr TEXT NOT NULL, vid TEXT NOT NULL, fp TEXT, device TEXT, os TEXT
    );
    CREATE INDEX IF NOT EXISTS scans_qr ON scans(qr);
    CREATE INDEX IF NOT EXISTS scans_fp ON scans(fp);
  `).catch(e => { ready = null; throw e; }));
  const q = async (sql, params) => { await init(); return (await pool.query(sql, params)).rows; };

  return {
    kind: 'postgres',
    async listQrs() { return (await q('SELECT * FROM qrs ORDER BY created DESC')).map(rowToQr); },
    async getQr(id) { const r = await q('SELECT * FROM qrs WHERE id = $1', [id]); return r[0] ? rowToQr(r[0]) : null; },
    async firstQr() { const r = await q("SELECT * FROM qrs ORDER BY (id = 'main') DESC, created ASC LIMIT 1"); return r[0] ? rowToQr(r[0]) : null; },
    async addQr(x) {
      await q('INSERT INTO qrs (id, name, target, created, original) VALUES ($1, $2, $3, $4, $5)',
        [x.id, x.name, x.target, x.created, x.original || null]);
    },
    async updateQr(id, { name, target }) {
      await q('UPDATE qrs SET name = COALESCE($2, name), target = COALESCE($3, target) WHERE id = $1', [id, name ?? null, target ?? null]);
      return this.getQr(id);
    },
    async deleteQr(id) { await q('DELETE FROM scans WHERE qr = $1', [id]); await q('DELETE FROM qrs WHERE id = $1', [id]); },
    async addScan(s) {
      await q('INSERT INTO scans (t, qr, vid, fp, device, os) VALUES ($1, $2, $3, $4, $5, $6)', [s.t, s.qr, s.vid, s.fp, s.device, s.os]);
    },
    async visitorForFingerprint(fp) { const r = await q('SELECT vid FROM scans WHERE fp = $1 ORDER BY t ASC LIMIT 1', [fp]); return r[0]?.vid || null; },
    async scans(qrId) {
      const rows = qrId ? await q('SELECT * FROM scans WHERE qr = $1 ORDER BY t ASC', [qrId])
                        : await q('SELECT * FROM scans ORDER BY t ASC');
      return rows.map(rowToScan);
    },
  };
}

// ---------------- JSON file ----------------
function fileStore(file, legacyTarget) {
  let db = { qrs: [], scans: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) {   // data from the very first version
      db.qrs.push({ id: 'main', name: 'Main QR', target: legacyTarget, created: raw[0]?.t || Date.now() });
      db.scans = raw.map(s => ({ ...s, qr: 'main' }));
    } else db = { qrs: raw.qrs || [], scans: raw.scans || [] };
  } catch { /* nothing saved yet */ }
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tmp = file + '.tmp';
      fs.writeFile(tmp, JSON.stringify(db), err => { if (!err) fs.rename(tmp, file, () => {}); });
    }, 200);
  };
  return {
    kind: 'file',
    async listQrs() { return [...db.qrs].sort((a, b) => b.created - a.created); },
    async getQr(id) { return db.qrs.find(x => x.id === id) || null; },
    async firstQr() { return db.qrs.find(x => x.id === 'main') || db.qrs[0] || null; },
    async addQr(x) { db.qrs.push(x); save(); },
    async updateQr(id, { name, target }) {
      const x = db.qrs.find(q => q.id === id); if (!x) return null;
      if (name != null) x.name = name; if (target != null) x.target = target; save(); return x;
    },
    async deleteQr(id) { db.qrs = db.qrs.filter(x => x.id !== id); db.scans = db.scans.filter(s => s.qr !== id); save(); },
    async addScan(s) { db.scans.push(s); save(); },
    async visitorForFingerprint(fp) { return db.scans.find(s => s.fp === fp)?.vid || null; },
    async scans(qrId) { return qrId ? db.scans.filter(s => s.qr === qrId) : db.scans; },
  };
}

function createStore({ legacyTarget, pool } = {}) {
  if (pool) return postgresStore(pool);
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    return postgresStore(new Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: false } }));
  }
  if (process.env.VERCEL) console.warn('WARNING: no DATABASE_URL set. On Vercel, data saved to a file will be lost. Add a Postgres database.');
  const file = process.env.DATA_FILE || path.join(process.env.VERCEL ? '/tmp' : __dirname, 'scans.json');
  return fileStore(file, legacyTarget);
}

module.exports = { createStore };
