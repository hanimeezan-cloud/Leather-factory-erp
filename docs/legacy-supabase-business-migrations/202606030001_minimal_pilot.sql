create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('Owner', 'Planning', 'Sales', 'Purchasing', 'Warehouse', 'Production', 'Quality'); exception when duplicate_object then null; end $$;
do $$ begin create type public.po_status as enum ('Planning', 'Materials Pending', 'Production Running', 'Packing', 'Ready To Ship', 'Shipped', 'Delayed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.material_status as enum ('Not Ordered', 'Ordered', 'In Transit', 'Received', 'Delayed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.approval_type as enum ('Sample Approval', 'Material Approval', 'Customer Approval'); exception when duplicate_object then null; end $$;
do $$ begin create type public.approval_status as enum ('Pending', 'Approved', 'Rejected', 'Delayed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.production_department as enum ('Cutting', 'Upper', 'Bottom', 'Packing'); exception when duplicate_object then null; end $$;
do $$ begin create type public.line_status as enum ('Running', 'Delayed', 'Stopped'); exception when duplicate_object then null; end $$;
do $$ begin create type public.alert_severity as enum ('info', 'warning', 'danger'); exception when duplicate_object then null; end $$;
do $$ begin create type public.report_type as enum ('daily-production', 'weekly-production', 'material-status', 'order-progress', 'shipment-status'); exception when duplicate_object then null; end $$;

create table if not exists public.roles (
  name public.app_role primary key,
  description text not null
);

insert into public.roles (name, description) values
  ('Owner', 'Full access'),
  ('Planning', 'Dashboard, purchase orders, production lines, reports'),
  ('Sales', 'Dashboard and purchase order progress'),
  ('Purchasing', 'Materials, approvals, and purchase order status'),
  ('Warehouse', 'Reports, material status, and shipment status'),
  ('Production', 'Production lines and daily updates'),
  ('Quality', 'Approvals and daily reports')
on conflict (name) do update set description = excluded.description;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  full_name text,
  department text,
  role public.app_role references public.roles(name),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  buyer text not null,
  style_code text not null,
  style_name text not null default '',
  color text not null,
  quantity integer not null check (quantity > 0),
  delivery_date date not null,
  status public.po_status not null default 'Planning',
  notes text not null default '',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  material_name text not null,
  supplier text not null,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  status public.material_status not null default 'Not Ordered',
  expected_arrival date,
  actual_arrival date,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, material_name)
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  approval_type public.approval_type not null,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  status public.approval_status not null default 'Pending',
  approval_date date not null,
  notes text not null default '',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, approval_type)
);

create table if not exists public.production_lines (
  id uuid primary key default gen_random_uuid(),
  line_name text not null unique,
  department public.production_department not null,
  current_style text not null default '',
  current_order_id uuid references public.purchase_orders(id) on delete set null,
  daily_target integer not null default 0 check (daily_target >= 0),
  daily_actual integer not null default 0 check (daily_actual >= 0),
  capacity integer not null default 0 check (capacity >= 0),
  status public.line_status not null default 'Running',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_production_updates (
  id uuid primary key default gen_random_uuid(),
  production_date date not null,
  production_line_id uuid not null references public.production_lines(id) on delete cascade,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  target_quantity integer not null check (target_quantity >= 0),
  actual_quantity integer not null check (actual_quantity >= 0),
  notes text not null default '',
  entered_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_date, production_line_id)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  severity public.alert_severity not null default 'info',
  message text not null,
  related_table text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_type public.report_type not null,
  generated_by uuid references public.users(id),
  row_count integer not null default 0 check (row_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_orders_status on public.purchase_orders(status);
create index if not exists idx_purchase_orders_delivery_date on public.purchase_orders(delivery_date);
create index if not exists idx_materials_status on public.materials(status);
create index if not exists idx_materials_expected_arrival on public.materials(expected_arrival);
create index if not exists idx_approvals_status on public.approvals(status);
create index if not exists idx_approvals_approval_date on public.approvals(approval_date);
create index if not exists idx_production_lines_department on public.production_lines(department);
create index if not exists idx_production_lines_status on public.production_lines(status);
create index if not exists idx_daily_updates_date on public.daily_production_updates(production_date);
create index if not exists idx_alerts_created_at on public.alerts(created_at desc);
create index if not exists idx_reports_type_created_at on public.reports(report_type, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_purchase_orders_updated_at on public.purchase_orders;
create trigger set_purchase_orders_updated_at before update on public.purchase_orders
for each row execute function public.set_updated_at();

drop trigger if exists set_materials_updated_at on public.materials;
create trigger set_materials_updated_at before update on public.materials
for each row execute function public.set_updated_at();

drop trigger if exists set_approvals_updated_at on public.approvals;
create trigger set_approvals_updated_at before update on public.approvals
for each row execute function public.set_updated_at();

drop trigger if exists set_production_lines_updated_at on public.production_lines;
create trigger set_production_lines_updated_at before update on public.production_lines
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_updates_updated_at on public.daily_production_updates;
create trigger set_daily_updates_updated_at before update on public.daily_production_updates
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;

  insert into public.profiles (user_id, full_name, department, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    null,
    null,
    false
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.current_user_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and active = true
  );
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
  where user_id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'Owner'::public.app_role;
$$;

create or replace function public.has_app_role(variadic allowed_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or public.current_app_role() = any(allowed_roles);
$$;

alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.materials enable row level security;
alter table public.approvals enable row level security;
alter table public.production_lines enable row level security;
alter table public.daily_production_updates enable row level security;
alter table public.alerts enable row level security;
alter table public.reports enable row level security;

create policy roles_select_active on public.roles for select using (public.current_user_active());

create policy users_select_self_or_owner on public.users
for select using (id = auth.uid() or public.is_owner());

create policy profiles_select_self_or_owner on public.profiles
for select using (user_id = auth.uid() or public.is_owner());

create policy profiles_update_owner on public.profiles
for update using (public.is_owner()) with check (public.is_owner());

create policy purchase_orders_select_active on public.purchase_orders
for select using (public.current_user_active());

create policy purchase_orders_insert_planning on public.purchase_orders
for insert with check (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role));

create policy purchase_orders_update_status_roles on public.purchase_orders
for update using (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role, 'Warehouse'::public.app_role))
with check (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role, 'Warehouse'::public.app_role));

create policy materials_select_active on public.materials
for select using (public.current_user_active());

create policy materials_insert_purchasing on public.materials
for insert with check (public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role));

create policy materials_update_purchasing on public.materials
for update using (public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role))
with check (public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role));

create policy approvals_select_active on public.approvals
for select using (public.current_user_active());

create policy approvals_insert_quality_purchasing on public.approvals
for insert with check (public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role, 'Quality'::public.app_role));

create policy approvals_update_quality_purchasing on public.approvals
for update using (public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role, 'Quality'::public.app_role))
with check (public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role, 'Quality'::public.app_role));

create policy production_lines_select_active on public.production_lines
for select using (public.current_user_active());

create policy production_lines_insert_planning_production on public.production_lines
for insert with check (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Production'::public.app_role));

create policy production_lines_update_planning_production on public.production_lines
for update using (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Production'::public.app_role))
with check (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Production'::public.app_role));

create policy daily_updates_select_active on public.daily_production_updates
for select using (public.current_user_active());

create policy daily_updates_insert_production on public.daily_production_updates
for insert with check (public.has_app_role('Owner'::public.app_role, 'Production'::public.app_role));

create policy daily_updates_update_production on public.daily_production_updates
for update using (public.has_app_role('Owner'::public.app_role, 'Production'::public.app_role))
with check (public.has_app_role('Owner'::public.app_role, 'Production'::public.app_role));

create policy alerts_select_active on public.alerts
for select using (public.current_user_active());

create policy alerts_insert_active on public.alerts
for insert with check (public.current_user_active());

create policy reports_select_report_roles on public.reports
for select using (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Warehouse'::public.app_role, 'Quality'::public.app_role));

create policy reports_insert_report_roles on public.reports
for insert with check (public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Warehouse'::public.app_role, 'Quality'::public.app_role));
