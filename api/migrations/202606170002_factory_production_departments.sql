alter table purchase_orders
  drop constraint if exists purchase_orders_current_stage_check;

update purchase_orders
set current_stage = case current_stage
  when 'Stitching' then 'Upper'
  when 'Closing' then 'Upper'
  when 'Lasting' then 'Bottom'
  when 'Finishing' then 'Bottom'
  else current_stage
end
where current_stage in ('Stitching', 'Closing', 'Lasting', 'Finishing');

update purchase_orders
set current_stage = 'Cutting'
where current_stage is null
  or current_stage not in ('Cutting', 'Upper', 'Bottom', 'Packing', 'Completed');

alter table purchase_orders
  add constraint purchase_orders_current_stage_check
  check (current_stage in ('Cutting', 'Upper', 'Bottom', 'Packing', 'Completed'));

alter table daily_production_updates
  drop constraint if exists daily_production_updates_production_stage_check;

update daily_production_updates
set production_stage = case production_stage
  when 'Stitching' then 'Upper'
  when 'Closing' then 'Upper'
  when 'Lasting' then 'Bottom'
  when 'Finishing' then 'Bottom'
  else production_stage
end
where production_stage in ('Stitching', 'Closing', 'Lasting', 'Finishing');

update daily_production_updates du
set production_stage = pl.department
from production_lines pl
where du.production_line_id = pl.id
  and pl.department in ('Cutting', 'Upper', 'Bottom', 'Packing')
  and du.production_stage not in ('Cutting', 'Upper', 'Bottom', 'Packing');

update daily_production_updates
set production_stage = 'Cutting'
where production_stage is null
  or production_stage not in ('Cutting', 'Upper', 'Bottom', 'Packing');

alter table daily_production_updates
  add constraint daily_production_updates_production_stage_check
  check (production_stage in ('Cutting', 'Upper', 'Bottom', 'Packing'));

drop index if exists idx_daily_updates_stage_date;

create index if not exists idx_daily_updates_department_date
  on daily_production_updates(production_stage, production_date);

create index if not exists idx_daily_updates_line_date
  on daily_production_updates(production_line_id, production_date);
