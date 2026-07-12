alter table purchase_orders
  add column if not exists current_stage text not null default 'Cutting';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_orders_current_stage_check'
  ) then
    alter table purchase_orders
      add constraint purchase_orders_current_stage_check
      check (current_stage in (
        'Cutting',
        'Stitching',
        'Closing',
        'Lasting',
        'Finishing',
        'Packing',
        'Completed'
      ));
  end if;
end $$;

update purchase_orders
set current_stage = case
  when status = 'Shipped' then 'Completed'
  when status = 'Ready To Ship' then 'Completed'
  when status = 'Packing' then 'Packing'
  when status = 'Production Running' then 'Lasting'
  when status = 'Delayed' then 'Stitching'
  else current_stage
end
where current_stage = 'Cutting';

alter table daily_production_updates
  add column if not exists production_stage text not null default 'Cutting';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_production_updates_production_stage_check'
  ) then
    alter table daily_production_updates
      add constraint daily_production_updates_production_stage_check
      check (production_stage in (
        'Cutting',
        'Stitching',
        'Closing',
        'Lasting',
        'Finishing',
        'Packing'
      ));
  end if;
end $$;

alter table daily_production_updates
  alter column production_line_id drop not null;

update daily_production_updates du
set production_stage = case pl.department
  when 'Cutting' then 'Cutting'
  when 'Upper' then 'Stitching'
  when 'Bottom' then 'Lasting'
  when 'Packing' then 'Packing'
  else production_stage
end
from production_lines pl
where du.production_line_id = pl.id
  and du.production_stage = 'Cutting';

create index if not exists idx_purchase_orders_current_stage
  on purchase_orders(current_stage);

create index if not exists idx_daily_updates_stage_date
  on daily_production_updates(production_stage, production_date);
