alter table bom_materials
  add column if not exists calculation_type text not null default 'Per Pair';

alter table bom_materials
  add column if not exists fixed_quantity numeric(14,4);

alter table material_requirements
  add column if not exists calculation_type text not null default 'Per Pair';

alter table material_requirements
  add column if not exists size_label text not null default '';

alter table material_requirements
  add column if not exists size_value text not null default '';

alter table material_requirements
  add column if not exists parent_bom_material_id uuid references bom_materials(id) on delete set null;

update bom_materials
set calculation_type = 'Per Pair'
where calculation_type is null or calculation_type = '';

update material_requirements
set
  calculation_type = 'Per Pair',
  size_label = '',
  size_value = '',
  parent_bom_material_id = bom_material_id
where calculation_type is null
  or calculation_type = ''
  or parent_bom_material_id is null;

alter table bom_materials
  drop constraint if exists bom_materials_calculation_type_check;

alter table bom_materials
  add constraint bom_materials_calculation_type_check
  check (calculation_type in ('Per Pair', 'Size Wise', 'Fixed Quantity', 'Manual Quantity'));

alter table material_requirements
  drop constraint if exists material_requirements_calculation_type_check;

alter table material_requirements
  add constraint material_requirements_calculation_type_check
  check (calculation_type in ('Per Pair', 'Size Wise', 'Fixed Quantity', 'Manual Quantity'));

alter table bom_materials
  drop constraint if exists bom_materials_fixed_quantity_check;

alter table bom_materials
  add constraint bom_materials_fixed_quantity_check
  check (fixed_quantity is null or fixed_quantity >= 0);

alter table material_requirements
  drop constraint if exists material_requirements_purchase_order_id_bom_material_id_key;

drop index if exists material_requirements_purchase_order_id_bom_material_id_key;

create unique index if not exists idx_material_requirements_po_bom_size
  on material_requirements(
    purchase_order_id,
    coalesce(bom_material_id, parent_bom_material_id),
    coalesce(size_value, '')
  );

create index if not exists idx_material_requirements_size_value
  on material_requirements(size_value)
  where size_value <> '';

create index if not exists idx_bom_materials_calculation_type
  on bom_materials(calculation_type);
