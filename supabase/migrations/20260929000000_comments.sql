-- Blog comments, readable by visitors only once approved.
-- Visitors (anon) can insert post/name/body and read approved rows, but can
-- never see or set approved or the jev_* moderation columns.

-- The table was first created in the dashboard (with a `slug` column); the
-- create below reproduces that on a fresh database, and the alters bring it
-- up to date either way.
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  slug       text        not null check (char_length(slug) between 1 and 300),
  name       text        not null check (char_length(name) between 1 and 60),
  body       text        not null check (char_length(body) between 1 and 3000),
  approved   boolean     not null default false,
  created_at timestamptz not null default now()
);

alter table public.comments rename column slug to post;
alter table public.comments drop constraint if exists comments_slug_check;
alter index if exists comments_slug_idx rename to comments_post_idx;
alter table public.comments
  add constraint comments_post_check check (post ~ '^/posts/[A-Za-z0-9._-]+\.html$'),
  -- Written only by the moderate-comment edge function (service role).
  add column jev_decision      text check (jev_decision in ('publish', 'review', 'reject', 'error')),
  add column jev_score         real,  -- Jev's probability for jev_decision
  add column jev_probabilities jsonb, -- full distribution, for reviewing in the dashboard
  add column jev_checked_at    timestamptz;

alter table public.comments enable row level security;

-- Supabase grants everything on new public tables to anon/authenticated by
-- default; take it all back and grant only the columns visitors need.
revoke all on table public.comments from anon, authenticated;
grant select (id, post, name, body, created_at) on table public.comments to anon, authenticated;
grant insert (post, name, body) on table public.comments to anon, authenticated;

drop policy if exists "read approved comments" on public.comments;
drop policy if exists "insert unapproved comments" on public.comments;

create policy "read approved comments"
  on public.comments for select
  to anon, authenticated
  using (approved);

-- approved can't be supplied (no column grant), so it always takes the
-- default; the check is a second layer in case grants ever change.
create policy "add unapproved comments"
  on public.comments for insert
  to anon, authenticated
  with check (approved = false and jev_decision is null and jev_score is null);

-- ── Database webhook: send each new comment to the moderation function ──
-- The shared secret lives in Vault (name: comment_webhook_secret), not here.

create extension if not exists pg_net;

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
                                              'name', new.name, 'body', new.body)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-webhook-secret', secret),
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;

revoke all on function public.notify_comment_moderation() from public, anon, authenticated;

create trigger comments_moderate_on_insert
  after insert on public.comments
  for each row execute function public.notify_comment_moderation();
