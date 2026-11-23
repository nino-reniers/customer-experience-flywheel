'use strict';

const assert = require('assert');
const { runValidity, runOverlap } = require('../lib/checks');

const good = {
  title: 'Show fees upfront',
  if_we: 'If we show total fees upfront on the restaurant list',
  then_outcome: 'then checkout completion for fee-sensitive customers will increase by 2 percentage points within 6 weeks',
  because_mechanism: 'fee surprise at the final step drives abandonment',
  target_segment: 'Fee-sensitive orderers in the pilot market',
  primary_metric: 'Checkout completion rate',
  success_criterion: '+2 percentage points checkout completion vs holdout within 6 weeks'
};
const v = runValidity(good);
assert.strictEqual(v.verdict, 'strong', 'good hypothesis should be strong, got: ' + JSON.stringify(v));
assert.ok(v.score >= 85, 'good hypothesis should score >= 85, got ' + v.score);

const bad = { title: '', if_we: '', then_outcome: '', because_mechanism: '', target_segment: '', primary_metric: '', success_criterion: '' };
const b = runValidity(bad);
assert.strictEqual(b.verdict, 'weak');
assert.ok(b.score < 30, 'empty hypothesis should score < 30, got ' + b.score);

const circular = Object.assign({}, good, { then_outcome: 'If we show total fees upfront on the restaurant list' });
const c = runValidity(circular);
const circ = c.checks.find(x => x.id === 'non_circular');
assert.strictEqual(circ.status, 'warn', 'circular outcome should warn');

const candidates = [
  { id: 1, title: 'Show fees upfront', if_we: 'If we show total fees upfront on the restaurant list', because_mechanism: 'fee surprise at the final step drives abandonment', primary_metric: 'Checkout completion rate', churn_reason_id: 1, status: 'accepted' },
  { id: 2, title: 'Delivery pass subscription', if_we: 'If we offer a monthly delivery pass that waives the delivery fee', because_mechanism: 'flat fee changes per-order cost', primary_metric: '30-day reorder rate', churn_reason_id: 1, status: 'accepted' }
];
const dup = runOverlap({ id: 9, title: 'Show fees upfront', if_we: good.if_we, because_mechanism: good.because_mechanism, primary_metric: good.primary_metric, churn_reason_id: 1 }, candidates);
assert.ok(['strong', 'duplicate'].includes(dup.verdict), 'duplicate should be flagged strong or duplicate, got ' + dup.verdict);

const fresh = runOverlap({ id: 9, title: 'Live courier ETA map', if_we: 'If we show a live map with courier position and a dynamic ETA', because_mechanism: 'uncertainty drives support contact', primary_metric: 'Support contact rate', churn_reason_id: 2 }, candidates);
assert.strictEqual(fresh.verdict, 'none', 'unrelated hypothesis should have no overlap, got ' + fresh.verdict);

console.log('All screening engine tests passed.');
