-- ADR 0002: group modes, owner handover, attendance check-ins and motions.
-- Most rules are re-checked by the ledger projection on every device; the server guards what the projection
-- cannot: the owner's role, voter lists and deadlines against the server clock, and one ballot per voter.

-- The server mirrors just enough of the ledger to judge time-based attendance events by its own clock.
alter table public.groups
  add column mode     text    not null default 'shared' check (mode in ('shared', 'attendance')),
  add column adopted  boolean not null default false,
  add column timezone text    not null default 'Asia/Seoul';

update public.groups g set timezone = r.tz
  from (
    select distinct on (group_id) group_id, body -> 'ruleset' ->> 'timezone' as tz
      from public.events where type = 'RulesetChanged' order by group_id, seq desc
  ) r
  where r.group_id = g.id and exists (select 1 from pg_timezone_names where name = r.tz);

create unique index events_one_motion_vote on public.events ((body ->> 'motionId'), actor_id) where type = 'MotionVoted';

-- One check-in per player and day.
create unique index events_one_check_in on public.events (group_id, actor_id, (body ->> 'workDate')) where type = 'CheckedIn';

create or replace function public.append_events(p_events jsonb)
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
  grp groups%rowtype;
  tz text;
  violated text;
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
      -- Locked: mode and adoption below are read and written per event.
      select * into grp from groups where groups.id = g for update;

      if kind in ('RulesetChanged', 'RulesAdopted', 'ModeChanged', 'OwnerTransferred') and my_role(g) <> 'owner' then
        raise exception 'owner_only';
      end if;

      if kind = 'ModeChanged' then
        if e ->> 'mode' not in ('shared', 'attendance') then raise exception 'invalid_mode'; end if;
        if e ->> 'mode' = grp.mode then raise exception 'no_change'; end if;
        update groups set mode = e ->> 'mode', adopted = false where groups.id = g;
      end if;

      if kind in ('RulesetChanged', 'RulesAdopted') then
        tz := e -> 'ruleset' ->> 'timezone';
        if not exists (select 1 from pg_timezone_names where name = tz) then raise exception 'invalid_timezone'; end if;
        if kind = 'RulesetChanged' and grp.mode = 'attendance' and grp.adopted then raise exception 'wrong_mode'; end if;
        if kind = 'RulesAdopted' and grp.mode <> 'attendance' then raise exception 'wrong_mode'; end if;
        if kind = 'RulesAdopted' and grp.adopted then raise exception 'already_adopted'; end if;
        update groups set timezone = tz, adopted = adopted or kind = 'RulesAdopted' where groups.id = g;
      end if;

      -- Check-ins count for the server's today; missed days only once they are over (group timezone).
      if kind = 'CheckedIn' and (now() at time zone grp.timezone)::date <> (e ->> 'workDate')::date then
        raise exception 'wrong_day';
      end if;
      if kind = 'AttendanceMissed'
         and now() < (((e ->> 'workDate')::date + 1)::timestamp at time zone grp.timezone) then
        raise exception 'day_not_over';
      end if;

      -- The ledger role and the server role move together; only a player with an account can take over.
      if kind = 'OwnerTransferred' then
        if e ->> 'to' = actor then raise exception 'already_owner'; end if;
        if not exists (select 1 from events ev
                         where ev.group_id = g and ev.type = 'PlayerJoined' and ev.body -> 'player' ->> 'id' = e ->> 'to') then
          raise exception 'no_such_player';
        end if;
        update members set role = 'owner' where group_id = g and player_id = e ->> 'to';
        if not found then raise exception 'not_claimed'; end if;
        update members set role = 'member' where group_id = g and user_id = auth.uid();
      end if;

      -- Missed days have one id per (group, player, date) so devices settling the same day cannot double-charge.
      if kind = 'AttendanceMissed'
         and e ->> 'id' is distinct from format('miss:%s:%s:%s', g, e ->> 'playerId', e ->> 'workDate') then
        raise exception 'bad_missed_id';
      end if;

      if kind = 'MotionVoted' then
        select * into target from events ev
          where ev.id = e ->> 'motionId' and ev.group_id = g and ev.type = 'MotionProposed';
        if not found then raise exception 'no_motion'; end if;
        if not (target.body -> 'voters') ? actor then raise exception 'not_a_voter'; end if;
        if now() > (target.body ->> 'expiresAt')::timestamptz then raise exception 'proposal_expired'; end if;
      end if;

      if kind = 'MotionWithdrawn' then
        select * into target from events ev
          where ev.id = e ->> 'motionId' and ev.group_id = g and ev.type = 'MotionProposed';
        if not found or target.actor_id <> actor then raise exception 'not_proposer'; end if;
      end if;

      if kind = 'LateRetracted' then
        select * into target from events ev where ev.id = e ->> 'targetId' and ev.group_id = g;
        if not found or target.actor_id <> actor then raise exception 'not_recorder'; end if;
        if now() - target.server_at > interval '10 minutes' then raise exception 'retract_window_closed'; end if;
      end if;

      if kind = 'RedemptionReverted' then
        select * into target from events ev
          where ev.id = e ->> 'redemptionId' and ev.group_id = g and ev.type = 'CupsRedeemed';
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
        get stacked diagnostics violated = constraint_name;
        -- Two devices settling the same day at once: the loser gets the winner's row, as a re-send would.
        select * into existing from events ev where ev.id = e ->> 'id';
        if found then
          id := existing.id; seq := existing.seq; server_at := existing.server_at; error := null;
        else
          id := e ->> 'id'; seq := null; server_at := null;
          error := case when violated = 'events_one_check_in' then 'already_checked_in' else 'already_voted' end;
        end if;
      when others then
        id := e ->> 'id'; seq := null; server_at := null; error := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;
