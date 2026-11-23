'use strict';

// Example content for a fresh library. Every item is flagged is_example = true
// in the database (the "Example" badge in the UI) so it can be told apart from
// real research and removed later with a single delete where is_example.

module.exports = {
  reasons: [
    {
      title: 'Orders arrive late or cold',
      category: 'delivery experience',
      driver: 'Delivery',
      subdriver: 'Absolute delivery time',
      description: 'Late and cold-food deliveries are a top driver of customers stopping ordering, especially at peak times when courier supply is tight.',
      evidence_source: 'Example entry — replace with your real evidence source',
      affected_segment: 'Peak-time orderers and suburban zones with longer courier travel times'
    },
    {
      title: 'The app feels slow and hard to use',
      category: 'app & tech',
      driver: 'App experience',
      subdriver: 'Usability',
      description: 'Customers on older or low-end devices experience long startup and search times, and abandon before completing their first order.',
      evidence_source: 'Example entry — replace with your real evidence source',
      affected_segment: 'Customers on low-end Android devices'
    }
  ],
  hypotheses: [
    {
      reasonIndex: 0,
      status: 'accepted',
      title: 'Live courier ETA map during order tracking',
      if_we: 'If we show a live map with the courier position and a dynamic ETA during order tracking',
      then_outcome: 'then contact rate per 1,000 late orders will decrease by at least 15% within 8 weeks',
      because_mechanism: 'uncertainty about when food will arrive, rather than the delay itself, drives cancellation and support contact — visible progress reduces that uncertainty',
      target_segment: 'Orders running more than 10 minutes past the original ETA',
      primary_metric: 'Support contact rate per 1,000 late orders',
      success_criterion: '-15% contact rate on late orders vs. baseline within 8 weeks',
      impact: {
        affected_customers: 'Late orders are about 6% of weekly volume, pilot scope 1.1m orders per quarter',
        expected_lift: '-15% contact rate is roughly 9k fewer support contacts per quarter',
        revenue_at_stake: 'Support cost of about 3.5 per contact, roughly 32k saved per quarter plus retention halo',
        confidence: 'medium',
        assumptions: 'Assumes the courier location feed covers 95% of couriers. Example figures.',
        method: 'Contact-rate baseline from support tickets linked to late orders (example)'
      },
      necessities: [
        { type: 'engineering', description: 'Real-time courier location stream into the tracking screen', effort: 'L', dependencies: 'Courier app location permissions', owning_team: 'Logistics platform' },
        { type: 'data', description: 'Late-order classifier feed to trigger the pilot', effort: 'S', dependencies: '', owning_team: 'Customer analytics' }
      ]
    },
    {
      reasonIndex: 1,
      status: 'submitted',
      title: 'Cut app startup time below two seconds on low-end devices',
      if_we: 'If we reduce app startup time on low-end Android devices to under two seconds',
      then_outcome: 'then 7-day retention for new installs on those devices will increase by at least 3 percentage points within 8 weeks',
      because_mechanism: 'a slow first launch causes customers to abandon before their first search, so the app never gets a chance to show its value',
      target_segment: 'New installs on low-end Android devices',
      primary_metric: '7-day retention of new installs',
      success_criterion: '+3 percentage points 7-day retention vs. baseline within 8 weeks',
      impact: {
        affected_customers: 'About 15% of new installs come from low-end Android devices',
        expected_lift: '+3pct retention is roughly 4.5k retained users per month',
        revenue_at_stake: 'To be sized by the Mobile platform team',
        confidence: 'low',
        assumptions: 'Assumes startup time is measurable per device tier. Example figures.',
        method: 'Device-tier segmentation of install cohorts (example)'
      },
      necessities: [
        { type: 'engineering', description: 'App startup profiling and lazy-loading of non-critical modules', effort: 'M', dependencies: '', owning_team: 'Mobile platform' },
        { type: 'data', description: 'Device model to device-tier mapping for install cohorts', effort: 'S', dependencies: '', owning_team: 'Customer analytics' }
      ]
    }
  ]
};
