insert into public.roles(name, description)
values ('SUPPORT', 'Служба поддержки: только обращения и сообщения поддержки')
on conflict (name) do update set description=excluded.description;

insert into public.organization_units(organization_id,name,code,is_active)
select o.id,'Служба поддержки','SUPPORT',true
from public.organizations o
where o.code='A4PRINT'
  and not exists (select 1 from public.organization_units u where u.organization_id=o.id and u.code='SUPPORT');

insert into public.staff_positions(organization_unit_id,name,code,is_active,sort_order)
select u.id,'Оператор службы поддержки','SUPPORT_OPERATOR',true,40
from public.organization_units u
join public.organizations o on o.id=u.organization_id and o.code='A4PRINT'
where u.code='SUPPORT'
  and not exists (select 1 from public.staff_positions p where p.organization_unit_id=u.id and p.code='SUPPORT_OPERATOR');

create table if not exists public.support_faq (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Общие вопросы',
  question text not null,
  answer text not null,
  keywords text[] not null default '{}',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  subject text not null default 'Обращение в поддержку',
  status text not null default 'NEW' check (status in ('NEW','OPEN','WAITING','RESOLVED','CLOSED')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  assigned_to uuid references public.users(id) on delete set null,
  source text not null default 'HUB',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid references public.users(id) on delete set null,
  sender_kind text not null default 'USER' check (sender_kind in ('USER','OPERATOR','BOT','SYSTEM')),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists support_tickets_requester_idx on public.support_tickets(requester_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets(status, updated_at desc);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id, created_at);
create index if not exists support_faq_active_idx on public.support_faq(is_active, sort_order);

alter table public.support_faq enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

grant select on public.support_faq to authenticated;
grant select,update on public.support_tickets to authenticated;
grant select on public.support_messages to authenticated;
grant all on public.support_faq, public.support_tickets, public.support_messages to service_role;

create or replace function public.get_my_roles()
returns text[]
language sql stable security definer set search_path=public
as $$
  select coalesce(array_agg(r.name order by r.name), '{}'::text[])
  from public.users u
  join public.user_roles ur on ur.user_id=u.id
  join public.roles r on r.id=ur.role_id
  where u.auth_user_id=auth.uid() and u.is_active=true;
$$;
grant execute on function public.get_my_roles() to authenticated;

create or replace function public.is_support_operator()
returns boolean
language sql stable security definer set search_path=public
as $$ select public.has_role('ADMIN') or public.has_role('SUPPORT'); $$;
grant execute on function public.is_support_operator() to authenticated;

create or replace function public.open_support_ticket(p_subject text default 'Обращение в поддержку')
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_user uuid; v_ticket uuid;
begin
  select id into v_user from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_user is null then raise exception 'STAFF_PROFILE_NOT_FOUND'; end if;
  select id into v_ticket from public.support_tickets where requester_id=v_user and status in ('NEW','OPEN','WAITING') order by created_at desc limit 1;
  if v_ticket is null then
    insert into public.support_tickets(requester_id,subject,status)
    values(v_user,coalesce(nullif(trim(p_subject),''),'Обращение в поддержку'),'NEW') returning id into v_ticket;
  end if;
  return v_ticket;
end;
$$;
grant execute on function public.open_support_ticket(text) to authenticated;

create or replace function public.send_support_message(p_ticket_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_user uuid; v_requester uuid; v_id uuid; v_kind text;
begin
  select id into v_user from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_user is null then raise exception 'STAFF_PROFILE_NOT_FOUND'; end if;
  select requester_id into v_requester from public.support_tickets where id=p_ticket_id;
  if v_requester is null then raise exception 'SUPPORT_TICKET_NOT_FOUND'; end if;
  if v_requester<>v_user and not public.is_support_operator() then raise exception 'SUPPORT_TICKET_ACCESS_DENIED'; end if;
  if nullif(trim(p_body),'') is null then raise exception 'SUPPORT_MESSAGE_EMPTY'; end if;
  v_kind := case when public.is_support_operator() then 'OPERATOR' else 'USER' end;
  insert into public.support_messages(ticket_id,sender_id,sender_kind,body)
  values(p_ticket_id,v_user,v_kind,left(trim(p_body),4000)) returning id into v_id;
  update public.support_tickets set
    status=case when v_kind='OPERATOR' then 'WAITING' else 'OPEN' end,
    assigned_to=case when v_kind='OPERATOR' then coalesce(assigned_to,v_user) else assigned_to end,
    updated_at=now(), closed_at=null
  where id=p_ticket_id;
  return v_id;
end;
$$;
grant execute on function public.send_support_message(uuid,text) to authenticated;

drop policy if exists support_faq_read_staff on public.support_faq;
create policy support_faq_read_staff on public.support_faq for select to authenticated
using (is_active=true and exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active=true));

drop policy if exists support_faq_manage on public.support_faq;
create policy support_faq_manage on public.support_faq for all to authenticated
using (public.is_support_operator()) with check (public.is_support_operator());

drop policy if exists support_tickets_read on public.support_tickets;
create policy support_tickets_read on public.support_tickets for select to authenticated
using (requester_id in (select id from public.users where auth_user_id=auth.uid() and is_active=true) or public.is_support_operator());

drop policy if exists support_tickets_update_operator on public.support_tickets;
create policy support_tickets_update_operator on public.support_tickets for update to authenticated
using (public.is_support_operator()) with check (public.is_support_operator());

drop policy if exists support_messages_read on public.support_messages;
create policy support_messages_read on public.support_messages for select to authenticated
using (exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.requester_id in (select id from public.users where auth_user_id=auth.uid() and is_active=true) or public.is_support_operator())));

revoke insert,update,delete on public.support_messages from authenticated;

insert into public.support_faq(category,question,answer,keywords,sort_order)
select * from (values
('Вход и аккаунт','Не получается войти в систему','Проверьте email и пароль. На телефоне полностью закройте PWA и откройте снова. Если вход через Google вернул на страницу входа, откройте мобильный HUB заново. Если проблема остаётся — нажмите «Позвать оператора».',array['вход','пароль','google','авторизация','не входит'],10),
('Заказы','Как создать новый заказ?','Откройте «Менеджер» или нажмите «+ Новый заказ» на главной. Выберите или создайте клиента, услугу, укажите параметры и проверьте расчёт перед сохранением.',array['заказ','создать','новый заказ','менеджер'],20),
('Заказы','Где посмотреть статус заказа?','Откройте раздел «Заказы», найдите заказ по номеру или клиенту и откройте карточку. В карточке видны текущий статус и история изменений.',array['статус','заказ','история'],30),
('Клиенты','Как добавить клиента?','Откройте «Клиенты» или рабочий стол менеджера. Перед добавлением выполните поиск по телефону или email, чтобы не создавать дубль.',array['клиент','добавить клиента','телефон'],40),
('Файлы','Как прикрепить макет или файл?','Файлы прикрепляйте к конкретному заказу или отправляйте в рабочем чате через кнопку скрепки. Перед отправкой убедитесь, что выбран правильный заказ или чат.',array['файл','макет','прикрепить','загрузить'],50),
('Касса','Как открыть или закрыть смену?','Откройте приложение «Касса», выберите оператора и нажмите «Открыть смену». После завершения рабочего дня используйте «Закрыть смену» и проверьте отчёт за смену.',array['касса','смена','открыть смену','закрыть смену'],60),
('Касса','Касса пишет «Нет связи»','Откройте новую кассу по адресу /pos/, обновите страницу и проверьте раздел синхронизации. Если связь с МойСклад не восстановилась, вызовите оператора поддержки.',array['нет связи','мойсклад','касса','синхронизация'],70),
('Склад','Где посмотреть остатки?','Откройте «Склад и номенклатура». Там доступны позиции, остатки и синхронизация с МойСклад. Не корректируйте остаток вручную без основания.',array['склад','остатки','товар','мойсклад'],80),
('Уведомления','Как включить уведомления?','В мобильном HUB нажмите «Включить Push» в верхнем уведомлении либо откройте профиль/настройки уведомлений. Разрешите уведомления в браузере или установленной PWA.',array['уведомления','push','сообщения'],90),
('Приложения','Как установить HUB или кассу на ПК?','На главной панели откройте «Приложения». Там доступны HUB, касса, чат, Partner CRM и мобильная версия. Для PWA используйте кнопку установки браузера.',array['установить','приложение','пк','касса','pwa'],100),
('Telegram','Как подключить Telegram?','Откройте «Настройки → Telegram», вставьте токен бота от BotFather, сохраните и нажмите «Проверить связь». После подключения входящие появятся в разделе Telegram.',array['telegram','бот','botfather','токен'],110),
('Партнёры','Как работать с партнёрами?','Раздел «Партнёры» используется для исполнителей и подрядчиков. Партнёр может получать заказы через Partner CRM, а менеджер видит их в общей системе.',array['партнер','partner crm','подрядчик'],120),
('Сотрудники','Как выдать сотруднику доступ?','Администратор открывает «Сотрудники», добавляет сотрудника или создаёт приглашение, затем назначает отдел, должность и только необходимые роли.',array['сотрудник','роль','доступ','права'],130),
('Отчёты','Где посмотреть статистику и выручку?','Основная сводка находится на главной панели и в разделе «Отчёты». Для кассы отдельная статистика доступна в POS в разделе «Отчёты и статистика».',array['отчеты','статистика','выручка','касса'],140),
('Ошибки','Что делать, если страница работает неправильно?','На ПК выполните Ctrl+F5. В установленной мобильной PWA полностью закройте приложение и откройте снова. Сохраните текст ошибки и страницу, где она появилась, затем вызовите поддержку.',array['ошибка','не работает','ctrl f5','обновить'],150)
) as v(category,question,answer,keywords,sort_order)
where not exists (select 1 from public.support_faq);

create or replace function public.notify_support_activity()
returns trigger
language plpgsql security definer set search_path=public
as $$
declare v_ticket public.support_tickets%rowtype; v_sender_support boolean;
begin
  select * into v_ticket from public.support_tickets where id=new.ticket_id;
  v_sender_support := new.sender_kind in ('OPERATOR','BOT','SYSTEM');
  if v_sender_support then
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select v_ticket.requester_id,'Ответ службы поддержки',left(new.body,220),'SUPPORT_MESSAGE','support_ticket',v_ticket.id
    where new.sender_id is distinct from v_ticket.requester_id;
  else
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct u.id,'Новое обращение в поддержку',left(new.body,220),'SUPPORT_MESSAGE','support_ticket',v_ticket.id
    from public.users u join public.user_roles ur on ur.user_id=u.id join public.roles r on r.id=ur.role_id
    where u.is_active=true and r.name in ('SUPPORT','ADMIN') and u.id is distinct from new.sender_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_support_activity on public.support_messages;
create trigger trg_notify_support_activity after insert on public.support_messages
for each row execute function public.notify_support_activity();
