begin;

create or replace function public.apply_inventory_event(
  p_product_id uuid,
  p_type public.inventory_event_type,
  p_qty_change integer,
  p_note text default null,
  p_device_id text default null,
  p_local_id text default null
)
returns table (
  event_id uuid,
  new_stock integer,
  event_status public.inventory_event_status,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_stock integer;
  v_new_stock integer;
  v_event_id uuid;
  v_status public.inventory_event_status;
  v_error text;
  v_existing_status public.inventory_event_status;
begin
  if auth.uid() is null
    or not public.has_role('admin'::public.app_role, auth.uid())
  then
    raise exception 'Only admins can modify inventory'
      using errcode = '42501';
  end if;

  insert into public.stock_snapshots (product_id, stock)
  values (p_product_id, 0)
  on conflict (product_id) do nothing;

  select stock
  into v_current_stock
  from public.stock_snapshots
  where product_id = p_product_id
  for update;

  v_current_stock := coalesce(v_current_stock, 0);

  if p_device_id is not null and p_local_id is not null then
    select id, status
      into v_event_id, v_existing_status
    from public.inventory_events
    where device_id = p_device_id
      and local_event_id = p_local_id
    order by created_at desc
    limit 1;

    if found then
      return query
      select
        v_event_id,
        v_current_stock,
        v_existing_status,
        case
          when v_existing_status = 'conflict' then 'Insufficient stock'
          else ''
        end;
      return;
    end if;
  end if;

  v_new_stock := v_current_stock + p_qty_change;

  if v_new_stock < 0 then
    v_status := 'conflict';
    v_error := 'Insufficient stock';
  else
    update public.stock_snapshots
    set stock = v_new_stock, updated_at = now()
    where product_id = p_product_id;

    v_status := 'applied';
    v_error := '';
  end if;

  insert into public.inventory_events (
    product_id, type, qty_change, status, note, device_id, local_event_id, user_id
  )
  values (
    p_product_id, p_type, p_qty_change, v_status, p_note, p_device_id, p_local_id, auth.uid()
  )
  returning id into v_event_id;

  return query
  select
    v_event_id,
    case when v_status = 'applied' then v_new_stock else v_current_stock end,
    v_status,
    v_error;
end;
$$;

drop function if exists public.admin_void_sale_event(uuid, text);

create or replace function public.admin_void_sale_event(
  p_event_id uuid,
  p_reason text default null
)
returns table (
  voided_event_id uuid,
  adjustment_event_id uuid,
  product_id uuid,
  restored_qty integer,
  new_stock integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.inventory_events%rowtype;
  v_current_stock integer;
  v_new_stock integer;
  v_restored_qty integer;
  v_adjustment_event_id uuid;
  v_reason text;
  v_note text;
begin
  if auth.uid() is null
    or not public.has_role('admin'::public.app_role, auth.uid())
  then
    raise exception 'Only admins can void sales'
      using errcode = '42501';
  end if;

  select *
    into v_sale
  from public.inventory_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Sale event not found'
      using errcode = 'P0002';
  end if;

  if v_sale.type <> 'sale' then
    raise exception 'Only sale events can be voided'
      using errcode = 'P0001';
  end if;

  if v_sale.status <> 'applied' then
    raise exception 'Only applied sale events can be voided'
      using errcode = 'P0001';
  end if;

  if v_sale.qty_change >= 0 then
    raise exception 'Invalid sale quantity'
      using errcode = 'P0001';
  end if;

  v_restored_qty := abs(v_sale.qty_change);
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_note := concat(
    'Voided sale ',
    v_sale.id::text,
    case
      when v_reason is null then ''
      else concat(' | Reason: ', v_reason)
    end
  );

  insert into public.stock_snapshots (product_id, stock)
  values (v_sale.product_id, 0)
  on conflict (product_id) do nothing;

  select stock
    into v_current_stock
  from public.stock_snapshots
  where product_id = v_sale.product_id
  for update;

  v_current_stock := coalesce(v_current_stock, 0);
  v_new_stock := v_current_stock + v_restored_qty;

  update public.stock_snapshots
  set stock = v_new_stock, updated_at = now()
  where product_id = v_sale.product_id;

  insert into public.inventory_events (
    product_id,
    type,
    qty_change,
    status,
    note,
    device_id,
    local_event_id,
    user_id
  )
  values (
    v_sale.product_id,
    'adjustment',
    v_restored_qty,
    'applied',
    v_note,
    v_sale.device_id,
    null,
    auth.uid()
  )
  returning id into v_adjustment_event_id;

  delete from public.inventory_events
  where id = v_sale.id;

  return query
  select
    v_sale.id,
    v_adjustment_event_id,
    v_sale.product_id,
    v_restored_qty,
    v_new_stock;
end;
$$;

grant execute on function public.apply_inventory_event(
  uuid,
  public.inventory_event_type,
  integer,
  text,
  text,
  text
) to authenticated;

grant execute on function public.admin_void_sale_event(
  uuid,
  text
) to authenticated;

commit;

notify pgrst, 'reload schema';
