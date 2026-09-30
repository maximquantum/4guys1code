'use strict';
process.env.DEMO_PASSWORD = 'test-password';
const assert = require('assert');
const { server } = require('./server');
server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (m, p, tok, body) => {
    const r = await fetch(base + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  const login = async u => (await call('POST', '/api/login', null, { username: u, password: 'test-password' })).json.token;
  try {
    assert.strictEqual((await call('GET', '/api/me/moment')).status, 401);
    assert.strictEqual((await call('POST', '/api/login', null, { username: 'c001', password: 'nope' })).status, 401);
    const t1 = await login('c001'), adv = await login('advisor');
    let m = (await call('GET', '/api/me/moment?id=c002', t1)).json; // IDOR attempt: id must be ignored
    assert.strictEqual(m.name, 'Sarah'); assert.strictEqual(m.status, 'act'); assert.ok(m.card.title.includes('new home'));
    assert.strictEqual((await call('GET', '/api/advisor/customers', t1)).status, 403);
    assert.strictEqual((await call('GET', '/api/me/moment', adv)).status, 403);
    assert.strictEqual((await call('GET', '/api/me/moment', await login('c003'))).json.card.title, 'How are things going?');
    assert.strictEqual((await call('GET', '/api/me/moment', await login('c004'))).json.status, 'act');
    assert.strictEqual((await call('GET', '/api/me/moment', await login('c005'))).json.status, 'quiet');
    const rows = (await call('GET', '/api/advisor/customers', adv)).json.customers, by = id => rows.find(r => r.id === id);
    assert.ok(by('c005').reason.includes('consent')); assert.strictEqual(by('c005').moment, null);
    assert.strictEqual(by('c006').status, 'quiet'); assert.strictEqual(by('c006').moment, 'baby'); assert.ok(by('c006').reason.includes('budget'));
    assert.strictEqual(by('c004').moment, 'firstsalary'); assert.strictEqual(by('c003').channel, 'advisor');
    assert.strictEqual(by('c010').status, 'quiet'); assert.ok(by('c010').reason.includes('Weak'));
    assert.strictEqual((await call('POST', '/api/me/feedback', t1, { kind: 'wrong' })).status, 200);
    assert.strictEqual((await call('GET', '/api/me/moment', t1)).json.status, 'quiet');
    assert.strictEqual((await call('GET', '/api/advisor/customers', adv)).json.stats.penalties.move, 0.05);
    assert.strictEqual((await call('POST', '/api/advisor/reset', adv, {})).status, 200);
    assert.strictEqual((await call('GET', '/api/me/moment', t1)).json.status, 'act');
    console.log('All checks passed'); server.close();
  } catch (e) { console.error(e); server.close(); process.exit(1); }
});
