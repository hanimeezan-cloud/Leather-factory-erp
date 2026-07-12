create index if not exists idx_users_email_lower on users(lower(email));
create index if not exists idx_customers_name_lower on customers(lower(customer_name));
create index if not exists idx_customers_brand_lower on customers(lower(brand));

create index if not exists idx_purchase_orders_customer_delivery
  on purchase_orders(customer_id, delivery_date);
create index if not exists idx_purchase_orders_customer_po_number
  on purchase_orders(customer_id, po_number);
create index if not exists idx_purchase_orders_style_id
  on purchase_orders(style_id);
create index if not exists idx_purchase_orders_lasting_line
  on purchase_orders(assigned_lasting_line_id);

create index if not exists idx_bom_materials_style_vendor
  on bom_materials(style_id, default_vendor_id);

create index if not exists idx_material_requirements_po_vendor
  on material_requirements(purchase_order_id, vendor_id);
create index if not exists idx_material_requirements_customer
  on material_requirements(customer_id);
create index if not exists idx_material_requirements_style
  on material_requirements(style_id);

create index if not exists idx_material_pos_status_po
  on material_purchase_orders(status, purchase_order_id);
create index if not exists idx_material_po_items_requirement
  on material_po_items(material_requirement_id);

create index if not exists idx_daily_updates_line_date
  on daily_production_updates(production_line_id, production_date);
