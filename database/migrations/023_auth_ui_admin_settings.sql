insert into public.settings(key,value,updated_at)
values (
  'auth_ui',
  '{"login":{"email":true,"google":true,"yandex":false,"mailru":false},"registration":{"email":true,"google":true,"yandex":false,"mailru":false}}'::jsonb,
  now()
)
on conflict (key) do nothing;

create or replace function public.get_public_auth_ui()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'login', jsonb_build_object(
      'email', coalesce((value->'login'->>'email')::boolean, true),
      'google', coalesce((value->'login'->>'google')::boolean, true),
      'yandex', coalesce((value->'login'->>'yandex')::boolean, false),
      'mailru', coalesce((value->'login'->>'mailru')::boolean, false)
    ),
    'registration', jsonb_build_object(
      'email', coalesce((value->'registration'->>'email')::boolean, true),
      'google', coalesce((value->'registration'->>'google')::boolean, true),
      'yandex', coalesce((value->'registration'->>'yandex')::boolean, false),
      'mailru', coalesce((value->'registration'->>'mailru')::boolean, false)
    )
  )
  from public.settings
  where key='auth_ui'
  union all
  select '{"login":{"email":true,"google":true,"yandex":false,"mailru":false},"registration":{"email":true,"google":true,"yandex":false,"mailru":false}}'::jsonb
  where not exists (select 1 from public.settings where key='auth_ui')
  limit 1;
$$;

revoke all on function public.get_public_auth_ui() from public;
grant execute on function public.get_public_auth_ui() to anon, authenticated;
