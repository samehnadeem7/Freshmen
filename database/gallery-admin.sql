-- VNIT gallery storage and admin policies. Apply once to the connected Supabase project.
-- The password itself is handled by Supabase Auth; this schema stores no password.

create table public.gallery_occasions (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(btrim(title)) between 1 and 100),
    event_date text not null check (event_date ~ '^\d{4}-\d{2}(-\d{2})?$'),
    tag text not null default 'Campus Life' check (char_length(btrim(tag)) between 1 and 40),
    created_at timestamptz not null default now(),
    unique (title, event_date)
);

create table public.gallery_photos (
    id uuid primary key default gen_random_uuid(),
    occasion_id uuid not null references public.gallery_occasions(id) on delete cascade,
    storage_path text,
    source_url text,
    alt_text text not null default '',
    label text not null default '',
    caption text not null default '',
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    check ((storage_path is not null)::integer + (source_url is not null)::integer = 1),
    check (storage_path is null or storage_path !~ '(^/|\.\.)')
);

create unique index gallery_photos_occasion_source_unique
    on public.gallery_photos (occasion_id, source_url) where source_url is not null;
create index gallery_photos_occasion_order_idx
    on public.gallery_photos (occasion_id, sort_order, created_at);

alter table public.gallery_occasions enable row level security;
alter table public.gallery_photos enable row level security;

grant select on public.gallery_occasions, public.gallery_photos to anon, authenticated;
grant insert, update, delete on public.gallery_occasions, public.gallery_photos to authenticated;

create policy "Anyone can view gallery occasions"
    on public.gallery_occasions for select to anon, authenticated using (true);
create policy "Gallery admin manages occasions"
    on public.gallery_occasions for all to authenticated
    using ((select auth.jwt() -> 'app_metadata' ->> 'gallery_admin') = 'true')
    with check ((select auth.jwt() -> 'app_metadata' ->> 'gallery_admin') = 'true');

create policy "Anyone can view gallery photos"
    on public.gallery_photos for select to anon, authenticated using (true);
create policy "Gallery admin manages photos"
    on public.gallery_photos for all to authenticated
    using ((select auth.jwt() -> 'app_metadata' ->> 'gallery_admin') = 'true')
    with check ((select auth.jwt() -> 'app_metadata' ->> 'gallery_admin') = 'true');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campus-gallery', 'campus-gallery', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Gallery admin can upload photos"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'campus-gallery'
        and (select auth.jwt() -> 'app_metadata' ->> 'gallery_admin') = 'true'
    );
create policy "Gallery admin can delete photos"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'campus-gallery'
        and (select auth.jwt() -> 'app_metadata' ->> 'gallery_admin') = 'true'
    );

-- Keep the current gallery intact when switching the public page to database-backed content.
insert into public.gallery_occasions (title, event_date, tag) values ('Freshmen Orientation & Welcome Dinner', '2026-08', 'Campus Life') on conflict (title, event_date) do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuDzgOK9J2_TOf-hnJNUgElylk9AlKbG46VpbVHnE7tTPzUpRaBc9F8swiUmbXshi4KoUM1c0sAC8oXyZEZwfy3yp88rYsnLiGO1p-rnxoNgK1oaeoZ-ahphgIsygO06Kc65nl75uyN2UbhiTVpZg5A1w3O8a8DlQtBJOO1b49chCcvwygsiPxqoqY6uRi2HRLQ7XlwCrzlns0tWW_mjOeHqr-1dSSufXmgg2HPx3CXrlR1SDfIWICFlAA', 'Main Auditorium VNIT', 'Main Auditorium', 'Inaugural Session & Director Address', 0 from public.gallery_occasions where title = 'Freshmen Orientation & Welcome Dinner' and event_date = '2026-08' on conflict do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuAYNL6J8Gz5nwvbmzMahOcFU3JDjopeulkyJ5tQjRoSJNG2xbphQTDqmqE5CV_B1UKoxQcHj2n49_TtQ1rcCQzqVkyuKYNjqnisf7nrtsk_2UUSbFVrowkR4yIRd_z3fPwYrdpxGiyDMsib4nxj0d1z0ga-in63wJtjkgR-95ZZkfnOuFQFVUjmTThxBpzLIjVZH_ztLue1SbK9vjtbPxkwypXfu3y4YvHYOXrATa4TW7ofh44_dL23cQ', 'Campus Walk', 'Campus Walk', 'Department Tour & Peer Intro', 1 from public.gallery_occasions where title = 'Freshmen Orientation & Welcome Dinner' and event_date = '2026-08' on conflict do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuClShlwdLYS6MgJ5ikHi39rUZ5v5NIY7LPDWlxpW873VElqJZIMaNfx_0JHUUrMm_sbrpTlbcgH358beX_xHDqiqVvRjS9UfTEKsqIs-OPxEB6x8txOXhwKLGDuCXDouC3WA_1YgLzcR5CtKTDN41-LHXs4MDw0FZZFpmj57NSKPC432Xp6iXsnhLIt5JvQQiIKz3cHGma63qpT_sh0HhCeq1O7mw146H4FU3wuJPB4J2j7Cp9gUU-Vew', 'Hostel Lawn Gathering', 'Hostel Lawn', 'Freshers'' Mixer & Chai Circle', 2 from public.gallery_occasions where title = 'Freshmen Orientation & Welcome Dinner' and event_date = '2026-08' on conflict do nothing;
insert into public.gallery_occasions (title, event_date, tag) values ('Senior Farewell & Batch Memories', '2026-04', 'Campus Life') on conflict (title, event_date) do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuBoWvi_XeiwI1oMMaKJicBsPF9XAdOrtLqzLNGunOfon8J93NfeF0wHpSHPBlyIt9ZOp5d5dVsqg5zWy2a7b2MSh_H-hJXHnrGVP7KUloD9bIwuIaVdGzlirklSK9VuB4WSoQfbk9VqKxfZpHQ5LisPtCacGtY9zY8179gN6U64PpAUhZhcCM8EDgJEoNHo8bmLT1lG0cOB1M4vGB7GQLENYhg6O4-uxmcpcOqDBU0x-tW1WoJtyFW7ig', 'Central Library Lawn', 'Library Grounds', 'Golden Hour Graduating Portrait', 0 from public.gallery_occasions where title = 'Senior Farewell & Batch Memories' and event_date = '2026-04' on conflict do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuCXBg7Wv-n4LfMjSSS6s7TW_-vYbLZCjzYYMiz1n9XFBbOgWIE_FwdFFbfQLlT5zKKcBVvtxf2n_wB2AuP4NM7ERgLkNVBjrlilG0izXUHGSW847YQpA65WjVtlWoF5LZ0EzAw1Yyjm2iTTEeLbewVYqPf5f0WAzgUG0u-MN_b5sfwxNYfN9mUuF1_ASNRoVZdwC7Y7d-fsdLC0sz54MZwdN4j_c2ZdH2xcaqGwH49BoUYHMsz_QfonbA', 'Farewell Stage', 'OAT Stage', 'Annual Senior Send-Off Gala', 1 from public.gallery_occasions where title = 'Senior Farewell & Batch Memories' and event_date = '2026-04' on conflict do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuBk5yX3MWa3j4pJ-1qZfQGEKzhnpWnjVWpP6YuN7aen5Zy5TFlkE_2pY7nk1D2h0buUPSjHIJ3tC7ginCuNSDGvM7pB6YAnExW0WEqiRr9uAvbzGafgN38r_yFqR0ZT4Ffvhl3mIK8lsNZd3SsG-N4AhkdaC8HzexeGQUbIlDl-GUArM4weuTuxoFX21SQgp1r17O7AHd5z-C2rtbpFxFrftKudwYY5DWNyE0xKug9Zl3B_GtIdFOz5Fw', 'Canteen Catch-up', 'VNIT Canteen', 'Final Lunch with the Mentor Squad', 2 from public.gallery_occasions where title = 'Senior Farewell & Batch Memories' and event_date = '2026-04' on conflict do nothing;
insert into public.gallery_occasions (title, event_date, tag) values ('Cultural Fest & Eid Milan', '2025-10', 'Campus Life') on conflict (title, event_date) do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuCqTAIZziXuPIRQfd2n2wZy9ex3el3fKNufgFaS2uV8bWrM_CCJKeZMsxQg6Hbqe0RDXeH6WUV0kyyGUgcvSy5MgCt8JEctbrsEnLxa2M2Gk1lIC5mokkT471At33ojrxBiLMcwPRADmSbd8OnGv8D3EFME49Bnx7NQD0eOMBVfjsb-yK2ENBeQZE55F9Ke7x_lcgUAhImETeAS4TwK5YmO5cSurpUNdxV1E6zjwgq5ASa5ONG0ql1RiQ', 'Eid Milan Gathering', 'Community Hall', 'Campus Community Dinner', 0 from public.gallery_occasions where title = 'Cultural Fest & Eid Milan' and event_date = '2025-10' on conflict do nothing;
insert into public.gallery_photos (occasion_id, source_url, alt_text, label, caption, sort_order) select id, 'https://lh3.googleusercontent.com/aida-public/AB6AXuDhY70JXXMfVaHs5At3Lk32Mv77cewnhaZx6FC8Fs8gv-Ni7OELKiOB6WjGsGLY48-ZJDbFZqr3kGoL0ZGm5w7lS2GeSnO_UdwKTNwHFlfRjv-q6atQihQUbjralmS979GHBgV5_ESe2sBtWVo7ioZbolQ5LEMIwP3tmUX64g6EZaLe38GfFRNtByx-7vilQyBKTfmNmFqhghZA9_IjokkrcdCgbXT9LNlfp5bwo56RDrRbAJFk2eMWhA', 'Cultural Evening', 'Amphitheatre', 'Evening Performance & Poetry Night', 1 from public.gallery_occasions where title = 'Cultural Fest & Eid Milan' and event_date = '2025-10' on conflict do nothing;
