create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  contact_person text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  material_categories text[] not null default '{}',
  notes text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bom_materials add column if not exists default_vendor_id uuid references public.vendors(id) on delete set null;

alter table public.purchase_orders add column if not exists style_id uuid references public.styles(id) on delete set null;
alter table public.purchase_orders add column if not exists assigned_production_line_id uuid references public.production_lines(id) on delete set null;
alter table public.purchase_orders add column if not exists assigned_lasting_line_id uuid references public.production_lines(id) on delete set null;
alter table public.purchase_orders add column if not exists planned_start_date date;
alter table public.purchase_orders add column if not exists planned_daily_capacity integer;
alter table public.purchase_orders add column if not exists estimated_lasting_days integer;
alter table public.purchase_orders add column if not exists estimated_completion_date date;
alter table public.purchase_orders add column if not exists shipment_risk text;
alter table public.purchase_orders add column if not exists production_plan_summary text not null default '';
alter table public.purchase_orders add column if not exists domino_warnings jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchase_orders_shipment_risk_check'
  ) then
    alter table public.purchase_orders
      add constraint purchase_orders_shipment_risk_check
      check (shipment_risk is null or shipment_risk in ('Low', 'Medium', 'High', 'Unknown'));
  end if;
end $$;

create table if not exists public.material_requirements (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  style_id uuid references public.styles(id) on delete set null,
  bom_material_id uuid references public.bom_materials(id) on delete set null,
  material_name text not null,
  specification text not null default '',
  required_quantity numeric(14,4) not null default 0 check (required_quantity >= 0),
  ordered_quantity numeric(14,4) not null default 0 check (ordered_quantity >= 0),
  received_quantity numeric(14,4) not null default 0 check (received_quantity >= 0),
  balance_quantity numeric(14,4) not null default 0 check (balance_quantity >= 0),
  unit text not null default '',
  vendor_id uuid references public.vendors(id) on delete set null,
  quantity_status text not null default 'Calculated'
    check (quantity_status in ('Calculated', 'Needs manual quantity')),
  notes text not null default '',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, bom_material_id)
);

create sequence if not exists public.material_po_number_seq;

create or replace function public.next_material_po_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'MPO-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.material_po_number_seq')::text, 4, '0');
end;
$$;

grant execute on function public.next_material_po_number() to authenticated;

create table if not exists public.material_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  material_po_number text not null unique,
  vendor_id uuid references public.vendors(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  style_id uuid references public.styles(id) on delete set null,
  generated_date date not null default current_date,
  expected_delivery_date date,
  status text not null default 'Draft'
    check (status in ('Draft', 'Ready', 'Sent', 'Confirmed', 'Partially Received', 'Completed', 'Cancelled')),
  notes text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_po_items (
  id uuid primary key default gen_random_uuid(),
  material_po_id uuid not null references public.material_purchase_orders(id) on delete cascade,
  material_requirement_id uuid references public.material_requirements(id) on delete set null,
  material_name text not null,
  specification text not null default '',
  quantity numeric(14,4) not null default 0 check (quantity >= 0),
  unit text not null default '',
  vendor_name_snapshot text not null default '',
  notes text not null default '',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_po_id, material_requirement_id)
);

create index if not exists idx_vendors_name on public.vendors(vendor_name);
create index if not exists idx_vendors_status on public.vendors(status);
create index if not exists idx_bom_materials_default_vendor on public.bom_materials(default_vendor_id);
create index if not exists idx_purchase_orders_style_id on public.purchase_orders(style_id);
create index if not exists idx_purchase_orders_assigned_lasting on public.purchase_orders(assigned_lasting_line_id);
create index if not exists idx_material_requirements_po on public.material_requirements(purchase_order_id);
create index if not exists idx_material_requirements_vendor on public.material_requirements(vendor_id);
create index if not exists idx_material_pos_po on public.material_purchase_orders(purchase_order_id);
create index if not exists idx_material_pos_vendor on public.material_purchase_orders(vendor_id);
create index if not exists idx_material_pos_status on public.material_purchase_orders(status);
create unique index if not exists idx_material_pos_draft_group
  on public.material_purchase_orders(
    purchase_order_id,
    coalesce(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'Draft';
create index if not exists idx_material_po_items_po on public.material_po_items(material_po_id);

drop trigger if exists set_vendors_updated_at on public.vendors;
create trigger set_vendors_updated_at before update on public.vendors
for each row execute function public.set_updated_at();

drop trigger if exists set_material_requirements_updated_at on public.material_requirements;
create trigger set_material_requirements_updated_at before update on public.material_requirements
for each row execute function public.set_updated_at();

drop trigger if exists set_material_purchase_orders_updated_at on public.material_purchase_orders;
create trigger set_material_purchase_orders_updated_at before update on public.material_purchase_orders
for each row execute function public.set_updated_at();

drop trigger if exists set_material_po_items_updated_at on public.material_po_items;
create trigger set_material_po_items_updated_at before update on public.material_po_items
for each row execute function public.set_updated_at();

alter table public.vendors enable row level security;
alter table public.material_requirements enable row level security;
alter table public.material_purchase_orders enable row level security;
alter table public.material_po_items enable row level security;

drop policy if exists vendors_select_procurement_roles on public.vendors;
drop policy if exists vendors_insert_procurement_roles on public.vendors;
drop policy if exists vendors_update_procurement_roles on public.vendors;
drop policy if exists vendors_delete_owner on public.vendors;
drop policy if exists material_requirements_select_procurement_roles on public.material_requirements;
drop policy if exists material_requirements_insert_procurement_roles on public.material_requirements;
drop policy if exists material_requirements_update_procurement_roles on public.material_requirements;
drop policy if exists material_requirements_delete_owner on public.material_requirements;
drop policy if exists material_pos_select_procurement_roles on public.material_purchase_orders;
drop policy if exists material_pos_insert_procurement_roles on public.material_purchase_orders;
drop policy if exists material_pos_update_procurement_roles on public.material_purchase_orders;
drop policy if exists material_pos_delete_owner on public.material_purchase_orders;
drop policy if exists material_po_items_select_procurement_roles on public.material_po_items;
drop policy if exists material_po_items_insert_procurement_roles on public.material_po_items;
drop policy if exists material_po_items_update_procurement_roles on public.material_po_items;
drop policy if exists material_po_items_delete_owner on public.material_po_items;

create policy vendors_select_procurement_roles on public.vendors
for select using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy vendors_insert_procurement_roles on public.vendors
for insert with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy vendors_update_procurement_roles on public.vendors
for update using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
) with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy vendors_delete_owner on public.vendors
for delete using (public.has_app_role('Owner'::public.app_role));

create policy material_requirements_select_procurement_roles on public.material_requirements
for select using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_requirements_insert_procurement_roles on public.material_requirements
for insert with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_requirements_update_procurement_roles on public.material_requirements
for update using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
) with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_requirements_delete_owner on public.material_requirements
for delete using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_pos_select_procurement_roles on public.material_purchase_orders
for select using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_pos_insert_procurement_roles on public.material_purchase_orders
for insert with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_pos_update_procurement_roles on public.material_purchase_orders
for update using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
) with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_pos_delete_owner on public.material_purchase_orders
for delete using (
  status = 'Draft' and
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_po_items_select_procurement_roles on public.material_po_items
for select using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_po_items_insert_procurement_roles on public.material_po_items
for insert with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_po_items_update_procurement_roles on public.material_po_items
for update using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
) with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role)
);

create policy material_po_items_delete_owner on public.material_po_items
for delete using (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role, 'Purchasing'::public.app_role) and
  exists (
    select 1
    from public.material_purchase_orders mpo
    where mpo.id = material_po_id
      and mpo.status = 'Draft'
  )
);
