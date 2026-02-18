begin;

drop function if exists public.admin_delete_sale_event(uuid, text);

create function public.admin_delete_sale_event(
  p_event_id uuid,
  p_reason text default null
)
returns table (
  deleted_event_id uuid,
  product_id uuid,
  qty_change integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.inventory_events%rowtype;
begin
  if auth.uid() is null
    or not public.has_role('admin'::public.app_role, auth.uid())
  then
    raise exception 'Only admins can delete sales'
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
    raise exception 'Only sale events can be deleted'
      using errcode = 'P0001';
  end if;

  if v_sale.status <> 'applied' then
    raise exception 'Only applied sale events can be deleted'
      using errcode = 'P0001';
  end if;

  delete from public.inventory_events as ie
  where ie.id = v_sale.id;

  return query
  select
    v_sale.id,
    v_sale.product_id,
    v_sale.qty_change;
end;
$$;

grant execute on function public.admin_delete_sale_event(
  uuid,
  text
) to authenticated;

commit;

notify pgrst, 'reload schema';
