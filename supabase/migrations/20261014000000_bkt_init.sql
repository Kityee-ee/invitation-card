-- BKT Friyay night: database setup.
-- Apply with `supabase db push`, or paste into Dashboard → SQL Editor and run once.
--
-- Guests can read the guest list and potluck board, but can only change
-- them through the functions below. Each browser holds a random token that
-- proves which RSVP / potluck claims are its own; tokens live in private
-- tables that the public API cannot read.

create extension if not exists pgcrypto;

-- Tables ---------------------------------------------------------------

create table public.rsvps (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  status     text not null check (status in ('yes', 'maybe', 'no')),
  plus_ones  int  not null default 0 check (plus_ones between 0 and 5),
  created_at timestamptz not null default now()
);

create table public.rsvp_owners (
  rsvp_id uuid primary key references public.rsvps (id) on delete cascade,
  token   text not null unique
);

create table public.potluck_items (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (category in ('drinks', 'fruits', 'dessert')),
  label      text not null check (char_length(label) between 1 and 60),
  note       text check (char_length(note) <= 60),
  claimed_by text check (char_length(claimed_by) <= 40),
  is_seed    boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.potluck_owners (
  item_id uuid primary key references public.potluck_items (id) on delete cascade,
  token   text not null
);

-- Access ---------------------------------------------------------------

alter table public.rsvps          enable row level security;
alter table public.rsvp_owners    enable row level security;
alter table public.potluck_items  enable row level security;
alter table public.potluck_owners enable row level security;

create policy "anyone can read" on public.rsvps         for select using (true);
create policy "anyone can read" on public.potluck_items for select using (true);

revoke all on public.rsvp_owners, public.potluck_owners from anon, authenticated;
revoke insert, update, delete on public.rsvps, public.potluck_items from anon, authenticated;

-- Functions (the only way to write) --------------------------------------

create or replace function public.check_token(p_token text) returns void
language plpgsql immutable as $$
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 64 then
    raise exception 'bad_token';
  end if;
end $$;

create or replace function public.save_rsvp(p_token text, p_name text, p_status text, p_plus_ones int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_name text := btrim(p_name);
begin
  perform check_token(p_token);
  select rsvp_id into v_id from rsvp_owners where token = p_token;
  if v_id is null then
    if (select count(*) from rsvps) >= 60 then raise exception 'guest_list_full'; end if;
    insert into rsvps (name, status, plus_ones) values (v_name, p_status, p_plus_ones)
      returning id into v_id;
    insert into rsvp_owners (rsvp_id, token) values (v_id, p_token);
  else
    update rsvps set name = v_name, status = p_status, plus_ones = p_plus_ones where id = v_id;
  end if;
  -- Keep the name on this guest's potluck claims in sync.
  update potluck_items i set claimed_by = v_name
    from potluck_owners o where o.item_id = i.id and o.token = p_token;
  return v_id;
end $$;

create or replace function public.claim_item(p_token text, p_name text, p_item_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform check_token(p_token);
  update potluck_items
     set claimed_by = btrim(p_name), note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_item_id and claimed_by is null;
  if not found then raise exception 'already_claimed'; end if;
  insert into potluck_owners (item_id, token) values (p_item_id, p_token)
    on conflict (item_id) do update set token = excluded.token;
end $$;

create or replace function public.add_item(p_token text, p_name text, p_category text, p_label text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform check_token(p_token);
  if (select count(*) from potluck_owners where token = p_token) >= 8 then
    raise exception 'too_many_items';
  end if;
  if (select count(*) from potluck_items) >= 80 then raise exception 'board_full'; end if;
  insert into potluck_items (category, label, claimed_by)
    values (p_category, btrim(p_label), btrim(p_name))
    returning id into v_id;
  insert into potluck_owners (item_id, token) values (v_id, p_token);
  return v_id;
end $$;

create or replace function public.unclaim_item(p_token text, p_item_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform check_token(p_token);
  delete from potluck_owners where item_id = p_item_id and token = p_token;
  if not found then raise exception 'not_yours'; end if;
  -- Host's slots reopen; items a guest added disappear.
  delete from potluck_items where id = p_item_id and not is_seed;
  update potluck_items set claimed_by = null, note = null where id = p_item_id;
end $$;

create or replace function public.whoami(p_token text)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'rsvp_id',  (select rsvp_id from rsvp_owners where token = p_token),
    'item_ids', coalesce((select json_agg(item_id) from potluck_owners where token = p_token), '[]'::json)
  );
$$;

revoke execute on all functions in schema public from public;
grant execute on function
  public.save_rsvp(text, text, text, int),
  public.claim_item(text, text, uuid, text),
  public.add_item(text, text, text, text),
  public.unclaim_item(text, uuid),
  public.whoami(text)
to anon, authenticated;

-- Live updates -----------------------------------------------------------

alter publication supabase_realtime add table public.rsvps, public.potluck_items;

-- The host's potluck slots -------------------------------------------------

insert into public.potluck_items (category, label, is_seed, created_at)
select category, label, true, now() + make_interval(secs => ord)
from (values
  (1, 'drinks',  'Soft drinks or juice'),
  (2, 'drinks',  'Beer, wine or something fun'),
  (3, 'fruits',  'A fruit platter'),
  (4, 'fruits',  'Any fruit in season'),
  (5, 'dessert', 'Something sweet'),
  (6, 'dessert', 'Kuih, cake or ice cream')
) as seed (ord, category, label);
