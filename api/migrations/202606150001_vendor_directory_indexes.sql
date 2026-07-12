create index if not exists idx_vendors_status on vendors(status);
create index if not exists idx_vendors_material_categories on vendors using gin(material_categories);
create index if not exists idx_bom_materials_default_vendor_id on bom_materials(default_vendor_id);
create index if not exists idx_material_purchase_orders_vendor_status
  on material_purchase_orders(vendor_id, status);
