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
    coalesce(new.email, ''),
    null,
    'Sales'::public.app_role,
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

create table if not exists public.styles (
  id uuid primary key default gen_random_uuid(),
  style_code text not null unique,
  style_name text not null default '',
  color text not null default '',
  brand text not null default '',
  size_range text not null default '',
  notes text not null default '',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bom_materials (
  id uuid primary key default gen_random_uuid(),
  style_id uuid not null references public.styles(id) on delete cascade,
  material_category text not null,
  material_name text not null,
  specification text not null default '',
  supplier text not null default '',
  unit text not null default '',
  consumption_per_pair numeric(12,4) not null default 0 check (consumption_per_pair >= 0),
  wastage_percent numeric(12,4) not null default 0 check (wastage_percent >= 0),
  critical boolean not null default false,
  required_qty_manual_override numeric(14,4) check (required_qty_manual_override is null or required_qty_manual_override >= 0),
  calculated_qty_example numeric(14,4) check (calculated_qty_example is null or calculated_qty_example >= 0),
  notes text not null default '',
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (style_id, material_category, material_name)
);

create index if not exists idx_styles_style_code on public.styles(style_code);
create index if not exists idx_bom_materials_style_id on public.bom_materials(style_id);
create index if not exists idx_bom_materials_category on public.bom_materials(material_category);
create index if not exists idx_bom_materials_critical on public.bom_materials(critical);

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
drop policy if exists bom_materials_select_by_role on public.bom_materials;
drop policy if exists bom_materials_insert_import_roles on public.bom_materials;
drop policy if exists bom_materials_update_import_roles on public.bom_materials;

create policy styles_select_by_role on public.styles
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role,
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

create policy bom_materials_select_by_role on public.bom_materials
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role,
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
