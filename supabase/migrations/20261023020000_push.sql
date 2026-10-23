-- M6: web push. Devices register subscriptions; every inserted event pings the "notify" Edge Function,
-- which decides who to tell (docs/PLAN.md M6). The hook is a no-op until notify_config is filled in.

create table public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  group_id   text not null references public.groups (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(group_id));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Where to send event notifications. Not readable by clients (RLS on, no policies).
-- Set per environment, e.g.:
--   insert into public.notify_config (id, url, secret) values (1, 'https://<ref>.functions.supabase.co/notify', '<random>');
create table public.notify_config (
  id     int primary key check (id = 1),
  url    text not null,
  secret text not null
);
alter table public.notify_config enable row level security;
revoke all on public.notify_config from anon, authenticated;

create extension if not exists pg_net with schema extensions;

create function public.notify_event() returns trigger
  language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg notify_config%rowtype;
begin
  select * into cfg from notify_config where id = 1;
  if not found then return new; end if;
  perform net.http_post(
    url := cfg.url,
    body := jsonb_build_object('record', jsonb_build_object(
      'group_id', new.group_id, 'actor_id', new.actor_id, 'type', new.type, 'body', new.body)),
    headers := jsonb_build_object('content-type', 'application/json', 'x-notify-secret', cfg.secret)
  );
  return new;
end;
$$;

create trigger events_notify after insert on public.events for each row execute function public.notify_event();
