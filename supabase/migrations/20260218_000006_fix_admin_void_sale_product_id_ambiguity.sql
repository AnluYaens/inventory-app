begin;

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

  select ie.*
    into v_sale
  from public.inventory_events as ie
  where ie.id = p_event_id
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

  select ss.stock
    into v_current_stock
  from public.stock_snapshots as ss
  where ss.product_id = v_sale.product_id
  for update;

  v_current_stock := coalesce(v_current_stock, 0);
  v_new_stock := v_current_stock + v_restored_qty;

  update public.stock_snapshots as ss
  set stock = v_new_stock, updated_at = now()
  where ss.product_id = v_sale.product_id;

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

  delete from public.inventory_events as ie
  where ie.id = v_sale.id;

  voided_event_id := v_sale.id;
  adjustment_event_id := v_adjustment_event_id;
  product_id := v_sale.product_id;
  restored_qty := v_restored_qty;
  new_stock := v_new_stock;

  return next;
end;
$$;

grant execute on function public.admin_void_sale_event(
  uuid,
  text
) to authenticated;

commit;

notify pgrst, 'reload schema';
