-- M5: redemption undo is checked like retraction (recorder only, 10 server minutes),
-- and evidence photos live in a private bucket readable/writable by group members only.

-- Appends events in order. Each event is accepted or rejected on its own; the result says which.
-- Re-sending an accepted event (same id) returns its original seq: pushes are idempotent.
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
        id := e ->> 'id'; seq := null; server_at := null; error := 'already_voted';
      when others then
        id := e ->> 'id'; seq := null; server_at := null; error := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;


-- ── evidence photos ─────────────────────────────────────────────────────────
-- Object names are "<groupId>/<assetId>.webp"; the folder decides who may touch the file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('evidence', 'evidence', false, 2 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do nothing;

create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.is_member((storage.foldername(name))[1]));

create policy evidence_write on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.is_member((storage.foldername(name))[1]));
