do $$ begin create type public.customer_status as enum ('Active', 'Inactive', 'Prospect'); exception when duplicate_object then null; end $$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  brand text not null default '',
  contact_person text not null default '',
  email text not null default '',
  phone text not null default '',
  country text not null default '',
  notes text not null default '',
  status public.customer_status not null default 'Active',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.purchase_orders add column if not exists customer_id uuid;
alter table public.purchase_orders add column if not exists po_date date;
alter table public.purchase_orders add column if not exists article text not null default '';
alter table public.purchase_orders add column if not exists brand text not null default '';
alter table public.purchase_orders add column if not exists price numeric(12,2) not null default 0 check (price >= 0);
alter table public.purchase_orders add column if not exists currency text not null default 'USD';
alter table public.purchase_orders add column if not exists product_image_url text not null default '';

do $$
begin
  alter table public.purchase_orders
    add constraint purchase_orders_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete restrict;
exception when duplicate_object then null;
end $$;

alter table public.purchase_orders drop constraint if exists purchase_orders_po_number_key;
create unique index if not exists purchase_orders_customer_po_number_key
  on public.purchase_orders(customer_id, po_number)
  where customer_id is not null;

create table if not exists public.purchase_order_sizes (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  size text not null,
  quantity integer not null check (quantity >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, size)
);

create index if not exists idx_customers_status on public.customers(status);
create index if not exists idx_customers_name on public.customers(customer_name);
create index if not exists idx_purchase_orders_customer_id on public.purchase_orders(customer_id);
create index if not exists idx_purchase_order_sizes_po_id on public.purchase_order_sizes(purchase_order_id);

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists set_purchase_order_sizes_updated_at on public.purchase_order_sizes;
create trigger set_purchase_order_sizes_updated_at before update on public.purchase_order_sizes
for each row execute function public.set_updated_at();

alter table public.customers enable row level security;
alter table public.purchase_order_sizes enable row level security;

drop policy if exists customers_select_by_role on public.customers;
drop policy if exists customers_insert_planning_sales on public.customers;
drop policy if exists customers_update_planning_sales on public.customers;
drop policy if exists purchase_order_sizes_select_by_role on public.purchase_order_sizes;
drop policy if exists purchase_order_sizes_insert_planning_sales on public.purchase_order_sizes;
drop policy if exists purchase_order_sizes_update_planning on public.purchase_order_sizes;
drop policy if exists purchase_order_sizes_delete_planning on public.purchase_order_sizes;
drop policy if exists purchase_orders_select_by_role on public.purchase_orders;
drop policy if exists purchase_orders_insert_planning on public.purchase_orders;
drop policy if exists purchase_orders_insert_planning_sales on public.purchase_orders;
drop policy if exists purchase_orders_update_status_roles on public.purchase_orders;

create policy customers_select_by_role on public.customers
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role
  )
);

create policy customers_insert_planning_sales on public.customers
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role
  )
);

create policy customers_update_planning_sales on public.customers
for update using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role
  )
) with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role
  )
);

create policy purchase_orders_select_by_role on public.purchase_orders
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy purchase_orders_insert_planning_sales on public.purchase_orders
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role
  )
);

create policy purchase_orders_update_status_roles on public.purchase_orders
for update using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role
  )
) with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role
  )
);

create policy purchase_order_sizes_select_by_role on public.purchase_order_sizes
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy purchase_order_sizes_insert_planning_sales on public.purchase_order_sizes
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role
  )
);

create policy purchase_order_sizes_update_planning on public.purchase_order_sizes
for update using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role)
) with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role)
);

create policy purchase_order_sizes_delete_planning on public.purchase_order_sizes
for delete using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role)
);
