drop policy if exists roles_select_active on public.roles;
drop policy if exists users_select_self_or_owner on public.users;
drop policy if exists profiles_select_self_or_owner on public.profiles;
drop policy if exists profiles_update_owner on public.profiles;
drop policy if exists purchase_orders_select_active on public.purchase_orders;
drop policy if exists purchase_orders_insert_planning on public.purchase_orders;
drop policy if exists purchase_orders_update_status_roles on public.purchase_orders;
drop policy if exists materials_select_active on public.materials;
drop policy if exists materials_insert_purchasing on public.materials;
drop policy if exists materials_update_purchasing on public.materials;
drop policy if exists approvals_select_active on public.approvals;
drop policy if exists approvals_insert_quality_purchasing on public.approvals;
drop policy if exists approvals_update_quality_purchasing on public.approvals;
drop policy if exists production_lines_select_active on public.production_lines;
drop policy if exists production_lines_insert_planning_production on public.production_lines;
drop policy if exists production_lines_update_planning_production on public.production_lines;
drop policy if exists daily_updates_select_active on public.daily_production_updates;
drop policy if exists daily_updates_insert_production on public.daily_production_updates;
drop policy if exists daily_updates_update_production on public.daily_production_updates;
drop policy if exists alerts_select_active on public.alerts;
drop policy if exists alerts_insert_active on public.alerts;
drop policy if exists reports_select_report_roles on public.reports;
drop policy if exists reports_insert_report_roles on public.reports;

create policy roles_select_active on public.roles
for select using (public.current_user_active());

create policy users_select_self_or_owner on public.users
for select using (id = auth.uid() or public.is_owner());

create policy profiles_select_self_or_owner on public.profiles
for select using (user_id = auth.uid() or public.is_owner());

create policy profiles_update_owner on public.profiles
for update using (public.is_owner()) with check (public.is_owner());

create policy purchase_orders_select_by_role on public.purchase_orders
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role,
    'Production'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy purchase_orders_insert_planning on public.purchase_orders
for insert with check (
  public.has_app_role('Owner'::public.app_role, 'Planning'::public.app_role)
);

create policy purchase_orders_update_status_roles on public.purchase_orders
for update using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role
  )
) with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role
  )
);

create policy materials_select_by_role on public.materials
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role,
    'Warehouse'::public.app_role
  )
);

create policy materials_insert_purchasing on public.materials
for insert with check (
  public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role)
);

create policy materials_update_purchasing on public.materials
for update using (
  public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role)
) with check (
  public.has_app_role('Owner'::public.app_role, 'Purchasing'::public.app_role)
);

create policy approvals_select_by_role on public.approvals
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Purchasing'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy approvals_insert_quality_purchasing on public.approvals
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Purchasing'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy approvals_update_quality_purchasing on public.approvals
for update using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Purchasing'::public.app_role,
    'Quality'::public.app_role
  )
) with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Purchasing'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy production_lines_select_by_role on public.production_lines
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Production'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy production_lines_insert_planning_production on public.production_lines
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Production'::public.app_role
  )
);

create policy production_lines_update_planning_production on public.production_lines
for update using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Production'::public.app_role
  )
) with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Production'::public.app_role
  )
);

create policy daily_updates_select_by_role on public.daily_production_updates
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Production'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy daily_updates_insert_production on public.daily_production_updates
for insert with check (
  public.has_app_role('Owner'::public.app_role, 'Production'::public.app_role)
);

create policy daily_updates_update_production on public.daily_production_updates
for update using (
  public.has_app_role('Owner'::public.app_role, 'Production'::public.app_role)
) with check (
  public.has_app_role('Owner'::public.app_role, 'Production'::public.app_role)
);

create policy alerts_select_dashboard_roles on public.alerts
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role
  )
);

create policy alerts_insert_active on public.alerts
for insert with check (public.current_user_active());

create policy reports_select_report_roles on public.reports
for select using (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Warehouse'::public.app_role,
    'Quality'::public.app_role
  )
);

create policy reports_insert_report_roles on public.reports
for insert with check (
  public.has_app_role(
    'Owner'::public.app_role,
    'Planning'::public.app_role,
    'Sales'::public.app_role,
    'Warehouse'::public.app_role,
    'Quality'::public.app_role
  )
);
