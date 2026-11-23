create table leaving_reasons (
  id bigint generated always as identity primary key,
  flywheel_driver text not null,
  flywheel_subdriver text,
  flywheel_type text,
  title text not null default '',
  body text not null,
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index leaving_reasons_driver_idx on leaving_reasons(flywheel_driver);
