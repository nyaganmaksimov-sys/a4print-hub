-- A4PRINT HUB: Production Farm Phase 57 — saved risk cockpit presets.
-- Restores live DB ↔ repository parity and adds per-user, per-organization saved views.
-- Presets only store presentation/filter state; they never mutate risk/domain objects.

create schema if not exists risk_private;

revoke all on schema risk_private from public,anon;
grant usage on schema risk_private to authenticated;

create table if not exists public.production_farm_risk_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null
    constraint production_farm_risk_presets_name_check
    check (char_length(btrim(name)) between 1 and 60),
  filters jsonb not null default '{}'::jsonb
    constraint production_farm_risk_presets_filters_check
    check (jsonb_typeof(filters)='object'),
  is_default boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.production_farm_risk_presets enable row level security;

revoke all on table public.production_farm_risk_presets from public,anon,authenticated;

create unique index if not exists uq_production_farm_risk_presets_name
  on public.production_farm_risk_presets(
    organization_id,
    user_id,
    lower(btrim(name))
  );

create unique index if not exists uq_production_farm_risk_presets_default
  on public.production_farm_risk_presets(organization_id,user_id)
  where is_default;

create or replace function risk_private.normalize_production_farm_risk_preset_filters(
  p_filters jsonb
)
returns jsonb
language plpgsql
immutable
set search_path=''
as $$
declare
  v jsonb:=coalesce(p_filters,'{}'::jsonb);
  v_q text;
  v_category text;
  v_severity text;
  v_triage text;
  v_overdue boolean:=false;
  v_result jsonb:='{}'::jsonb;
begin
  if jsonb_typeof(v)<>'object' then
    raise exception 'RISK_PRESET_FILTERS_MUST_BE_OBJECT';
  end if;

  if exists(
    select 1
    from jsonb_object_keys(v) k
    where k not in('q','category','severity','triage','overdue')
  ) then
    raise exception 'RISK_PRESET_FILTER_KEY_INVALID';
  end if;

  v_q:=nullif(btrim(coalesce(v->>'q','')),'');
  if v_q is not null and char_length(v_q)>120 then
    raise exception 'RISK_PRESET_SEARCH_TOO_LONG';
  end if;

  v_category:=nullif(upper(btrim(coalesce(v->>'category',''))),'');
  if v_category is not null and v_category not in(
    'PAYMENT_INTEGRITY',
    'PAYMENT_OBLIGATION',
    'CONTRACT_DEADLINE',
    'CONDITION_CLAIM',
    'PARTNER_DISPUTE',
    'EQUIPMENT_INCIDENT'
  ) then
    raise exception 'RISK_CATEGORY_INVALID';
  end if;

  v_severity:=nullif(upper(btrim(coalesce(v->>'severity',''))),'');
  if v_severity is not null and v_severity not in('CRITICAL','HIGH','MEDIUM','LOW') then
    raise exception 'RISK_SEVERITY_INVALID';
  end if;

  v_triage:=nullif(lower(btrim(coalesce(v->>'triage',''))),'');
  if v_triage is not null and v_triage not in('mine','unassigned','ack') then
    raise exception 'RISK_TRIAGE_INVALID';
  end if;

  if v ? 'overdue' then
    if jsonb_typeof(v->'overdue')<>'boolean' then
      raise exception 'RISK_PRESET_OVERDUE_MUST_BE_BOOLEAN';
    end if;
    v_overdue:=(v->>'overdue')::boolean;
  end if;

  if v_q is not null then
    v_result:=v_result||jsonb_build_object('q',v_q);
  end if;
  if v_category is not null then
    v_result:=v_result||jsonb_build_object('category',v_category);
  end if;
  if v_severity is not null then
    v_result:=v_result||jsonb_build_object('severity',v_severity);
  end if;
  if v_triage is not null then
    v_result:=v_result||jsonb_build_object('triage',v_triage);
  end if;
  if v_overdue then
    v_result:=v_result||jsonb_build_object('overdue',true);
  end if;

  return v_result;
end
$$;

revoke all on function risk_private.normalize_production_farm_risk_preset_filters(jsonb)
  from public,anon,authenticated;

create or replace function risk_private.assert_production_farm_risk_preset_context()
returns table(organization_id uuid,user_id uuid)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_org uuid:=public.current_user_organization_id();
  v_user uuid:=public.current_staff_user_id();
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform private.assert_non_partner_staff_context();

  if v_org is null or v_user is null then
    raise exception 'STAFF_CONTEXT_REQUIRED';
  end if;

  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  return query select v_org,v_user;
end
$$;

revoke all on function risk_private.assert_production_farm_risk_preset_context()
  from public,anon,authenticated;

create or replace function risk_private.get_my_production_farm_risk_presets()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_user uuid;
  v_result jsonb;
begin
  select c.organization_id,c.user_id
    into v_org,v_user
  from risk_private.assert_production_farm_risk_preset_context() c;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'name',p.name,
        'filters',p.filters,
        'is_default',p.is_default,
        'created_at',p.created_at,
        'updated_at',p.updated_at
      )
      order by p.is_default desc,lower(p.name),p.created_at,p.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.production_farm_risk_presets p
  where p.organization_id=v_org
    and p.user_id=v_user;

  return v_result;
end
$$;

revoke all on function risk_private.get_my_production_farm_risk_presets()
  from public,anon,authenticated;
grant execute on function risk_private.get_my_production_farm_risk_presets()
  to authenticated;

create or replace function risk_private.save_my_production_farm_risk_preset(
  p_name text,
  p_filters jsonb,
  p_make_default boolean default false,
  p_preset_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_user uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_filters jsonb;
  v_id uuid:=p_preset_id;
  v_count integer;
begin
  select c.organization_id,c.user_id
    into v_org,v_user
  from risk_private.assert_production_farm_risk_preset_context() c;

  if char_length(v_name) not between 1 and 60 then
    raise exception 'RISK_PRESET_NAME_INVALID';
  end if;

  v_filters:=risk_private.normalize_production_farm_risk_preset_filters(p_filters);

  if v_id is null then
    select count(*)
      into v_count
    from public.production_farm_risk_presets p
    where p.organization_id=v_org
      and p.user_id=v_user;

    if v_count>=20 then
      raise exception 'RISK_PRESET_LIMIT_REACHED';
    end if;

    if exists(
      select 1
      from public.production_farm_risk_presets p
      where p.organization_id=v_org
        and p.user_id=v_user
        and lower(btrim(p.name))=lower(v_name)
    ) then
      raise exception 'RISK_PRESET_NAME_EXISTS';
    end if;

    if coalesce(p_make_default,false) then
      update public.production_farm_risk_presets
      set is_default=false,
          updated_at=clock_timestamp()
      where organization_id=v_org
        and user_id=v_user
        and is_default;
    end if;

    insert into public.production_farm_risk_presets(
      organization_id,user_id,name,filters,is_default
    )
    values(
      v_org,v_user,v_name,v_filters,coalesce(p_make_default,false)
    )
    returning id into v_id;
  else
    perform 1
    from public.production_farm_risk_presets p
    where p.id=v_id
      and p.organization_id=v_org
      and p.user_id=v_user
    for update;

    if not found then
      raise exception 'RISK_PRESET_NOT_AVAILABLE';
    end if;

    if exists(
      select 1
      from public.production_farm_risk_presets p
      where p.organization_id=v_org
        and p.user_id=v_user
        and p.id<>v_id
        and lower(btrim(p.name))=lower(v_name)
    ) then
      raise exception 'RISK_PRESET_NAME_EXISTS';
    end if;

    if coalesce(p_make_default,false) then
      update public.production_farm_risk_presets
      set is_default=false,
          updated_at=clock_timestamp()
      where organization_id=v_org
        and user_id=v_user
        and id<>v_id
        and is_default;
    end if;

    update public.production_farm_risk_presets
    set name=v_name,
        filters=v_filters,
        is_default=coalesce(p_make_default,false),
        updated_at=clock_timestamp()
    where id=v_id;
  end if;

  return v_id;
end
$$;

revoke all on function risk_private.save_my_production_farm_risk_preset(text,jsonb,boolean,uuid)
  from public,anon,authenticated;
grant execute on function risk_private.save_my_production_farm_risk_preset(text,jsonb,boolean,uuid)
  to authenticated;

create or replace function risk_private.delete_my_production_farm_risk_preset(
  p_preset_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_user uuid;
  v_deleted uuid;
begin
  select c.organization_id,c.user_id
    into v_org,v_user
  from risk_private.assert_production_farm_risk_preset_context() c;

  delete from public.production_farm_risk_presets p
  where p.id=p_preset_id
    and p.organization_id=v_org
    and p.user_id=v_user
  returning p.id into v_deleted;

  if v_deleted is null then
    raise exception 'RISK_PRESET_NOT_AVAILABLE';
  end if;

  return true;
end
$$;

revoke all on function risk_private.delete_my_production_farm_risk_preset(uuid)
  from public,anon,authenticated;
grant execute on function risk_private.delete_my_production_farm_risk_preset(uuid)
  to authenticated;

create or replace function public.get_my_production_farm_risk_presets()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select risk_private.get_my_production_farm_risk_presets()
$$;

revoke all on function public.get_my_production_farm_risk_presets()
  from public,anon,authenticated;
grant execute on function public.get_my_production_farm_risk_presets()
  to authenticated;

create or replace function public.save_my_production_farm_risk_preset(
  p_name text,
  p_filters jsonb,
  p_make_default boolean default false,
  p_preset_id uuid default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select risk_private.save_my_production_farm_risk_preset(
    p_name,p_filters,p_make_default,p_preset_id
  )
$$;

revoke all on function public.save_my_production_farm_risk_preset(text,jsonb,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.save_my_production_farm_risk_preset(text,jsonb,boolean,uuid)
  to authenticated;

create or replace function public.delete_my_production_farm_risk_preset(
  p_preset_id uuid
)
returns boolean
language sql
security invoker
set search_path=''
as $$
  select risk_private.delete_my_production_farm_risk_preset(p_preset_id)
$$;

revoke all on function public.delete_my_production_farm_risk_preset(uuid)
  from public,anon,authenticated;
grant execute on function public.delete_my_production_farm_risk_preset(uuid)
  to authenticated;

select private.assert_production_farm_security_baseline();
