
-- ROOM LIBRARY DATABASE
-- Run once in the Supabase SQL Editor for a new project.

create table public.librarians (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.books (
  id bigint generated always as identity primary key,
  title text not null unique,
  author text not null default 'Unknown',
  lendable boolean not null default true,
  never_lend boolean not null default false
);

create table public.checkouts (
  id bigint generated always as identity primary key,
  book_id bigint not null references public.books(id),
  borrower_name text not null
    check (length(trim(borrower_name)) > 0),
  checked_out_at date not null default current_date,
  due_date date generated always as (checked_out_at + 7) stored,
  returned_at date
);

-- A book may have only one active checkout at a time.
create unique index one_active_checkout_per_book
on public.checkouts(book_id)
where returned_at is null;

-- Initial catalog. These inserts won't overwrite existing titles.
insert into public.books (title, author, lendable, never_lend)
values
  ('The Library Lion', 'Unknown', false, false),
  ('The Creeper Diaries', 'Unknown', true, false),
  ('The Book with No Words', 'Unknown', true, false),
  ('100 Amazing Science Fair Projects', 'Unknown', true, false),
  ('Creepy Pair of Underpants', 'Unknown', true, false),
  ('Dragons Love Tacos', 'Unknown', false, true)
on conflict (title) do nothing;

-- Security helper: true only for an authorized librarian.
create function public.is_librarian()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.librarians
    where user_id = (select auth.uid())
  );
$$;

-- Only logged-in users need to call this helper.
revoke all on function public.is_librarian() from public;
grant execute on function public.is_librarian() to authenticated;

-- Enable row-level security.
alter table public.librarians enable row level security;
alter table public.books enable row level security;
alter table public.checkouts enable row level security;

-- Public catalog reading.
create policy "Anyone can browse books"
on public.books for select
to anon, authenticated
using (true);

-- Librarians can manage catalog entries.
create policy "Librarians manage catalog"
on public.books for all
to authenticated
using ((select public.is_librarian()))
with check ((select public.is_librarian()));

-- Only librarians can view or create checkout records.
create policy "Librarians view checkouts"
on public.checkouts for select
to authenticated
using ((select public.is_librarian()));

create policy "Librarians create checkouts"
on public.checkouts for insert
to authenticated
with check ((select public.is_librarian()));

create policy "Librarians return books"
on public.checkouts for update
to authenticated
using ((select public.is_librarian()))
with check ((select public.is_librarian()));

-- A checkout cannot be edited to change its book, borrower,
-- or checkout date after it has been created.
create function public.guard_checkout_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.book_id is distinct from old.book_id
     or new.borrower_name is distinct from old.borrower_name
     or new.checked_out_at is distinct from old.checked_out_at
     or new.due_date is distinct from old.due_date then
    raise exception 'Checkout details cannot be changed.';
  end if;

  if old.returned_at is not null
     or new.returned_at is null then
    raise exception 'Only an active checkout can be returned.';
  end if;

  return new;
end;
$$;

create trigger protect_checkout_details
before update on public.checkouts
for each row execute function public.guard_checkout_update();

-- Database-level protection for books that cannot be lent.
create function public.check_lending_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_book public.books%rowtype;
begin
  select * into selected_book
  from public.books
  where id = new.book_id;

  if not found then
    raise exception 'Book not found.';
  end if;

  if not selected_book.lendable
     or selected_book.never_lend
     or lower(trim(selected_book.title)) = 'dragons love tacos' then
    raise exception 'This book cannot be checked out.';
  end if;

  if new.returned_at is not null then
    raise exception 'A new checkout must start as active.';
  end if;

  return new;
end;
$$;

create trigger enforce_lending_rules
before insert on public.checkouts
for each row execute function public.check_lending_rules();

-- Keep librarian account records private.
revoke all on public.librarians from anon, authenticated;
grant select on public.librarians to authenticated;

-- Give the app only the database permissions it needs.
revoke all on public.checkouts from anon, authenticated;
grant select, insert, update on public.checkouts to authenticated;

grant select on public.books to anon, authenticated;
grant insert, update, delete on public.books to authenticated;

grant usage, select on sequence public.books_id_seq to authenticated;
grant usage, select on sequence public.checkouts_id_seq to authenticated;
