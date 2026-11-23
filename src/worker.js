const CORE_ONLY = { claude: 1 };
const WEIGHT = { openai: 0.71, gemini: 0.19, claude: 0.07, perplexity: 0.03 };

const ENGINES = ['openai', 'perplexity', 'gemini', 'claude'];
const KEYNAME = { openai: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY' };
const LABEL = { sol: 'ChatGPT paid (Sol)', luna: 'ChatGPT (Luna test)', flashlite: 'Gemini (Flash-Lite test)', openai54: 'ChatGPT (gpt-5.4 test)', openai: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini', claude: 'Claude' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function usageOf(u) { u = u || {}; return { inp: u.input_tokens || u.prompt_tokens || 0, out: u.output_tokens || u.completion_tokens || 0, s: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0, cached: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || u.cache_read_input_tokens || 0, reason: (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0 }; }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function cite(url, domain) { return { url: url || '', domain: (domain || domainOf(url) || '').replace(/^www\./, '').toLowerCase() }; }

async function postJSON(url, headers, body, name) {
  const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (e) { throw new Error(name + ' ' + r.status + ' not JSON: ' + t.slice(0, 200)); }
  if (!r.ok) throw new Error(name + ' ' + r.status + ' ' + t.slice(0, 300));
  return j;
}

const ASK = {
  openai: async function (env, q) {
    const model = env.OPENAI_MODEL || 'gpt-5.5';
    const effort = env.OPENAI_EFFORT || 'low';
    const maxCalls = parseInt(env.OPENAI_MAX_SEARCHES || '3', 10) || 0;
    const j = await postJSON('https://api.openai.com/v1/responses', { authorization: 'Bearer ' + env.OPENAI_API_KEY }, Object.assign({ model: model, input: q, tools: [{ type: 'web_search' }] }, effort ? { reasoning: { effort: effort } } : {}, maxCalls ? { max_tool_calls: maxCalls } : {}), 'openai');
    let text = '', cites = [];
    for (const it of (j.output || [])) if (it.type === 'message') for (const c of (it.content || [])) if (c.type === 'output_text') { text += c.text || ''; for (const a of (c.annotations || [])) if (a.url) cites.push(cite(a.url)); }
    if (!text && j.output_text) text = j.output_text;
    const nSearch = (j.output || []).filter(function (it) { return it.type === 'web_search_call'; }).length;
    const u = j.usage || {};
    return { text: text, cites: cites, model: (j.model || model) + (effort ? ' effort ' + effort : '') + (maxCalls ? ' max ' + maxCalls : ''), usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, input_tokens_details: u.input_tokens_details, output_tokens_details: u.output_tokens_details, server_tool_use: { web_search_requests: nSearch } } };
  },
  perplexity: async function (env, q) {
    const effort = env.PERPLEXITY_EFFORT || 'low';
    const j = await postJSON('https://api.perplexity.ai/v1/agent', { authorization: 'Bearer ' + env.PERPLEXITY_API_KEY }, { input: q, effort: effort }, 'perplexity');
    let text = '', ann = [];
    const byId = {}, order = [];
    function addResults(list) { for (const r of (list || [])) { if (!r || !r.url) continue; const id = r.id == null ? null : String(r.id); if (id !== null && !(id in byId)) byId[id] = r.url; order.push(r.url); } }
    for (const it of (j.output || [])) {
      if (it.type === 'message') for (const c of (it.content || [])) if (c.type === 'output_text') { text += c.text || ''; for (const x of (c.annotations || [])) if (x.url) ann.push(x.url); }
      if (it.type === 'search_results') addResults(it.results);
    }
    if (!order.length) addResults(j.search_results);
    if (!text && j.output_text) text = j.output_text;
    // Count only sources the answer actually cites: markers like [web:3], [3] or [web:1, web:4]
    const used = {}, cites = [];
    const re = /\[((?:\s*(?:web:)?\d+\s*,?)+)\]/g; let m;
    while ((m = re.exec(text))) { const ids = m[1].match(/\d+/g) || []; for (const id of ids) { const u = byId[id]; if (u && !used[u]) { used[u] = 1; cites.push(cite(u)); } } }
    for (const u of ann) if (!used[u]) { used[u] = 1; cites.push(cite(u)); }
    const u = j.usage || {};
    return { text: text, cites: cites, model: (j.model || 'perplexity') + ' effort ' + effort, usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, server_tool_use: { web_search_requests: Object.keys(byId).length ? (j.output || []).filter(function (it) { return it.type === 'search_results'; }).length : 0 } } };
  },
  gemini: async function (env, q) {
    const model = env.GEMINI_MODEL || 'gemini-3.5-flash';
    const j = await postJSON('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', { 'x-goog-api-key': env.GEMINI_API_KEY }, { contents: [{ parts: [{ text: q }] }], tools: [{ google_search: {} }], generationConfig: { thinkingConfig: { thinkingLevel: env.GEMINI_THINKING || 'low' } } }, 'gemini');
    const cand = (j.candidates || [])[0] || {};
    const text = ((cand.content || {}).parts || []).map(function (p) { return p.text || ''; }).join('');
    const chunks = ((cand.groundingMetadata || {}).groundingChunks || []);
    const cites = chunks.filter(function (c) { return c.web; }).map(function (c) { return cite(c.web.uri, c.web.domain || c.web.title); });
    const um = j.usageMetadata || {}; const gm = cand.groundingMetadata || {};
    return { text: text, cites: cites, model: j.modelVersion || model, usage: { input_tokens: (um.promptTokenCount || 0) + (um.toolUsePromptTokenCount || 0), output_tokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0), server_tool_use: { web_search_requests: (gm.webSearchQueries || []).length } } };
  },
  claude: async function (env, q) {
    const model = env.CLAUDE_MODEL || 'claude-sonnet-5-5';
    const j = await postJSON('https://api.anthropic.com/v1/messages', { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, { model: model, max_tokens: 2000, messages: [{ role: 'user', content: q }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }, 'claude');
    let text = '', cites = [];
    for (const b of (j.content || [])) if (b.type === 'text') { text += b.text || ''; for (const c of (b.citations || [])) if (c.url) cites.push(cite(c.url)); }
    return { text: text, cites: cites, model: j.model || model, usage: j.usage || {} };
  }
};

async function extractBrands(env, category, text) {
  const sys = 'You read an answer that an AI assistant gave to a business buyer asking about superyacht suppliers in one product category. List every company or brand the answer puts forward as a supplier, manufacturer or service provider in that category, in the order they first appear. Use the brand name as written, without legal suffixes such as Ltd, GmbH or S.r.l. Do not list shipyards, yachts, magazines, websites or AI tools unless the answer presents them as suppliers in this category. Reply with JSON only and no other words, starting with { and ending with }, even when there are no brands ({"brands": []}), in the form {"brands": ["Name", "Name"]}.';
  const j = await postJSON('https://api.anthropic.com/v1/messages', { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, { model: env.EXTRACT_MODEL || 'claude-haiku-5-5', max_tokens: 2500, system: sys, messages: [{ role: 'user', content: 'Category: ' + category + '\n\nAnswer:\n' + text.slice(0, 14000) }] }, 'extract');
  const t = (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('extract: no JSON in reply');
  const o = JSON.parse(m[0]);
  const out = Array.isArray(o.brands) ? o.brands.filter(function (x) { return typeof x === 'string' && x.trim(); }) : [];
  out.usage = j.usage || {};
  return out;
}

function matchBrand(brands, raw) {
  const n = norm(raw); if (!n) return null;
  for (const b of brands) {
    let names = [b.name]; try { names = names.concat(JSON.parse(b.aliases || '[]')); } catch (e) {}
    for (const nm of names) {
      const k = norm(nm); if (!k) continue;
      if (k === n) return b.id;
      if (k.length >= 4 && n.length >= 4 && (n.indexOf(k) === 0 || k.indexOf(n) === 0)) return b.id;
    }
  }
  return null;
}

ASK.openai54 = function (env, q) { return ASK.openai(Object.assign({}, env, { OPENAI_MODEL: 'gpt-5.4' }), q); };
ASK.sol = function (env, q) { return ASK.openai(Object.assign({}, env, { OPENAI_MODEL: env.SOL_MODEL || 'gpt-5.6-sol' }), q); };
ASK.luna = function (env, q) { return ASK.openai(Object.assign({}, env, { OPENAI_MODEL: 'gpt-5.6-luna' }), q); };
ASK.flashlite = function (env, q) { return ASK.gemini(Object.assign({}, env, { GEMINI_MODEL: 'gemini-3.5-flash-lite' }), q); };

async function processJob(env, job) {
  const claimed = await env.DB.prepare("UPDATE jobs SET status='running', attempts=attempts+1, updated_at=datetime('now') WHERE id=? AND status='pending'").bind(job.id).run();
  if (!claimed.meta.changes) return;
  try {
    const p = await env.DB.prepare('SELECT p.text, p.category_id, c.name AS cname FROM prompts p JOIN categories c ON c.id = p.category_id WHERE p.id = ?').bind(job.prompt_id).first();
    const res = await ASK[job.engine](env, p.text);
    if (!res.text || !res.text.trim()) throw new Error(job.engine + ': empty answer');
    const names = await extractBrands(env, p.cname, res.text);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM citations WHERE answer_id IN (SELECT id FROM answers WHERE job_id = ?)').bind(job.id),
      env.DB.prepare('DELETE FROM mentions WHERE answer_id IN (SELECT id FROM answers WHERE job_id = ?)').bind(job.id),
      env.DB.prepare('DELETE FROM answers WHERE job_id = ?').bind(job.id)
    ]);
    const U = usageOf(res.usage), X = usageOf(names.usage);
    const ins = await env.DB.prepare('INSERT INTO answers (job_id, run_id, prompt_id, engine, model, text, in_tok, out_tok, searches, x_in, x_out, cached_tok, reason_tok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(job.id, job.run_id, job.prompt_id, job.engine, res.model || '', res.text, U.inp, U.out, U.s, X.inp, X.out, U.cached, U.reason).run();
    const aid = ins.meta.last_row_id;
    const stmts = [];
    const seenUrl = {};
    for (const c of res.cites) { if (!c.url || seenUrl[c.url]) continue; seenUrl[c.url] = 1; stmts.push(env.DB.prepare('INSERT INTO citations (answer_id, run_id, url, domain) VALUES (?,?,?,?)').bind(aid, job.run_id, c.url, c.domain)); }
    const brands = (await env.DB.prepare('SELECT id, name, aliases FROM brands WHERE category_id = ?').bind(p.category_id).all()).results;
    const used = {}; let pos = 0;
    for (const raw of names) {
      const nn = norm(raw); if (!nn || used['n' + nn]) continue; used['n' + nn] = 1;
      const bid = matchBrand(brands, raw);
      if (bid && used['b' + bid]) continue;
      if (bid) used['b' + bid] = 1;
      pos++;
      stmts.push(env.DB.prepare('INSERT INTO mentions (answer_id, run_id, engine, brand_id, raw_name, position, norm) VALUES (?,?,?,?,?,?,?)').bind(aid, job.run_id, job.engine, bid, raw.trim(), pos, nn));
      if (!bid) stmts.push(env.DB.prepare('INSERT INTO candidates (category_id, norm, raw_name) VALUES (?,?,?) ON CONFLICT(category_id, norm) DO UPDATE SET seen = seen + 1').bind(p.category_id, nn, raw.trim()));
    }
    stmts.push(env.DB.prepare("UPDATE jobs SET status='done', error=NULL, updated_at=datetime('now') WHERE id=?").bind(job.id));
    await env.DB.batch(stmts);
  } catch (e) {
    const emsg = String((e && e.message) || e).slice(0, 500);
    if (/ 429 /.test(emsg) || /location is not supported/i.test(emsg)) await env.DB.prepare("UPDATE jobs SET status = 'pending', attempts = MAX(attempts - 1, 0), error = ?, updated_at = datetime('now') WHERE id = ?").bind(emsg, job.id).run();
    else await env.DB.prepare("UPDATE jobs SET status = CASE WHEN attempts >= 3 THEN 'error' ELSE 'pending' END, error = ?, updated_at = datetime('now') WHERE id = ?").bind(emsg, job.id).run();
  }
}

async function tick(env, n) {
  const active = await env.DB.prepare("SELECT id FROM runs WHERE status = 'running' LIMIT 1").first();
  if (!active) return 0;
  await env.DB.prepare("UPDATE jobs SET status='pending' WHERE status='running' AND updated_at < datetime('now','-10 minutes')").run();
  const jobs = (await env.DB.prepare("SELECT * FROM jobs WHERE status='pending' ORDER BY id LIMIT ?").bind(n).all()).results;
  await Promise.all(jobs.map(function (j) { return processJob(env, j); }));
  await env.DB.prepare("UPDATE runs SET status='done' WHERE status='running' AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.run_id = runs.id AND jobs.status IN ('pending','running'))").run();
  return jobs.length;
}

async function createRun(env, cat, limit, label) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is needed: it is also used to recognise brands.');
  const engines = ENGINES.filter(function (e) { return env[KEYNAME[e]]; });
  const prompts = (await env.DB.prepare('SELECT id, core FROM prompts WHERE category_id = ? AND active = 1 ORDER BY n LIMIT ?').bind(cat, limit || 1000).all()).results;
  if (!prompts.length) throw new Error('No questions found for category ' + cat);
  const r = await env.DB.prepare('INSERT INTO runs (category_id, label, prompt_limit) VALUES (?,?,?)').bind(cat, label || '', prompts.length).run();
  const rid = r.meta.last_row_id;
  const stmts = [];
  for (const p of prompts) for (const e of engines) if (!CORE_ONLY[e] || p.core) stmts.push(env.DB.prepare('INSERT INTO jobs (run_id, prompt_id, engine) VALUES (?,?,?)').bind(rid, p.id, e));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return { run: rid, jobs: stmts.length, engines: engines };
}

const CSS = 'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1000px;margin:32px auto;padding:0 16px;color:#1d1d1f;line-height:1.45}table{border-collapse:collapse;width:100%;margin:10px 0 26px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e6e6e6;font-size:14px;vertical-align:top}th{background:#f5f5f5;font-weight:600}.n{text-align:right}.tag{background:#e7f1fb;color:#1a4f8b;border-radius:10px;padding:1px 8px;font-size:12px;white-space:nowrap}.muted{color:#666;font-size:13px}button{padding:6px 12px;margin:2px 4px 2px 0;cursor:pointer}form{display:inline}h1{font-size:24px;margin-bottom:4px}h2{font-size:18px;margin-top:30px}pre{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:10px;font-size:13px}.err{color:#a02020}';
function page(title, body, indexable) { return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + (indexable ? '' : '<meta name="robots" content="noindex">') + '<title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>' + body + '</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }); }

async function leagueData(env, runId) {
  const run = await env.DB.prepare('SELECT r.*, c.name AS cname FROM runs r JOIN categories c ON c.id = r.category_id WHERE r.id = ?').bind(runId).first();
  if (!run) return null;
  const tot = (await env.DB.prepare('SELECT COUNT(*) AS n FROM answers WHERE run_id = ?').bind(runId).first()).n;
  const perEngine = (await env.DB.prepare('SELECT engine, COUNT(*) AS n FROM answers WHERE run_id = ? GROUP BY engine').bind(runId).all()).results;
  const rows = (await env.DB.prepare("SELECT b.id, b.name, b.kind, b.note, b.exhibitor, b.booth, COUNT(DISTINCT m.answer_id) AS ans, SUM(CASE WHEN m.position = 1 THEN 1 ELSE 0 END) AS firsts, AVG(m.position) AS avgpos, COUNT(DISTINCT CASE WHEN m.engine='openai' THEN m.answer_id END) AS e_openai, COUNT(DISTINCT CASE WHEN m.engine='perplexity' THEN m.answer_id END) AS e_perplexity, COUNT(DISTINCT CASE WHEN m.engine='gemini' THEN m.answer_id END) AS e_gemini, COUNT(DISTINCT CASE WHEN m.engine='claude' THEN m.answer_id END) AS e_claude FROM mentions m JOIN brands b ON b.id = m.brand_id WHERE m.run_id = ? GROUP BY b.id ORDER BY ans DESC, firsts DESC, avgpos ASC").bind(runId).all()).results;
  const missing = (await env.DB.prepare('SELECT name, booth FROM brands WHERE category_id = ? AND exhibitor = 1 AND id NOT IN (SELECT DISTINCT brand_id FROM mentions WHERE run_id = ? AND brand_id IS NOT NULL) ORDER BY name').bind(run.category_id, runId).all()).results;
  const domains = (await env.DB.prepare("SELECT domain, COUNT(DISTINCT answer_id) AS n FROM citations WHERE run_id = ? AND domain <> '' GROUP BY domain ORDER BY n DESC LIMIT 15").bind(runId).all()).results;
  const unmatched = (await env.DB.prepare('SELECT COUNT(*) AS n FROM mentions WHERE run_id = ? AND brand_id IS NULL').bind(runId).first()).n;
  const nE = {}; for (const pe of perEngine) nE[pe.engine] = pe.n;
  let wsum = 0; for (const e in nE) wsum += (WEIGHT[e] || 0);
  for (const r of rows) { let s = 0; for (const e in nE) if (nE[e]) s += (WEIGHT[e] || 0) * (r['e_' + e] || 0) / nE[e]; r.score = wsum ? s / wsum : 0; }
  if (perEngine.length > 1) rows.sort(function (a, b) { return b.score - a.score || b.ans - a.ans; });
  return { run: run, tot: tot, perEngine: perEngine, rows: rows.filter(function (r) { return r.kind !== 'adjacent'; }), adjacent: rows.filter(function (r) { return r.kind === 'adjacent'; }), missing: missing, domains: domains, unmatched: unmatched };
}

function leagueTable(d, limit) {
  const rows = limit ? d.rows.slice(0, limit) : d.rows;
  let h = '<table><tr><th>#</th><th>Brand</th><th class="n">AI visibility score</th><th class="n">Answers naming it</th><th class="n">Named first</th><th class="n">Avg position</th>';
  for (const e of ENGINES) h += '<th class="n">' + LABEL[e] + '</th>';
  h += '</tr>';
  rows.forEach(function (r, i) {
    const pct = d.tot ? Math.round(100 * r.ans / d.tot) : 0;
    h += '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + (r.exhibitor ? ' <span class="tag">METSTRADE ' + esc(r.booth || '') + '</span>' : '') + '</td><td class="n"><b>' + Math.round(100 * (r.score || 0)) + '</b></td><td class="n">' + r.ans + ' (' + pct + '%)</td><td class="n">' + (r.firsts || 0) + '</td><td class="n">' + (r.avgpos ? Number(r.avgpos).toFixed(1) : '') + '</td>';
    for (const e of ENGINES) h += '<td class="n">' + (r['e_' + e] || 0) + '</td>';
    h += '</tr>';
  });
  return h + '</table><p class="muted">AI visibility score: the share of answers naming the brand on each assistant, weighted by how widely that assistant is used (ChatGPT 71%, Gemini 19%, Claude 7%, Perplexity 3%), out of 100. The four assistants cover about 95% of AI assistant use. Microsoft Copilot is not included because there is no public way to run these questions on it. Google AI Overviews cannot be queried directly, so Gemini stands in for Google.</p>';
}

function authed(req, env) {
  if (!env.ADMIN_KEY) return false;
  const h = req.headers.get('authorization') || '';
  if (h.indexOf('Basic ') !== 0) return false;
  let dec = ''; try { dec = atob(h.slice(6)); } catch (e) { return false; }
  return dec.slice(dec.indexOf(':') + 1) === env.ADMIN_KEY;
}

function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function adminPage(env, msg) {
  const runs = (await env.DB.prepare("SELECT r.id, r.category_id, r.label, r.created_at, r.status, SUM(j.status='done') AS done, SUM(j.status='pending') AS pending, SUM(j.status='running') AS running, SUM(j.status='error') AS err, COUNT(j.id) AS total FROM runs r LEFT JOIN jobs j ON j.run_id = r.id GROUP BY r.id ORDER BY r.id DESC LIMIT 20").all()).results;
  const cands = (await env.DB.prepare("SELECT * FROM candidates WHERE status = 'pending' ORDER BY seen DESC, raw_name LIMIT 100").all()).results;
  const errs = (await env.DB.prepare('SELECT id, run_id, engine, status, error FROM jobs WHERE error IS NOT NULL ORDER BY id DESC LIMIT 10').all()).results;
  const cats = (await env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  let h = '<h1>AI visibility tracker: admin</h1>';
  if (msg) h += '<p><b>' + esc(msg) + '</b></p>';
  const leads = (await env.DB.prepare('SELECT * FROM checks ORDER BY created_at DESC LIMIT 50').all()).results;
  h += '<h2>Free checks (latest ' + leads.length + ')</h2>' + (leads.length ? '<table><tr><th>When</th><th>Company</th><th>Sells</th><th>Email</th><th class="n">Named</th><th>Wants report</th><th class="n">Cost $</th></tr>' + leads.map(function (l) { return '<tr><td>' + esc(String(l.created_at).slice(0, 16)) + '</td><td><a href="/check/r/' + esc(l.id) + '">' + esc(l.company) + '</a></td><td>' + esc(l.product) + '</td><td>' + esc(l.email || '') + '</td><td class="n">' + (l.named == null ? '' : l.named + '/3') + '</td><td>' + (l.interest ? 'yes' : '') + '</td><td class="n">' + (l.cost_usd == null ? '' : l.cost_usd) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">None yet.</p>');
  let lds = []; try { lds = (await env.DB.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 50').all()).results; } catch (e) {}
  h += '<h2>Plan requests and category votes (latest ' + lds.length + ')</h2>' + (lds.length ? '<table><tr><th>When</th><th>Type</th><th>Plan or category</th><th>Company</th><th>Email</th><th>Website</th><th>Note</th></tr>' + lds.map(function (l) { return '<tr><td>' + esc(String(l.created_at).slice(0, 16)) + '</td><td>' + esc(l.kind) + '</td><td>' + esc(l.value || '') + '</td><td>' + esc(l.company || '') + '</td><td>' + esc(l.email || '') + '</td><td>' + esc(l.website || '') + '</td><td>' + esc(l.note || '') + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">None yet.</p>');
  h += '<p class="muted">Keys set: ' + ENGINES.map(function (e) { return LABEL[e] + (env[KEYNAME[e]] ? ' yes' : ' <span class="err">no</span>'); }).join(' &middot; ') + ' &middot; Admin key yes. Jobs are processed two a minute automatically.</p>';
  h += '<h2>Start a run</h2>';
  for (const c of cats) h += '<form method="post" action="/admin/run"><input type="hidden" name="cat" value="' + esc(c.id) + '"><input type="hidden" name="limit" value="5"><button>' + esc(c.name) + ': test run, 5 questions</button></form><form method="post" action="/admin/run"><input type="hidden" name="cat" value="' + esc(c.id) + '"><input type="hidden" name="limit" value="1000"><button>' + esc(c.name) + ': full run, all questions</button></form>';
  h += ' <form method="post" action="/admin/tick"><button>Process the next 2 jobs now</button></form>';
  h += '<h2>Runs</h2><table><tr><th>Run</th><th>Category</th><th>Started (UTC)</th><th>Status</th><th class="n">Done</th><th class="n">Waiting</th><th class="n">Errors</th><th>View</th></tr>';
  for (const r of runs) h += '<tr><td>' + r.id + '</td><td>' + esc(r.category_id) + '</td><td>' + esc(r.created_at) + '</td><td>' + esc(r.status) + '</td><td class="n">' + (r.done || 0) + ' / ' + r.total + '</td><td class="n">' + ((r.pending || 0) + (r.running || 0)) + '</td><td class="n">' + (r.err || 0) + '</td><td><a href="/admin/league?run=' + r.id + '">League</a> &middot; <a href="/admin/answers?run=' + r.id + '">Answers</a> &middot; <a href="/admin/export.csv?run=' + r.id + '">CSV</a></td></tr>';
  h += '</table>';
  h += '<h2>New brand names to approve (' + cands.length + ')</h2>';
  if (!cands.length) h += '<p class="muted">Nothing waiting.</p>';
  else {
    h += '<table><tr><th>Name as the AI wrote it</th><th>Category</th><th class="n">Times seen</th><th>Action</th></tr>';
    for (const c of cands) {
      const brands = (await env.DB.prepare('SELECT id, name FROM brands WHERE category_id = ? ORDER BY name').bind(c.category_id).all()).results;
      h += '<tr><td>' + esc(c.raw_name) + '</td><td>' + esc(c.category_id) + '</td><td class="n">' + c.seen + '</td><td>'
        + '<form method="post" action="/admin/candidate"><input type="hidden" name="id" value="' + c.id + '"><input type="hidden" name="act" value="approve"><button>Add as new brand</button></form>'
        + '<form method="post" action="/admin/candidate"><input type="hidden" name="id" value="' + c.id + '"><input type="hidden" name="act" value="alias"><select name="brand">' + brands.map(function (b) { return '<option value="' + b.id + '">' + esc(b.name) + '</option>'; }).join('') + '</select><button>Same as</button></form>'
        + '<form method="post" action="/admin/candidate"><input type="hidden" name="id" value="' + c.id + '"><input type="hidden" name="act" value="reject"><button>Not a supplier</button></form></td></tr>';
    }
    h += '</table>';
  }
  if (errs.length) { h += '<h2>Recent errors</h2><table><tr><th>Job</th><th>Run</th><th>Assistant</th><th>Status</th><th>Error</th></tr>'; for (const e of errs) h += '<tr><td>' + e.id + '</td><td>' + e.run_id + '</td><td>' + esc(LABEL[e.engine] || e.engine) + '</td><td>' + esc(e.status) + '</td><td class="err">' + esc(e.error) + '</td></tr>'; h += '</table>'; }
  h += '<p class="muted">Public pages: <a href="/league/stabilisers">/league/stabilisers</a> &middot; <a href="/league/decking">/league/decking</a> &middot; <a href="/league/lighting">/league/lighting</a> &middot; <a href="/league/brokerage">/league/brokerage</a> &middot; <a href="/league/">/league/</a> &middot; <a href="/admin/sources">Sources by month</a></p>';
  return page('AI tracker admin', h);
}

const SRC_TYPE = { 'obmagazine.media': 'Trade press', 'boatinternational.com': 'Trade press', 'superyachttimes.com': 'Trade press', 'superyachtnews.com': 'Trade press', 'dockwalk.com': 'Trade press', 'superyachtpartners.com': 'Trade press', 'yachtingmagazine.com': 'Trade press', 'thesuperyachtlife.com': 'Trade press', 'metstrade.com': 'Directory / show', 'yachting-pages.com': 'Directory / show', 'superyachtservicesguide.com': 'Directory / show', 'nauticexpo.com': 'Directory / show', 'yotspot.com': 'Directory / show', 'youtube.com': 'Video', 'en.wikipedia.org': 'Reference' };
async function adminSources(env, csv) {
  const runs = (await env.DB.prepare("SELECT r.id, r.category_id AS cat, c.name AS cname, substr(r.created_at, 1, 7) AS ym, (SELECT COUNT(*) FROM answers a WHERE a.run_id = r.id) AS n FROM runs r JOIN categories c ON c.id = r.category_id WHERE COALESCE(r.label, '') NOT LIKE '%test%' AND EXISTS (SELECT 1 FROM answers a WHERE a.run_id = r.id) ORDER BY (r.label = 'monthly') DESC, r.id DESC").all()).results;
  const pick = {};
  for (const r of runs) { const k = r.ym + '|' + r.cat; if (!pick[k]) pick[k] = r; }
  let use = Object.keys(pick).map(function (k) { return pick[k]; });
  if (!use.length) return page('Sources by month', '<p><a href="/admin">&larr; Admin</a></p><p>No runs yet.</p>');
  const allMonths = Array.from(new Set(use.map(function (r) { return r.ym; }))).sort();
  const months = csv ? allMonths : allMonths.slice(-6);
  use = use.filter(function (r) { return months.indexOf(r.ym) >= 0; });
  const byId = {}; for (const r of use) byId[r.id] = r;
  const ids = use.map(function (r) { return r.id; });
  const stmt = env.DB.prepare('SELECT run_id, domain, COUNT(DISTINCT answer_id) AS n FROM citations WHERE run_id IN (' + ids.map(function () { return '?'; }).join(',') + ') GROUP BY run_id, domain');
  const rows = (await stmt.bind.apply(stmt, ids).all()).results;
  const latest = months[months.length - 1], prev = months.length > 1 ? months[months.length - 2] : null;
  const tot = {}, cnt = {}, catCnt = {}, cats = [];
  for (const r of use) { tot[r.ym] = (tot[r.ym] || 0) + r.n; if (r.ym === latest) cats.push({ id: r.cat, name: r.cname, n: r.n }); }
  for (const x of rows) {
    const r = byId[x.run_id]; if (!r || !x.domain) continue;
    cnt[x.domain] = cnt[x.domain] || {}; cnt[x.domain][r.ym] = (cnt[x.domain][r.ym] || 0) + x.n;
    if (r.ym === latest) { catCnt[x.domain] = catCnt[x.domain] || {}; catCnt[x.domain][r.cat] = x.n; }
  }
  if (csv) {
    const lines = ['month,category,run,website,type,answers_citing,answers_in_run'];
    for (const x of rows) { const r = byId[x.run_id]; if (!r) continue; lines.push([r.ym, r.cname, r.id, x.domain, SRC_TYPE[x.domain] || '', x.n, r.n].map(csvCell).join(',')); }
    return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="sources-by-month.csv"' } });
  }
  function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }
  const doms = Object.keys(cnt).sort(function (a, b) { return ((cnt[b][latest] || 0) - (cnt[a][latest] || 0)) || a.localeCompare(b); }).slice(0, 40);
  cats.sort(function (a, b) { return a.name.localeCompare(b.name); });
  let h = '<p><a href="/admin">&larr; Admin</a></p><h1>Sources by month</h1>';
  h += '<p class="muted">The websites the assistants cite, counted as answers citing each site at least once, and as a share of that month&#39;s answers. Each month uses that month&#39;s monthly run per category, or before monthly runs began, the latest full run that is not a test. ' + months.map(function (m) { return esc(m) + ': ' + (tot[m] || 0) + ' answers'; }).join(' &middot; ') + '. <a href="/admin/sources.csv">Download every month (CSV)</a></p>';
  h += '<h2>Month by month (top 40)</h2><table><tr><th>Website</th><th>Type</th>' + months.map(function (m) { return '<th class="n">' + esc(m) + '</th>'; }).join('') + '<th class="n">Change</th></tr>';
  for (const d of doms) {
    h += '<tr><td>' + esc(d) + '</td><td>' + esc(SRC_TYPE[d] || '') + '</td>';
    for (const m of months) { const n = cnt[d][m] || 0; h += '<td class="n">' + (n ? n + ' <span class="muted">(' + pct(n, tot[m]) + '%)</span>' : '&ndash;') + '</td>'; }
    let ch = '&ndash;';
    if (prev) { const diff = Math.round((pct(cnt[d][latest] || 0, tot[latest]) - pct(cnt[d][prev] || 0, tot[prev])) * 10) / 10; ch = (diff > 0 ? '+' : '') + diff + ' pts'; }
    h += '<td class="n">' + ch + '</td></tr>';
  }
  h += '</table><h2>' + esc(latest) + ' by category</h2><table><tr><th>Website</th>' + cats.map(function (c) { return '<th class="n">' + esc(c.name) + ' <span class="muted">(' + c.n + ' answers)</span></th>'; }).join('') + '</tr>';
  for (const d of doms) { h += '<tr><td>' + esc(d) + '</td>' + cats.map(function (c) { const n = (catCnt[d] || {})[c.id] || 0; return '<td class="n">' + (n ? n + ' <span class="muted">(' + pct(n, c.n) + '%)</span>' : '&ndash;') + '</td>'; }).join('') + '</tr>'; }
  h += '</table><p class="muted">Change compares each site&#39;s share with the previous month, in percentage points, so months with different numbers of questions compare fairly.</p>';
  return page('Sources by month', h);
}

async function buyTable(env, runId) {
  const den = (await env.DB.prepare('SELECT a.engine, COUNT(*) AS n, SUM(COALESCE(p.weight, 1)) AS w FROM answers a JOIN prompts p ON p.id = a.prompt_id WHERE a.run_id = ? GROUP BY a.engine').bind(runId).all()).results;
  const num = (await env.DB.prepare("SELECT b.id, b.name, b.exhibitor, m.engine, COUNT(*) AS n, SUM(COALESCE(p.weight, 1)) AS w FROM (SELECT DISTINCT answer_id, brand_id, engine FROM mentions WHERE run_id = ? AND brand_id IS NOT NULL) m JOIN brands b ON b.id = m.brand_id AND b.kind = 'maker' JOIN answers a ON a.id = m.answer_id JOIN prompts p ON p.id = a.prompt_id GROUP BY b.id, m.engine").bind(runId).all()).results;
  const dn = {}, dw = {}; let ws = 0;
  for (const d of den) { dn[d.engine] = d.n; dw[d.engine] = d.w; ws += WEIGHT[d.engine] || 0; }
  const S = {};
  for (const r of num) { if (!dn[r.engine] || !ws) continue; const x = S[r.id] || (S[r.id] = { name: r.name, ex: r.exhibitor, eq: 0, buy: 0 }); x.eq += (WEIGHT[r.engine] || 0) * r.n / dn[r.engine] / ws; x.buy += (WEIGHT[r.engine] || 0) * r.w / dw[r.engine] / ws; }
  const arr = Object.keys(S).map(function (k) { return S[k]; });
  const eqO = arr.slice().sort(function (a, b) { return b.eq - a.eq; });
  arr.sort(function (a, b) { return b.buy - a.buy; });
  const tiers = (await env.DB.prepare('SELECT COALESCE(p.weight, 1) AS w, COUNT(DISTINCT p.id) AS n FROM answers a JOIN prompts p ON p.id = a.prompt_id WHERE a.run_id = ? GROUP BY COALESCE(p.weight, 1) ORDER BY w DESC').bind(runId).all()).results;
  let h = '<h2>Buying-questions score</h2><p class="muted">The same score with each question weighted by buying value: shortlist questions count 3, compare questions 2, research questions 1. This run: ' + tiers.map(function (x) { return x.n + ' questions at weight ' + x.w; }).join(', ') + '. The public league stays on equal weights.</p>';
  h += '<table><tr><th>#</th><th>Brand</th><th class="n">Buying score</th><th class="n">Equal score</th><th class="n">Equal rank</th><th class="n">Move</th></tr>';
  arr.slice(0, 25).forEach(function (r, i) { const er = eqO.indexOf(r) + 1; const mv = er - (i + 1); h += '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + (r.ex ? ' <span class="tag">exhibitor</span>' : '') + '</td><td class="n">' + Math.round(r.buy * 100) + '</td><td class="n">' + Math.round(r.eq * 100) + '</td><td class="n">' + er + '</td><td class="n">' + (mv > 0 ? '+' + mv : (mv === 0 ? '&ndash;' : mv)) + '</td></tr>'; });
  return h + '</table>';
}

async function resolveCandidate(env, f) {
  const c = await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(Number(f.get('id'))).first();
  if (!c) return 'Not found';
  const act = f.get('act');
  let bid = null;
  if (act === 'approve') {
    const r = await env.DB.prepare('INSERT INTO brands (category_id, name, aliases, exhibitor) VALUES (?,?,?,0)').bind(c.category_id, c.raw_name, '[]').run();
    bid = r.meta.last_row_id;
  } else if (act === 'alias') {
    bid = Number(f.get('brand'));
    const b = await env.DB.prepare('SELECT aliases FROM brands WHERE id = ?').bind(bid).first();
    let al = []; try { al = JSON.parse(b.aliases || '[]'); } catch (e) {}
    if (al.indexOf(c.raw_name) < 0) al.push(c.raw_name);
    await env.DB.prepare('UPDATE brands SET aliases = ? WHERE id = ?').bind(JSON.stringify(al), bid).run();
  } else {
    await env.DB.prepare("UPDATE candidates SET status = 'rejected' WHERE id = ?").bind(c.id).run();
    return 'Marked as not a supplier: ' + c.raw_name;
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE candidates SET status = ?, brand_id = ? WHERE id = ?').bind(act === 'approve' ? 'approved' : 'alias', bid, c.id),
    env.DB.prepare('UPDATE mentions SET brand_id = ? WHERE brand_id IS NULL AND norm = ? AND run_id IN (SELECT id FROM runs WHERE category_id = ?)').bind(bid, c.norm, c.category_id)
  ]);
  return (act === 'approve' ? 'Added ' : 'Linked ') + c.raw_name;
}


// ---- Free AI check (/check) ----
const CK_CSS = 'body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#0E1A24;background:#F6F7F6;line-height:1.5}.top{background:#0E1A24;color:#fff;padding:18px 24px}.top a{color:#fff;text-decoration:none;font-weight:700}.top span{color:#C9D3DB;font-size:14px}.wrap{max-width:760px;margin:0 auto;padding:32px 20px 64px}h1{font-size:30px;line-height:1.15;margin:0 0 10px}h2{font-size:20px;margin:0 0 10px}p{margin:0 0 12px}.muted{color:#4A5A66;font-size:14px}.card{background:#fff;border-radius:14px;padding:20px 22px;margin:14px 0;box-shadow:0 1px 2px rgba(14,26,36,.06)}label{display:block;font-weight:600;font-size:15px;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #C9D3DB;border-radius:10px;font-size:16px}button{background:#0B6E99;color:#fff;border:0;border-radius:10px;padding:14px 22px;font-size:16px;font-weight:700;cursor:pointer;margin-top:18px;min-height:48px}.chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:700}.yes{background:#0B6E99;color:#fff}.no{background:#F6D2BC;color:#6B2A08}.big{font-size:44px;font-weight:700;line-height:1.1}.lock{background:#0E1A24;color:#fff}.lock li{margin:6px 0;color:#D5DEE5}.lock .muted{color:#C9D3DB}.lock input{border-color:#4A5A66}.err{color:#a02020;font-weight:600}a{color:#0B6E99}.lock a{color:#8FD0EC}';
function ckPageOld(title, body, indexable, refresh) {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + (indexable ? '' : '<meta name="robots" content="noindex">') + (refresh ? '<meta http-equiv="refresh" content="' + refresh + '">' : '') + '<title>' + esc(title) + '</title><style>' + CK_CSS + '</style></head><body><div class="top"><a href="/">YachtingSignals</a> <span>&middot; which suppliers the AI assistants recommend</span></div><div class="wrap">' + body + '</div></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
const CK_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function ckForm(msg) {
  return '<h1>Does ChatGPT recommend your company?</h1><p>Buyers now ask ChatGPT for supplier shortlists. Tell us your company and what you sell, and we will ask free ChatGPT three buyer questions, with web search on, and show you whether it named you and who it named instead.</p>' + (msg ? '<p class="err">' + esc(msg) + '</p>' : '') +
    '<form method="post" action="/check" class="card"><label for="company">Company name</label><input id="company" name="company" required maxlength="80" autocomplete="organization">' +
    '<label for="product">What you sell</label><input id="product" name="product" required maxlength="80" placeholder="e.g. gyro stabilisers, yacht tenders, teak decking, crew placement">' +
    '<label for="website">Your website (optional, helps us spot you)</label><input id="website" name="website" maxlength="120" placeholder="example.com">' +
    '<label for="email">Email (optional, if you would like the full report later)</label><input id="email" name="email" type="email" maxlength="120" autocomplete="email">' +
    '<button type="submit">Run my free check</button></form>' +
    '<p class="muted">Takes about a minute. Up to three free checks a day. We keep what you enter and the answers so we can show your result; your email is only used to send you results.</p>';
}
function ckQuestions(product) {
  const p = product.trim();
  return [
    'Who are the leading suppliers of ' + p + ' for superyachts?',
    'Which suppliers of ' + p + ' should a superyacht shipyard or refit project manager shortlist?',
    'Which companies supplying ' + p + ' do superyacht captains and project managers recommend in the Mediterranean?'
  ];
}
function ckKeys(company, website) {
  const keys = [];
  const words = String(company || '').toLowerCase().split(/[\s,.]+/).filter(function (w) { return w && ['ltd', 'limited', 'llc', 'inc', 'gmbh', 'srl', 'bv', 'sas', 'sarl', 'spa', 'plc', 'sa', 'ag', 'oy', 'ab', 'as'].indexOf(w) < 0; });
  const c = norm(words.join(' ')); if (c.length >= 3) keys.push(c);
  const full = norm(company); if (full.length >= 3 && keys.indexOf(full) < 0) keys.push(full);
  const w = String(website || '').trim();
  if (w) { const d = domainOf(/^https?:/i.test(w) ? w : 'https://' + w).split('.')[0]; const dn = norm(d); if (dn.length >= 4 && keys.indexOf(dn) < 0) keys.push(dn); }
  return keys;
}
function ckFind(names, keys) {
  for (let i = 0; i < names.length; i++) {
    const k = norm(names[i]); if (!k) continue;
    for (const key of keys) { if (k === key || (key.length >= 5 && k.indexOf(key) >= 0) || (k.length >= 5 && key.indexOf(k) >= 0)) return i; }
  }
  return -1;
}
async function ckRun(env, c) {
  const keys = ckKeys(c.company, c.website);
  let cost = 0;
  const out = await Promise.all(ckQuestions(c.product).map(async function (q) {
    try {
      const a = await ASK.openai(env, q);
      const u = usageOf(a.usage);
      cost += Math.max(0, u.inp - u.cached) * 0.2e-6 + u.cached * 0.02e-6 + u.out * 1.2e-6 + u.s * 0.01;
      let names = [];
      try { names = await extractBrands(env, c.product, a.text || ''); cost += 0.001; } catch (e) {}
      const doms = []; for (const x of (a.cites || [])) if (x.domain && doms.indexOf(x.domain) < 0) doms.push(x.domain);
      return { q: q, names: names.slice(0, 20), pos: ckFind(names, keys) + 1, sites: doms.length, doms: doms.slice(0, 15), model: a.model || '' };
    } catch (e) { return { q: q, error: String((e && e.message) || e).slice(0, 200) }; }
  }));
  const ok = out.filter(function (r) { return !r.error; });
  const named = ok.filter(function (r) { return r.pos > 0; }).length;
  await env.DB.prepare('UPDATE checks SET status = ?, result = ?, named = ?, cost_usd = ? WHERE id = ?').bind(ok.length ? 'done' : 'error', JSON.stringify(out), named, Math.round(cost * 10000) / 10000, c.id).run();
}
function ckTopRival(r) {
  const counts = {}, label = {}, canon = [];
  for (const x of r) {
    if (x.error || !x.names) continue;
    const seen = {};
    x.names.forEach(function (n, i) {
      if (i === x.pos - 1) return;
      const k = norm(n); if (!k) return;
      let c = null;
      for (const ck of canon) { if (ck === k || (ck.length >= 5 && k.indexOf(ck) === 0) || (k.length >= 5 && ck.indexOf(k) === 0)) { c = ck; break; } }
      if (!c) { c = k; canon.push(k); label[k] = n; }
      if (!seen[c]) { seen[c] = 1; counts[c] = (counts[c] || 0) + 1; }
    });
  }
  let best = null; for (const ck of canon) if (!best || counts[ck] > counts[best]) best = ck;
  return best ? { name: label[best], n: counts[best] } : null;
}
function ckTopSite(r, keys) {
  const counts = {}, order = [];
  for (const x of r) {
    if (x.error) continue;
    const seen = {};
    (x.doms || []).forEach(function (d) { if (seen[d]) return; seen[d] = 1; if (!(d in counts)) { counts[d] = 0; order.push(d); } counts[d]++; });
  }
  let best = null;
  for (const d of order) { if (keys.indexOf(norm(d.split('.')[0])) >= 0) continue; if (!best || counts[d] > counts[best]) best = d; }
  return best ? { domain: best, n: counts[best], total: order.length } : null;
}
function ckResult(c) {
  let r = []; try { r = JSON.parse(c.result || '[]'); } catch (e) {}
  const ok = r.filter(function (x) { return !x.error; });
  const named = ok.filter(function (x) { return x.pos > 0; }).length;
  let h = '<p class="muted">Free check for</p><h1>' + esc(c.company) + '</h1><p class="muted">' + esc(c.product) + ' &middot; asked of free ChatGPT, with web search on, on ' + esc(String(c.created_at).slice(0, 10)) + '</p>';
  const verdict = named === 0 ? 'When a buyer asks ChatGPT these questions, you are not on its shortlist. ChatGPT carries about 71% of AI assistant use, so this is the gap that costs you most.'
    : (named < ok.length ? 'You are on some of ChatGPT&#39;s shortlists but not all of them. ChatGPT carries about 71% of AI assistant use, so each missing answer matters.'
    : 'ChatGPT named you every time. The monthly report shows whether that holds on Gemini, Claude and Perplexity, and whether it holds month to month.');
  h += '<div class="card"><div class="big">' + named + ' of ' + ok.length + '</div><p>ChatGPT answers that named ' + esc(c.company) + '.</p><p class="muted">' + verdict + '</p></div>';
  const rival = ckTopRival(r), site = ckTopSite(r, ckKeys(c.company, c.website));
  if (rival || site) {
    h += '<div class="card"><h2>At a glance</h2>';
    if (rival) h += '<p><b>' + esc(rival.name) + '</b> was named in ' + rival.n + ' of ' + ok.length + ' answers. You were named in ' + named + '.</p>';
    if (site) h += '<p>The website ChatGPT relied on most: <b>' + esc(site.domain) + '</b>, cited in ' + site.n + ' of ' + ok.length + ' answers. Being covered there is one of the quickest ways onto its shortlist.' + (site.total > 1 ? ' The other ' + (site.total - 1) + ' websites it read are in the full report.' : '') + '</p>';
    h += '</div>';
  }
  for (const x of r) {
    h += '<div class="card"><p><b>&ldquo;' + esc(x.q) + '&rdquo;</b></p>';
    if (x.error) { h += '<p class="muted">ChatGPT did not answer this question, so it is not counted.</p></div>'; continue; }
    if (!x.names.length) { h += '<p class="muted">ChatGPT gave no supplier names for this question.</p></div>'; continue; }
    h += x.pos > 0 ? '<p><span class="chip yes">Named, #' + x.pos + ' of ' + x.names.length + '</span></p>' : '<p><span class="chip no">Not named</span> <span class="muted">' + x.names.length + ' suppliers named</span></p>';
    if (x.pos > 1) { const above = x.names.slice(0, x.pos - 1); h += '<p>Ranked above you: ' + esc(above.slice(0, 5).join(', ')) + (above.length > 5 ? ' and ' + (above.length - 5) + ' more' : '') + '</p>'; }
    else { const others = x.names.filter(function (n, i) { return i !== x.pos - 1; }).slice(0, 3); const rest = x.names.length - others.length - (x.pos > 0 ? 1 : 0); if (others.length) h += '<p>' + (x.pos === 1 ? 'You were named first. Also named: ' : 'Named instead: ') + esc(others.join(', ')) + (rest > 0 ? ' and ' + rest + ' more' : '') + '</p>'; }
    h += '<p class="muted">In the full report: the ' + (x.sites === 1 ? 'website' : x.sites + ' websites') + ' ChatGPT read for this answer' + (x.pos > 0 ? ', and exactly how it described you' : ', and where to get listed') + '.</p></div>';
  }
  h += '<div class="card lock" id="report"><h2>What the &pound;20 monthly report adds</h2><ul>' +
    '<li>The websites each assistant trusted for every answer, so you know where to get listed</li>' +
    '<li>How the AI describes your company, word for word, with errors flagged</li>' +
    '<li>Gemini, Claude and Perplexity as well as ChatGPT</li>' +
    '<li>100 buyer questions a month in your category, not 3</li>' +
    '<li>Your rank against competitors, and how it moves each month</li></ul>' +
    '<p class="muted">Founding price &pound;20 a month, or &pound;200 a year.' + (named < ok.length ? ' Missing from answers? The &pound;250 visibility fix gives you ready-to-paste text and page edits for your own website. <a href="/#pricing">See pricing</a>' : '') + '</p>';
  if (c.interest) h += '<p><b>Thank you. We will email the full report to ' + esc(c.email) + '.</b></p>';
  else h += '<form method="post" action="/check/r/' + esc(c.id) + '/report"><label for="email">Send me the full report</label><input id="email" name="email" type="email" required maxlength="120" value="' + esc(c.email || '') + '" placeholder="you@company.com"><button type="submit">Send me the report</button></form>';
  h += '</div><p class="muted">Answers come from ChatGPT&#39;s official connection and can differ slightly from what a signed-in user sees. <a href="/check">Check another company</a> &middot; <a href="/league/">See the leagues</a></p>';
  return h;
}
async function ckStart(req, env) {
  const f = await req.formData();
  const company = String(f.get('company') || '').trim().slice(0, 80);
  const product = String(f.get('product') || '').trim().slice(0, 80);
  const website = String(f.get('website') || '').trim().slice(0, 120);
  const email = String(f.get('email') || '').trim().slice(0, 120);
  if (company.length < 2 || product.length < 3) return ckPage('Free check', ckForm('Please enter your company name and what you sell.'), true);
  if (email && !CK_EMAIL.test(email)) return ckPage('Free check', ckForm('That email address does not look right.'), true);
  const hb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((req.headers.get('cf-connecting-ip') || '') + '|ys'));
  const ip = Array.from(new Uint8Array(hb)).slice(0, 8).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  const mine = (await env.DB.prepare("SELECT COUNT(*) AS n FROM checks WHERE ip = ? AND created_at > datetime('now','-1 day')").bind(ip).first()).n;
  if (mine >= 3) return ckPage('Free check', ckForm('You have used your three free checks for today. Please come back tomorrow.'), true);
  const all = (await env.DB.prepare("SELECT COUNT(*) AS n FROM checks WHERE created_at > datetime('now','-1 day')").first()).n;
  if (all >= 150) return ckPage('Free check', ckForm('The free check is very busy today. Please try again tomorrow.'), true);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.DB.prepare('INSERT INTO checks (id, company, product, website, email, ip) VALUES (?,?,?,?,?,?)').bind(id, company, product, website, email, ip).run();
  return Response.redirect(new URL(req.url).origin + '/check/r/' + id, 303);
}
function ckWait(id, company) {
  return ckPage('Asking ChatGPT', '<h1>Asking ChatGPT about ' + esc(company) + '&hellip;</h1><p>Three buyer questions are going to free ChatGPT now, with web search on. It usually takes one to two minutes. This page updates on its own: please keep it open.</p><p class="muted" id="t">Working&hellip;</p><script>(function(){var u="/check/r/' + id + '";var s=Date.now();setInterval(function(){var el=document.getElementById("t");if(el)el.textContent="Working… "+Math.round((Date.now()-s)/1000)+" seconds";},1000);function poll(){fetch(u+"?state=1",{cache:"no-store"}).then(function(r){return r.text();}).then(function(t){if(t.indexOf("done")===0||t.indexOf("error")===0)location.replace(u);else setTimeout(poll,4000);}).catch(function(){setTimeout(poll,4000);});}fetch(u+"?go=1",{cache:"no-store"}).catch(function(){});setTimeout(poll,4000);})();</script><noscript><meta http-equiv="refresh" content="10"></noscript>');
}
async function ckShow(req, env, url) {
  const parts = url.pathname.split('/');
  const id = parts[3] || '';
  let c = await env.DB.prepare('SELECT * FROM checks WHERE id = ?').bind(id).first();
  if (!c) return ckPage('Not found', '<h1>Check not found</h1><p><a href="/check">Run a free check</a></p>');
  if (parts[4] === 'report' && req.method === 'POST') {
    const f = await req.formData();
    const email = String(f.get('email') || '').trim().slice(0, 120);
    if (CK_EMAIL.test(email)) await env.DB.prepare('UPDATE checks SET email = ?, interest = 1 WHERE id = ?').bind(email, id).run();
    return Response.redirect(url.origin + '/check/r/' + id + '#report', 303);
  }
  await env.DB.prepare("UPDATE checks SET status = 'pending' WHERE id = ? AND status = 'running' AND created_at < datetime('now','-4 minutes')").bind(id).run();
  c = await env.DB.prepare('SELECT * FROM checks WHERE id = ?').bind(id).first();
  if (url.searchParams.get('state') === '1') return new Response(String(c.status), { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
  if (c.status === 'pending' && url.searchParams.get('go') !== '1') return ckWait(id, c.company);
  if (c.status === 'pending') {
    const claimed = await env.DB.prepare("UPDATE checks SET status = 'running' WHERE id = ? AND status = 'pending'").bind(id).run();
    if (claimed.meta.changes) {
      try { await ckRun(env, c); } catch (e) { await env.DB.prepare("UPDATE checks SET status = 'error' WHERE id = ?").bind(id).run(); }
      return new Response('done', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    }
  }
  if (c.status === 'running' || c.status === 'pending') return ckWait(id, c.company);
  if (c.status === 'error') return ckPage('Free check', '<h1>Sorry, ChatGPT did not answer</h1><p>The check could not finish this time. <a href="/check">Please try again</a>.</p>');
  return ckPage('Free check: ' + c.company, ckResult(c));
}

// ---- Public site: shared look (19 Nov 2026) ----
const SITE_CSS = ':root{--ink:#1F3240;--body:#3A4A56;--muted:#4A5A66;--sea:#1F7A99;--sea2:#1F6E8A;--mist:#E6F1F4;--bg:#FBF8F3;--line:#ECE4D8;--coral:#A8462C}' +
  '*{box-sizing:border-box}body{margin:0;font-family:"Nunito Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.55;font-size:16px}' +
  'a{color:var(--sea)}a:hover{color:#165C74}h1,h2,.serif{font-family:Fraunces,Georgia,serif;font-weight:600;line-height:1.12;margin:0 0 12px}h1{font-size:clamp(32px,5vw,52px)}h2{font-size:clamp(26px,3.4vw,32px)}h3{font-size:19px;font-weight:700;margin:0 0 8px}p{margin:0 0 12px}' +
  '.hd{background:#fff;border-bottom:1px solid var(--line);padding:12px 20px}.hd nav{max-width:1120px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between;align-items:center}' +
  '.logo{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:22px;color:var(--ink);text-decoration:none}.nav{display:flex;flex-wrap:wrap;gap:4px 22px;align-items:center}.nav a{color:var(--body);text-decoration:none;font-weight:700;padding:10px 0}' +
  'button,.btn,.nav a.cta{display:inline-block;background:var(--sea);color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;border:0;font-size:16px;cursor:pointer;min-height:46px;font-family:inherit;text-align:center}.nav a.cta{padding:10px 20px;min-height:0;color:#fff}button:hover,.btn:hover,.nav a.cta:hover{background:#165C74;color:#fff}form button{margin-top:16px}.row button{margin-top:0}' +
  '.wrap{max-width:1120px;margin:0 auto;padding:0 20px}.narrow{max-width:760px;margin:0 auto;padding:40px 20px 24px}' +
  '.hero{background:var(--mist);padding:60px 20px 100px}.hero>.in{max-width:1120px;margin:0 auto;display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start}.hero-l{flex:999 1 520px;min-width:0}.hero-r{flex:1 1 320px;min-width:0}' +
  '.eyebrow{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--sea);margin:0 0 14px}.lead{font-size:19px;color:var(--body);max-width:640px}' +
  '.card{background:#fff;border-radius:20px;padding:22px 24px;margin:14px 0;box-shadow:0 1px 2px rgba(31,50,64,.05),0 6px 24px rgba(31,50,64,.06)}' +
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:20px}.grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:20px}' +
  'label{display:block;font-weight:700;font-size:14px;color:var(--body);margin:12px 0 6px}input,select,textarea{width:100%;padding:12px;border:1px solid #C9D6DD;border-radius:12px;font-size:16px;font-family:inherit;color:var(--ink);background:#fff}' +
  '.row{display:flex;flex-wrap:wrap;gap:0 12px;align-items:flex-end}.row>div{flex:1 1 200px}.muted{color:var(--muted);font-size:14px}.err{color:#A02020;font-weight:700}.ok{background:#E3F1E8;color:#1E5631;border-radius:12px;padding:12px 16px;font-weight:700}' +
  '.chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:700}.yes{background:var(--sea);color:#fff}.no{background:#F6D9C8;color:#7A2E12}.big{font-family:Fraunces,Georgia,serif;font-size:44px;font-weight:700;line-height:1.1}' +
  '.lock{background:var(--sea2);color:#fff}.lock li{margin:6px 0}.lock .muted{color:#E3EEF2}.lock a{color:#fff}.lock label{color:#fff}.lock input{border-color:#fff}.lock button{background:#fff;color:var(--sea2)}' +
  'section.s{margin:72px 0}.stats{margin-top:-48px;position:relative}.stat .n{font-family:Fraunces,Georgia,serif;font-size:34px;font-weight:700}.stat .t{color:var(--body);font-size:15px}' +
  '.tbl{overflow-x:auto}table.lg{width:100%;min-width:600px;border-collapse:collapse;font-size:15px}table.lg th{text-align:left;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em;padding:10px 8px;border-bottom:1px solid #DDE3E7}table.lg td{padding:11px 8px;border-bottom:1px solid #EEF1F3}table.lg .n{text-align:right;font-variant-numeric:tabular-nums}' +
  '.bar{display:flex;align-items:center;gap:10px}.bar .tr{flex:1;height:10px;background:#EEF1F3;border-radius:5px;overflow:hidden;min-width:60px}.bar .fl{height:100%;border-radius:5px;background:var(--sea)}.bar .fl.nx{background:#E9B38F}.bar b{width:30px;text-align:right;font-variant-numeric:tabular-nums}' +
  '.key{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:14px;color:var(--muted)}.sw{width:14px;height:14px;border-radius:4px;display:inline-block;background:var(--sea)}.sw.nx{background:#E9B38F;margin-left:12px}' +
  '.steps>div{border-top:3px solid var(--sea);padding-top:14px}.step{font-weight:800;color:var(--sea);margin-bottom:6px}.pledge{background:#F3EADB;border-radius:18px;padding:18px 22px;margin-top:24px}' +
  '.price{display:flex;flex-direction:column;gap:10px;padding:28px;margin:0}.price ul{margin:0;padding-left:18px;flex:1;color:var(--body)}.price li{margin:5px 0}.amt{font-family:Fraunces,Georgia,serif;font-size:44px;font-weight:700;line-height:1}.amt span{font-family:"Nunito Sans",sans-serif;font-size:16px;font-weight:600;color:var(--muted)}' +
  '.tag{font-weight:800;font-size:15px;color:var(--sea)}.feat{background:var(--sea2);color:#fff}.feat ul,.feat .tag{color:#fff}.feat .amt span,.feat .muted{color:#E3EEF2}.feat .btn{background:#fff;color:var(--sea2)}.pro{border:2px solid var(--sea)}.fix .tag{color:var(--coral)}.fix .btn{background:#fff;color:var(--coral);border:2px solid #C4573A}.fix .btn:hover{background:#FBEDE6}' +
  '.badge{font-size:12px;font-weight:800;background:#fff;color:var(--sea2);padding:4px 10px;border-radius:999px}' +
  '.pills{display:flex;flex-wrap:wrap;gap:10px;border:0;padding:0;margin:0}.pills legend{font-weight:700;font-size:14px;color:var(--body);margin-bottom:10px}.pills label{display:inline-flex;align-items:center;gap:8px;border:1px solid #D8CFC2;border-radius:999px;padding:9px 16px;font-weight:600;background:#fff;margin:0;color:var(--ink);font-size:15px}.pills input{width:auto;margin:0}' +
  'details{border-bottom:1px solid var(--line);padding:16px 0}summary{font-weight:700;cursor:pointer;font-size:17px}details p{margin:10px 0 0;color:var(--body)}.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
  '.ft{background:#1F4E63;color:#DCE8EE;padding:44px 20px 28px;margin-top:80px;font-size:14px}.ft a{color:#fff}.ft .cols{display:flex;flex-wrap:wrap;gap:28px 56px;justify-content:space-between}.ft .col{display:flex;flex-direction:column;gap:4px}.ft .hdr{color:#fff;font-weight:700;margin-bottom:4px}.ft .legal{border-top:1px solid #3A6A80;margin-top:28px;padding-top:18px;color:#C9DAE2;font-size:13px}';
const GTM_ID = 'GTM-T8KBR82H';
const GTM_HEAD = '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());dataLayer.push({"gtm.start":new Date().getTime(),event:"gtm.js"});</script><script async src="https://www.googletagmanager.com/gtm.js?id=' + GTM_ID + '"></script>';
const GTM_BODY = '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=' + GTM_ID + '" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>';
const SITE_HEAD = '<header class="hd"><nav aria-label="Main"><a class="logo" href="/">YachtingSignals</a><div class="nav"><a href="/league/">Leagues</a><a href="/#how">How it works</a><a href="/#pricing">Pricing</a><a class="cta" href="/check">Free AI check</a></div></nav></header>';
const SITE_FOOT = '<footer class="ft"><div class="wrap" style="padding:0"><div class="cols"><div class="col" style="max-width:380px"><div class="serif" style="font-size:21px;color:#fff;font-weight:700">YachtingSignals</div><div>Which suppliers the AI assistants recommend. An independent monthly measurement, not a paid ranking.</div><a href="mailto:hello@yachtingsignals.com" style="font-weight:700">hello@yachtingsignals.com</a></div>' +
  '<div class="cols"><div class="col"><div class="hdr">Leagues</div><a href="/league/stabilisers">Stabilisers</a><a href="/league/decking">Decking and flooring</a><a href="/league/lighting">Lighting</a><a href="/league/brokerage">Brokerage and charter</a><span>More categories soon</span></div><div class="col"><div class="hdr">For suppliers</div><a href="/check">Free AI check</a><a href="/#pricing">Pricing</a><a href="/#how">How it works</a></div><div class="col"><div class="hdr">Legal</div><a href="/privacy">Privacy</a></div></div></div>' +
  '<div class="legal">YachtingSignals is a trading name of TENFEET LTD, company number 09894030. Registered office: 128 City Road, London, EC1V 2NX. &copy; 2026 TENFEET LTD.</div></div></footer>';
function sitePage(title, body, o) {
  o = o || {};
  return new Response('<!doctype html><html lang="en"><head>' + GTM_HEAD + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + (o.noindex ? '<meta name="robots" content="noindex">' : '') + (o.refresh ? '<meta http-equiv="refresh" content="' + o.refresh + '">' : '') + '<title>' + esc(title) + '</title>' + (o.desc ? '<meta name="description" content="' + esc(o.desc) + '">' : '') +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap" rel="stylesheet">' +
    (o.ld ? '<script type="application/ld+json">' + o.ld + '</script>' : '') + '<style>' + SITE_CSS + '</style></head><body>' + GTM_BODY + SITE_HEAD + body + SITE_FOOT + '</body></html>', { status: o.status || 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
function ckPage(title, body, indexable, refresh) { return sitePage(title, '<main class="narrow">' + body + '</main>', { noindex: !indexable, refresh: refresh }); }
async function ipHash(req) { const hb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((req.headers.get('cf-connecting-ip') || '') + '|ys')); return Array.from(new Uint8Array(hb)).slice(0, 8).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(s, noDay) { const d = new Date(String(s).replace(' ', 'T') + 'Z'); if (isNaN(d)) return String(s).slice(0, 10); return (noDay ? '' : d.getUTCDate() + ' ') + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
async function publicRun(env, cat) {
  return await env.DB.prepare("SELECT id FROM runs WHERE category_id = ? AND EXISTS (SELECT 1 FROM answers WHERE answers.run_id = runs.id) AND (label = 'monthly' OR (COALESCE(label,'') NOT LIKE '%test%' AND NOT EXISTS (SELECT 1 FROM runs r2 WHERE r2.category_id = runs.category_id AND r2.label = 'monthly' AND EXISTS (SELECT 1 FROM answers a2 WHERE a2.run_id = r2.id)))) ORDER BY (label = 'monthly') DESC, id DESC LIMIT 1").bind(cat).first();
}
function engList(d) { return d.perEngine.filter(function (e) { return e.n > 0 && ENGINES.indexOf(e.engine) >= 0; }).sort(function (a, b) { return (WEIGHT[b.engine] || 0) - (WEIGHT[a.engine] || 0); }); }
function engNames(d) { const l = engList(d).map(function (e) { return LABEL[e.engine]; }); return l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l.join(''); }
async function nQuestions(env, runId) { return (await env.DB.prepare('SELECT COUNT(DISTINCT prompt_id) AS n FROM answers WHERE run_id = ?').bind(runId).first()).n; }
function pubTable(d, limit) {
  const es = engList(d), rows = limit ? d.rows.slice(0, limit) : d.rows;
  let h = '<div class="tbl"><table class="lg"><thead><tr><th style="width:36px">#</th><th>Brand</th><th style="min-width:180px">AI visibility score</th>';
  for (const e of es) h += '<th class="n">' + esc(LABEL[e.engine]) + '</th>';
  h += '<th class="n">Named first</th></tr></thead><tbody>';
  rows.forEach(function (r, i) {
    const s = Math.round(100 * (r.score || 0));
    h += '<tr><td class="muted">' + (i + 1) + '</td><td><b>' + esc(r.name) + '</b></td><td><div class="bar"><div class="tr"><div class="fl' + (r.exhibitor ? '' : ' nx') + '" style="width:' + s + '%"></div></div><b>' + s + '</b></div></td>';
    for (const e of es) h += '<td class="n">' + (r['e_' + e.engine] || 0) + '/' + e.n + '</td>';
    h += '<td class="n">' + (r.firsts || 0) + '</td></tr>';
  });
  return h + '</tbody></table></div><p class="key" style="margin:12px 0 0"><span class="sw"></span>METSTRADE 2026 exhibitor <span class="sw nx"></span>Not exhibiting</p>';
}
const SCORE_NOTE = 'AI visibility score: the share of answers naming the brand on each assistant, weighted by how widely that assistant is used (ChatGPT 71%, Gemini 19%, Claude 7%, Perplexity 3%), out of 100. Together these four cover about 95% of AI assistant use. Microsoft Copilot is left out because there is no public way to run these questions on it, and Gemini stands in for Google&rsquo;s AI Overviews.';
async function leaguePage(env, cat) {
  if (!cat) {
    const cats = (await env.DB.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY name').all()).results;
    let h = '<main class="wrap" style="padding-top:44px"><p class="eyebrow">League tables</p><h1>Who the AI assistants recommend</h1><p class="lead">Every month we ask ChatGPT, Gemini, Claude and Perplexity the same buyer questions for each category, with web search on, and publish the top 10. Nobody pays to be in a league.</p>';
    for (const c of cats) { if (await publicRun(env, c.id)) h += '<div class="card"><h3 style="margin:0"><a href="/league/' + esc(c.id) + '">' + esc(c.name) + '</a></h3></div>'; }
    h += '<div class="card"><h3>Is your company on ChatGPT&rsquo;s shortlist?</h3><a class="btn" href="/check">Run my free check</a></div></main>';
    return sitePage('League tables: who the AI assistants recommend | YachtingSignals', h, { desc: 'Monthly league tables of the superyacht suppliers ChatGPT, Gemini, Claude and Perplexity recommend to buyers.' });
  }
  const c = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(cat).first();
  if (!c) return notFoundPage();
  const last = await publicRun(env, cat);
  let h = '<main class="wrap" style="padding-top:44px"><p class="eyebrow">League table</p><h1>Who the AI assistants recommend: ' + esc(c.name) + '</h1>';
  if (!last) return sitePage(c.name + ' | YachtingSignals', h + '<p>No results yet.</p></main>');
  const d = await leagueData(env, last.id);
  const nQ = await nQuestions(env, last.id);
  h += '<p class="lead">The top 10 brands from ' + d.tot + ' answers: ' + nQ + ' buyer questions asked of ' + engNames(d) + ' on ' + fmtDate(d.run.created_at) + ', with web search on. ' + (cat === 'brokerage' ? 'The questions are written the way a yacht buyer, seller or charter client would ask them.' : 'The questions are written the way a shipyard buyer, naval architect or refit manager would ask them.') + '</p>';
  h += '<div class="card" style="padding:26px">' + pubTable(d, 10) + '</div>';
  h += '<div class="grid" style="margin-top:20px"><div class="card"><h3>How the score works</h3><p class="muted" style="margin:0">' + SCORE_NOTE + '</p></div><div class="card"><h3>Is your company on ChatGPT&rsquo;s shortlist?</h3><p style="color:var(--body)">Run a free check: three buyer questions on free ChatGPT, with web search on. It takes about a minute.</p><a class="btn" href="/check">Run my free check</a></div></div></main>';
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Superyacht ' + c.name.toLowerCase() + ': brands most recommended by AI assistants, ' + fmtDate(d.run.created_at, true), itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: Math.min(10, d.rows.length), itemListElement: d.rows.slice(0, 10).map(function (r, i) { return { '@type': 'ListItem', position: i + 1, name: r.name }; }) };
  return sitePage('Who the AI assistants recommend: superyacht ' + c.name.toLowerCase() + ' | YachtingSignals', h, { desc: 'Which superyacht ' + c.name.toLowerCase() + ' brands ChatGPT, Gemini, Claude and Perplexity recommend to buyers, measured monthly by YachtingSignals.', ld: JSON.stringify(ld).replace(/</g, '\\u003c') });
}
function notFoundPage() { return sitePage('Page not found | YachtingSignals', '<main class="narrow"><h1>Page not found</h1><p><a href="/">Go to the homepage</a></p></main>', { status: 404, noindex: true }); }
const CAT_OPTS = { decking: 'Teak and decking', connectivity: 'Connectivity', propulsion: 'Hybrid and propulsion', refit: 'Refit yards', tenders: 'Tenders and toys' };
const PLANS = {
  report: { name: 'Monthly report', price: '&pound;20 a month', head: 'Get the monthly report', line: 'Every month: your rank and AI visibility score, every buyer question with your result on each assistant, the websites each one trusts, and how it describes you. Founding price &pound;20 a month, fixed for 12 months, or &pound;200 a year.', cta: 'Request the monthly report' },
  pro: { name: 'Pro', price: '&pound;59 a month', head: 'Get Pro', line: 'Everything in the monthly report, plus 50 search terms of your own, paid ChatGPT shown next to free, and testing from up to 5 markets in the local language.', cta: 'Request Pro' },
  fix: { name: 'Visibility fix', price: '&pound;250 one-off', head: 'Book the visibility fix', line: 'Your 3 biggest gaps, ready-to-paste text for your own website, edits written for up to 3 of your existing pages, the websites to get listed on, and re-checks after 30 and 60 days.', cta: 'Book the fix' }
};
const HP = '<div class="hp" aria-hidden="true"><label for="hp">Leave this empty</label><input id="hp" name="hp" tabindex="-1" autocomplete="off"></div>';
function planPage(planKey, msg) {
  const k = PLANS[planKey] ? planKey : 'report', p = PLANS[k];
  const h = '<p class="eyebrow">' + p.name + ' &middot; ' + p.price + '</p><h1>' + p.head + '</h1><p class="lead">' + p.line + '</p>' + (msg ? '<p class="err">' + esc(msg) + '</p>' : '') +
    '<form method="post" action="/start" class="card" style="position:relative"><input type="hidden" name="plan" value="' + k + '">' + HP +
    '<label for="s-company">Company name</label><input id="s-company" name="company" required maxlength="80" autocomplete="organization"><label for="s-email">Work email</label><input id="s-email" name="email" type="email" required maxlength="120" autocomplete="email"><label for="s-website">Website</label><input id="s-website" name="website" maxlength="120" placeholder="example.com"><label for="s-note">Anything we should know? (optional)</label><textarea id="s-note" name="note" rows="3" maxlength="600"></textarea><button type="submit">' + p.cta + '</button></form>' +
    '<p class="muted">We will email you a secure payment link and confirm the details before anything starts. Nothing is charged until you pay that link. Not sure yet? <a href="/check">Run the free check first</a>.</p>';
  return sitePage(p.head + ' | YachtingSignals', '<main class="narrow">' + h + '</main>', { noindex: true });
}
async function planPost(req, env) {
  const f = await req.formData();
  const k = String(f.get('plan') || ''); if (!PLANS[k]) return planPage('report', 'Please choose a plan.');
  if (String(f.get('hp') || '')) return sitePage('Thank you', '<main class="narrow"><h1>Thank you</h1></main>', { noindex: true });
  const company = String(f.get('company') || '').trim().slice(0, 80), email = String(f.get('email') || '').trim().slice(0, 120), website = String(f.get('website') || '').trim().slice(0, 120), note = String(f.get('note') || '').trim().slice(0, 600);
  if (company.length < 2 || !CK_EMAIL.test(email)) return planPage(k, 'Please enter your company name and a valid email address.');
  const ip = await ipHash(req);
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > datetime('now','-1 day')").bind(ip).first()).n;
  if (n < 10) await env.DB.prepare('INSERT INTO leads (kind, value, email, company, website, note, ip) VALUES (?,?,?,?,?,?,?)').bind('plan', k, email, company, website, note, ip).run();
  return sitePage('Thank you | YachtingSignals', '<main class="narrow"><p class="eyebrow">' + PLANS[k].name + '</p><h1>Thank you, ' + esc(company) + '</h1><p class="lead">We have your request. We will email ' + esc(email) + ' with a secure payment link and confirm the details before anything starts.</p><p><a class="btn" href="/check">Run a free check while you wait</a></p></main>', { noindex: true });
}
async function votePost(req, env) {
  const f = await req.formData(), back = new URL(req.url).origin + '/';
  if (String(f.get('hp') || '')) return Response.redirect(back + '?vote=ok#vote', 303);
  const cat = String(f.get('cat') || ''), email = String(f.get('email') || '').trim().slice(0, 120);
  if (!CAT_OPTS[cat] || !CK_EMAIL.test(email)) return Response.redirect(back + '?vote=bad#vote', 303);
  const ip = await ipHash(req);
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > datetime('now','-1 day')").bind(ip).first()).n;
  if (n < 10) await env.DB.prepare('INSERT INTO leads (kind, value, email, ip) VALUES (?,?,?,?)').bind('vote', cat, email, ip).run();
  return Response.redirect(back + '?vote=ok#vote', 303);
}
function privacyPage() {
  const h = '<h1>Privacy</h1><p class="muted">Last updated 23 November 2026</p>' +
    '<p>YachtingSignals is run by TENFEET LTD (company number 09894030, 128 City Road, London, EC1V 2NX). This page explains what we collect through this website and why.</p>' +
    '<h3>What we collect</h3><p>When you run a free check, we keep the company name, what you sell, your website and email if you give them, and the answers ChatGPT gave. When you request a plan or vote for a category, we keep what you enter in the form. We also keep a one-way scrambled version of your IP address to stop the forms being overused; we cannot turn it back into your address.</p>' +
    '<h3>Why</h3><p>To show you your result, to reply to your request, and to email you about the report or category you asked about. We do not sell your details or use them for anything else.</p>' +
    '<h3>Who else handles it</h3><p>The site and its database run on Cloudflare. For the free check, the product you sell is sent to OpenAI as part of the questions, and the answers are read by Anthropic&rsquo;s Claude to pick out the brand names. Fonts are loaded from Google Fonts, which sees your IP address when the page loads. We use Google Analytics, loaded through Google Tag Manager, to count visits and see which pages are used; it sets cookies on your device. We do not use it for advertising or remarketing.</p>' +
    '<h3>Your choices</h3><p>You can ask to see, correct or delete what we hold about you at any time by emailing <a href="mailto:hello@yachtingsignals.com">hello@yachtingsignals.com</a>. You can also complain to the UK Information Commissioner&rsquo;s Office (ico.org.uk).</p>';
  return sitePage('Privacy | YachtingSignals', '<main class="narrow">' + h + '</main>');
}
function stat(n, t) { return '<div class="stat"><div class="n">' + n + '</div><div class="t">' + t + '</div></div>'; }
async function homePage(env, url) {
  const cat = 'stabilisers';
  const last = await publicRun(env, cat);
  const d = last ? await leagueData(env, last.id) : null;
  const es = d ? engList(d) : [], nE = es.length, nQ = d ? await nQuestions(env, last.id) : 0;
  let h = '<section class="hero"><div class="in"><div class="hero-l"><p class="eyebrow">For superyacht suppliers</p><h1>When a buyer asks ChatGPT for a shortlist, are you on it?</h1><p class="lead">Shipyard buyers, refit managers and naval architects now ask AI assistants which suppliers to call. Every month we ask ChatGPT, Gemini, Claude and Perplexity the same buyer questions and publish who they recommend.</p>' +
    '<form id="check" class="card" method="post" action="/check" style="max-width:620px;margin-top:24px;padding:24px"><div class="serif" style="font-size:22px;margin:0 0 2px">Free check: does ChatGPT recommend you?</div><div class="row"><div><label for="hc-company">Company name</label><input id="hc-company" name="company" required maxlength="80" autocomplete="organization"></div><div><label for="hc-product">What you sell</label><input id="hc-product" name="product" required maxlength="80" placeholder="e.g. gyro stabilisers"></div></div>' +
    '<div class="row"><div><label for="hc-website">Website (optional)</label><input id="hc-website" name="website" maxlength="120" placeholder="example.com"></div><div style="flex:0 0 auto;margin-top:12px"><button type="submit">Run my free check</button></div></div><p class="muted" style="margin:12px 0 0">3 buyer questions on free ChatGPT, web search on. About a minute. No sign-up, no card.</p></form></div><div class="hero-r">';
  if (d) {
    h += '<div class="card" style="margin:0;padding:24px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span class="eyebrow" style="margin:0;font-size:12px">This month&rsquo;s league</span><span class="muted">' + fmtDate(d.run.created_at, true) + '</span></div><div class="serif" style="font-size:22px;margin:6px 0 10px">Superyacht stabilisers</div>';
    d.rows.slice(0, 5).forEach(function (r, i) { const s = Math.round(100 * (r.score || 0)); h += '<div class="bar" style="margin:9px 0;font-size:15px"><span class="muted" style="width:14px">' + (i + 1) + '</span><span style="width:110px;font-weight:700">' + esc(r.name) + '</span><div class="tr"><div class="fl" style="width:' + s + '%"></div></div><b>' + s + '</b></div>'; });
    h += '<p class="muted" style="border-top:1px solid #EEF1F3;padding-top:10px;margin:12px 0 8px">AI visibility score out of 100, from ' + d.tot + ' answers on ' + engNames(d) + '.</p><a href="#league" style="font-weight:700">See the full top 10</a></div>';
  }
  h += '</div></div></section><div class="wrap">';
  if (d && nE > 1) {
    const agree = (await env.DB.prepare("SELECT COUNT(*) AS n FROM (SELECT a.prompt_id FROM mentions m JOIN answers a ON a.id = m.answer_id WHERE m.run_id = ? AND m.position = 1 AND m.brand_id IS NOT NULL GROUP BY a.prompt_id HAVING COUNT(DISTINCT a.engine) = ? AND COUNT(DISTINCT m.brand_id) = 1)").bind(last.id, nE).first()).n;
    const shared = (await env.DB.prepare("SELECT COUNT(*) AS n FROM (SELECT c.domain FROM citations c JOIN answers a ON a.id = c.answer_id WHERE c.run_id = ? AND c.domain <> '' GROUP BY c.domain HAVING COUNT(DISTINCT a.engine) = ?)").bind(last.id, nE).first()).n;
    let lead = null; for (const r of d.rows) if (!lead || (r.firsts || 0) > (lead.firsts || 0)) lead = r;
    const all = ({ 2: 'both', 3: 'all three', 4: 'all four' })[nE] || 'all ' + nE;
    h += '<div class="card stats grid4" style="padding:24px 28px">' + stat(agree + ' of ' + nQ, 'buyer questions where ' + all + ' assistants named the same brand first') + (lead ? stat((lead.firsts || 0) + ' of ' + d.tot, 'answers name ' + esc(lead.name) + ' first. Being listed is not being recommended') : '') + stat(String(shared), 'websites trusted by ' + all + ' assistants. Each one reads different sources') + stat('1st', 'of every month: the same questions, asked again, so movement is real') + '</div>';
  }
  if (d) {
    h += '<section class="s card" id="league" style="padding:30px"><div style="display:flex;flex-wrap:wrap;gap:4px 24px;justify-content:space-between;align-items:baseline"><h2>Who the AI assistants recommend: stabilisers</h2><span class="muted">Run ' + fmtDate(d.run.created_at) + ' &middot; ' + nQ + ' buyer questions &middot; ' + d.tot + ' answers</span></div><p style="color:var(--body);max-width:780px">Ranked by AI visibility score: how often each assistant names the brand, weighted by how many people use that assistant. The columns on the right show how many answers named it on each one.</p>' + pubTable(d, 10) + '<p style="margin:14px 0 0"><a href="/league/stabilisers" style="font-weight:700">Full league and method</a> &middot; <a href="/league/decking" style="font-weight:700">Also live: decking and flooring</a> &middot; <a href="/league/lighting" style="font-weight:700">lighting</a> &middot; <a href="/league/brokerage" style="font-weight:700">brokerage and charter</a> &middot; <a href="/league/">All leagues</a></p></section>';
  }
  h += '<section class="s"><h2>What the November 2026 run showed</h2><div class="grid" style="margin-top:18px">' +
    '<div class="card" style="margin:0"><h3>Each assistant tells a different story</h3><p style="color:var(--body);margin:0">Humphree is named in 16 of 20 Claude answers but 7 on ChatGPT, the assistant most buyers use. Checking one assistant gives you only part of the picture.</p></div>' +
    '<div class="card" style="margin:0"><h3>ChatGPT reads your own website</h3><p style="color:var(--body);margin:0">ChatGPT&rsquo;s most-cited sources are the makers&rsquo; own sites. Claude leans on trade press, Gemini on YouTube. What your pages say is what the biggest assistant repeats.</p></div>' +
    '<div class="card" style="margin:0"><h3>The AI decides what size of yacht you suit</h3><p style="color:var(--body);margin:0">One well-known gyro brand is repeatedly placed on smaller yachts, citing its own sizing page. That keeps it off larger-yacht shortlists.</p></div></div></section>';
  h += '<section class="s" id="how"><h2>How it works</h2><div class="grid steps" style="margin-top:18px">' +
    '<div><div class="step">1 &middot; Ask</div><p style="color:var(--body)">On the 1st of each month, the same set of buyer questions in each category goes to the main AI assistants, with web search on and no chat history.</p></div>' +
    '<div><div class="step">2 &middot; Record</div><p style="color:var(--body)">Every brand named is recorded in order, with every website the assistant cited. Each assistant runs on the model its free app gives most people.</p></div>' +
    '<div><div class="step">3 &middot; Score</div><p style="color:var(--body)">Brands are scored out of 100, weighted by real use: ChatGPT 71%, Gemini 19%, Claude 7%, Perplexity 3%. Together these cover about 95% of AI assistant use.</p></div></div>' +
    '<div class="pledge"><b>Nobody pays to be in the league.</b> Rankings come only from what the assistants say. Paying customers get their own report and help with their gaps, never a place in the table.</div></section>';
  h += '<section class="s" id="pricing"><h2>Simple pricing</h2><p style="color:var(--body);max-width:760px">Not sure yet? <a href="#check" style="font-weight:700">Start with the free check</a>. The monthly plans can be cancelled at any time.</p><div class="grid" style="margin-top:22px;align-items:stretch">' +
    '<div class="card price feat"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="tag">Monthly report</span><span class="badge">Start here</span></div><div class="amt">&pound;20<span> / month</span></div><p class="muted" style="margin:0">Founding price, fixed for 12 months. Or &pound;200 a year.</p><ul><li>Monthly buyer questions on ChatGPT, Gemini, Claude and Perplexity</li><li>Your rank, AI visibility score and movement</li><li>Every answer, with your result on each assistant</li><li>The websites each assistant trusts in your category</li><li>How each assistant describes you, with errors flagged</li></ul><a class="btn" href="/start?plan=report">Get the monthly report</a></div>' +
    '<div class="card price pro"><span class="tag">Pro</span><div class="amt">&pound;59<span> / month</span></div><p class="muted" style="margin:0">For suppliers selling across several markets.</p><ul><li>Everything in the monthly report</li><li>50 search terms of your own: products, models, competitors</li><li>Paid ChatGPT shown next to free</li><li>Testing from up to 5 markets, in the local language</li><li>An alert when a competitor overtakes you</li></ul><a class="btn" href="/start?plan=pro">Get Pro</a></div>' +
    '<div class="card price fix"><span class="tag">Visibility fix</span><div class="amt">&pound;250<span> one-off</span></div><p class="muted" style="margin:0">For suppliers missing from answers that matter.</p><ul><li>Your 3 biggest gaps, weighted to ChatGPT</li><li>Ready-to-paste text for your own website</li><li>Edits written for up to 3 of your existing pages</li><li>The websites to get listed on, and how</li><li>Re-checks after 30 and 60 days to show what changed</li></ul><a class="btn" href="/start?plan=fix">Book the fix</a></div></div>' +
    '<p class="muted" style="margin-top:16px">The fix promises the work and an honest measurement, not a ranking: assistants change, and new text can take one or two monthly runs to be picked up.</p></section>';
  const v = url.searchParams.get('vote');
  h += '<section class="s card" id="vote" style="padding:30px;display:flex;flex-wrap:wrap;gap:24px 40px"><div style="flex:1 1 280px"><h2 style="font-size:28px">Which category next?</h2><p style="color:var(--body);margin:0">Stabilisers is the first league. Tell us which part of the supply chain you want ranked next and we will email you when it goes live.</p></div>' +
    '<form method="post" action="/vote" style="flex:2 1 420px;position:relative">' + (v === 'ok' ? '<p class="ok">Thanks, your vote is in. We will email you when that league goes live.</p>' : v === 'bad' ? '<p class="err">Please pick a category and enter a valid email.</p>' : '') + HP +
    '<fieldset class="pills"><legend>Pick one</legend>' + Object.keys(CAT_OPTS).map(function (k, i) { return '<label><input type="radio" name="cat" value="' + k + '"' + (i === 0 ? ' required' : '') + '> ' + CAT_OPTS[k] + '</label>'; }).join('') + '</fieldset>' +
    '<div class="row" style="margin-top:6px"><div><label for="hv-email">Work email</label><input id="hv-email" name="email" type="email" required placeholder="you@company.com" autocomplete="email"></div><div style="flex:0 0 auto"><button type="submit">Vote</button></div></div></form></section>';
  h += '<section class="s"><h2>Questions</h2><div class="grid" style="gap:0 40px">' +
    '<details><summary>Is this the same as SEO?</summary><p>Related, but not the same. Google ranks pages; an AI assistant reads a handful of pages and writes its own shortlist. You can rank well on Google and still be missing from ChatGPT&rsquo;s answer.</p></details>' +
    '<details><summary>Why these assistants?</summary><p>ChatGPT, Gemini, Claude and Perplexity together cover about 95% of AI assistant use. Microsoft Copilot has no public way to run these questions, so it is left out, and Gemini stands in for Google&rsquo;s AI Overviews.</p></details>' +
    '<details><summary>Why do results move from month to month?</summary><p>Assistants search the web fresh each time and their models change. The report records the model behind every answer and only treats a movement as real once it holds for two months.</p></details>' +
    '<details><summary>Can I pay to move up the league?</summary><p>No. The league shows only what the assistants say. The &pound;250 fix helps you improve what they read about you, and the next monthly runs show whether it worked.</p></details></div></section></div>';
  return sitePage('YachtingSignals: which superyacht suppliers the AI assistants recommend', h, { desc: 'Every month YachtingSignals asks ChatGPT, Gemini, Claude and Perplexity the same buyer questions and publishes which superyacht suppliers they recommend. Free check: does ChatGPT recommend your company?' });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === '/robots.txt') return new Response('User-agent: *\nAllow: /\nDisallow: /admin\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      if (path === '/') return await homePage(env, url);
      if (path === '/vote' && req.method === 'POST') return await votePost(req, env);
      if (path === '/start') return req.method === 'POST' ? await planPost(req, env) : planPage(url.searchParams.get('plan'), '');
      if (path === '/privacy') return privacyPage();
      if (path === '/check' && req.method === 'POST') return await ckStart(req, env);
      if (path === '/check') return ckPage('Does ChatGPT recommend your company? Free check | YachtingSignals', ckForm(''), true);
      if (path.indexOf('/check/r/') === 0) return await ckShow(req, env, url);
      if (path === '/league') return await leaguePage(env, '');
      if (path.indexOf('/league/') === 0) return await leaguePage(env, decodeURIComponent(path.split('/')[2] || ''));
      if (path.indexOf('/admin') === 0) {
        if (!authed(req, env)) return new Response('Login needed', { status: 401, headers: { 'www-authenticate': 'Basic realm="AI tracker admin"' } });
        if (req.method === 'POST') {
          const f = await req.formData();
          let msg = '';
          if (path === '/admin/run') { const r = await createRun(env, f.get('cat'), Number(f.get('limit')), ''); msg = 'Run ' + r.run + ' started: ' + r.jobs + ' questions to ask (' + r.engines.map(function (e) { return LABEL[e]; }).join(', ') + ').'; }
          else if (path === '/admin/tick') { const n = await tick(env, 2); msg = 'Processed ' + n + ' job(s).'; }
          else if (path === '/admin/candidate') { msg = await resolveCandidate(env, f); }
          return adminPage(env, msg);
        }
        if (path === '/admin' || path === '/admin/') return adminPage(env, '');
        const runId = Number(url.searchParams.get('run'));
        if (path === '/admin/sources') return await adminSources(env, false);
        if (path === '/admin/sources.csv') return await adminSources(env, true);
        if (path === '/admin/league') {
          const d = await leagueData(env, runId);
          if (!d) return page('Not found', 'Run not found');
          let h = '<p><a href="/admin">&larr; Admin</a></p><h1>' + esc(d.run.cname) + ': run ' + d.run.id + '</h1><p class="muted">' + d.tot + ' answers (' + d.perEngine.map(function (e) { return LABEL[e.engine] + ' ' + e.n; }).join(', ') + '). ' + d.unmatched + ' brand mentions waiting for approval are not counted yet.</p>';
          h += '<h2>League table</h2>' + leagueTable(d, 0);
          h += await buyTable(env, runId);
          h += '<h2>Also named: not stabiliser makers (' + d.adjacent.length + ')</h2><p class="muted">Named by the AIs in stabiliser answers but not stabiliser makers. Not ranked; each one took a place a stabiliser maker could have had.</p>' + (d.adjacent.length ? '<table><tr><th>Company</th><th>What they actually do</th><th class="n">Answers naming it</th></tr>' + d.adjacent.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.note || '') + '</td><td class="n">' + r.ans + '</td></tr>'; }).join('') + '</table>' : '<p>None.</p>');
          h += '<h2>METSTRADE exhibitors not named in any answer (' + d.missing.length + ')</h2><p>' + (d.missing.length ? d.missing.map(function (m) { return esc(m.name) + ' <span class="tag">' + esc(m.booth || '') + '</span>'; }).join(' &nbsp; ') : 'None: every exhibitor was named at least once.') + '</p>';
          h += '<h2>Websites the AIs cite most</h2><table><tr><th>Website</th><th class="n">Answers citing it</th></tr>' + d.domains.map(function (x) { return '<tr><td>' + esc(x.domain) + '</td><td class="n">' + x.n + '</td></tr>'; }).join('') + '</table>';
          return page('Run ' + d.run.id, h);
        }
        if (path === '/admin/answers') {
          const rows = (await env.DB.prepare('SELECT a.id, a.engine, a.model, a.text, p.n FROM answers a JOIN prompts p ON p.id = a.prompt_id WHERE a.run_id = ? ORDER BY p.n, a.engine').bind(runId).all()).results;
          let h = '<p><a href="/admin">&larr; Admin</a></p><h1>Answers, run ' + runId + '</h1>';
          for (const a of rows) {
            const ms = (await env.DB.prepare('SELECT m.raw_name, m.position, b.name FROM mentions m LEFT JOIN brands b ON b.id = m.brand_id WHERE m.answer_id = ? ORDER BY m.position').bind(a.id).all()).results;
            const cs = (await env.DB.prepare('SELECT DISTINCT domain FROM citations WHERE answer_id = ?').bind(a.id).all()).results;
            h += '<h2>Question ' + a.n + ': ' + esc(LABEL[a.engine]) + ' <span class="muted">' + esc(a.model) + '</span></h2><p><b>Brands found:</b> ' + (ms.map(function (m) { return esc(m.name || (m.raw_name + ' (waiting)')); }).join(', ') || 'none') + '<br><b>Sources:</b> ' + (cs.map(function (c) { return esc(c.domain); }).join(', ') || 'none') + '</p><pre>' + esc(a.text) + '</pre>';
          }
          return page('Answers', h);
        }
        if (path === '/admin/export.csv') {
          const rows = (await env.DB.prepare('SELECT a.run_id, a.engine, a.model, p.n, m.position, m.raw_name, b.name AS brand, b.exhibitor FROM mentions m JOIN answers a ON a.id = m.answer_id JOIN prompts p ON p.id = a.prompt_id LEFT JOIN brands b ON b.id = m.brand_id WHERE a.run_id = ? ORDER BY p.n, a.engine, m.position').bind(runId).all()).results;
          const lines = ['run,assistant,model,question,position,name_as_written,brand,exhibitor'].concat(rows.map(function (r) { return [r.run_id, LABEL[r.engine], r.model, r.n, r.position, r.raw_name, r.brand || '', r.exhibitor ? 'yes' : ''].map(csvCell).join(','); }));
          return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="run-' + runId + '.csv"' } });
        }
        return page('Not found', 'Not found');
      }
      return notFoundPage();
    } catch (e) {
      if (path.indexOf('/admin') === 0) return page('Error', '<h1>Something went wrong</h1><pre>' + esc((e && e.message) || e) + '</pre>');
      return sitePage('Back shortly | YachtingSignals', '<main class="narrow" style="padding-top:44px"><h1>Back shortly</h1><p>The league tables are being updated. Please try again in a few hours.</p><p><a href="/check">The free AI check</a> may also be unavailable until then.</p></main>', { status: 503, noindex: true });
    }
  },
  async scheduled(event, env, ctx) {
    if (event.cron === '0 3 1 * *') {
      const cats = (await env.DB.prepare('SELECT id FROM categories WHERE active = 1').all()).results;
      for (const c of cats) { try { await createRun(env, c.id, 1000, 'monthly'); } catch (e) {} }
      return;
    }
    await tick(env, 5);
  }
};
