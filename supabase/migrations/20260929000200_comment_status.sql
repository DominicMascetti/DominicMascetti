-- Lets a visitor's browser find out what happened to its own comments, so a
-- comment Jev rejected (or that was deleted) stops showing for its author.
-- The browser sends a random client_token with each comment; only someone
-- holding that token can ask about it, and they only learn a status word.

alter table public.comments add column client_token uuid unique;

grant insert (client_token) on table public.comments to anon, authenticated;

create or replace function public.comment_status(tokens uuid[])
returns table (token uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select t,
         case
           when c.id is null then 'removed'
           when c.approved then 'approved'
           when c.jev_decision = 'reject' then 'removed'
           else 'pending'
         end
    from unnest(tokens[1:50]) as t
    left join public.comments c on c.client_token = t;
$$;

revoke all on function public.comment_status(uuid[]) from public, anon, authenticated;
grant execute on function public.comment_status(uuid[]) to anon, authenticated;
