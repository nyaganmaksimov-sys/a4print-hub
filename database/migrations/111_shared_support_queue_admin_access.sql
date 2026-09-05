create or replace function public.is_support_operator()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.has_role('ADMIN') or public.has_role('SUPPORT');
$$;
grant execute on function public.is_support_operator() to authenticated;

update public.support_tickets
set assigned_to = null
where assigned_to is not null;

create or replace function public.clear_support_ticket_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.assigned_to := null;
  return new;
end;
$$;

drop trigger if exists trg_clear_support_ticket_assignment on public.support_tickets;
create trigger trg_clear_support_ticket_assignment
before insert or update of assigned_to on public.support_tickets
for each row execute function public.clear_support_ticket_assignment();

create or replace function public.send_support_message(p_ticket_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid;
  v_requester uuid;
  v_id uuid;
  v_kind text;
begin
  select id into v_user
  from public.users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;

  if v_user is null then raise exception 'STAFF_PROFILE_NOT_FOUND'; end if;

  select requester_id into v_requester
  from public.support_tickets
  where id=p_ticket_id;

  if v_requester is null then raise exception 'SUPPORT_TICKET_NOT_FOUND'; end if;
  if v_requester<>v_user and not public.is_support_operator() then
    raise exception 'SUPPORT_TICKET_ACCESS_DENIED';
  end if;
  if nullif(trim(p_body),'') is null then raise exception 'SUPPORT_MESSAGE_EMPTY'; end if;

  v_kind := case when public.is_support_operator() then 'OPERATOR' else 'USER' end;

  insert into public.support_messages(ticket_id,sender_id,sender_kind,body)
  values(p_ticket_id,v_user,v_kind,left(trim(p_body),4000))
  returning id into v_id;

  update public.support_tickets
  set status=case when v_kind='OPERATOR' then 'WAITING' else 'OPEN' end,
      assigned_to=null,
      updated_at=now(),
      closed_at=null
  where id=p_ticket_id;

  return v_id;
end;
$$;
grant execute on function public.send_support_message(uuid,text) to authenticated;

comment on column public.support_tickets.assigned_to is 'Legacy field. Support uses a shared queue; tickets are not bound to one employee.';
