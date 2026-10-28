// QR Scan Tracker — upload QR codes in the panel, get trackable versions,
// and see each one's scan history (unique people + total scans) on the dashboard.
// Your computer:  npm install && npm start
// Vercel:         push to GitHub, import the repo on Vercel, add a Postgres database (see README)
const express = require('express');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const { createStore } = require('./db');

// ---------- Settings (environment variables) ----------
const PORT = process.env.PORT || 3000;
// Your public address. If not set, the address the dashboard was opened with is used.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';  // CHANGE THIS
const LEGACY_TARGET = process.env.TARGET_URL || 'https://doublebull.in/';    // only for the old /scan link

const store = createStore({ legacyTarget: LEGACY_TARGET });

// ---------- Helpers ----------
const baseUrl = req => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const scanUrl = (qr, req) => `${baseUrl(req)}/s/${qr.id}`;
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
function deviceType(ua = '') {
  if (/ipad|tablet/i.test(ua)) return 'Tablet';
  if (/mobi|android|iphone/i.test(ua)) return 'Mobile';
  return 'Desktop';
}
function osName(ua = '') {
  if (/iphone|ipad|ios/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
function newId() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.randomBytes(6)].map(b => abc[b % abc.length]).join('');
}
function validTarget(u) {
  try { const x = new URL(String(u).trim()); return ['http:', 'https:'].includes(x.protocol) ? x.href : null; }
  catch { return null; }
}
const cleanName = n => String(n || '').trim().slice(0, 60);
const dayKey = (t, tz) => new Date(t - tz * 6e4).toISOString().slice(0, 10);
// Catch errors in async routes so one bad request never breaks the app
const h = fn => (req, res, next) => fn(req, res, next).catch(err => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Server error: ' + err.message });
});

const app = express();
app.set('trust proxy', true);
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));   // on Vercel, public/ is served by the CDN instead

// ---------- 1. Scanning: every trackable QR points to /s/<id> ----------
async function recordScan(req, res, qr) {
  const ua = req.headers['user-agent'] || '';
  const fingerprint = sha(clientIp(req) + '|' + ua);   // raw IP is never stored
  // Unique person = long-lived cookie; if cookies are blocked, fall back to hashed IP + device
  let vid = req.cookies.qr_vid;
  if (!vid) {
    vid = (await store.visitorForFingerprint(fingerprint).catch(() => null)) || crypto.randomUUID();
    res.cookie('qr_vid', vid, { maxAge: 1000 * 60 * 60 * 24 * 365 * 2, httpOnly: true, sameSite: 'lax' });
  }
  try {
    await store.addScan({ t: Date.now(), qr: qr.id, vid, fp: fingerprint, device: deviceType(ua), os: osName(ua) });
  } catch (e) { console.error('Could not save scan:', e.message); }   // still send the person on
  res.set('Cache-Control', 'no-store');
  res.redirect(302, qr.target);
}

app.get('/s/:id', h(async (req, res) => {
  const qr = await store.getQr(req.params.id);
  if (!qr) return res.status(404).send('This QR code is no longer active.');
  await recordScan(req, res, qr);
}));

app.get('/scan', h(async (req, res) => {   // old link from the first version
  const qr = await store.firstQr();
  if (!qr) return res.redirect(302, LEGACY_TARGET);
  await recordScan(req, res, qr);
}));

// Trackable QR image (this is the one to print)
app.get('/qr/:file', h(async (req, res) => {
  const qr = await store.getQr(req.params.file.replace(/\.png$/, ''));
  if (!qr) return res.status(404).end();
  const width = Math.min(Math.max(parseInt(req.query.w) || 800, 120), 2000);
  res.type('png');
  if (req.query.download) res.attachment(`${qr.name.replace(/[^\w-]+/g, '-') || 'qr'}-trackable.png`);
  res.send(await QRCode.toBuffer(scanUrl(qr, req), { width, margin: 2, errorCorrectionLevel: 'M' }));
}));

// ---------- 2. Admin API (password protected) ----------
function auth(req, res, next) {
  const key = req.headers['x-dashboard-key'] || req.query.key;
  if (key === DASHBOARD_PASSWORD) return next();
  res.status(401).json({ error: 'Wrong or missing password' });
}

app.get('/api/info', auth, (req, res) => {
  const base = baseUrl(req);
  res.json({ base, local: /\/\/(localhost|127\.|\[?::1)/.test(base), fixed: !!PUBLIC_URL, storage: store.kind,
    vercelWithoutDb: !!process.env.VERCEL && store.kind === 'file' });
});

app.get('/api/qrs', auth, h(async (req, res) => {
  const tz = parseInt(req.query.tz) || 0;
  const today = dayKey(Date.now(), tz);
  const [qrs, scans] = await Promise.all([store.listQrs(), store.scans()]);
  const per = {};
  for (const s of scans) {
    const p = (per[s.qr] ||= { total: 0, people: new Set(), today: new Set(), last: 0 });
    p.total++; p.people.add(s.vid); p.last = Math.max(p.last, s.t);
    if (dayKey(s.t, tz) === today) p.today.add(s.vid);
  }
  res.json(qrs.map(q => {
    const p = per[q.id];
    return { ...q, scanUrl: scanUrl(q, req), total: p?.total || 0, unique: p?.people.size || 0,
      todayUnique: p?.today.size || 0, lastScan: p?.last || null };
  }));
}));

app.post('/api/qrs', auth, h(async (req, res) => {
  const target = validTarget(req.body.target);
  if (!target) return res.status(400).json({ error: 'Only QR codes that contain a website link (http/https) can be tracked.' });
  const qr = { id: newId(), name: cleanName(req.body.name) || new URL(target).hostname, target, created: Date.now() };
  if (typeof req.body.original === 'string' && req.body.original.startsWith('data:image/') && req.body.original.length < 300000)
    qr.original = req.body.original;
  await store.addQr(qr);
  res.json({ ...qr, scanUrl: scanUrl(qr, req) });
}));

app.patch('/api/qrs/:id', auth, h(async (req, res) => {
  if (!(await store.getQr(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const changes = {};
  if (req.body.name !== undefined && cleanName(req.body.name)) changes.name = cleanName(req.body.name);
  if (req.body.target !== undefined) {
    const t = validTarget(req.body.target);
    if (!t) return res.status(400).json({ error: 'Please enter a full link starting with http:// or https://' });
    changes.target = t;
  }
  res.json(await store.updateQr(req.params.id, changes));
}));

app.delete('/api/qrs/:id', auth, h(async (req, res) => {
  await store.deleteQr(req.params.id);
  res.json({ ok: true });
}));

app.get('/api/stats', auth, h(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
  const tz = parseInt(req.query.tz) || 0;    // browser's getTimezoneOffset(), so days match your local time
  const id = req.query.qr || 'all';
  const [qrs, all] = await Promise.all([store.listQrs(), store.scans(id === 'all' ? null : id)]);
  const names = Object.fromEntries(qrs.map(q => [q.id, q.name]));
  const since = Date.now() - days * 864e5;
  const recent = all.filter(s => s.t >= since);

  const firstSeen = new Map();
  for (const s of all) { const k = s.qr + '|' + s.vid; if (!firstSeen.has(k)) firstSeen.set(k, s.t); }
  const isFirst = s => firstSeen.get(s.qr + '|' + s.vid) === s.t;

  const daily = {};
  for (let i = days - 1; i >= 0; i--) daily[dayKey(Date.now() - i * 864e5, tz)] = { total: 0, unique: new Set() };
  const count = (o, k) => (o[k] = (o[k] || 0) + 1);
  const devices = {}, oses = {}, byQr = {}, hours = Array(24).fill(0);
  for (const s of recent) {
    const d = daily[dayKey(s.t, tz)];
    if (d) { d.total++; d.unique.add(s.vid); }
    count(devices, s.device); count(oses, s.os); count(byQr, names[s.qr] || s.qr);
    hours[new Date(s.t - tz * 6e4).getUTCHours()]++;
  }
  const todayKey = dayKey(Date.now(), tz);
  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  res.json({
    allTime: { total: all.length, unique: new Set(all.map(s => s.vid)).size },
    period: { days, total: recent.length, unique: new Set(recent.map(s => s.vid)).size },
    today: { total: daily[todayKey]?.total || 0, unique: daily[todayKey]?.unique.size || 0 },
    daily: Object.entries(daily).map(([date, v]) => ({ date, total: v.total, unique: v.unique.size })),
    devices, oses, hours, byQr,
    history: all.slice(-limit).reverse().map(s => ({ t: s.t, qr: names[s.qr] || s.qr, device: s.device, os: s.os, repeat: !isFirst(s) })),
    historyTotal: all.length,
  });
}));

app.get('/api/export.csv', auth, h(async (req, res) => {
  const id = req.query.qr || 'all';
  const [qrs, rows] = await Promise.all([store.listQrs(), store.scans(id === 'all' ? null : id)]);
  const names = Object.fromEntries(qrs.map(q => [q.id, q.name]));
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  res.type('text/csv').attachment('qr-scans.csv');
  res.send('time,qr_name,visitor,device,os\n' +
    rows.map(s => [new Date(s.t).toISOString(), esc(names[s.qr] || s.qr), s.vid, s.device, s.os].join(',')).join('\n'));
}));

// ---------- 3. Pages ----------
app.get(['/', '/dashboard'], (req, res) => {
  const i = req.originalUrl.indexOf('?');
  res.redirect('/dashboard.html' + (i >= 0 ? req.originalUrl.slice(i) : ''));
});

module.exports = app;   // Vercel uses this

if (require.main === module) {   // `npm start` on your own computer
  app.listen(PORT, () => {
    console.log(`QR tracker running on port ${PORT}  (storage: ${store.kind}, password: ${DASHBOARD_PASSWORD === 'admin123' ? 'admin123 — change it!' : 'set'})`);
    if (PUBLIC_URL) return console.log(`  Dashboard: ${PUBLIC_URL}/dashboard`);
    const lan = Object.values(require('os').networkInterfaces()).flat()
      .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
    console.log(`  On this computer:          http://localhost:${PORT}/dashboard`);
    for (const ip of lan) console.log(`  For phone testing (Wi-Fi): http://${ip}:${PORT}/dashboard   <- open THIS one, then download the QR`);
  });
}
