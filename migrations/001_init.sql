create table users (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index sessions_user_id_idx on sessions(user_id);

create table churn_reasons (
  id bigint generated always as identity primary key,
  title text not null,
  category text not null,
  description text not null,
  evidence_source text not null default '',
  affected_segment text not null default '',
  is_example boolean not null default false,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index churn_reasons_category_idx on churn_reasons(category);

create table hypotheses (
  id bigint generated always as identity primary key,
  churn_reason_id bigint not null references churn_reasons(id),
  title text not null,
  if_we text not null,
  then_outcome text not null,
  because_mechanism text not null,
  target_segment text not null,
  primary_metric text not null,
  success_criterion text not null default '',
  status text not null default 'submitted',
  review_feedback text,
  reviewed_by bigint references users(id),
  reviewed_at timestamptz,
  merged_into bigint references hypotheses(id),
  is_example boolean not null default false,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hypotheses_churn_reason_id_idx on hypotheses(churn_reason_id);
create index hypotheses_status_idx on hypotheses(status);
create index hypotheses_created_by_idx on hypotheses(created_by);

create table impact_sizings (
  id bigint generated always as identity primary key,
  hypothesis_id bigint not null references hypotheses(id) on delete cascade,
  affected_customers text not null default '',
  expected_lift text not null default '',
  revenue_at_stake text not null default '',
  confidence text not null default 'medium',
  assumptions text not null default '',
  method text not null default '',
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index impact_sizings_hypothesis_id_idx on impact_sizings(hypothesis_id);

create table technical_necessities (
  id bigint generated always as identity primary key,
  hypothesis_id bigint not null references hypotheses(id) on delete cascade,
  requirement_type text not null,
  description text not null,
  effort text not null default 'M',
  dependencies text not null default '',
  owning_team text not null default '',
  created_at timestamptz not null default now()
);
create index technical_necessities_hypothesis_id_idx on technical_necessities(hypothesis_id);

create table hypothesis_checks (
  id bigint generated always as identity primary key,
  hypothesis_id bigint not null references hypotheses(id) on delete cascade,
  check_type text not null,
  score numeric not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index hypothesis_checks_hypothesis_id_idx on hypothesis_checks(hypothesis_id);
