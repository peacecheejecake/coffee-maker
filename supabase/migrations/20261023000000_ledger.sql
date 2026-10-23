-- Ledger sync schema (DESIGN.md §5.5, PLAN.md M3).
-- Clients never write tables directly: every write goes through SECURITY DEFINER functions that check
-- membership and the time-window rules against the server clock. Reads are plain selects under RLS.

create table public.groups (
  id          text primary key,              -- client-generated ULID (GroupId)
  name        text not null default '',
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now()
);

create table public.members (
  group_id  text not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  -- Ledger player this account acts as. Null right after joining, until the user claims or creates one.
  player_id text,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id),
  unique (group_id, player_id)
);

create table public.events (
  seq        bigint generated always as identity primary key,
  id         text not null unique,           -- ULID; idempotency key
  group_id   text not null references public.groups (id) on delete cascade,
  actor_id   text not null,
  type       text not null,
  body       jsonb not null,                 -- the event as the client created it
  client_at  timestamptz not null,
  server_at  timestamptz not null default now()
);

create index events_group_seq on public.events (group_id, seq);
-- One ballot per voter per proposal.
create unique index events_one_vote on public.events ((body ->> 'proposalId'), actor_id) where type = 'WaiveVoted';

-- ── helpers ────────────────────────────────────────────────────────────────

create function public.is_member(g text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where group_id = g and user_id = auth.uid());
$$;

create function public.my_player(g text) returns text
  language sql stable security definer set search_path = public as $$
  select player_id from members where group_id = g and user_id = auth.uid();
$$;

create function public.my_role(g text) returns text
  language sql stable security definer set search_path = public as $$
  select role from members where group_id = g and user_id = auth.uid();
$$;

-- ── RLS: read-only for members ─────────────────────────────────────────────

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.events enable row level security;

create policy groups_read on public.groups for select to authenticated using (public.is_member(id));
create policy members_read on public.members for select to authenticated using (public.is_member(group_id));
create policy events_read on public.events for select to authenticated using (public.is_member(group_id));

revoke insert, update, delete on public.groups, public.members, public.events from anon, authenticated;
grant select on public.groups, public.members, public.events to authenticated;

-- ── group lifecycle ────────────────────────────────────────────────────────

create function public.create_group(p_group_id text, p_player_id text, p_name text default '')
  returns text language plpgsql security definer set search_path = public as $$
declare
  code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into groups (id, name, created_by) values (p_group_id, coalesce(p_name, ''), auth.uid())
    returning invite_code into code;
  insert into members (group_id, user_id, player_id, role) values (p_group_id, auth.uid(), p_player_id, 'owner');
  return code;
end;
$$;

-- Joins by invite code. Idempotent; returns the group id and the caller's player (null until claimed).
create function public.join_group(p_code text)
  returns table (group_id text, player_id text) language plpgsql security definer set search_path = public as $$
declare
  g text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select id into g from groups where invite_code = upper(trim(p_code));
  if g is null then raise exception 'invalid_invite'; end if;
  insert into members (group_id, user_id, role) values (g, auth.uid(), 'member') on conflict do nothing;
  return query select m.group_id, m.player_id from members m where m.group_id = g and m.user_id = auth.uid();
end;
$$;

-- Binds the caller to a ledger player: an existing unclaimed one, or a new id they are about to add.
create function public.claim_player(p_group_id text, p_player_id text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_group_id) then raise exception 'not_member'; end if;
  if exists (select 1 from members where group_id = p_group_id and player_id = p_player_id and user_id <> auth.uid()) then
    raise exception 'player_taken';
  end if;
  update members set player_id = p_player_id where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- ── writes ─────────────────────────────────────────────────────────────────

-- Appends events in order. Each event is accepted or rejected on its own; the result says which.
-- Re-sending an accepted event (same id) returns its original seq: pushes are idempotent.
create function public.append_events(p_events jsonb)
  returns table (id text, seq bigint, server_at timestamptz, error text)
  language plpgsql security definer set search_path = public as $$
declare
  e jsonb;
  g text;
  actor text;
  kind text;
  existing events%rowtype;
  target events%rowtype;
  inserted events%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  for e in select * from jsonb_array_elements(p_events) loop
    g := e ->> 'groupId';
    actor := e ->> 'actorId';
    kind := e ->> 'type';

    select * into existing from events ev where ev.id = e ->> 'id';
    if found then
      id := existing.id; seq := existing.seq; server_at := existing.server_at; error := null;
      return next;
      continue;
    end if;

    begin
      if my_player(g) is distinct from actor then raise exception 'not_actor'; end if;

      if kind = 'RulesetChanged' and my_role(g) <> 'owner' then
        raise exception 'owner_only';
      end if;

      if kind = 'LateRetracted' then
        select * into target from events ev where ev.id = e ->> 'targetId' and ev.group_id = g;
        if not found or target.actor_id <> actor then raise exception 'not_recorder'; end if;
        if now() - target.server_at > interval '10 minutes' then raise exception 'retract_window_closed'; end if;
      end if;

      if kind = 'WaiveVoted' then
        select * into target from events ev
          where ev.id = e ->> 'proposalId' and ev.group_id = g and ev.type = 'WaiveProposed';
        if not found then raise exception 'no_proposal'; end if;
        if not (target.body -> 'voters') ? actor then raise exception 'not_a_voter'; end if;
        if now() > (target.body ->> 'expiresAt')::timestamptz then raise exception 'proposal_expired'; end if;
      end if;

      insert into events (id, group_id, actor_id, type, body, client_at)
        values (e ->> 'id', g, actor, kind, e, (e ->> 'at')::timestamptz)
        returning * into inserted;
      id := inserted.id; seq := inserted.seq; server_at := inserted.server_at; error := null;
    exception
      when unique_violation then
        id := e ->> 'id'; seq := null; server_at := null; error := 'already_voted';
      when others then
        id := e ->> 'id'; seq := null; server_at := null; error := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_group, public.join_group, public.claim_player, public.append_events from public, anon;
grant execute on function public.create_group, public.join_group, public.claim_player, public.append_events to authenticated;

-- Live updates: Realtime delivers inserts to subscribers that pass the events_read policy.
alter publication supabase_realtime add table public.events;
