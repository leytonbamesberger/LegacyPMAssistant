function mockRes(label) {
  const res = {
    _status: 200,
    _headers: {},
    headersSent: false,
    setHeader(k, v) { this._headers[k] = v; },
    status(code) { this._status = code; return this; },
    json(body) { this.headersSent = true; console.log(`[${label}] JSON`, this._status, JSON.stringify(body)); return this; },
    redirect(status, url) {
      if (typeof status === 'string') { url = status; status = 302; }
      this.headersSent = true;
      console.log(`[${label}] REDIRECT`, status, url);
      return this;
    },
    send(body) { this.headersSent = true; console.log(`[${label}] SEND`, this._status, body); return this; },
  };
  return res;
}

async function run(label, modPath, req) {
  try {
    const mod = require(modPath);
    const handler = mod.default || mod;
    const res = mockRes(label);
    await handler(req, res);
  } catch (err) {
    console.log(`[${label}] THREW ->`, err && err.stack || err);
  }
}

(async () => {
  await run('profile-no-auth', './api_profile.cjs', { method: 'POST', headers: {}, query: {}, url: '/api/profile' });
  await run('procore-status-no-auth', './api_procore_status.cjs', { method: 'GET', headers: {}, query: {}, url: '/api/procore/status' });
  await run('procore-authorize-no-auth', './api_procore_authorize.cjs', { method: 'POST', headers: {}, query: {}, url: '/api/procore/authorize' });
  await run('procore-callback-empty', './api_procore_callback.cjs', { method: 'GET', headers: { host: 'legacy-pm.vercel.app' }, query: {}, url: '/api/procore/callback' });
  await run('procore-disconnect-no-auth', './api_procore_disconnect.cjs', { method: 'POST', headers: {}, query: {}, url: '/api/procore/disconnect' });
})();
