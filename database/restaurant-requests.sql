-- Additive schema for private restaurant suggestions and a reliable email outbox.
create table public.restaurant_requests (
    id uuid primary key,
    guest_hash text not null check (guest_hash ~ '^[a-f0-9]{64}$'),
    restaurant_name text not null check (char_length(btrim(restaurant_name)) between 2 and 120),
    listing_url text not null default '' check (char_length(listing_url) <= 1000),
    location text not null check (char_length(btrim(location)) between 2 and 500),
    restaurant_type text not null check (char_length(btrim(restaurant_type)) between 2 and 80),
    created_at timestamptz not null default now(),
    notification_status text not null default 'pending' check (notification_status in ('pending', 'sending', 'sent')),
    mail_lease uuid,
    mail_lease_until timestamptz,
    notification_sent_at timestamptz
);
alter table public.restaurant_requests enable row level security;
revoke all on public.restaurant_requests from public, anon, authenticated;
grant all on public.restaurant_requests to service_role;

-- Site admins can read suggestions from the admin portal; guests remain unable to read them.
grant select on public.restaurant_requests to authenticated;
drop policy if exists "Site admins view restaurant suggestions" on public.restaurant_requests;
create policy "Site admins view restaurant suggestions"
    on public.restaurant_requests for select to authenticated
    using (
        (select auth.jwt() -> 'app_metadata' ->> 'site_admin') = 'true'
        and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false'
    );

create index restaurant_requests_outbox_idx on public.restaurant_requests (created_at)
    where notification_status <> 'sent';

create function public.claim_restaurant_request_mail()
returns setof public.restaurant_requests
language sql security invoker set search_path = '' as $$
    update public.restaurant_requests r
    set notification_status = 'sending', mail_lease = gen_random_uuid(),
        mail_lease_until = now() + interval '10 minutes'
    where r.id in (
        select id from public.restaurant_requests
        where notification_status = 'pending'
           or (notification_status = 'sending' and mail_lease_until < now())
        order by created_at limit 10 for update skip locked
    )
    returning r.*;
$$;
revoke all on function public.claim_restaurant_request_mail() from public, anon, authenticated;
grant execute on function public.claim_restaurant_request_mail() to service_role;
