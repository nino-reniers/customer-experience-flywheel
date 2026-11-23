'use strict';

// The automatic screening system. Pure functions, no database access:
//   runValidity(hypothesis)  -> structural quality gate, 0-100 + fix-it notes
//   runOverlap(h, candidates) -> near-duplicate detection against other entries
// The engine is deterministic and explainable: it flags, owners decide.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'we', 'our', 'us', 'will', 'be',
  'is', 'are', 'was', 'that', 'this', 'it', 'its', 'by', 'as', 'at', 'from', 'if', 'then', 'because',
  'than', 'more', 'less', 'into', 'their', 'they', 'them', 'you', 'your', 'when', 'which', 'can', 'could',
  'would', 'should', 'has', 'have', 'had', 'not', 'no', 'but', 'so', 'about', 'over', 'under', 'after',
  'before', 'between', 'out', 'up', 'down', 'all', 'any', 'each', 'few', 'most', 'other', 'some', 'such',
  'only', 'own', 'same', 'too', 'very', 'now', 'customers', 'customer', 'users', 'user', 'jet'
]);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
    .join(' ');
}

function trigrams(s) {
  const padded = '  ' + s + '  ';
  const set = new Set();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}

function trigramSimilarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function similarity(a, b) {
  return trigramSimilarity(normalize(a), normalize(b));
}

const ACTION_RE = /\b(add|adds|offer|offers|build|builds|introduce|introduces|change|changes|improve|improves|reduce|reduces|send|sends|show|shows|enable|enables|launch|launches|test|tests|remove|removes|update|updates|make|makes|provide|provides|give|gives|display|displays|notify|notifies|personalis|personaliz|lower|lowers|increase|increases|extend|extends|create|creates|develop|develops|trial|trials|pilot|pilots|redesign|redesigns|streamline|streamlines|simplify|simplifies|allow|allows|let|lets|upgrade|upgrades|deploy|deploys|roll|rolls|switch|switches|replace|replaces|cap|caps|waive|waives|discount|discounts|bundle|bundles|reward|rewards|we)\b/i;

const DIRECTION_RE = /\b(increase|increases|improve|improvement|improves|rise|rises|grow|grows|higher|reduce|reduces|reduction|decrease|decreases|lower|lowers|drop|drops|down|fewer|more|better|faster|lift|retain|retention|retains|win|wins|regain|convert|converts|churn|churns|cancellations?|abandon|abandons|abandonment|completions?)\b|%|\+/i;

function runValidity(h) {
  h = h || {};
  const title = String(h.title || '').trim();
  const ifWe = String(h.if_we || '').trim();
  const then = String(h.then_outcome || '').trim();
  const because = String(h.because_mechanism || '').trim();
  const segment = String(h.target_segment || '').trim();
  const metric = String(h.primary_metric || '').trim();
  const criterion = String(h.success_criterion || '').trim();

  const checks = [];
  const add = (id, label, weight, status, message) => checks.push({ id, label, weight, status, message });

  // 1. Title
  add('title', 'Has a clear title', 5,
    title.length >= 5 ? 'pass' : (title ? 'warn' : 'fail'),
    title.length >= 5 ? 'Title is set.' : (title ? 'The title is very short — give the hypothesis a descriptive name.' : 'A title is required so the entry is findable in the library.'));

  // 2. Intervention present
  if (!ifWe) add('intervention', 'Defines an intervention ("If we…")', 15, 'fail', 'No intervention — state the change you propose to make.');
  else if (ifWe.length < 15) add('intervention', 'Defines an intervention ("If we…")', 15, 'warn', 'The intervention is very short — describe the concrete change.');
  else add('intervention', 'Defines an intervention ("If we…")', 15, 'pass', 'Intervention is described.');

  // 3. Actionable
  if (ifWe) {
    const actionable = ACTION_RE.test(ifWe);
    add('actionable', 'Intervention is something the team can do', 10,
      actionable ? 'pass' : 'warn',
      actionable ? 'The intervention reads as a concrete action.' : 'Start with what the team will do — "If we offer…", "If we add…" — rather than a general wish.');
  }

  // 4. Outcome present
  add('outcome', 'States an expected outcome ("…then…")', 15,
    then ? 'pass' : 'fail',
    then ? 'Expected outcome is stated.' : 'No outcome — complete the "then" part: what do you expect to change?');

  // 5. Direction
  if (then) {
    const hasDir = DIRECTION_RE.test(then) || DIRECTION_RE.test(metric) || /\d/.test(then);
    add('direction', 'Outcome says which way the metric moves', 10,
      hasDir ? 'pass' : 'warn',
      hasDir ? 'The expected direction is clear.' : 'Say whether the metric should increase or decrease, and roughly by how much.');
  }

  // 6. Segment
  add('segment', 'Targets an identifiable segment', 10,
    segment ? (segment.length >= 6 ? 'pass' : 'warn') : 'fail',
    segment ? (segment.length >= 6 ? 'Target segment is defined.' : 'The segment is very short — which customers, where?') : 'No target segment — which customer group does this apply to?');

  // 7. Metric
  add('metric', 'Names a primary metric', 10,
    metric ? 'pass' : 'fail',
    metric ? 'Primary metric: ' + metric + '.' : 'No primary metric — how will you know it worked?');

  // 8. Mechanism
  if (!because) add('mechanism', 'Explains why it works ("…because…")', 10, 'fail', 'No reasoning — why would this intervention move the metric?');
  else if (because.length < 15) add('mechanism', 'Explains why it works ("…because…")', 10, 'warn', 'The reasoning is very short — add the causal mechanism.');
  else add('mechanism', 'Explains why it works ("…because…")', 10, 'pass', 'Causal mechanism is stated.');

  // 9. Falsifiable / testable
  if (!criterion) add('falsifiable', 'Has a success criterion (testable)', 10, 'fail', 'No success criterion — without one the hypothesis can never pass or fail. E.g. "+5% 30-day reorder rate within 8 weeks".');
  else if (!/\d/.test(criterion)) add('falsifiable', 'Has a success criterion (testable)', 10, 'warn', 'The success criterion has no number — make it measurable.');
  else add('falsifiable', 'Has a success criterion (testable)', 10, 'pass', 'Success criterion is measurable.');

  // 10. Non-circular
  if (ifWe && then) {
    const sim = similarity(ifWe, then);
    add('non_circular', 'Outcome is not a restatement of the intervention', 5,
      sim < 0.7 ? 'pass' : 'warn',
      sim < 0.7 ? 'Outcome and intervention are clearly distinct.' : 'The outcome looks like the intervention rephrased — say what will change for customers, not what you will do.');
  }

  const totalW = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  const score = Math.round((100 * got) / totalW);
  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  const verdict = fails === 0 && score >= 85 ? 'strong' : (score >= 55 ? 'needs_work' : 'weak');
  return { score, verdict, fails, warns, checks };
}

function runOverlap(h, candidates) {
  h = h || {};
  const self = normalize(String(h.title || '') + ' ' + String(h.if_we || '') + ' ' + String(h.because_mechanism || ''));
  const metricN = normalize(h.primary_metric || '');
  const scored = [];
  for (const c of (candidates || [])) {
    if (h.id && Number(c.id) === Number(h.id)) continue;
    const other = normalize(String(c.title || '') + ' ' + String(c.if_we || '') + ' ' + String(c.because_mechanism || ''));
    let score = trigramSimilarity(self, other);
    const signals = [];
    if (h.churn_reason_id && c.churn_reason_id === h.churn_reason_id) { score += 0.1; signals.push('same churn reason'); }
    if (metricN && normalize(c.primary_metric || '') === metricN) { score += 0.08; signals.push('same primary metric'); }
    score = Math.round(Math.min(1, score) * 100) / 100;
    scored.push({ id: c.id, title: c.title, status: c.status, score, signals });
  }
  scored.sort((a, b) => b.score - a.score);
  const relevant = scored.filter(s => s.score >= 0.35).slice(0, 3);
  let verdict = 'none';
  if (relevant[0]) {
    if (relevant[0].score >= 0.92) verdict = 'duplicate';
    else if (relevant[0].score >= 0.72) verdict = 'strong';
    else if (relevant[0].score >= 0.5) verdict = 'possible';
  }
  return { verdict, score: relevant[0] ? relevant[0].score : 0, matches: relevant };
}

module.exports = { normalize, similarity, trigramSimilarity, runValidity, runOverlap };
