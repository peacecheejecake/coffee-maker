-- M7: native push. The iOS/Android shell registers an APNs or FCM device token instead of a Web Push
-- subscription; the notify Edge Function sends to both kinds.

create table public.native_push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  group_id   text not null references public.groups (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

alter table public.native_push_tokens enable row level security;
create policy native_push_own on public.native_push_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(group_id));
grant select, insert, update, delete on public.native_push_tokens to authenticated;
