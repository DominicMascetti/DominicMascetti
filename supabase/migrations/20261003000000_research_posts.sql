-- Research posts for the unlisted /open-research/ page, moderated by Jev the
-- same way comments are. Visitors (anon) can insert title/link/name/body and
-- read approved rows, but can never see or set approved or the jev_* columns.

create table public.research_posts (
  id                bigint generated always as identity primary key,
  title             text        not null check (char_length(title) between 1 and 200),
  link              text        check (link ~* '^https?://[^\s]+$' and char_length(link) <= 500),
  name              text        not null check (char_length(name) between 1 and 60),
  body              text        not null check (char_length(body) between 1 and 20000),
  approved          boolean     not null default false,
  created_at        timestamptz not null default now(),
  client_token      uuid        unique,
  -- Written only by the moderate-comment edge function (service role).
  jev_decision      text check (jev_decision in ('publish', 'review', 'reject', 'error')),
  jev_score         real,  -- Jev's probability for jev_decision
  jev_probabilities jsonb, -- full distribution, for reviewing in the dashboard
  jev_checked_at    timestamptz
);

create index research_posts_approved_created_idx on public.research_posts (created_at desc) where approved;

alter table public.research_posts enable row level security;

-- Supabase grants everything on new public tables to anon/authenticated by
-- default; take it all back and grant only the columns visitors need.
revoke all on table public.research_posts from anon, authenticated;
grant select (id, title, link, name, body, created_at) on table public.research_posts to anon, authenticated;
grant insert (title, link, name, body, client_token) on table public.research_posts to anon, authenticated;

-- The moderate-comment edge function reads and updates with the service role.
grant select, update on table public.research_posts to service_role;

create policy "read approved research posts"
  on public.research_posts for select
  to anon, authenticated
  using (approved);

-- approved can't be supplied (no column grant), so it always takes the
-- default; the check is a second layer in case grants ever change.
create policy "add unapproved research posts"
  on public.research_posts for insert
  to anon, authenticated
  with check (approved = false and jev_decision is null and jev_score is null);

-- Lets a submitter's browser find out what happened to its own posts, so one
-- Jev rejected (or that was deleted) stops showing for its author.
create or replace function public.research_post_status(tokens uuid[])
returns table (token uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select t,
         case
           when r.id is null then 'removed'
           when r.approved then 'approved'
           when r.jev_decision = 'reject' then 'removed'
           else 'pending'
         end
    from unnest(tokens[1:50]) as t
    left join public.research_posts r on r.client_token = t;
$$;

revoke all on function public.research_post_status(uuid[]) from public, anon, authenticated;
grant execute on function public.research_post_status(uuid[]) to anon, authenticated;

-- ── Database webhook: send each new research post to the moderation function ──
-- Same function and Vault secret (comment_webhook_secret) as comments.

create or replace function public.notify_research_moderation()
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
    raise warning 'comment_webhook_secret missing from vault; research post % left for manual review', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := 'https://lkhasrwsvrxahvynpawv.supabase.co/functions/v1/moderate-comment',
    body    := jsonb_build_object(
                 'type', 'INSERT', 'schema', tg_table_schema, 'table', tg_table_name,
                 'record', jsonb_build_object('id', new.id, 'title', new.title,
                                              'link', new.link, 'name', new.name,
                                              'body', new.body)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-webhook-secret', secret),
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;

revoke all on function public.notify_research_moderation() from public, anon, authenticated;

create trigger research_posts_moderate_on_insert
  after insert on public.research_posts
  for each row execute function public.notify_research_moderation();
