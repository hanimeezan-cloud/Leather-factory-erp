create extension if not exists pgcrypto;

create table if not exists roles (
  name text primary key check (name in ('Owner', 'Planning', 'Sales', 'Purchasing', 'Warehouse', 'Production', 'Quality')),
  description text not null default ''
);

insert into roles (name, description)
values
  ('Owner', 'Full access and user administration'),
  ('Planning', 'Planning, customers, orders, production planning, reports'),
  ('Sales', 'Customer and purchase order access'),
  ('Purchasing', 'Materials, approvals, vendors, BOM, material POs'),
  ('Warehouse', 'Material and shipment status access'),
  ('Production', 'Production lines and daily production updates'),
  ('Quality', 'Approvals and production report access')
on conflict (name) do update set description = excluded.description;

create table if not exists users (
  id uuid primary key,
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id uuid primary key references users(id) on delete cascade,
  full_name text,
  department text,
  role text references roles(name) default 'Sales',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  brand text not null default '',
  contact_person text not null default '',
  email text not null default '',
  phone text not null default '',
  country text not null default '',
  notes text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Prospect')),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists styles (
  id uuid primary key default gen_random_uuid(),
  style_code text not null,
  style_name text not null default '',
  color text not null default '',
  brand text not null default '',
  size_range text not null default '',
  notes text not null default '',
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (style_code, color, brand)
);

create table if not exists production_lines (
  id uuid primary key default gen_random_uuid(),
  line_name text not null unique,
  department text not null check (department in ('Cutting', 'Upper', 'Bottom', 'Packing')),
  current_style text not null default '',
  current_order_id uuid,
  daily_target integer not null default 0 check (daily_target >= 0),
  daily_actual integer not null default 0 check (daily_actual >= 0),
  capacity integer not null default 0 check (capacity >= 0),
  status text not null default 'Running' check (status in ('Running', 'Delayed', 'Stopped')),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete restrict,
  po_number text not null,
  buyer text not null default '',
  po_date date,
  article text not null default '',
  brand text not null default '',
  style_code text not null default '',
  style_name text not null default '',
  color text not null default '',
  quantity integer not null check (quantity > 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  currency text not null default 'USD',
  delivery_date date not null,
  status text not null default 'Planning' check (status in ('Planning', 'Materials Pending', 'Production Running', 'Packing', 'Ready To Ship', 'Shipped', 'Delayed')),
  notes text not null default '',
  product_image_url text not null default '',
  style_id uuid references styles(id) on delete set null,
  assigned_production_line_id uuid references production_lines(id) on delete set null,
  assigned_lasting_line_id uuid references production_lines(id) on delete set null,
  planned_start_date date,
  planned_daily_capacity integer,
  estimated_lasting_days integer,
  estimated_completion_date date,
  shipment_risk text check (shipment_risk is null or shipment_risk in ('Low', 'Medium', 'High', 'Unknown')),
  production_plan_summary text not null default '',
  domino_warnings jsonb not null default '[]'::jsonb,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, po_number)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'production_lines_current_order_id_fkey'
  ) then
    alter table production_lines
      add constraint production_lines_current_order_id_fkey
      foreign key (current_order_id) references purchase_orders(id) on delete set null;
  end if;
end $$;

create table if not exists purchase_order_sizes (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  size text not null,
  quantity integer not null check (quantity >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, size)
);

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  contact_person text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  material_categories text[] not null default '{}',
  notes text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bom_materials (
  id uuid primary key default gen_random_uuid(),
  style_id uuid references styles(id) on delete cascade,
  category text not null default '',
  material_category text not null default '',
  material_name text not null,
  specification text not null default '',
  supplier text not null default '',
  unit text not null default '',
  consumption_per_pair numeric(14,4),
  wastage_percent numeric(8,4) not null default 0,
  criticality text not null default 'No',
  critical boolean not null default false,
  required_qty_manual_override numeric(14,4),
  calculated_qty_example numeric(14,4),
  default_vendor_id uuid references vendors(id) on delete set null,
  notes text not null default '',
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (style_id, category, material_name)
);

create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  material_name text not null,
  supplier text not null default '',
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  required_qty numeric(14,4) not null default 0 check (required_qty >= 0),
  received_qty numeric(14,4) not null default 0 check (received_qty >= 0),
  unit text not null default 'pairs',
  status text not null default 'Not Ordered' check (status in ('Not Ordered', 'Ordered', 'In Transit', 'Received', 'Delayed')),
  expected_arrival date,
  actual_arrival date,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  approval_type text not null check (approval_type in ('Sample Approval', 'Material Approval', 'Customer Approval')),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Delayed')),
  approval_date date not null,
  notes text not null default '',
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists daily_production_updates (
  id uuid primary key default gen_random_uuid(),
  production_date date not null,
  production_line_id uuid not null references production_lines(id) on delete cascade,
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  target_quantity integer not null default 0 check (target_quantity >= 0),
  actual_quantity integer not null default 0 check (actual_quantity >= 0),
  notes text not null default '',
  entered_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_date, production_line_id, purchase_order_id)
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'info' check (severity in ('info', 'warning', 'danger')),
  message text not null,
  related_table text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('daily-production', 'weekly-production', 'material-status', 'order-progress', 'shipment-status')),
  generated_by uuid references users(id),
  row_count integer not null default 0 check (row_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists material_requirements (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  style_id uuid references styles(id) on delete set null,
  bom_material_id uuid references bom_materials(id) on delete set null,
  material_name text not null,
  specification text not null default '',
  required_quantity numeric(14,4) not null default 0 check (required_quantity >= 0),
  ordered_quantity numeric(14,4) not null default 0 check (ordered_quantity >= 0),
  received_quantity numeric(14,4) not null default 0 check (received_quantity >= 0),
  balance_quantity numeric(14,4) not null default 0 check (balance_quantity >= 0),
  unit text not null default '',
  vendor_id uuid references vendors(id) on delete set null,
  quantity_status text not null default 'Calculated' check (quantity_status in ('Calculated', 'Needs manual quantity')),
  notes text not null default '',
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, bom_material_id)
);

create sequence if not exists material_po_number_seq;

create or replace function next_material_po_number()
returns text
language plpgsql
as $$
begin
  return 'MPO-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('material_po_number_seq')::text, 4, '0');
end;
$$;

create table if not exists material_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  material_po_number text not null unique,
  vendor_id uuid references vendors(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  style_id uuid references styles(id) on delete set null,
  generated_date date not null default current_date,
  expected_delivery_date date,
  status text not null default 'Draft' check (status in ('Draft', 'Ready', 'Sent', 'Confirmed', 'Partially Received', 'Completed', 'Cancelled')),
  notes text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists material_po_items (
  id uuid primary key default gen_random_uuid(),
  material_po_id uuid not null references material_purchase_orders(id) on delete cascade,
  material_requirement_id uuid references material_requirements(id) on delete set null,
  material_name text not null,
  specification text not null default '',
  quantity numeric(14,4) not null default 0 check (quantity >= 0),
  unit text not null default '',
  vendor_name_snapshot text not null default '',
  notes text not null default '',
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_po_id, material_requirement_id)
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at before update on users for each row execute function set_updated_at();
drop trigger if exists set_profiles_updated_at on profiles;
create trigger set_profiles_updated_at before update on profiles for each row execute function set_updated_at();
drop trigger if exists set_customers_updated_at on customers;
create trigger set_customers_updated_at before update on customers for each row execute function set_updated_at();
drop trigger if exists set_styles_updated_at on styles;
create trigger set_styles_updated_at before update on styles for each row execute function set_updated_at();
drop trigger if exists set_purchase_orders_updated_at on purchase_orders;
create trigger set_purchase_orders_updated_at before update on purchase_orders for each row execute function set_updated_at();
drop trigger if exists set_purchase_order_sizes_updated_at on purchase_order_sizes;
create trigger set_purchase_order_sizes_updated_at before update on purchase_order_sizes for each row execute function set_updated_at();
drop trigger if exists set_vendors_updated_at on vendors;
create trigger set_vendors_updated_at before update on vendors for each row execute function set_updated_at();
drop trigger if exists set_bom_materials_updated_at on bom_materials;
create trigger set_bom_materials_updated_at before update on bom_materials for each row execute function set_updated_at();
drop trigger if exists set_materials_updated_at on materials;
create trigger set_materials_updated_at before update on materials for each row execute function set_updated_at();
drop trigger if exists set_approvals_updated_at on approvals;
create trigger set_approvals_updated_at before update on approvals for each row execute function set_updated_at();
drop trigger if exists set_production_lines_updated_at on production_lines;
create trigger set_production_lines_updated_at before update on production_lines for each row execute function set_updated_at();
drop trigger if exists set_daily_production_updates_updated_at on daily_production_updates;
create trigger set_daily_production_updates_updated_at before update on daily_production_updates for each row execute function set_updated_at();
drop trigger if exists set_material_requirements_updated_at on material_requirements;
create trigger set_material_requirements_updated_at before update on material_requirements for each row execute function set_updated_at();
drop trigger if exists set_material_purchase_orders_updated_at on material_purchase_orders;
create trigger set_material_purchase_orders_updated_at before update on material_purchase_orders for each row execute function set_updated_at();
drop trigger if exists set_material_po_items_updated_at on material_po_items;
create trigger set_material_po_items_updated_at before update on material_po_items for each row execute function set_updated_at();

create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_customers_name on customers(customer_name);
create index if not exists idx_purchase_orders_customer on purchase_orders(customer_id);
create index if not exists idx_purchase_orders_status on purchase_orders(status);
create index if not exists idx_purchase_orders_delivery on purchase_orders(delivery_date);
create index if not exists idx_purchase_orders_style_lookup on purchase_orders(style_code, color, brand);
create index if not exists idx_purchase_order_sizes_po on purchase_order_sizes(purchase_order_id);
create index if not exists idx_styles_lookup on styles(style_code, color, brand);
create index if not exists idx_bom_materials_style on bom_materials(style_id);
create index if not exists idx_bom_materials_material_name on bom_materials(material_name);
create index if not exists idx_bom_materials_default_vendor on bom_materials(default_vendor_id);
create index if not exists idx_materials_status on materials(status);
create index if not exists idx_materials_po on materials(purchase_order_id);
create index if not exists idx_approvals_status on approvals(status);
create index if not exists idx_approvals_po on approvals(purchase_order_id);
create index if not exists idx_production_lines_status on production_lines(status);
create index if not exists idx_daily_updates_date on daily_production_updates(production_date);
create index if not exists idx_alerts_created on alerts(created_at);
create index if not exists idx_vendors_name on vendors(vendor_name);
create index if not exists idx_material_requirements_po on material_requirements(purchase_order_id);
create index if not exists idx_material_requirements_vendor on material_requirements(vendor_id);
create index if not exists idx_material_pos_po on material_purchase_orders(purchase_order_id);
create index if not exists idx_material_pos_vendor on material_purchase_orders(vendor_id);
create index if not exists idx_material_pos_status on material_purchase_orders(status);
create unique index if not exists idx_material_pos_draft_group
  on material_purchase_orders(
    purchase_order_id,
    coalesce(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'Draft';
create index if not exists idx_material_po_items_po on material_po_items(material_po_id);
