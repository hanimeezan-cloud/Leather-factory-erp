create table if not exists production_timeline (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  event_type text not null,
  event_title text not null,
  event_description text not null default '',
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_production_timeline_po_created
  on production_timeline(purchase_order_id, created_at desc);

create index if not exists idx_production_timeline_created
  on production_timeline(created_at desc);

create index if not exists idx_production_timeline_event_type
  on production_timeline(event_type);

insert into production_timeline (
  purchase_order_id,
  event_type,
  event_title,
  event_description,
  user_id,
  created_at
)
select
  po.id,
  'po_created',
  'PO Created',
  'Purchase order ' || po.po_number || ' was added to the system.',
  po.created_by,
  po.created_at
from purchase_orders po
where not exists (
  select 1
  from production_timeline pt
  where pt.purchase_order_id = po.id
    and pt.event_type in ('po_created', 'po_imported')
);
