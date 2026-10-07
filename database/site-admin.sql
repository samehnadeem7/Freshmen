-- Expand gallery administration to the whole guide. Passwords stay in Supabase Auth.
drop policy if exists "Gallery admin manages occasions" on public.gallery_occasions;
drop policy if exists "Gallery admin manages photos" on public.gallery_photos;
drop policy if exists "Gallery admin can upload photos" on storage.objects;
drop policy if exists "Gallery admin can delete photos" on storage.objects;

create policy "Site admins manage gallery occasions"
    on public.gallery_occasions for all to authenticated
    using (
        (select auth.jwt() -> 'app_metadata' ->> 'site_admin') = 'true'
        and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false'
    )
    with check (
        (select auth.jwt() -> 'app_metadata' ->> 'site_admin') = 'true'
        and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false'
    );

create policy "Site admins manage gallery photos"
    on public.gallery_photos for all to authenticated
    using (
        (select auth.jwt() -> 'app_metadata' ->> 'site_admin') = 'true'
        and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false'
    )
    with check (
        (select auth.jwt() -> 'app_metadata' ->> 'site_admin') = 'true'
        and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false'
    );

create policy "Site admins upload gallery photos"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'campus-gallery'
        and (select auth.jwt() -> 'app_metadata' ->> 'site_admin') = 'true'
        and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false'
    );

create policy "Site admins delete gallery photos"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'campus-gallery'
        and (select auth.jwt() -> 'app_metadata' ->> 'site_admin') = 'true'
        and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false'
    );
