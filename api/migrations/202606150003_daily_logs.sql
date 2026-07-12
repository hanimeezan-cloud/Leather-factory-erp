create table if not exists daily_logs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  note text not null default '',
  log_date date not null default current_date,
  author_id uuid references users(id) on delete set null,
  department_stage text not null default '',
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  status text not null default 'Open' check (status in ('Open', 'Resolved')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_daily_logs_updated_at on daily_logs;
create trigger set_daily_logs_updated_at
  before update on daily_logs
  for each row
  execute function set_updated_at();

create index if not exists idx_daily_logs_date on daily_logs(log_date desc);
create index if not exists idx_daily_logs_priority_status on daily_logs(priority, status);
create index if not exists idx_daily_logs_status on daily_logs(status);
create index if not exists idx_daily_logs_author on daily_logs(author_id);
create index if not exists idx_daily_logs_purchase_order on daily_logs(purchase_order_id);
create index if not exists idx_daily_logs_department_stage on daily_logs(department_stage);

insert into daily_logs (
  title,
  note,
  log_date,
  author_id,
  department_stage,
  purchase_order_id,
  priority,
  status,
  created_by,
  updated_by,
  created_at,
  updated_at
)
select
  'Production update - ' || coalesce(du.production_stage, 'Factory') as title,
  du.notes as note,
  du.production_date as log_date,
  du.entered_by as author_id,
  coalesce(du.production_stage, '') as department_stage,
  du.purchase_order_id,
  case
    when du.actual_quantity < du.target_quantity then 'Medium'
    else 'Low'
  end as priority,
  'Open' as status,
  du.entered_by as created_by,
  du.updated_by as updated_by,
  du.created_at,
  du.updated_at
from daily_production_updates du
where trim(coalesce(du.notes, '')) <> ''
  and not exists (
    select 1
    from daily_logs dl
    where dl.log_date = du.production_date
      and dl.note = du.notes
      and coalesce(dl.purchase_order_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(du.purchase_order_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
