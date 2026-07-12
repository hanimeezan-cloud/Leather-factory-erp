alter table roles drop constraint if exists roles_name_check;
alter table roles
  add constraint roles_name_check
  check (name in ('Owner', 'Management', 'Planning', 'Sales', 'Purchasing', 'Warehouse', 'Production', 'Quality'));

insert into roles (name, description)
values ('Management', 'Management approval and read access')
on conflict (name) do update set description = excluded.description;

alter table profiles drop constraint if exists profiles_user_id_fkey;
alter table profiles
  add constraint profiles_user_id_fkey
  foreign key (user_id) references users(id) on update cascade on delete cascade;

create unique index if not exists idx_users_email_lower on users (lower(email));

alter table purchase_orders
  add column if not exists approved boolean not null default false;

alter table purchase_orders
  add column if not exists approved_by uuid references users(id) on delete set null;

alter table purchase_orders
  add column if not exists approved_at timestamptz;

create index if not exists idx_purchase_orders_approved on purchase_orders(approved);
create index if not exists idx_purchase_orders_approved_by on purchase_orders(approved_by);
