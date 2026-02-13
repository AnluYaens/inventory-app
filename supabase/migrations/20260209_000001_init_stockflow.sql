begin;

create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('admin', 'staff');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.inventory_event_type as enum ('sale', 'restock', 'adjustment');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.inventory_event_status as enum ('applied', 'conflict');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null unique,
  category text,
  size text,
  color text,
  price numeric not null default 0,
  cost numeric,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_snapshots (
  product_id uuid primary key references public.products(id) on delete cascade,
  stock integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  type public.inventory_event_type not null,
  qty_change integer not null,
  status public.inventory_event_status not null default 'applied',
  note text,
  device_id text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'staff',
  unique (user_id, role)
);

create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  store_name text not null default 'Mi Tienda',
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id, store_name, currency)
select gen_random_uuid(), 'Mi Tienda', 'USD'
where not exists (select 1 from public.store_settings);

create index if not exists idx_inventory_events_product_created
  on public.inventory_events (product_id, created_at desc);

create index if not exists idx_inventory_events_status
  on public.inventory_events (status);

create index if not exists idx_user_roles_user
  on public.user_roles (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_products_updated_at'
  ) then
    create trigger trg_products_updated_at
    before update on public.products
    for each row execute function public.set_updated_at();
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_stock_snapshots_updated_at'
  ) then
    create trigger trg_stock_snapshots_updated_at
    before update on public.stock_snapshots
    for each row execute function public.set_updated_at();
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_store_settings_updated_at'
  ) then
    create trigger trg_store_settings_updated_at
    before update on public.store_settings
    for each row execute function public.set_updated_at();
  end if;
end
$$;

create or replace function public.has_role(_role public.app_role, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role = _role
  );
$$;

drop function if exists public.apply_inventory_event(
  uuid,
  public.inventory_event_type,
  integer,
  text,
  text
);

create or replace function public.apply_inventory_event(
  p_product_id uuid,
  p_type public.inventory_event_type,
  p_qty_change integer,
  p_note text default null,
  p_device_id text default null
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
    product_id, type, qty_change, status, note, device_id, user_id
  )
  values (
    p_product_id, p_type, p_qty_change, v_status, p_note, p_device_id, auth.uid()
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'staff')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
  end if;
end
$$;

alter table public.products enable row level security;
alter table public.stock_snapshots enable row level security;
alter table public.inventory_events enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.store_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'products' and policyname = 'products_select_authenticated'
  ) then
    create policy products_select_authenticated
    on public.products
    for select
    to authenticated
    using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'products' and policyname = 'products_insert_admin'
  ) then
    create policy products_insert_admin
    on public.products
    for insert
    to authenticated
    with check (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'products' and policyname = 'products_update_admin'
  ) then
    create policy products_update_admin
    on public.products
    for update
    to authenticated
    using (public.has_role('admin'::public.app_role, auth.uid()))
    with check (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'products' and policyname = 'products_delete_admin'
  ) then
    create policy products_delete_admin
    on public.products
    for delete
    to authenticated
    using (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_snapshots' and policyname = 'stock_snapshots_select_authenticated'
  ) then
    create policy stock_snapshots_select_authenticated
    on public.stock_snapshots
    for select
    to authenticated
    using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_snapshots' and policyname = 'stock_snapshots_modify_admin'
  ) then
    create policy stock_snapshots_modify_admin
    on public.stock_snapshots
    for all
    to authenticated
    using (public.has_role('admin'::public.app_role, auth.uid()))
    with check (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_events' and policyname = 'inventory_events_select_authenticated'
  ) then
    create policy inventory_events_select_authenticated
    on public.inventory_events
    for select
    to authenticated
    using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_events' and policyname = 'inventory_events_insert_authenticated'
  ) then
    create policy inventory_events_insert_authenticated
    on public.inventory_events
    for insert
    to authenticated
    with check (
      auth.uid() = user_id
      or public.has_role('admin'::public.app_role, auth.uid())
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_events' and policyname = 'inventory_events_modify_admin'
  ) then
    create policy inventory_events_modify_admin
    on public.inventory_events
    for update
    to authenticated
    using (public.has_role('admin'::public.app_role, auth.uid()))
    with check (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_events' and policyname = 'inventory_events_delete_admin'
  ) then
    create policy inventory_events_delete_admin
    on public.inventory_events
    for delete
    to authenticated
    using (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own_or_admin'
  ) then
    create policy profiles_select_own_or_admin
    on public.profiles
    for select
    to authenticated
    using (
      user_id = auth.uid()
      or public.has_role('admin'::public.app_role, auth.uid())
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_insert_own_or_admin'
  ) then
    create policy profiles_insert_own_or_admin
    on public.profiles
    for insert
    to authenticated
    with check (
      user_id = auth.uid()
      or public.has_role('admin'::public.app_role, auth.uid())
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own_or_admin'
  ) then
    create policy profiles_update_own_or_admin
    on public.profiles
    for update
    to authenticated
    using (
      user_id = auth.uid()
      or public.has_role('admin'::public.app_role, auth.uid())
    )
    with check (
      user_id = auth.uid()
      or public.has_role('admin'::public.app_role, auth.uid())
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_select_own_or_admin'
  ) then
    create policy user_roles_select_own_or_admin
    on public.user_roles
    for select
    to authenticated
    using (
      user_id = auth.uid()
      or public.has_role('admin'::public.app_role, auth.uid())
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_modify_admin'
  ) then
    create policy user_roles_modify_admin
    on public.user_roles
    for all
    to authenticated
    using (public.has_role('admin'::public.app_role, auth.uid()))
    with check (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'store_settings' and policyname = 'store_settings_select_authenticated'
  ) then
    create policy store_settings_select_authenticated
    on public.store_settings
    for select
    to authenticated
    using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'store_settings' and policyname = 'store_settings_modify_admin'
  ) then
    create policy store_settings_modify_admin
    on public.store_settings
    for all
    to authenticated
    using (public.has_role('admin'::public.app_role, auth.uid()))
    with check (public.has_role('admin'::public.app_role, auth.uid()));
  end if;
end
$$;

grant execute on function public.has_role(public.app_role, uuid) to authenticated;
grant execute on function public.apply_inventory_event(uuid, public.inventory_event_type, integer, text, text) to authenticated;

commit;
