alter table customers add column if not exists archived_at timestamptz;
alter table customers add column if not exists archived_by uuid references users(id) on delete set null;
alter table customers add column if not exists archive_reason text not null default '';

alter table purchase_orders add column if not exists archived_at timestamptz;
alter table purchase_orders add column if not exists archived_by uuid references users(id) on delete set null;
alter table purchase_orders add column if not exists archive_reason text not null default '';

alter table styles add column if not exists archived_at timestamptz;
alter table styles add column if not exists archived_by uuid references users(id) on delete set null;
alter table styles add column if not exists archive_reason text not null default '';

alter table bom_materials add column if not exists archived_at timestamptz;
alter table bom_materials add column if not exists archived_by uuid references users(id) on delete set null;
alter table bom_materials add column if not exists archive_reason text not null default '';

alter table material_requirements add column if not exists archived_at timestamptz;
alter table material_requirements add column if not exists archived_by uuid references users(id) on delete set null;
alter table material_requirements add column if not exists archive_reason text not null default '';

alter table material_purchase_orders add column if not exists archived_at timestamptz;
alter table material_purchase_orders add column if not exists archived_by uuid references users(id) on delete set null;
alter table material_purchase_orders add column if not exists archive_reason text not null default '';

alter table material_po_items add column if not exists archived_at timestamptz;
alter table material_po_items add column if not exists archived_by uuid references users(id) on delete set null;
alter table material_po_items add column if not exists archive_reason text not null default '';

alter table materials add column if not exists archived_at timestamptz;
alter table materials add column if not exists archived_by uuid references users(id) on delete set null;
alter table materials add column if not exists archive_reason text not null default '';

alter table vendors add column if not exists archived_at timestamptz;
alter table vendors add column if not exists archived_by uuid references users(id) on delete set null;
alter table vendors add column if not exists archive_reason text not null default '';

alter table approvals add column if not exists archived_at timestamptz;
alter table approvals add column if not exists archived_by uuid references users(id) on delete set null;
alter table approvals add column if not exists archive_reason text not null default '';

alter table production_lines add column if not exists archived_at timestamptz;
alter table production_lines add column if not exists archived_by uuid references users(id) on delete set null;
alter table production_lines add column if not exists archive_reason text not null default '';

alter table daily_logs add column if not exists archived_at timestamptz;
alter table daily_logs add column if not exists archived_by uuid references users(id) on delete set null;
alter table daily_logs add column if not exists archive_reason text not null default '';

alter table daily_production_updates add column if not exists archived_at timestamptz;
alter table daily_production_updates add column if not exists archived_by uuid references users(id) on delete set null;
alter table daily_production_updates add column if not exists archive_reason text not null default '';

alter table reports add column if not exists archived_at timestamptz;
alter table reports add column if not exists archived_by uuid references users(id) on delete set null;
alter table reports add column if not exists archive_reason text not null default '';

create index if not exists idx_customers_archived_at on customers(archived_at);
create index if not exists idx_purchase_orders_archived_at on purchase_orders(archived_at);
create index if not exists idx_styles_archived_at on styles(archived_at);
create index if not exists idx_bom_materials_archived_at on bom_materials(archived_at);
create index if not exists idx_material_requirements_archived_at on material_requirements(archived_at);
create index if not exists idx_material_purchase_orders_archived_at on material_purchase_orders(archived_at);
create index if not exists idx_material_po_items_archived_at on material_po_items(archived_at);
create index if not exists idx_materials_archived_at on materials(archived_at);
create index if not exists idx_vendors_archived_at on vendors(archived_at);
create index if not exists idx_approvals_archived_at on approvals(archived_at);
create index if not exists idx_production_lines_archived_at on production_lines(archived_at);
create index if not exists idx_daily_logs_archived_at on daily_logs(archived_at);
create index if not exists idx_daily_production_updates_archived_at on daily_production_updates(archived_at);
create index if not exists idx_reports_archived_at on reports(archived_at);
