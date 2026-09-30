'use strict';
// KBC "Moments, not offers" - proof of concept. Zero dependencies. Synthetic data only.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const GENERATED_PW = !process.env.DEMO_PASSWORD;
const PASSWORD = process.env.DEMO_PASSWORD || crypto.randomBytes(6).toString('hex');
const DAYS = 90, RECENT = 60, THRESHOLD = 0.6, MAX_PER_MONTH = 2, COUNT = 60;

// ---------- 1. Synthetic customers (no real data) ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const NAMES = ['Sarah', 'Tom', 'Lina', 'Noah', 'Emma', 'Lucas', 'Mila', 'Finn', 'Zoe', 'Arthur', 'Nora', 'Jules'];
const SCRIPT = ['move', 'baby', 'jobloss', 'firstsalary', 'move', 'baby']; // c001..c006 are the demo story

function genCustomer(i) {
  const r = mulberry32(1000 + i), tx = [];
  const add = (day, amount, cat, merchant) => tx.push({ day, amount: Math.round(amount * 100) / 100, cat, merchant });
  const id = 'c' + String(i + 1).padStart(3, '0');
  const name = i < NAMES.length ? NAMES[i] : NAMES[i % NAMES.length] + ' ' + String.fromCharCode(65 + i % 26) + '.';
  const scenario = i < 6 ? SCRIPT[i] : (['move', 'baby', 'jobloss'][i % 10] || 'none');
  const consent = i === 4 ? false : i < 6 ? true : i % 7 !== 3;
  const sentThisMonth = (i === 5 || (i >= 6 && i % 11 === 5)) ? 2 : 0;
  const age = scenario === 'firstsalary' ? 22 : 26 + Math.floor(r() * 35);
  const salary = 1800 + Math.floor(r() * 2000);
  for (let d = 5; d < DAYS; d += 30) {
    if (scenario === 'firstsalary' && d < RECENT) add(d, 200, 'transfer', 'Family transfer');
    else if (!(scenario === 'jobloss' && d >= RECENT)) add(d, salary, 'salary', 'Employer');
  }
  for (let d = 1; d < DAYS; d += 30) add(d, -(600 + Math.floor(r() * 500)), 'rent', 'Landlord');
  for (let d = 10; d < DAYS; d += 30) add(d, -(80 + Math.floor(r() * 60)), 'utilities', 'Energy co.');
  for (let d = 0; d < DAYS; d += 3) add(d, -(20 + r() * 70), 'groceries', 'Supermarket');
  for (let d = 2; d < DAYS; d += 7) add(d, -(15 + r() * 25), 'transport', 'Transit');
  for (let d = 0; d < DAYS; d++) if (r() < 0.2) add(d, -(10 + r() * 40), 'dining', 'Restaurant');
  if (scenario === 'move') { add(63, -350, 'movers', 'Moving company'); [64, 66, 70, 75].forEach(d => add(d, -(120 + r() * 280), 'furniture', 'Furniture store')); }
  if (scenario === 'baby') [62, 65, 68, 74, 80].forEach(d => add(d, -(30 + r() * 90), 'baby', 'Baby store'));
  if (scenario === 'none' && i % 4 === 1) add(75, -150, 'furniture', 'Furniture store'); // weak signal, must stay quiet
  tx.sort((a, b) => a.day - b.day);
  return { id, name, age, consent, sentThisMonth, tx };
}
const CUSTOMERS = new Map();
for (let i = 0; i < COUNT; i++) { const c = genCustomer(i); CUSTOMERS.set(c.id, c); }

// ---------- 2. Moment detectors: cheap, deterministic, explainable ----------
const n = (tx, win, cat) => tx.filter(t => t.cat === cat && (win === 'recent' ? t.day >= RECENT : t.day < RECENT)).length;
const cap = x => Math.min(0.95, Math.round(x * 100) / 100);
const DETECTORS = {
  move(tx) {
    const m = n(tx, 'recent', 'movers'), f = n(tx, 'recent', 'furniture');
    if (!m && !f) return null;
    const ev = []; if (m) ev.push(m + ' moving-company payment'); if (f) ev.push(f + ' furniture purchase(s) in the last 30 days');
    return { confidence: cap(0.2 + (m ? 0.4 : 0) + 0.15 * Math.min(f, 3)), evidence: ev };
  },
  baby(tx) {
    const b = n(tx, 'recent', 'baby'); if (!b) return null;
    return { confidence: b >= 2 ? cap(0.5 + 0.1 * Math.min(b, 5)) : 0.3, evidence: [b + ' baby-store purchase(s) in the last 30 days'] };
  },
  jobloss(tx) {
    const before = n(tx, 'prior', 'salary');
    if (before < 2 || n(tx, 'recent', 'salary') > 0) return null;
    return { confidence: 0.85, evidence: ['No salary deposit in the last 30 days (' + before + ' in the 60 days before)'] };
  },
  firstsalary(tx, c) {
    if (c.age >= 26 || n(tx, 'prior', 'salary') > 0 || n(tx, 'recent', 'salary') < 1) return null;
    return { confidence: 0.9, evidence: ['First salary deposit received, none before'] };
  }
};

// What to do per moment. Customer-safe wording only: no product push on sensitive moments.
const PLAYBOOK = {
  move: { title: 'Settling into a new home?', body: 'Moving is a lot. We can update your address, check your home insurance and set up your energy and internet payments in one go.', cta: 'Sort it in the app', channel: 'app', why: 'We noticed payments that are typical when moving, such as movers and furniture.' },
  baby: { title: 'Making room for someone new?', body: 'Whenever you are ready, we can look at a child savings account and review your insurance. No rush.', cta: 'Take a look', channel: 'app', why: 'We noticed several purchases in baby stores.' },
  jobloss: { title: 'How are things going?', body: 'If your income has changed, a KBC advisor can talk through your options with you. No obligation, no sales pitch.', cta: 'Request a call', channel: 'advisor', why: 'Your usual income deposit has not arrived this month.' },
  firstsalary: { title: 'Your first salary!', body: 'A good moment to set up a simple budget and a small monthly savings goal. It takes two minutes.', cta: 'Set it up', channel: 'app', why: 'We noticed your first salary payment.' }
};

// ---------- 3. Decision layer: consent -> detect -> threshold -> dismissals -> contact budget ----------
const dismissed = new Map(); // customerId -> Set(moment)
const wrongBy = new Map();   // moment -> Set(customerId): one vote per customer, so tuning can't be spammed
const penalty = m => Math.min(0.2, 0.05 * (wrongBy.get(m) ? wrongBy.get(m).size : 0));

function decide(c) {
  if (!c.consent) return { status: 'quiet', reason: 'No personalisation consent: nothing is analysed or shown.' };
  const found = Object.keys(DETECTORS).map(m => {
    const r = DETECTORS[m](c.tx, c); if (!r) return null;
    return { moment: m, confidence: Math.max(0, Math.round((r.confidence - penalty(m)) * 100) / 100), evidence: r.evidence };
  }).filter(Boolean).sort((a, b) => b.confidence - a.confidence);
  const top = found[0];
  if (!top) return { status: 'quiet', reason: 'No life moment detected.' };
  const sig = { moment: top.moment, confidence: top.confidence, evidence: top.evidence };
  if (top.confidence < THRESHOLD) return { status: 'quiet', reason: 'Weak signal below threshold (' + THRESHOLD + '): staying quiet.', ...sig };
  if (dismissed.has(c.id) && dismissed.get(c.id).has(top.moment)) return { status: 'quiet', reason: 'Customer dismissed this moment: not shown again.', ...sig };
  if (c.sentThisMonth >= MAX_PER_MONTH) return { status: 'quiet', reason: 'Monthly contact budget reached: waiting.', ...sig };
  return { status: 'act', ...sig };
}
function customerView(c) {
  const d = decide(c);
  if (d.status !== 'act') return { name: c.name, status: 'quiet', message: 'Nothing new for you right now. We only get in touch when it can really help.' };
  const p = PLAYBOOK[d.moment];
  return { name: c.name, status: 'act', card: { title: p.title, body: p.body, cta: p.cta, why: p.why } };
}
function advisorRow(c) {
  const d = decide(c);
  return { id: c.id, name: c.name, status: d.status, moment: d.moment || null, confidence: d.confidence == null ? null : d.confidence, evidence: d.evidence || [], channel: d.status === 'act' ? PLAYBOOK[d.moment].channel : null, reason: d.reason || null };
}

// ---------- 4. HTTP, auth, security ----------
const sessions = new Map(), attempts = new Map();
const readPublic = f => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');
const STATIC = { '/': [readPublic('index.html'), 'text/html; charset=utf-8'], '/app.js': [readPublic('app.js'), 'text/javascript; charset=utf-8'] };

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 10000) tooBig = true; else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return reject(new Error('too large'));
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
function auth(req) {
  const h = req.headers['authorization'] || '';
  const s = h.startsWith('Bearer ') ? sessions.get(h.slice(7)) : null;
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(h.slice(7)); return null; }
  return s;
}
async function login(req, res) {
  const ip = req.socket.remoteAddress || '?', now = Date.now();
  let a = attempts.get(ip); if (!a || a.reset < now) { a = { n: 0, reset: now + 60000 }; attempts.set(ip, a); }
  if (a.n >= 10) return send(res, 429, { error: 'Too many attempts, try again in a minute' });
  const b = await readBody(req);
  const u = typeof b.username === 'string' ? b.username : '';
  const pwOk = safeEq(typeof b.password === 'string' ? b.password : '', PASSWORD);
  const isAdv = u === 'advisor', cust = CUSTOMERS.get(u);
  if (!pwOk || (!isAdv && !cust)) { a.n++; return send(res, 401, { error: 'Invalid credentials' }); }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role: isAdv ? 'advisor' : 'customer', customerId: isAdv ? null : cust.id, exp: now + 3600000 });
  send(res, 200, { token, role: isAdv ? 'advisor' : 'customer', name: isAdv ? 'Advisor' : cust.name });
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && STATIC[p]) return send(res, 200, STATIC[p][0], STATIC[p][1]);
    if (!p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method === 'POST' && p === '/api/login') return await login(req, res);
    const s = auth(req);
    if (!s) return send(res, 401, { error: 'Unauthorized' });

    if (p.startsWith('/api/me/')) { // customer-only; identity comes from the session, never from the request
      if (s.role !== 'customer') return send(res, 403, { error: 'Forbidden' });
      const c = CUSTOMERS.get(s.customerId);
      if (req.method === 'GET' && p === '/api/me/moment') return send(res, 200, customerView(c));
      if (req.method === 'POST' && p === '/api/me/feedback') {
        const b = await readBody(req);
        if (b.kind !== 'dismiss' && b.kind !== 'wrong') return send(res, 400, { error: 'Invalid kind' });
        const d = decide(c);
        if (d.status !== 'act') return send(res, 409, { error: 'Nothing to respond to' });
        if (!dismissed.has(c.id)) dismissed.set(c.id, new Set());
        dismissed.get(c.id).add(d.moment);
        if (b.kind === 'wrong') { if (!wrongBy.has(d.moment)) wrongBy.set(d.moment, new Set()); wrongBy.get(d.moment).add(c.id); }
        return send(res, 200, { ok: true });
      }
    }
    if (p.startsWith('/api/advisor/')) {
      if (s.role !== 'advisor') return send(res, 403, { error: 'Forbidden' });
      if (req.method === 'GET' && p === '/api/advisor/customers') {
        const rows = [...CUSTOMERS.values()].map(advisorRow).sort((a, b) => (b.status === 'act') - (a.status === 'act') || (b.confidence || 0) - (a.confidence || 0));
        const penalties = {}; Object.keys(DETECTORS).forEach(m => { penalties[m] = penalty(m); });
        return send(res, 200, { customers: rows, stats: { customers: rows.length, acted: rows.filter(r => r.status === 'act').length, penalties } });
      }
      if (req.method === 'POST' && p === '/api/advisor/reset') { dismissed.clear(); wrongBy.clear(); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    const code = e.message === 'too large' ? 413 : e.message === 'bad json' ? 400 : 500;
    send(res, code, { error: code === 500 ? 'Server error' : e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('KBC Moments running on http://' + HOST + ':' + PORT);
    console.log('Usernames: c001..c060 (customers) or advisor');
    if (GENERATED_PW) console.log('Demo password for this run: ' + PASSWORD + '  (set DEMO_PASSWORD to choose your own)');
  });
}
module.exports = { server };
