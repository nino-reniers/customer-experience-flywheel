alter table churn_reasons add column flywheel_driver text;
alter table churn_reasons add constraint churn_reasons_flywheel_driver_check
  check (flywheel_driver in ('Off-platform incentives', 'Supply', 'App experience', 'Price and discounts', 'Delivery', 'Customer & partner service'));
update churn_reasons set flywheel_driver = 'Price and discounts' where title = 'Delivery fees feel too high';
update churn_reasons set flywheel_driver = 'Delivery' where title = 'Orders arrive late or cold';
update churn_reasons set flywheel_driver = 'App experience' where title = 'The app feels slow and hard to use';
create index churn_reasons_flywheel_driver_idx on churn_reasons(flywheel_driver);
