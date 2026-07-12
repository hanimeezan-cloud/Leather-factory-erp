create table if not exists material_po_email_logs (
  id uuid primary key default gen_random_uuid(),
  material_po_id uuid not null references material_purchase_orders(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by uuid references users(id) on delete set null,
  recipient_email text not null,
  email_subject text not null,
  email_body text not null default '',
  attachment_path text not null default '',
  status text not null default 'Sent' check (status in ('Sent', 'Failed', 'Demo')),
  error_message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_material_po_email_logs_po
  on material_po_email_logs(material_po_id, sent_at desc);

create index if not exists idx_material_po_email_logs_sent_by
  on material_po_email_logs(sent_by);
