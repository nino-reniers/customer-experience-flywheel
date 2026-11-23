'use strict';

const { q, q1 } = require('./db');
const auth = require('./auth');
const { runValidity, runOverlap } = require('./checks');
const ui = require('./ui');

const esc = ui.esc, layout = ui.layout, statusBadge = ui.statusBadge, overlapBadge = ui.overlapBadge;
const validityChip = ui.validityChip, exampleBadge = ui.exampleBadge, fmtDate = ui.fmtDate;
const checkRows = ui.checkRows, field = ui.field, roleChip = ui.roleChip;
const CATEGORIES = ui.CATEGORIES, REQ_TYPES = ui.REQ_TYPES, EFFORTS = ui.EFFORTS, CONFIDENCES = ui.CONFIDENCES;
const DRIVERS = ui.DRIVERS, driverChip = ui.driverChip, flywheelSvg = ui.flywheelSvg;
const DRIVER_OPTIONS = [{ value: '', label: '— pick a flywheel driver —' }].concat(DRIVERS.map(d => ({ value: d.id, label: d.n + ' · ' + d.id, group: d.phase })));
const SUBDRIVERS = ui.SUBDRIVERS, LEAVES = ui.LEAVES;
const SUB_OPTIONS = [{ value: '', label: '— optional —' }].concat(DRIVERS.map(d => (SUBDRIVERS[d.id] || []).map(sd => ({ value: sd, label: sd, group: d.n + ' · ' + d.id }))).reduce((a, b) => a.concat(b), []));

const wrap = fn => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
const str = (v, max) => { const m = max || 4000; return String(v == null ? '' : v).trim().slice(0, m); };
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

const FLASH = {
  submitted: 'Submitted for review. The overlap and validity checks have run — an owner will now take a look.',
  drafted: 'Saved as draft. Submit it for review whenever you are ready.',
  accepted: 'Accepted — the entry is now published in the library.',
  rejected: 'Rejected — feedback has been left for the submitter.',
  merged: 'Marked as a duplicate and merged into the target entry.',
  rechecked: 'Checks re-run against the latest content.',
  saved: 'Saved.',
  impact: 'Impact sizing saved.',
  necessity: 'Technical requirement added.',
  removed: 'Technical requirement removed.',
  role: 'Role updated.',
  reason: 'Churn reason added.',
  registered: 'Account created — you are signed in.'
};
const ERR_FLASH = {
  feedback: 'A rejection needs feedback so the submitter knows what to improve.',
  merge: 'Merge failed — enter the ID of an existing accepted hypothesis (not this one).',
  lastowner: 'The library must keep at least one owner.'
};
const flashHtml = req => {
  const ok = FLASH[str(req.query.ok, 30)];
  const err = ERR_FLASH[str(req.query.err, 30)];
  let out = '';
  if (ok) out += '<div class="flash">' + esc(ok) + '</div>';
  if (err) out += '<div class="flash err">' + esc(err) + '</div>';
  return out;
};

function canView(h, user) { return h.status === 'accepted' || user.role === 'owner' || h.created_by === user.id; }
function canEdit(h, user) {
  return user.role === 'owner' || (h.created_by === user.id && (h.status === 'draft' || h.status === 'rejected'));
}

function notFoundPage(req) {
  const user = req && req.user;
  return layout({ title: 'Not found', user, content: '<div class="card"><h2>Not found</h2><p class="muted">That page or entry does not exist, or you cannot see it.</p><p><a class="btn btn-secondary" href="/">Back to the library</a></p></div>' });
}

function forbiddenPage() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Owners only</title><link rel="stylesheet" href="/styles.css"></head><body><header class="topbar"><div class="brand"><span class="brandmark">CX</span><span class="brandname">Customer Experience Library</span></div></header><main class="container"><div class="card"><h2>Owners only</h2><p class="muted">You need the owner role to open this page.</p><p><a class="btn btn-secondary" href="/">Back to the library</a></p></div></main></body></html>';
}

async function latestChecksFor(ids) {
  const map = new Map();
  if (!ids || !ids.length) return map;
  const rows = await q(
    'select distinct on (hypothesis_id, check_type) hypothesis_id, check_type, score, result from hypothesis_checks where hypothesis_id = any($1::bigint[]) order by hypothesis_id, check_type, created_at desc',
    [ids]);
  for (const r of rows) {
    const key = String(r.hypothesis_id);   // pg returns bigint ids as strings
    if (!map.has(key)) map.set(key, {});
    const entry = (r.result && typeof r.result === 'object') ? r.result : {};
    entry.score = Number(r.score);
    map.get(key)[r.check_type] = entry;
  }
  return map;
}

async function runChecksAndStore(id) {
  const h = await q1('select * from hypotheses where id = $1', [id]);
  if (!h) return null;
  const candidates = await q(
    "select id, title, if_we, because_mechanism, primary_metric, churn_reason_id, status from hypotheses where status in ('accepted','submitted') and id <> $1",
    [id]);
  const validity = runValidity(h);
  const overlap = runOverlap(h, candidates);
  await q(
    "insert into hypothesis_checks (hypothesis_id, check_type, score, result) values ($1, 'validity', $2, $3::jsonb), ($1, 'overlap', $4, $5::jsonb)",
    [id, validity.score, JSON.stringify(validity), Math.round(overlap.score * 100), JSON.stringify(overlap)]);
  return { validity: validity, overlap: overlap };
}

// A "why customers are leaving" window: clear title, one bullet per sentence,
// inline [n] markers as small superscripts, and a source footnote with links.
function reasonCard(title, body, sources, plainSource) {
  const bullets = String(body || '').split(/\n+/).map(b => b.trim()).filter(Boolean).map(b => {
    let t = esc(b);
    if (!/[.!?]$/.test(t)) t += '.';
    t = t.replace(/\[(\d+)\]/g, (m, n) => '<sup class="cite">[' + n + ']</sup>');
    return '<li>' + t + '</li>';
  }).join('');
  let srcnote = '';
  if (sources && sources.length) {
    const links = sources.map(src => '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">[' + esc(src.label) + ']</a>').join(' ');
    srcnote = '<div class="srcnote">' + (sources.length > 1 ? 'Sources:' : 'Source:') + ' ' + links + '</div>';
  } else if (plainSource) {
    srcnote = '<div class="srcnote">Source: ' + esc(plainSource) + '</div>';
  }
  return '<div class="card reasonbox"><h3>' + esc(title) + '</h3><ul class="reasonbullets">' + bullets + '</ul>' + srcnote + '</div>';
}

function hypCard(row, chk) {
  const c = chk || {};
  const ov = c.overlap ? c.overlap.verdict : null;
  const body = String(row.if_we || '');
  return '<div class="card hyp">' +
    '<div class="card-top">' + statusBadge(row.status) + ' ' + exampleBadge(row.is_example) + ' ' + validityChip(c.validity) + ' ' + overlapBadge(ov) + '</div>' +
    '<h3><a href="/hypotheses/' + row.id + '">' + esc(row.title) + '</a></h3>' +
    '<p class="muted small">' + esc(row.reason_title) + ' · ' + esc(row.category) + (row.flywheel_driver ? ' · ' + esc(row.flywheel_driver) : '') + '</p>' +
    '<p class="excerpt">' + esc(body.slice(0, 180)) + (body.length > 180 ? '…' : '') + '</p>' +
    '<p class="muted small">by ' + esc(row.creator || 'Example content') + '</p>' +
    '</div>';
}

// ---------------------------------------------------------------- auth pages

async function loginPage(req, res) {
  if (req.user) return res.redirect('/');
  const bad = str(req.query.err, 20) === 'bad';
  const content = '<div class="authwrap"><div class="card authcard">' +
    '<h1>Sign in</h1>' +
    '<p class="muted">Why customers stop ordering at JET, hypotheses to tackle each reason, impact sizings and technical necessities — curated by the owners.</p>' +
    (bad ? '<div class="flash err">Wrong email or password.</div>' : '') +
    '<form method="post" action="/login">' +
    field('Email', 'email', '', { required: true, type: 'email' }) +
    field('Password', 'password', '', { required: true, type: 'password' }) +
    '<button class="btn">Sign in</button></form>' +
    '<p class="muted">Opening this app from the Toqan <strong>Apps</strong> section signs you in automatically with your Toqan account — no registration needed. The first person to open the app becomes its owner.</p>' +
    '<p class="muted small">Seeing this page inside Toqan anyway? Tell ToqanClaw in chat. Accounts created before automatic sign-in can still use the form above; they link themselves to the Toqan account with the same email.</p>' +
    '</div></div>';
  res.send(layout({ title: 'Sign in', content: content }));
}

async function loginPost(req, res) {
  const email = str(req.body.email, 200).toLowerCase();
  const user = await q1('select * from users where email = $1', [email]);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) return res.redirect('/login?err=bad');
  await auth.createSession(res, user.id);
  res.redirect('/');
}

async function logoutPost(req, res) {
  await auth.destroySession(req, res);
  res.redirect('/login');
}

// Temporary identity diagnostics: shows what the platform passes to the app,
// so we can check whether Toqan account identity is available for auto sign-in.
async function diagnosticsPage(req, res) {
  const rows = [];
  for (const key of Object.keys(req.headers)) {
    let val = String(req.headers[key]);
    if (key === 'cookie') val = val.split(';').map(c => c.split('=')[0].trim()).filter(Boolean).join(', ') + ' (values hidden)';
    if (key === 'authorization') { val = auth.describeAuth(val); if (val.length > 1200) val = val.slice(0, 1200) + '…'; }
    if (val.length > 300) val = val.slice(0, 300) + '…';
    rows.push('<tr><td>' + esc(key) + '</td><td>' + esc(val) + '</td></tr>');
  }
  const content =
    '<div class="pagehead"><h1>Identity check</h1>' +
    '<p class="muted">Diagnostics. Toqan sends <strong>x-forwarded-user</strong> — your stable Toqan account id — and the app now uses it to sign you in automatically. The Authorization header is decoded below for inspection only; its raw value stays hidden. If the decoded claims contain your name or email but your profile still shows a placeholder name, send this page back to ToqanClaw.</p></div>' +
    '<div class="card"><h3>Request</h3><dl class="kv"><dt>Path</dt><dd>' + esc(req.originalUrl) + '</dd><dt>Method</dt><dd>' + esc(req.method) + '</dd></dl></div>' +
    '<div class="card"><h3>Headers received</h3><table class="list"><tr><th>Header</th><th>Value</th></tr>' + rows.join('') + '</table></div>' +
    '<div class="card"><h3>What to look for</h3><p class="muted">Anything containing an email address, your name, or keys named like user, sub, account, identity, or x-toqan-… . Cookie values are hidden on purpose.</p></div>';
  res.send(layout({ title: 'Identity check', user: req.user, content: content }));
}

async function profilePage(req, res) {
  const content =
    '<div class="pagehead"><h1>Your profile</h1>' +
    '<p class="muted">Your account was created automatically from your Toqan sign-in. Set the display name shown on your submissions and reviews.</p></div>' +
    '<form method="post" action="/profile" class="card form">' +
    field('Display name', 'name', req.user.name, { required: true }) +
    '<p class="muted small">Email on file: ' + esc(req.user.email || 'not shared by Toqan') + '</p>' +
    '<button class="btn">Save</button></form>';
  res.send(layout({ title: 'Your profile', user: req.user, active: '', content: content }));
}

async function profilePost(req, res) {
  const name = str(req.body.name, 100);
  if (!name) return res.redirect('/profile');
  await q('update users set name = $2, name_is_placeholder = false, updated_at = now() where id = $1', [req.user.id, name]);
  req.user.name = name;
  res.redirect('/?ok=saved');
}

// ---------------------------------------------------------------- library home

async function home(req, res) {
  const category = str(req.query.category, 60);
  const search = str(req.query.q, 100);
  const driver = DRIVERS.some(d => d.id === str(req.query.driver, 60)) ? str(req.query.driver, 60) : '';
  let sub = '';
  if (driver) {
    const list = SUBDRIVERS[driver] || [];
    const sv = str(req.query.sub, 120);
    sub = list.indexOf(sv) >= 0 ? sv : (list[0] || '');
  }
  let type = '';
  if (sub) {
    const tv = str(req.query.type, 120);
    const tlist = LEAVES[sub] || ['Placeholder 1', 'Placeholder 2'];
    type = tlist.indexOf(tv) >= 0 ? tv : (tlist[0] || '');
  }
  let taxRow = '';
  if (driver) {
    const subs = SUBDRIVERS[driver] || [];
    const tlist = sub ? (LEAVES[sub] || ['Placeholder 1', 'Placeholder 2']) : [];
    const sel = (name, opts, cur) => '<select name="' + name + '" onchange="this.form.submit()">' +
      opts.map(o => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(cur) ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select>';
    const subOpts = subs.map(sd => ({ value: sd, label: sd }));
    const typeOpts = tlist.map(t => ({ value: t, label: t }));
    taxRow = '<div class="taxrow">' +
      '<form method="get" action="/" class="taxform">' +
      '<input type="hidden" name="q" value="' + esc(search) + '">' +
      '<input type="hidden" name="category" value="' + esc(category) + '">' +
      '<input type="hidden" name="driver" value="' + esc(driver) + '">' +
      '<div class="taxpair"><label>Sub-driver</label>' + sel('sub', subOpts, sub) + '</div>' +
      '<div class="taxpair"><label>Type</label>' + sel('type', typeOpts, type) + '</div>' +
      '<noscript><button class="btn" type="submit">Apply</button></noscript>' +
      '</form>' +
      '</div>';
  }
  let reasonSection = '';
  if (driver || search) {
    const lrows = await q(
      "select title, body, sources from leaving_reasons where ($1 = '' or flywheel_driver = $1) and ($2 = '' or flywheel_subdriver = $2 or flywheel_subdriver is null) and ($3 = '' or flywheel_type = $3 or flywheel_type is null) and ($4 = '' or title ilike '%' || $4 || '%' or body ilike '%' || $4 || '%') order by id",
      [driver, sub, type, search]);
    const crows = await q(
      "select title as ctitle, description, evidence_source from churn_reasons where ($1 = '' or flywheel_driver = $1) and ($2 = '' or flywheel_subdriver = $2 or flywheel_subdriver is null) and ($3 = '' or flywheel_type = $3 or flywheel_type is null) and ($4 = '' or title ilike '%' || $4 || '%' or description ilike '%' || $4 || '%') order by id",
      [driver, sub, type, search]);
    const boxes = [];
    for (const r of lrows) boxes.push(reasonCard(r.title, r.body, r.sources, null));
    for (const r of crows) boxes.push(reasonCard(r.ctitle, r.description, null, r.evidence_source));
    if (boxes.length) reasonSection = '<p class="rowlabel">Customer pain points</p><div class="reasonboxes">' + boxes.join('') + '</div>';
  }
  const hero = '<div class="card hero">' +
    '<h2>Customer Experience flywheel</h2>' +
    '<p class="muted">The stronger our growth flywheel and its six drivers, the better our customer\u2019s experience.</p>' +
    '<div class="hero-wheel">' + flywheelSvg(driver) + '</div></div>';
  const content =
    flashHtml(req) + hero +
    taxRow +
    reasonSection;
  res.send(layout({ title: 'Library', user: req.user, active: '/', content: content, search: { driver: driver, sub: sub, type: type } }));
}

// ---------------------------------------------------------------- churn reasons

async function reasonsPage(req, res) {
  const rows = await q(
    "select r.id, r.title, r.category, r.description, r.is_example, r.flywheel_driver, \
       (select count(*)::int from hypotheses h where h.churn_reason_id = r.id and h.status = 'accepted') as accepted_count, \
       (select count(*)::int from hypotheses h where h.churn_reason_id = r.id) as total_count \
     from churn_reasons r order by r.created_at desc limit 300");
  const list = rows.map(r => '<div class="card">' +
    '<div class="card-top">' + exampleBadge(r.is_example) + driverChip(r.flywheel_driver) + '<span class="chip static">' + esc(r.category) + '</span></div>' +
    '<h3><a href="/reasons/' + r.id + '">' + esc(r.title) + '</a></h3>' +
    '<p>' + esc(r.description) + '</p>' +
    '<p class="muted small">' + r.accepted_count + ' accepted of ' + r.total_count + ' submitted</p></div>').join('') ||
    '<div class="card empty"><p>No churn reasons yet.</p></div>';
  let addForm = '';
  if (req.user.role === 'owner') {
    addForm = '<details class="card"><summary>Add a churn reason</summary><form method="post" action="/reasons">' +
      field('Title', 'title', '', { required: true, placeholder: 'e.g. Delivery fees feel too high' }) +
      field('Category', 'category', '', { options: [''].concat(CATEGORIES), required: true }) +
      field('Flywheel driver', 'driver', '', { options: DRIVER_OPTIONS, hint: 'Where on the experience flywheel does this sit?' }) +
      field('Description', 'description', '', { textarea: true, required: true, placeholder: 'What is going wrong for the customer?' }) +
      field('Evidence source', 'evidence_source', '', { placeholder: 'e.g. Exit survey 2025, NPS verbatims, churn interviews' }) +
      field('Affected segment', 'affected_segment', '', { placeholder: 'Which customers does this hit?' }) +
      '<button class="btn">Add reason</button></form></details>';
  }
  const content =
    '<div class="pagehead"><h1>Churn reasons</h1><p class="muted">Why customers stop ordering at JET — the backbone of the library.</p></div>' +
    flashHtml(req) + addForm + '<div class="grid">' + list + '</div>';
  res.send(layout({ title: 'Churn reasons', user: req.user, active: '/reasons', content: content }));
}

async function reasonPost(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const title = str(req.body.title, 200);
  const category = str(req.body.category, 60);
  const description = str(req.body.description, 2000);
  const driver = str(req.body.driver, 60);
  const subdriver = str(req.body.subdriver, 120);
  if (!title || !category || !description) return res.redirect('/reasons');
  if (!DRIVERS.some(d => d.id === driver)) return res.redirect('/reasons');
  if (subdriver && (SUBDRIVERS[driver] || []).indexOf(subdriver) < 0) return res.redirect('/reasons');
  await q('insert into churn_reasons (title, category, description, evidence_source, affected_segment, flywheel_driver, flywheel_subdriver, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [title, category, description, str(req.body.evidence_source, 500), str(req.body.affected_segment, 500), driver, subdriver || null, req.user.id]);
  res.redirect('/reasons?ok=reason');
}

async function reasonDriverPost(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const id = int(req.params.id);
  const driver = str(req.body.driver, 60);
  const subdriver = str(req.body.subdriver, 120);
  if (!DRIVERS.some(d => d.id === driver)) return res.redirect('/reasons/' + id);
  if (subdriver && (SUBDRIVERS[driver] || []).indexOf(subdriver) < 0) return res.redirect('/reasons/' + id);
  await q('update churn_reasons set flywheel_driver = $2, flywheel_subdriver = $3, updated_at = now() where id = $1', [id, driver, subdriver || null]);
  res.redirect('/reasons/' + id + '?ok=saved');
}

async function reasonDetail(req, res) {
  const id = int(req.params.id);
  const reason = id ? await q1('select * from churn_reasons where id = $1', [id]) : null;
  if (!reason) return res.status(404).send(notFoundPage(req));
  const rows = await q(
    "select h.id, h.title, h.if_we, h.status, h.created_at, h.is_example, r.title as reason_title, r.category, r.flywheel_driver, coalesce(u.name, 'Example content') as creator \
     from hypotheses h join churn_reasons r on r.id = h.churn_reason_id left join users u on u.id = h.created_by \
     where h.churn_reason_id = $1 order by h.created_at desc", [id]);
  const visible = rows.filter(h => canView(h, req.user));
  const checks = await latestChecksFor(visible.map(h => h.id));
  const cards = visible.map(h => hypCard(h, checks.get(h.id))).join('') ||
    '<div class="card empty"><p>No hypotheses tackle this reason yet.</p><p><a class="btn" href="/submit">Submit one</a></p></div>';
  let mapForm = '';
  if (req.user.role === 'owner') {
    mapForm = '<details><summary>' + (reason.flywheel_driver ? 'Change flywheel mapping' : 'Map this reason to the flywheel') + '</summary>' +
      '<form method="post" action="/reasons/' + reason.id + '/driver">' +
      field('Flywheel driver', 'driver', reason.flywheel_driver || '', { options: DRIVER_OPTIONS }) +
      field('Flywheel sub-driver (optional)', 'subdriver', reason.flywheel_subdriver || '', { options: SUB_OPTIONS }) +
      '<button class="btn">Save mapping</button></form></details>';
  }
  const content =
    '<div class="pagehead"><div class="card-top">' + exampleBadge(reason.is_example) + driverChip(reason.flywheel_driver) + (reason.flywheel_subdriver ? '<span class="chip static">' + esc(reason.flywheel_subdriver) + '</span>' : '') + '<span class="chip static">' + esc(reason.category) + '</span></div>' +
    '<h1>' + esc(reason.title) + '</h1></div>' +
    '<div class="card"><p>' + esc(reason.description) + '</p>' +
    (reason.evidence_source ? '<p class="muted small">Evidence: ' + esc(reason.evidence_source) + '</p>' : '') +
    (reason.affected_segment ? '<p class="muted small">Segment: ' + esc(reason.affected_segment) + '</p>' : '') +
    mapForm +
    '<p><a class="btn" href="/submit">Submit a hypothesis for this reason</a></p></div>' +
    '<div class="grid">' + cards + '</div>';
  res.send(layout({ title: reason.title, user: req.user, active: '/reasons', content: content }));
}

// ---------------------------------------------------------------- submit

async function submitPage(req, res, values, error) {
  const v = values || {};
  const reasons = await q('select id, title, category from churn_reasons order by title');
  const reasonOptions = [{ value: '', label: '— pick one —' }].concat(reasons.map(r => ({ value: r.id, label: r.title + ' (' + r.category + ')' })));
  const content =
    '<div class="pagehead"><h1>Submit a hypothesis</h1>' +
    '<p class="muted">Write it as: <em>If we [do X], then [metric] will [move] for [segment], because [mechanism].</em> The screening runs the moment you submit — you see the results immediately and can revise before an owner reviews.</p></div>' +
    (error ? '<div class="flash err">' + esc(error) + '</div>' : '') +
    '<form method="post" action="/submit" class="card form">' +
    '<h3>Churn reason</h3>' +
    field('Existing churn reason', 'reason_id', v.reason_id || '', { options: reasonOptions }) +
    '<details><summary>…or add a new churn reason</summary>' +
    field('New reason title', 'new_reason_title', v.new_reason_title || '', { placeholder: 'e.g. Delivery fees feel too high' }) +
    field('New reason category', 'new_reason_category', v.new_reason_category || '', { options: [''].concat(CATEGORIES) }) +
    field('Flywheel driver', 'new_reason_driver', v.new_reason_driver || '', { options: DRIVER_OPTIONS, hint: 'Where on the experience flywheel does this friction sit?' }) +
    field('Flywheel sub-driver (optional)', 'new_reason_subdriver', v.new_reason_subdriver || '', { options: SUB_OPTIONS, hint: 'The deeper part of the driver where this friction sits.' }) +
    field('New reason description', 'new_reason_description', v.new_reason_description || '', { textarea: true, placeholder: 'What is going wrong for the customer?' }) +
    '</details>' +
    '<h3>Hypothesis</h3>' +
    field('Title', 'title', v.title || '', { required: true, placeholder: 'Short name, e.g. "Show fees upfront on the list"' }) +
    field('If we…', 'if_we', v.if_we || '', { textarea: true, required: true, placeholder: '…show the total fees upfront on the restaurant list instead of at checkout' }) +
    field('…then…', 'then_outcome', v.then_outcome || '', { textarea: true, required: true, placeholder: '…checkout completion for fee-sensitive customers will increase by 2 percentage points within 6 weeks' }) +
    field('…because…', 'because_mechanism', v.because_mechanism || '', { textarea: true, required: true, placeholder: '…fee surprise at the final step, not the fee level, is the moment customers abandon' }) +
    field('For which segment', 'target_segment', v.target_segment || '', { required: true, placeholder: 'e.g. Fee-sensitive orderers in the pilot market' }) +
    field('Primary metric', 'primary_metric', v.primary_metric || '', { required: true, placeholder: 'e.g. Checkout completion rate' }) +
    field('Success criterion (how it passes or fails)', 'success_criterion', v.success_criterion || '', { placeholder: 'e.g. +2pct checkout completion vs. holdout within 6 weeks' }) +
    '<details><summary>Impact sizing (optional — owners can add later)</summary>' +
    field('Affected customers', 'affected_customers', v.affected_customers || '', { placeholder: 'e.g. 1.2m fee-sensitive orderers in the pilot market' }) +
    field('Expected lift', 'expected_lift', v.expected_lift || '', { placeholder: 'e.g. +2pct completion = 24k recovered orders per month' }) +
    field('Revenue at stake', 'revenue_at_stake', v.revenue_at_stake || '', { placeholder: 'e.g. 0.9m gross profit per month at current AOV' }) +
    field('Confidence', 'confidence', v.confidence || 'medium', { options: CONFIDENCES }) +
    field('Assumptions', 'assumptions', v.assumptions || '', { textarea: true }) +
    field('Sizing method', 'method', v.method || '', { placeholder: 'e.g. Cohort analysis of checkout funnel drop-off' }) +
    '</details>' +
    '<div class="btnrow"><button class="btn" name="action" value="submit">Submit for review</button>' +
    '<button class="btn btn-secondary" name="action" value="draft">Save as draft</button></div>' +
    '</form>';
  res.send(layout({ title: 'Submit', user: req.user, active: '/submit', content: content }));
}

async function submitPost(req, res) {
  const action = str(req.body.action, 10) === 'draft' ? 'draft' : 'submitted';
  const v = {
    reason_id: str(req.body.reason_id, 20), new_reason_title: str(req.body.new_reason_title, 200),
    new_reason_category: str(req.body.new_reason_category, 60), new_reason_description: str(req.body.new_reason_description, 2000),
    new_reason_driver: str(req.body.new_reason_driver, 60),
    new_reason_subdriver: str(req.body.new_reason_subdriver, 120),
    title: str(req.body.title, 200), if_we: str(req.body.if_we, 2000), then_outcome: str(req.body.then_outcome, 2000),
    because_mechanism: str(req.body.because_mechanism, 2000), target_segment: str(req.body.target_segment, 300),
    primary_metric: str(req.body.primary_metric, 200), success_criterion: str(req.body.success_criterion, 500),
    affected_customers: str(req.body.affected_customers, 500), expected_lift: str(req.body.expected_lift, 500),
    revenue_at_stake: str(req.body.revenue_at_stake, 500), confidence: str(req.body.confidence, 20) || 'medium',
    assumptions: str(req.body.assumptions, 2000), method: str(req.body.method, 500)
  };
  let reasonId = int(v.reason_id);
  if (reasonId) {
    const r = await q1('select id from churn_reasons where id = $1', [reasonId]);
    if (!r) return submitPage(req, res, v, 'That churn reason does not exist.');
  } else if (v.new_reason_title) {
    if (!v.new_reason_category || !v.new_reason_description) return submitPage(req, res, v, 'A new churn reason needs a category and a description.');
    if (!DRIVERS.some(d => d.id === v.new_reason_driver)) return submitPage(req, res, v, 'A new churn reason needs a flywheel driver — pick where on the experience flywheel this friction sits.');
    if (v.new_reason_subdriver && (SUBDRIVERS[v.new_reason_driver] || []).indexOf(v.new_reason_subdriver) < 0) return submitPage(req, res, v, 'That sub-driver does not belong to the chosen flywheel driver.');
    const r = await q1('insert into churn_reasons (title, category, description, flywheel_driver, flywheel_subdriver, created_by) values ($1, $2, $3, $4, $5, $6) returning id',
      [v.new_reason_title, v.new_reason_category, v.new_reason_description, v.new_reason_driver, v.new_reason_subdriver || null, req.user.id]);
    reasonId = r.id;
  } else {
    return submitPage(req, res, v, 'Pick an existing churn reason or add a new one.');
  }
  const required = ['title', 'if_we', 'then_outcome', 'because_mechanism', 'target_segment', 'primary_metric'];
  if (required.some(k => !v[k])) return submitPage(req, res, v, 'The title, the if/then/because parts, the segment and the primary metric are all required.');
  const hyp = await q1(
    'insert into hypotheses (churn_reason_id, title, if_we, then_outcome, because_mechanism, target_segment, primary_metric, success_criterion, status, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id',
    [reasonId, v.title, v.if_we, v.then_outcome, v.because_mechanism, v.target_segment, v.primary_metric, v.success_criterion, action, req.user.id]);
  if (v.affected_customers || v.expected_lift || v.revenue_at_stake || v.assumptions || v.method) {
    await q('insert into impact_sizings (hypothesis_id, affected_customers, expected_lift, revenue_at_stake, confidence, assumptions, method, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [hyp.id, v.affected_customers, v.expected_lift, v.revenue_at_stake, v.confidence, v.assumptions, v.method, req.user.id]);
  }
  if (action === 'submitted') await runChecksAndStore(hyp.id);
  res.redirect('/hypotheses/' + hyp.id + '?ok=' + (action === 'draft' ? 'drafted' : 'submitted'));
}

// ---------------------------------------------------------------- hypothesis detail

async function hypothesisDetail(req, res) {
  const id = int(req.params.id);
  const h = id ? await q1(
    "select h.*, r.title as reason_title, r.category, r.flywheel_driver, r.flywheel_subdriver, coalesce(u.name, 'Example content') as creator, ru.name as reviewer, m.title as merged_title, m.id as merged_id \
     from hypotheses h \
     join churn_reasons r on r.id = h.churn_reason_id \
     left join users u on u.id = h.created_by \
     left join users ru on ru.id = h.reviewed_by \
     left join hypotheses m on m.id = h.merged_into \
     where h.id = $1", [id]) : null;
  if (!h || !canView(h, req.user)) return res.status(404).send(notFoundPage(req));
  const impact = await q1('select * from impact_sizings where hypothesis_id = $1 order by created_at desc limit 1', [id]);
  const necessities = await q('select * from technical_necessities where hypothesis_id = $1 order by id', [id]);
  const checks = await latestChecksFor([id]);
  const chk = checks.get(String(id)) || {};

  const meta = [
    '<dt>Churn reason</dt><dd><a href="/reasons/' + h.churn_reason_id + '">' + esc(h.reason_title) + '</a> ' + driverChip(h.flywheel_driver) + (h.flywheel_subdriver ? ' <span class="chip static">' + esc(h.flywheel_subdriver) + '</span>' : '') + ' <span class="muted small">(' + esc(h.category) + ')</span></dd>',
    '<dt>Submitted by</dt><dd>' + esc(h.creator) + ' on ' + esc(fmtDate(h.created_at)) + '</dd>'
  ];
  if (h.reviewer) meta.push('<dt>Last reviewed by</dt><dd>' + esc(h.reviewer) + ' on ' + esc(fmtDate(h.reviewed_at)) + '</dd>');

  const hypFields = '<dl class="kv">' +
    '<dt>If we…</dt><dd>' + esc(h.if_we) + '</dd>' +
    '<dt>…then…</dt><dd>' + esc(h.then_outcome) + '</dd>' +
    '<dt>…because…</dt><dd>' + esc(h.because_mechanism) + '</dd>' +
    '<dt>For segment</dt><dd>' + esc(h.target_segment) + '</dd>' +
    '<dt>Primary metric</dt><dd>' + esc(h.primary_metric) + '</dd>' +
    '<dt>Success criterion</dt><dd>' + esc(h.success_criterion || '— none given') + '</dd></dl>';

  let checksHtml = '<p class="muted">Checks have not run for this entry yet' + (h.status === 'draft' ? ' — they run when it is submitted for review.' : '.') + '</p>';
  if (chk.validity) {
    checksHtml = '<div class="checkblock"><h4>Validity ' + validityChip(chk.validity) + '</h4><table class="checklist">' + checkRows(chk.validity.checks) + '</table></div>';
  }
  if (chk.overlap) {
    const matches = (chk.overlap.matches || []).map(m =>
      '<li><a href="/hypotheses/' + m.id + '">' + esc(m.title) + '</a> — ' + Math.round((m.score || 0) * 100) + '% similar' +
      (m.signals && m.signals.length ? ' <span class="muted small">(' + esc(m.signals.join(', ')) + ')</span>' : '') +
      ' <span class="muted small">' + esc(m.status) + '</span></li>').join('');
    checksHtml += '<div class="checkblock"><h4>Overlap ' + overlapBadge(chk.overlap.verdict) + '</h4>' +
      (matches ? '<ul class="matches">' + matches + '</ul>' : '<p class="muted">No similar hypotheses found.</p>') + '</div>';
  }

  let impactHtml = '<p class="muted">Not sized yet.</p>';
  if (impact) {
    impactHtml = '<dl class="kv">' +
      '<dt>Affected customers</dt><dd>' + esc(impact.affected_customers || '—') + '</dd>' +
      '<dt>Expected lift</dt><dd>' + esc(impact.expected_lift || '—') + '</dd>' +
      '<dt>Revenue at stake</dt><dd>' + esc(impact.revenue_at_stake || '—') + '</dd>' +
      '<dt>Confidence</dt><dd>' + esc(impact.confidence || '—') + '</dd>' +
      '<dt>Assumptions</dt><dd>' + esc(impact.assumptions || '—') + '</dd>' +
      '<dt>Sizing method</dt><dd>' + esc(impact.method || '—') + '</dd></dl>';
  }
  if (canEdit(h, req.user)) {
    impactHtml += '<details><summary>' + (impact ? 'Update impact sizing' : 'Add impact sizing') + '</summary>' +
      '<form method="post" action="/hypotheses/' + h.id + '/impact">' +
      field('Affected customers', 'affected_customers', impact ? impact.affected_customers : '', { placeholder: 'e.g. 1.2m fee-sensitive orderers in the pilot market' }) +
      field('Expected lift', 'expected_lift', impact ? impact.expected_lift : '', {}) +
      field('Revenue at stake', 'revenue_at_stake', impact ? impact.revenue_at_stake : '', {}) +
      field('Confidence', 'confidence', impact ? impact.confidence : 'medium', { options: CONFIDENCES }) +
      field('Assumptions', 'assumptions', impact ? impact.assumptions : '', { textarea: true }) +
      field('Sizing method', 'method', impact ? impact.method : '', {}) +
      '<button class="btn">Save impact sizing</button></form></details>';
  }

  let necHtml = '<p class="muted">No technical requirements listed yet.</p>';
  if (necessities.length) {
    necHtml = '<table class="list"><tr><th>Type</th><th>Requirement</th><th>Effort</th><th>Dependencies</th><th>Owning team</th>' + (canEdit(h, req.user) ? '<th></th>' : '') + '</tr>' +
      necessities.map(n => '<tr><td><span class="chip static">' + esc(n.requirement_type) + '</span></td><td>' + esc(n.description) + '</td><td>' + esc(n.effort) + '</td><td>' + esc(n.dependencies || '—') + '</td><td>' + esc(n.owning_team || '—') + '</td>' +
        (canEdit(h, req.user) ? '<td><form method="post" action="/necessities/' + n.id + '/delete"><button class="linklike">Remove</button></form></td>' : '') + '</tr>').join('') + '</table>';
  }
  if (canEdit(h, req.user)) {
    necHtml += '<details><summary>Add a technical requirement</summary>' +
      '<form method="post" action="/hypotheses/' + h.id + '/necessity">' +
      field('Type', 'requirement_type', 'engineering', { options: REQ_TYPES }) +
      field('Requirement', 'description', '', { textarea: true, required: true, placeholder: 'What has to be built, changed or available' }) +
      field('Effort', 'effort', 'M', { options: EFFORTS }) +
      field('Dependencies', 'dependencies', '', {}) +
      field('Owning team', 'owning_team', '', {}) +
      '<button class="btn">Add requirement</button></form></details>';
  }

  let actionsHtml = '';
  if (req.user.role === 'owner' && h.status === 'submitted') {
    actionsHtml = '<div class="card actions"><h3>Owner review</h3>' +
      '<form method="post" action="/hypotheses/' + h.id + '/accept"><button class="btn">Accept &amp; publish</button></form>' +
      '<form method="post" action="/hypotheses/' + h.id + '/reject" class="stack">' +
      field('Feedback for the submitter', 'feedback', '', { textarea: true, rows: 2, placeholder: 'Why is this rejected? The submitter can edit and resubmit.' }) +
      '<button class="btn btn-danger">Reject with feedback</button></form>' +
      '<form method="post" action="/hypotheses/' + h.id + '/merge" class="stack">' +
      field('Duplicate of accepted entry #', 'merge_into', '', { placeholder: 'e.g. 2' }) +
      '<button class="btn btn-secondary">Mark as duplicate &amp; merge</button></form></div>';
  }
  let toolsHtml = '';
  if (canEdit(h, req.user)) toolsHtml += '<a class="btn btn-secondary" href="/hypotheses/' + h.id + '/edit">Edit</a> ';
  if ((req.user.role === 'owner' || h.created_by === req.user.id) && h.status !== 'accepted') {
    toolsHtml += '<form method="post" action="/hypotheses/' + h.id + '/recheck" class="inlineform"><button class="btn btn-secondary" type="submit">Re-run checks</button></form>';
  }

  let feedbackHtml = '';
  if (h.review_feedback && (h.status === 'rejected' || h.status === 'merged')) {
    feedbackHtml = '<div class="feedback"><strong>' + (h.status === 'rejected' ? 'Rejected' : 'Merged') + (h.reviewer ? ' — ' + esc(h.reviewer) : '') + ':</strong> ' + esc(h.review_feedback) + '</div>';
  }
  let mergedHtml = '';
  if (h.status === 'merged' && h.merged_id) {
    mergedHtml = '<div class="merged-note">This entry is a duplicate of <a href="/hypotheses/' + h.merged_id + '">#' + h.merged_id + ' — ' + esc(h.merged_title) + '</a>. The original carries the accepted version.</div>';
  }

  const content =
    '<div class="pagehead"><div class="card-top">' + statusBadge(h.status) + ' ' + exampleBadge(h.is_example) + '</div>' +
    '<h1>' + esc(h.title) + '</h1>' +
    (toolsHtml ? '<div class="btnrow">' + toolsHtml + '</div>' : '') + '</div>' +
    flashHtml(req) + mergedHtml + feedbackHtml +
    '<div class="card"><dl class="kv">' + meta.join('') + '</dl><hr class="sep">' + hypFields + '</div>' +
    '<div class="card"><h3>Automatic screening</h3>' + checksHtml + '</div>' +
    '<div class="card"><h3>Impact sizing</h3>' + impactHtml + '</div>' +
    '<div class="card"><h3>Technical necessities</h3>' + necHtml + '</div>' +
    actionsHtml;
  res.send(layout({ title: h.title, user: req.user, active: '', content: content }));
}

// ---------------------------------------------------------------- edit / recheck / decisions

async function editPage(req, res) {
  const id = int(req.params.id);
  const h = id ? await q1('select * from hypotheses where id = $1', [id]) : null;
  if (!h || !canView(h, req.user) || !canEdit(h, req.user)) return res.status(404).send(notFoundPage(req));
  const reasons = await q('select id, title, category from churn_reasons order by title');
  const reasonOptions = [{ value: '', label: '— pick a churn reason —' }].concat(reasons.map(r => ({ value: r.id, label: r.title + ' (' + r.category + ')' })));
  const isAccepted = h.status === 'accepted';
  const content =
    '<div class="pagehead"><h1>Edit' + (isAccepted ? ' (owner edit)' : '') + '</h1></div>' +
    '<form method="post" action="/hypotheses/' + h.id + '/edit" class="card form">' +
    field('Churn reason', 'reason_id', h.churn_reason_id, { options: reasonOptions }) +
    field('Title', 'title', h.title, { required: true }) +
    field('If we…', 'if_we', h.if_we, { textarea: true, required: true }) +
    field('…then…', 'then_outcome', h.then_outcome, { textarea: true, required: true }) +
    field('…because…', 'because_mechanism', h.because_mechanism, { textarea: true, required: true }) +
    field('For which segment', 'target_segment', h.target_segment, { required: true }) +
    field('Primary metric', 'primary_metric', h.primary_metric, { required: true }) +
    field('Success criterion', 'success_criterion', h.success_criterion, { placeholder: 'e.g. +2pct checkout completion vs. holdout within 6 weeks' }) +
    '<div class="btnrow">' +
    (isAccepted
      ? '<button class="btn" name="action" value="save">Save changes</button>'
      : '<button class="btn" name="action" value="submit">Submit for review</button><button class="btn btn-secondary" name="action" value="draft">Save as draft</button>') +
    '<a class="btn btn-secondary" href="/hypotheses/' + h.id + '">Cancel</a></div></form>';
  res.send(layout({ title: 'Edit', user: req.user, active: '/mine', content: content }));
}

async function editPost(req, res) {
  const id = int(req.params.id);
  const h = id ? await q1('select * from hypotheses where id = $1', [id]) : null;
  if (!h || !canView(h, req.user) || !canEdit(h, req.user)) return res.status(404).send(notFoundPage(req));
  const action = str(req.body.action, 10);
  const v = {
    reason_id: int(req.body.reason_id), title: str(req.body.title, 200), if_we: str(req.body.if_we, 2000),
    then_outcome: str(req.body.then_outcome, 2000), because_mechanism: str(req.body.because_mechanism, 2000),
    target_segment: str(req.body.target_segment, 300), primary_metric: str(req.body.primary_metric, 200),
    success_criterion: str(req.body.success_criterion, 500)
  };
  if (!v.reason_id || !v.title || !v.if_we || !v.then_outcome || !v.because_mechanism || !v.target_segment || !v.primary_metric) {
    return res.redirect('/hypotheses/' + id + '/edit');
  }
  const newStatus = h.status === 'accepted' ? 'accepted' : (action === 'draft' ? 'draft' : 'submitted');
  await q(
    'update hypotheses set churn_reason_id = $2, title = $3, if_we = $4, then_outcome = $5, because_mechanism = $6, target_segment = $7, primary_metric = $8, success_criterion = $9, status = $10, review_feedback = $11, reviewed_by = $12, reviewed_at = $13, updated_at = now() where id = $1',
    [id, v.reason_id, v.title, v.if_we, v.then_outcome, v.because_mechanism, v.target_segment, v.primary_metric, v.success_criterion, newStatus,
     newStatus === 'submitted' ? null : h.review_feedback,
     newStatus === 'submitted' ? null : h.reviewed_by,
     newStatus === 'submitted' ? null : h.reviewed_at]);
  if (newStatus === 'submitted') await runChecksAndStore(id);
  res.redirect('/hypotheses/' + id + '?ok=' + (newStatus === 'submitted' ? 'submitted' : 'saved'));
}

async function recheckPost(req, res) {
  const id = int(req.params.id);
  const h = id ? await q1('select * from hypotheses where id = $1', [id]) : null;
  if (!h || !canView(h, req.user)) return res.status(404).send(notFoundPage(req));
  if (!(req.user.role === 'owner' || h.created_by === req.user.id) || h.status === 'accepted') return res.redirect('/hypotheses/' + id);
  await runChecksAndStore(id);
  res.redirect('/hypotheses/' + id + '?ok=rechecked');
}

async function acceptPost(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const id = int(req.params.id);
  await q("update hypotheses set status = 'accepted', reviewed_by = $2, reviewed_at = now(), updated_at = now() where id = $1 and status = 'submitted'",
    [id, req.user.id]);
  res.redirect('/hypotheses/' + id + '?ok=accepted');
}

async function rejectPost(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const id = int(req.params.id);
  const feedback = str(req.body.feedback, 2000);
  if (!feedback) return res.redirect('/hypotheses/' + id + '?err=feedback');
  await q("update hypotheses set status = 'rejected', review_feedback = $3, reviewed_by = $2, reviewed_at = now(), updated_at = now() where id = $1 and status = 'submitted'",
    [id, req.user.id, feedback]);
  res.redirect('/hypotheses/' + id + '?ok=rejected');
}

async function mergePost(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const id = int(req.params.id);
  const target = int(req.body.merge_into);
  const t = target ? await q1('select id, status from hypotheses where id = $1', [target]) : null;
  if (!t || t.status !== 'accepted' || target === id) return res.redirect('/hypotheses/' + id + '?err=merge');
  await q("update hypotheses set status = 'merged', merged_into = $3, review_feedback = $4, reviewed_by = $2, reviewed_at = now(), updated_at = now() where id = $1 and status = 'submitted'",
    [id, req.user.id, target, str(req.body.feedback, 2000) || ('Duplicate of accepted entry #' + target)]);
  res.redirect('/hypotheses/' + id + '?ok=merged');
}

// ---------------------------------------------------------------- impact / necessities

async function impactPost(req, res) {
  const id = int(req.params.id);
  const h = id ? await q1('select * from hypotheses where id = $1', [id]) : null;
  if (!h || !canView(h, req.user) || !canEdit(h, req.user)) return res.status(404).send(notFoundPage(req));
  const v = {
    affected_customers: str(req.body.affected_customers, 500), expected_lift: str(req.body.expected_lift, 500),
    revenue_at_stake: str(req.body.revenue_at_stake, 500),
    confidence: CONFIDENCES.indexOf(str(req.body.confidence, 20)) >= 0 ? str(req.body.confidence, 20) : 'medium',
    assumptions: str(req.body.assumptions, 2000), method: str(req.body.method, 500)
  };
  const existing = await q1('select id from impact_sizings where hypothesis_id = $1', [id]);
  if (existing) {
    await q('update impact_sizings set affected_customers = $2, expected_lift = $3, revenue_at_stake = $4, confidence = $5, assumptions = $6, method = $7, updated_at = now() where id = $1',
      [existing.id, v.affected_customers, v.expected_lift, v.revenue_at_stake, v.confidence, v.assumptions, v.method]);
  } else {
    await q('insert into impact_sizings (hypothesis_id, affected_customers, expected_lift, revenue_at_stake, confidence, assumptions, method, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, v.affected_customers, v.expected_lift, v.revenue_at_stake, v.confidence, v.assumptions, v.method, req.user.id]);
  }
  res.redirect('/hypotheses/' + id + '?ok=impact');
}

async function necessityPost(req, res) {
  const id = int(req.params.id);
  const h = id ? await q1('select * from hypotheses where id = $1', [id]) : null;
  if (!h || !canView(h, req.user) || !canEdit(h, req.user)) return res.status(404).send(notFoundPage(req));
  const description = str(req.body.description, 2000);
  const type = REQ_TYPES.indexOf(str(req.body.requirement_type, 40)) >= 0 ? str(req.body.requirement_type, 40) : 'other';
  const effort = EFFORTS.indexOf(str(req.body.effort, 2)) >= 0 ? str(req.body.effort, 2) : 'M';
  if (!description) return res.redirect('/hypotheses/' + id);
  await q('insert into technical_necessities (hypothesis_id, requirement_type, description, effort, dependencies, owning_team) values ($1, $2, $3, $4, $5, $6)',
    [id, type, description, effort, str(req.body.dependencies, 500), str(req.body.owning_team, 200)]);
  res.redirect('/hypotheses/' + id + '?ok=necessity');
}

async function necessityDelete(req, res) {
  const nid = int(req.params.id);
  const n = nid ? await q1('select * from technical_necessities where id = $1', [nid]) : null;
  if (!n) return res.status(404).send(notFoundPage(req));
  const h = await q1('select * from hypotheses where id = $1', [n.hypothesis_id]);
  if (!h || !canView(h, req.user) || !canEdit(h, req.user)) return res.status(404).send(notFoundPage(req));
  await q('delete from technical_necessities where id = $1', [nid]);
  res.redirect('/hypotheses/' + n.hypothesis_id + '?ok=removed');
}

// ---------------------------------------------------------------- mine / review / users / help

async function minePage(req, res) {
  const rows = await q(
    "select h.id, h.title, h.if_we, h.status, h.created_at, h.is_example, r.title as reason_title, r.category, r.flywheel_driver, $2::text as creator \
     from hypotheses h join churn_reasons r on r.id = h.churn_reason_id \
     where h.created_by = $1 order by h.created_at desc limit 200", [req.user.id, req.user.name]);
  const checks = await latestChecksFor(rows.map(r => r.id));
  const cards = rows.map(r => hypCard(r, checks.get(r.id))).join('') ||
    '<div class="card empty"><p>Nothing yet — submit your first hypothesis.</p><p><a class="btn" href="/submit">Submit a hypothesis</a></p></div>';
  const content =
    '<div class="pagehead"><h1>My submissions</h1><p class="muted">Everything you have submitted, with its screening results and status.</p></div>' +
    flashHtml(req) + '<div class="grid">' + cards + '</div>';
  res.send(layout({ title: 'My submissions', user: req.user, active: '/mine', content: content }));
}

async function reviewPage(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const queue = await q(
    "select h.id, h.title, h.if_we, h.created_at, h.is_example, r.title as reason_title, r.category, r.flywheel_driver, coalesce(u.name, 'Example content') as creator \
     from hypotheses h join churn_reasons r on r.id = h.churn_reason_id left join users u on u.id = h.created_by \
     where h.status = 'submitted' order by h.created_at asc limit 100");
  const checks = await latestChecksFor(queue.map(r => r.id));
  const items = queue.map(h => {
    const c = checks.get(h.id) || {};
    const matches = ((c.overlap && c.overlap.matches) || []).map(m => '<a href="/hypotheses/' + m.id + '">' + esc(m.title) + '</a>').join(', ');
    return '<div class="card">' +
      '<div class="card-top">' + exampleBadge(h.is_example) + '</div>' +
      '<h3><a href="/hypotheses/' + h.id + '">' + esc(h.title) + '</a></h3>' +
      '<p class="muted small">' + esc(h.reason_title) + ' · ' + esc(h.category) + (h.flywheel_driver ? ' · ' + esc(h.flywheel_driver) : '') + ' · by ' + esc(h.creator) + ' · ' + esc(fmtDate(h.created_at)) + '</p>' +
      '<p>' + validityChip(c.validity) + ' ' + overlapBadge(c.overlap ? c.overlap.verdict : null) + '</p>' +
      (matches ? '<p class="muted small">Similar to: ' + matches + '</p>' : '') +
      '<a class="btn" href="/hypotheses/' + h.id + '">Review</a></div>';
  }).join('') || '<div class="card empty"><p>The review queue is empty.</p></div>';
  const recent = await q(
    "select h.id, h.title, h.status, h.reviewed_at, coalesce(ru.name, '') as reviewer \
     from hypotheses h left join users ru on ru.id = h.reviewed_by \
     where h.status in ('accepted','rejected','merged') order by h.reviewed_at desc nulls last limit 10");
  const recentHtml = recent.length
    ? '<div class="card"><h3>Recently decided</h3><table class="list">' + recent.map(x =>
        '<tr><td><a href="/hypotheses/' + x.id + '">' + esc(x.title) + '</a></td><td>' + statusBadge(x.status) + '</td><td class="muted small">' + esc(x.reviewer) + ' ' + esc(fmtDate(x.reviewed_at)) + '</td></tr>').join('') + '</table></div>'
    : '';
  const content =
    '<div class="pagehead"><h1>Review queue</h1><p class="muted">Submitted hypotheses with their screening results. The checks flag — you decide: accept, reject with feedback, or merge duplicates.</p></div>' +
    flashHtml(req) + '<div class="grid">' + items + '</div>' + recentHtml;
  res.send(layout({ title: 'Review queue', user: req.user, active: '/review', content: content }));
}

async function usersPage(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const rows = await q('select id, name, email, role, created_at from users order by created_at');
  const table = '<table class="list"><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>' +
    rows.map(u => '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td><td>' + roleChip(u.role) + '</td>' +
      '<td><form method="post" action="/users/' + u.id + '/role"><button class="linklike" type="submit">' + (u.role === 'owner' ? 'Make member' : 'Make owner') + '</button></form></td></tr>').join('') +
    '</table>';
  const content =
    '<div class="pagehead"><h1>People</h1><p class="muted">Owners review submissions and manage the library. Everyone else can browse and submit.</p></div>' +
    flashHtml(req) + '<div class="card">' + table + '</div>';
  res.send(layout({ title: 'People', user: req.user, active: '/users', content: content }));
}

async function rolePost(req, res) {
  if (req.user.role !== 'owner') return res.status(403).send(forbiddenPage());
  const id = int(req.params.id);
  const target = id ? await q1('select * from users where id = $1', [id]) : null;
  if (!target) return res.status(404).send(notFoundPage(req));
  const newRole = target.role === 'owner' ? 'member' : 'owner';
  if (target.role === 'owner') {
    const n = (await q1("select count(*)::int as n from users where role = 'owner'")).n;
    if (n <= 1) return res.redirect('/users?err=lastowner');
  }
  await q('update users set role = $2, updated_at = now() where id = $1', [id, newRole]);
  res.redirect('/users?ok=role');
}

async function helpPage(req, res) {
  const content =
    '<div class="pagehead"><h1>How this library works</h1></div>' +
    '<div class="card"><h3>The entry</h3><p>Each entry links four things: a <strong>churn reason</strong> (why customers stop ordering at JET), a <strong>hypothesis</strong> to tackle it, an <strong>impact sizing</strong>, and the <strong>technical necessities</strong> needed to build it.</p></div>' +
    '<div class="card"><h3>The experience flywheel</h3><p>Every churn reason maps to one of six drivers on the flywheel, grouped around the Trigger → Session → Order cycle: <strong>1 Off-platform incentives</strong> (pre-session), <strong>2 Supply</strong>, <strong>3 App experience</strong> and <strong>4 Price and discounts</strong> (in session), <strong>5 Delivery</strong> and <strong>6 Customer &amp; partner service</strong> (post-order). The front page shows the wheel — click a driver to filter the library. Each driver breaks into sub-drivers (Marketing, Vouchers, Fees …) shown under the search bar when a driver is selected, and sub-drivers can have a deeper layer (e.g. Fees → Delivery Fee, Service Fee, Minimum Order Fee).</p><ul><li>The stronger our growth flywheel, the better our customer\u2019s experience.</li><li>Retention aims to stabilize customers into coming back at least once every month.</li><li>Frequency aims to accelerate the continuous cycle, moving from session to order to session.</li></ul></div>' +
    '<div class="card"><h3>The hypothesis format</h3><p><em>If we [do X], then [metric] will [move] for [segment], because [mechanism].</em> Add a success criterion so the hypothesis can pass or fail.</p></div>' +
    '<div class="card"><h3>Automatic screening</h3><p>On submission, two checks run:</p><ul>' +
    '<li><strong>Overlap</strong> — compares your hypothesis against every published and pending one and flags near-duplicates (with side-by-side links) so owners can merge them.</li>' +
    '<li><strong>Validity</strong> — scores the hypothesis out of 100 on structure, measurability, falsifiability, actionability and non-circular reasoning, and leaves fix-it notes.</li></ul>' +
    '<p class="muted">The checks flag — owners decide. Nothing is auto-rejected.</p></div>' +
    '<div class="card"><h3>Life of a submission</h3><p><span class="badge b-gray">Draft</span> → <span class="badge b-blue">In review</span> → <span class="badge b-green">Accepted</span> / <span class="badge b-red">Rejected</span> (with feedback — edit and resubmit) / <span class="badge b-gray">Merged</span> (duplicate of an existing entry).</p></div>' +
    '<div class="card"><h3>Roles</h3><p><strong>Owners</strong> review, accept, reject and merge, add churn reasons and manage people. <strong>Members</strong> browse the library, submit hypotheses and follow their own submissions.</p></div>';
  res.send(layout({ title: 'Help', user: req.user, active: '/help', content: content }));
}

// ---------------------------------------------------------------- wiring

function attachRoutes(app) {
  app.use(auth.loadUser);

  app.get('/login', wrap(loginPage));
  app.post('/login', wrap(loginPost));
  app.post('/logout', wrap(logoutPost));
  app.get('/diagnostics', wrap(diagnosticsPage));

  app.use((req, res, next) => { if (!req.user) return res.redirect('/login'); next(); });

  app.get('/profile', wrap(profilePage));
  app.post('/profile', wrap(profilePost));
  app.get('/', wrap(home));
  app.get('/reasons', wrap(reasonsPage));
  app.post('/reasons', wrap(reasonPost));
  app.post('/reasons/:id/driver', wrap(reasonDriverPost));
  app.get('/reasons/:id', wrap(reasonDetail));
  app.get('/submit', wrap(submitPage));
  app.post('/submit', wrap(submitPost));
  app.get('/mine', wrap(minePage));
  app.get('/review', wrap(reviewPage));
  app.get('/users', wrap(usersPage));
  app.post('/users/:id/role', wrap(rolePost));
  app.get('/help', wrap(helpPage));
  app.get('/hypotheses/:id', wrap(hypothesisDetail));
  app.get('/hypotheses/:id/edit', wrap(editPage));
  app.post('/hypotheses/:id/edit', wrap(editPost));
  app.post('/hypotheses/:id/recheck', wrap(recheckPost));
  app.post('/hypotheses/:id/accept', wrap(acceptPost));
  app.post('/hypotheses/:id/reject', wrap(rejectPost));
  app.post('/hypotheses/:id/merge', wrap(mergePost));
  app.post('/hypotheses/:id/impact', wrap(impactPost));
  app.post('/hypotheses/:id/necessity', wrap(necessityPost));
  app.post('/necessities/:id/delete', wrap(necessityDelete));

  app.use((req, res) => res.status(404).send(notFoundPage(req)));
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).send(layout({ title: 'Error', user: req.user, content: '<div class="card"><h2>Something went wrong</h2><p class="muted">The error was logged on the server. Go back and try again.</p><p><a class="btn btn-secondary" href="/">Back to the library</a></p></div>' }));
  });
}

module.exports = { attachRoutes };
