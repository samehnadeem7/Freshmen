-- Transaction-only checks. All fixtures and rate-limit counters are rolled back.
begin;
insert into public.guide_restaurants (id, name) values ('feedback-transaction-test', 'Temporary database test');
insert into public.restaurant_reviews (id, restaurant_id, guest_hash, rating)
values (gen_random_uuid(), 'feedback-transaction-test', repeat('a',64), 5),
       (gen_random_uuid(), 'feedback-transaction-test', repeat('b',64), 2);
do $$
declare summary record; allowed boolean;
begin
    select * into summary from public.restaurant_rating_summary where restaurant_id = 'feedback-transaction-test';
    assert summary.review_count = 2 and summary.average_rating = 3.5, 'Incorrect average/count';
    begin
        insert into public.restaurant_reviews (id, restaurant_id, guest_hash, rating)
        values (gen_random_uuid(), 'feedback-transaction-test', repeat('a',64), 4);
        raise exception 'Duplicate guest unexpectedly allowed';
    exception when unique_violation then null;
    end;
    begin
        insert into public.restaurant_reviews (id, restaurant_id, guest_hash, rating)
        values (gen_random_uuid(), 'feedback-transaction-test', repeat('c',64), 6);
        raise exception 'Invalid stars unexpectedly allowed';
    exception when check_violation then null;
    end;
    for i in 1..11 loop
        allowed := public.reserve_feedback_attempt('transaction-test-guest', 'transaction-test-ip');
        assert allowed = (i <= 10), 'Guest rate limit not enforced';
    end loop;
end;
$$;
rollback;
