alter table daily_production_updates
  add column if not exists production_stage text not null default 'Cutting';

alter table daily_production_updates
  alter column production_line_id drop not null;

alter table daily_production_updates
  drop constraint if exists daily_production_updates_production_stage_check;

update daily_production_updates
set production_stage = 'Cutting'
where production_stage is null
  or production_stage not in ('Cutting', 'Upper', 'Bottom', 'Packing');

alter table daily_production_updates
  add constraint daily_production_updates_production_stage_check
  check (production_stage in ('Cutting', 'Upper', 'Bottom', 'Packing'));

create index if not exists idx_daily_updates_po_stage_date
  on daily_production_updates(purchase_order_id, production_stage, production_date)
  where archived_at is null;

create index if not exists idx_daily_updates_stage_date_po
  on daily_production_updates(production_stage, production_date, purchase_order_id)
  where archived_at is null;
