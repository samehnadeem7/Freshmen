// Public API integration checks. No persistent test reviews or uploads are created.
// Run: node tests/feedback-api.mjs (requires network access).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../feedback.js', import.meta.url), 'utf8');
const api = source.match(/const API = '([^']+)'/)[1];
const key = source.match(/const PUBLIC_KEY = '([^']+)'/)[1];
const jwt = source.match(/const ANON_JWT = '([^']+)'/)[1];
const headers = { apikey: key, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
const request = async (path, options = {}) => {
    const response = await fetch(api + path, { ...options, headers: { ...headers, ...options.headers } });
    return { status: response.status, data: await response.json() };
};
const summaries = await request('/rest/v1/restaurant_rating_summary?select=restaurant_id,review_count,average_rating');
assert.equal(summaries.status, 200);
assert.equal(summaries.data.length, 27);
assert.ok(summaries.data.every(row => row.review_count >= 0 && (row.average_rating === null || row.average_rating >= 1 && row.average_rating <= 5)));
console.log('PASS: all 27 restaurant summaries are publicly readable.');

const privateColumn = await request('/rest/v1/restaurant_reviews?select=guest_hash');
assert.ok([401, 403].includes(privateColumn.status));
const directWrite = await request('/rest/v1/restaurant_reviews', { method: 'POST', body: '{}' });
assert.ok([401, 403].includes(directWrite.status));
const rateRPC = await request('/rest/v1/rpc/reserve_feedback_attempt', {
    method: 'POST', body: JSON.stringify({ p_guest: 'test', p_ip: 'test' }),
});
assert.ok([401, 403].includes(rateRPC.status));
console.log('PASS: private identifiers, direct writes, and rate-limit RPC are blocked for guests.');

const base = {
    request_id: crypto.randomUUID(), guest_token: crypto.randomUUID(), restaurant_id: 'behrouz-biryani',
    rating: 4, author_name: 'Temporary validation test', body: '', photos: [],
};
for (const change of [{ rating: 0 }, { rating: 6 }, { rating: 3.5 }, { body: 'x'.repeat(2001) }, { author_name: 'x'.repeat(61) }, { photos: ['', '', '', ''] }]) {
    const result = await request('/functions/v1/restaurant-feedback', { method: 'POST', body: JSON.stringify({ ...base, ...change }) });
    assert.equal(result.status, 400, JSON.stringify(result));
}
const badPhoto = await request('/functions/v1/restaurant-feedback', {
    method: 'POST', body: JSON.stringify({ ...base, photos: ['bm90LWEtcGhvdG8='] }),
});
assert.equal(badPhoto.status, 400);
const unknown = await request('/functions/v1/restaurant-feedback', {
    method: 'POST', body: JSON.stringify({ ...base, restaurant_id: 'nonexistent-restaurant' }),
});
assert.equal(unknown.status, 400);
console.log('PASS: invalid stars, excessive text/photos, invalid image bytes, and unknown restaurants are rejected.');

const preflight = await fetch(api + '/functions/v1/restaurant-feedback', {
    method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'POST' },
});
assert.equal(preflight.status, 200);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
console.log('PASS: browser CORS preflight.');

const adminStatus = await request('/functions/v1/site-admin', {
    method: 'POST', body: JSON.stringify({ action: 'status' }),
});
assert.ok([401, 403].includes(adminStatus.status), JSON.stringify(adminStatus));
const guestGalleryWrite = await request('/rest/v1/gallery_occasions', {
    method: 'POST', body: JSON.stringify({ title: 'Unapproved test', event_date: '2026-10', tag: 'Test' }),
});
assert.ok([401, 403].includes(guestGalleryWrite.status), JSON.stringify(guestGalleryWrite));
console.log('PASS: admin function and gallery writes reject guest access.');
