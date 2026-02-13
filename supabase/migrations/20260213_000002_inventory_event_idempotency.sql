begin;

alter table public.inventory_events
  add column if not exists local_event_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_events_device_local_id_key'
      and conrelid = 'public.inventory_events'::regclass
  ) then
    alter table public.inventory_events
      add constraint inventory_events_device_local_id_key
      unique (device_id, local_event_id);
  end if;
end
$$;

drop function if exists public.apply_inventory_event(
  uuid,
  public.inventory_event_type,
  integer,
  text,
  text
);

drop function if exists public.apply_inventory_event(
  uuid,
  public.inventory_event_type,
  integer,
  text,
  text,
  text
);

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

grant execute on function public.apply_inventory_event(
  uuid,
  public.inventory_event_type,
  integer,
  text,
  text,
  text
) to authenticated;

commit;
