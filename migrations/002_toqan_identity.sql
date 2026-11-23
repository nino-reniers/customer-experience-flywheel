alter table users add column toqan_id text;
alter table users alter column password_hash drop not null;
alter table users alter column email drop not null;
alter table users add column name_is_placeholder boolean not null default false;
create unique index users_toqan_id_idx on users(toqan_id);
