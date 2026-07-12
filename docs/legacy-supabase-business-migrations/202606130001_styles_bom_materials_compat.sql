create table if not exists public.styles (
  id uuid primary key default gen_random_uuid(),
  style_code text not null,
  style_name text,
  color text,
  brand text,
  size_range text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.styles add column if not exists style_name text;
alter table public.styles add column if not exists color text;
alter table public.styles add column if not exists brand text;
alter table public.styles add column if not exists size_range text;
alter table public.styles add column if not exists notes text;
alter table public.styles add column if not exists created_by uuid references public.users(id);
alter table public.styles add column if not exists updated_by uuid references public.users(id);
alter table public.styles add column if not exists created_at timestamptz default now();
alter table public.styles add column if not exists updated_at timestamptz default now();

alter table public.styles drop constraint if exists styles_style_code_key;

create table if not exists public.bom_materials (
  id uuid primary key default gen_random_uuid(),
  style_id uuid references public.styles(id) on delete cascade,
  category text,
  material_name text not null,
  supplier text,
  unit text,
  consumption_per_pair numeric,
  wastage_percent numeric,
  criticality text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.bom_materials add column if not exists style_id uuid references public.styles(id) on delete cascade;
alter table public.bom_materials add column if not exists category text;
alter table public.bom_materials add column if not exists material_category text;
alter table public.bom_materials add column if not exists material_name text;
alter table public.bom_materials add column if not exists specification text;
alter table public.bom_materials add column if not exists supplier text;
alter table public.bom_materials add column if not exists unit text;
alter table public.bom_materials add column if not exists consumption_per_pair numeric;
alter table public.bom_materials add column if not exists wastage_percent numeric;
alter table public.bom_materials add column if not exists criticality text;
alter table public.bom_materials add column if not exists critical boolean default false;
alter table public.bom_materials add column if not exists required_qty_manual_override numeric;
alter table public.bom_materials add column if not exists calculated_qty_example numeric;
alter table public.bom_materials add column if not exists notes text;
alter table public.bom_materials add column if not exists created_by uuid references public.users(id);
alter table public.bom_materials add column if not exists updated_by uuid references public.users(id);
alter table public.bom_materials add column if not exists created_at timestamptz default now();
alter table public.bom_materials add column if not exists updated_at timestamptz default now();

alter table public.bom_materials alter column material_category drop not null;
alter table public.bom_materials alter column specification drop not null;
alter table public.bom_materials alter column unit drop not null;
alter table public.bom_materials alter column consumption_per_pair drop not null;
alter table public.bom_materials alter column wastage_percent drop not null;
alter table public.bom_materials alter column critical drop not null;
alter table public.bom_materials alter column notes drop not null;

update public.bom_materials
set category = coalesce(category, material_category),
    criticality = coalesce(criticality, case when critical then 'Yes' else 'No' end)
where category is null or criticality is null;

create index if not exists idx_styles_style_code on public.styles(style_code);
create index if not exists idx_styles_style_code_color_brand on public.styles(style_code, color, brand);
create index if not exists idx_bom_materials_style_id on public.bom_materials(style_id);
create index if not exists idx_bom_materials_material_name on public.bom_materials(material_name);
create index if not exists idx_bom_materials_category on public.bom_materials(category);

drop trigger if exists set_styles_updated_at on public.styles;
create trigger set_styles_updated_at before update on public.styles
for each row execute function public.set_updated_at();

drop trigger if exists set_bom_materials_updated_at on public.bom_materials;
create trigger set_bom_materials_updated_at before update on public.bom_materials
for each row execute function public.set_updated_at();

alter table public.styles enable row level security;
alter table public.bom_materials enable row level security;

drop policy if exists styles_select_by_role on public.styles;
drop policy if exists styles_insert_import_roles on public.styles;
drop policy if exists styles_update_import_roles on public.styles;
drop policy if exists styles_delete_owner on public.styles;
drop policy if exists bom_materials_select_by_role on public.bom_materials;
drop policy if exists bom_materials_insert_import_roles on public.bom_materials;
drop policy if exists bom_materials_update_import_roles on public.bom_materials;
drop policy if exists bom_materials_delete_owner on public.bom_materials;

create policy styles_select_by_role on public.styles
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role,
    'Production'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy styles_insert_import_roles on public.styles
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role
  )
);

create policy styles_update_import_roles on public.styles
for update using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role
  )
) with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role
  )
);

create policy styles_delete_owner on public.styles
for delete using (public.has_app_role('Owner'::public.app_role));

create policy bom_materials_select_by_role on public.bom_materials
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role,
    'Production'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy bom_materials_insert_import_roles on public.bom_materials
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role
  )
);

create policy bom_materials_update_import_roles on public.bom_materials
for update using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role
  )
) with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role
  )
);

create policy bom_materials_delete_owner on public.bom_materials
for delete using (public.has_app_role('Owner'::public.app_role));
