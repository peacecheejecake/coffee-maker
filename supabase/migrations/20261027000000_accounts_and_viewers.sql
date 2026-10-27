-- Accounts and viewers.
-- * Anyone holding an invite link may watch the group read-only (a "viewer"), even before signing in:
--   the client opens the link with an anonymous session and view_group records it as a viewer.
-- * Participating (claiming a player) is for signed-in accounts; one account can belong to many groups,
--   listed by my_groups.
-- * A player held by an anonymous account can be taken over by a signed-in one: anonymous accounts vanish
--   with the browser's data, and this is how their owner gets the name back.

create table public.viewers (
  group_id  text not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.viewers enable row level security;
create policy viewers_read on public.viewers for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.viewers from anon, authenticated;
grant select on public.viewers to authenticated;

-- Members and viewers may read a group; only members may write (append_events checks my_player).
create function public.can_read(g text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where group_id = g and user_id = auth.uid())
      or exists (select 1 from viewers where group_id = g and user_id = auth.uid());
$$;

create function public.is_anonymous_caller() returns boolean
  language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

drop policy groups_read on public.groups;
drop policy members_read on public.members;
drop policy events_read on public.events;
create policy groups_read on public.groups for select to authenticated using (public.can_read(id));
create policy members_read on public.members for select to authenticated using (public.can_read(group_id));
-- Realtime applies this policy too, so viewers get live inserts.
create policy events_read on public.events for select to authenticated using (public.can_read(group_id));

drop policy evidence_read on storage.objects;
create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.can_read((storage.foldername(name))[1]));

-- Opens an invite link. Members get their membership back (player_id null until claimed); everyone else
-- becomes a viewer. Never makes the caller a member: that is join_group, once they choose to take part.
create function public.view_group(p_code text)
  returns table (group_id text, member boolean, player_id text)
  language plpgsql security definer set search_path = public as $$
declare
  g text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select id into g from groups where invite_code = upper(trim(p_code));
  if g is null then raise exception 'invalid_invite'; end if;
  if exists (select 1 from members m where m.group_id = g and m.user_id = auth.uid()) then
    return query select m.group_id, true, m.player_id from members m where m.group_id = g and m.user_id = auth.uid();
    return;
  end if;
  insert into viewers (group_id, user_id) values (g, auth.uid())
    on conflict on constraint viewers_pkey do update set viewed_at = now();
  return query select g, false, null::text;
end;
$$;

-- Claimed players and whether the holding account is anonymous (and so can be taken over).
create function public.player_claims(p_group_id text)
  returns table (player_id text, anonymous boolean)
  language sql stable security definer set search_path = public, auth as $$
  select m.player_id, coalesce(u.is_anonymous, false)
  from public.members m join auth.users u on u.id = m.user_id
  where m.group_id = p_group_id and m.player_id is not null and public.can_read(p_group_id);
$$;

-- Binds the caller to a ledger player: an unclaimed one, a new id they are about to add, or one held by an
-- anonymous account when the caller is signed in (the previous holder keeps membership without a player).
create or replace function public.claim_player(p_group_id text, p_player_id text)
  returns void language plpgsql security definer set search_path = public as $$
declare
  holder uuid;
  holder_anonymous boolean;
begin
  if not is_member(p_group_id) then raise exception 'not_member'; end if;
  select m.user_id, coalesce(u.is_anonymous, false) into holder, holder_anonymous
    from members m join auth.users u on u.id = m.user_id
    where m.group_id = p_group_id and m.player_id = p_player_id and m.user_id <> auth.uid();
  if holder is not null then
    if is_anonymous_caller() or not holder_anonymous then raise exception 'player_taken'; end if;
    update members set player_id = null where group_id = p_group_id and user_id = holder;
  end if;
  update members set player_id = p_player_id where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- The caller's groups, newest first, with the name of the player they act as (from the ledger).
create function public.my_groups()
  returns table (group_id text, name text, invite_code text, role text, player_id text, player_name text, members bigint, joined_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.invite_code, m.role, m.player_id,
    (select coalesce(ev.body -> 'patch' ->> 'name', ev.body -> 'player' ->> 'name')
       from events ev
       where ev.group_id = g.id
         and ((ev.type = 'PlayerJoined' and ev.body -> 'player' ->> 'id' = m.player_id)
           or (ev.type = 'PlayerUpdated' and ev.body ->> 'playerId' = m.player_id and ev.body -> 'patch' ? 'name'))
       order by ev.seq desc limit 1),
    (select count(*) from members x where x.group_id = g.id),
    m.joined_at
  from members m join groups g on g.id = m.group_id
  where m.user_id = auth.uid()
  order by m.joined_at desc;
$$;

revoke all on function public.view_group, public.player_claims, public.my_groups from public, anon;
grant execute on function public.view_group, public.player_claims, public.my_groups to authenticated;
