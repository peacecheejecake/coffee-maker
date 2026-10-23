-- A browser keeps its push endpoint (and a phone its device token) across accounts: after site data is
-- cleared the device signs in anonymously as someone new but registers the same endpoint. Saving goes
-- through these functions, which hand the endpoint/token to the caller instead of failing on RLS.

create function public.save_push_subscription(p_group_id text, p_endpoint text, p_p256dh text, p_auth text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_group_id) then raise exception 'not_member'; end if;
  insert into push_subscriptions (endpoint, user_id, group_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_group_id, p_p256dh, p_auth)
    on conflict (endpoint) do update
      set user_id = excluded.user_id, group_id = excluded.group_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create function public.save_native_push_token(p_group_id text, p_token text, p_platform text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_group_id) then raise exception 'not_member'; end if;
  insert into native_push_tokens (token, user_id, group_id, platform)
    values (p_token, auth.uid(), p_group_id, p_platform)
    on conflict (token) do update
      set user_id = excluded.user_id, group_id = excluded.group_id, platform = excluded.platform;
end;
$$;

revoke all on function public.save_push_subscription, public.save_native_push_token from public, anon;
grant execute on function public.save_push_subscription, public.save_native_push_token to authenticated;
