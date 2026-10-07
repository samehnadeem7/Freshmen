-- Remote setup source. Applied through Supabase MCP as restaurant_feedback.
create table public.guide_restaurants (
    id text primary key,
    name text not null
);
alter table public.guide_restaurants enable row level security;
create policy "Restaurant directory is public" on public.guide_restaurants
    for select to anon, authenticated using (true);
grant select on public.guide_restaurants to anon, authenticated;
grant all on public.guide_restaurants to service_role;

create table public.restaurant_reviews (
    id uuid primary key,
    restaurant_id text not null references public.guide_restaurants(id),
    guest_hash text not null check (guest_hash ~ '^[a-f0-9]{64}$'),
    author_name text not null default 'Guest' check (char_length(author_name) between 1 and 60),
    rating smallint not null check (rating between 1 and 5),
    body text not null default '' check (char_length(body) <= 2000),
    photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 3),
    created_at timestamptz not null default now(),
    unique (restaurant_id, guest_hash)
);
create index restaurant_reviews_recent_idx on public.restaurant_reviews (restaurant_id, created_at desc, id desc);
alter table public.restaurant_reviews enable row level security;
create policy "Published restaurant reviews are public" on public.restaurant_reviews
    for select to anon, authenticated using (true);
revoke all on public.restaurant_reviews from anon, authenticated;
grant select (id, restaurant_id, author_name, rating, body, photo_paths, created_at)
    on public.restaurant_reviews to anon, authenticated;
grant all on public.restaurant_reviews to service_role;

create view public.restaurant_rating_summary with (security_invoker = true) as
select r.id as restaurant_id, count(v.id)::integer as review_count,
       round(avg(v.rating), 1) as average_rating
from public.guide_restaurants r
left join public.restaurant_reviews v on v.restaurant_id = r.id
group by r.id;
grant select on public.restaurant_rating_summary to anon, authenticated, service_role;

create schema if not exists guide_private;
revoke all on schema guide_private from public, anon, authenticated;
grant usage on schema guide_private to service_role;
create table guide_private.feedback_limits (
    key text primary key,
    window_start timestamptz not null,
    attempts integer not null
);
alter table guide_private.feedback_limits enable row level security;
grant all on guide_private.feedback_limits to service_role;
create index feedback_limits_window_idx on guide_private.feedback_limits (window_start);

-- Only the server function can reserve upload/submission attempts. Atomic under concurrency.
create function public.reserve_feedback_attempt(p_guest text, p_ip text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
    guest_attempts integer;
    ip_attempts integer;
    hour_start timestamptz := date_trunc('hour', now());
begin
    delete from guide_private.feedback_limits where window_start < hour_start - interval '1 day';
    insert into guide_private.feedback_limits as limits (key, window_start, attempts)
    values ('guest:' || p_guest, hour_start, 1)
    on conflict (key) do update set
        attempts = case when limits.window_start = hour_start then limits.attempts + 1 else 1 end,
        window_start = hour_start
    returning attempts into guest_attempts;
    insert into guide_private.feedback_limits as limits (key, window_start, attempts)
    values ('ip:' || p_ip, hour_start, 1)
    on conflict (key) do update set
        attempts = case when limits.window_start = hour_start then limits.attempts + 1 else 1 end,
        window_start = hour_start
    returning attempts into ip_attempts;
    return guest_attempts <= 10 and ip_attempts <= 60;
end;
$$;
revoke all on function public.reserve_feedback_attempt(text, text) from public, anon, authenticated;
grant execute on function public.reserve_feedback_attempt(text, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-review-photos', 'restaurant-review-photos', true, 768000, array['image/jpeg']);
-- No client upload/update/delete policy: all writes go through the validated server function.

insert into public.guide_restaurants (id, name) values
('behrouz-biryani', 'Behrouz Biryani'),
('red-bucket-biryani', 'Red Bucket Biryani'),
('al-bashir-hotel', 'Al Bashir Hotel'),
('hkgn-gulab-baba-biryani', 'HKGN Gulab Baba Biryani'),
('hotel-wakil-biryani-center', 'Hotel Wakil Biryani Center'),
('mullaji-zillah-biryani-centre', 'Mullaji Zillah Biryani Centre'),
('sartaj-hotel', 'Sartaj Hotel'),
('hotel-al-zam-zam', 'Hotel Al Zam Zam'),
('mughal-darbar', 'Mughal Darbar'),
('al-lazeez-shawarma', 'Al Lazeez Shawarma'),
('shawarma-g', 'Shawarma G'),
('two-brothers-shawarma', 'Two Brothers Shawarma'),
('kings-shawarma-cuisine', 'Kings Shawarma & Cuisine'),
('dastarkhwan', 'Dastarkhwan'),
('al-rahman', 'Al Rahman'),
('zauq-restaurant', 'Zauq Restaurant'),
('arabian-taj', 'Arabian Taj'),
('babbu-hotel', 'Babbu Hotel'),
('kareem-s', 'Kareem''s'),
('tkg-the-kebab-guy', 'TKG - The Kebab Guy'),
('cluckers-fried-chicken', 'Cluckers Fried Chicken'),
('subway', 'Subway'),
('uttar-dakshin-by-naivedhyam', 'Uttar Dakshin by Naivedhyam'),
('clap-all-day-diner', 'Clap - All Day Diner'),
('the-b-b-food-truck', 'The B&B Food Truck'),
('checkers', 'Checkers'),
('kathmandu-jhol-momo-asian-street', 'Kathmandu Jhol Momo & Asian Street');
