alter table churn_reasons add column flywheel_subdriver text;
update churn_reasons set flywheel_subdriver = 'Fees' where title = 'Delivery fees feel too high';
update churn_reasons set flywheel_subdriver = 'Absolute delivery time' where title = 'Orders arrive late or cold';
update churn_reasons set flywheel_subdriver = 'Usability' where title = 'The app feels slow and hard to use';
