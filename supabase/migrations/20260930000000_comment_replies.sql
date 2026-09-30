-- One level of replies. A reply points at a top-level approved comment on the
-- same post; replying to a reply attaches to that reply's thread instead.

alter table public.comments
  add column parent_id bigint references public.comments(id) on delete cascade;

create index comments_parent_idx on public.comments (parent_id);

grant select (parent_id) on table public.comments to anon, authenticated;
grant insert (parent_id) on table public.comments to anon, authenticated;

create or replace function public.check_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.comments;
begin
  if new.parent_id is null then
    return new;
  end if;

  select * into parent from public.comments where id = new.parent_id;
  if parent.id is null or not parent.approved or parent.post <> new.post then
    raise exception 'cannot reply to comment %', new.parent_id using errcode = '23503';
  end if;

  new.parent_id := coalesce(parent.parent_id, parent.id);
  return new;
end;
$$;

revoke all on function public.check_comment_parent() from public, anon, authenticated;

create trigger comments_check_parent
  before insert on public.comments
  for each row execute function public.check_comment_parent();

-- Same webhook as before, now also sending parent_id so Jev can see what a
-- reply is replying to.
create or replace function public.notify_comment_moderation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets
   where name = 'comment_webhook_secret';

  if secret is null then
    raise warning 'comment_webhook_secret missing from vault; comment % left for manual review', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := 'https://lkhasrwsvrxahvynpawv.supabase.co/functions/v1/moderate-comment',
    body    := jsonb_build_object(
                 'type', 'INSERT', 'schema', tg_table_schema, 'table', tg_table_name,
                 'record', jsonb_build_object('id', new.id, 'post', new.post,
                                              'name', new.name, 'body', new.body,
                                              'parent_id', new.parent_id)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-webhook-secret', secret),
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;
