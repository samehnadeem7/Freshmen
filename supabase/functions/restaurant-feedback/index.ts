// Guest endpoint: gateway verifies the public anon JWT; writes use a server-only key.
// A public key identifies this app, not a person. Guest abuse limits are enforced below.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bucket = 'restaurant-review-photos';

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST to submit a review.' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(url + path, { ...init, headers: { ...headers, ...init.headers } });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw Object.assign(new Error('Database request failed'), { code: data?.code });
    return data;
  };
  const uploaded: string[] = [];
  let saved = false;
  try {
    // Limit actual bytes, including chunked requests, before parsing/decoding pictures.
    if (!req.body) return reply(400, { error: 'Review is missing.' });
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 3_200_000) {
        await reader.cancel();
        return reply(413, { error: 'Photos are too large. Please choose smaller pictures.' });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return reply(400, { error: 'Invalid review format.' }); }
    if (input && ['mine', 'remove'].includes(input.action)) {
      if (!uuid.test(input.guest_token ?? '') || typeof input.restaurant_id !== 'string' ||
          !/^[a-z0-9-]{1,100}$/.test(input.restaurant_id) ||
          (input.action === 'remove' && !uuid.test(input.review_id ?? ''))) {
        return reply(400, { error: 'Invalid review ownership details.' });
      }
      const guestHash = await hash(`guest:${input.guest_token}`);
      const filter = `restaurant_id=eq.${input.restaurant_id}&guest_hash=eq.${guestHash}` +
        (input.action === 'remove' ? `&id=eq.${input.review_id}` : '');
      const own = await api(`/rest/v1/restaurant_reviews?${filter}&select=id,photo_paths`);
      if (input.action === 'mine') return reply(200, { id: own[0]?.id || null });
      // Match the specific review as well as its owner: retries cannot remove a later review.
      if (own.length) {
        if (own[0].photo_paths.length) {
          await api(`/storage/v1/object/${bucket}`, {
            method: 'DELETE', body: JSON.stringify({ prefixes: own[0].photo_paths }),
          });
        }
        await api(`/rest/v1/restaurant_reviews?${filter}`, { method: 'DELETE' });
      }
      return reply(200, { removed: true });
    }
    if (!input || typeof input !== 'object' || !uuid.test(input.guest_token ?? '') ||
        !uuid.test(input.request_id ?? '') || typeof input.restaurant_id !== 'string' ||
        !/^[a-z0-9-]{1,100}$/.test(input.restaurant_id) ||
        !Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5 ||
        typeof input.body !== 'string' || input.body.length > 2000 ||
        typeof input.author_name !== 'string' || input.author_name.length > 60 ||
        !Array.isArray(input.photos) || input.photos.length > 3) {
      return reply(400, { error: 'Choose 1–5 stars, a name under 60 characters, and a review under 2,000 characters.' });
    }
    const guestHash = await hash(`guest:${input.guest_token}`);
    // Hash with a server-side secret; never retain raw IP addresses.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const ipHash = await hash(`${key}:${ip}`);
    const allowed = await api('/rest/v1/rpc/reserve_feedback_attempt', {
      method: 'POST', body: JSON.stringify({ p_guest: guestHash, p_ip: ipHash }),
    });
    if (!allowed) return reply(429, { error: 'Too many attempts. Please try again in an hour.' });
    const restaurant = await api(`/rest/v1/guide_restaurants?id=eq.${input.restaurant_id}&select=id`);
    if (!restaurant.length) return reply(400, { error: 'This restaurant is not in the guide.' });
    const existing = await api(`/rest/v1/restaurant_reviews?restaurant_id=eq.${input.restaurant_id}&guest_hash=eq.${guestHash}&select=id`);
    if (existing.length) {
      if (existing[0].id === input.request_id) return reply(200, { id: existing[0].id });
      return reply(409, { error: 'You have already reviewed this restaurant from this browser.' });
    }
    const pictures: Uint8Array[] = [];
    for (const photo of input.photos) {
      if (typeof photo !== 'string' || photo.length > 1_024_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo)) {
        return reply(400, { error: 'Use JPEG photos smaller than 750 KB after compression.' });
      }
      let picture;
      try { picture = Uint8Array.from(atob(photo), c => c.charCodeAt(0)); }
      catch { return reply(400, { error: 'A photo could not be read. Please choose it again.' }); }
      if (picture.length < 4 || picture.length > 768000 || picture[0] !== 255 || picture[1] !== 216 || picture[2] !== 255) {
        return reply(400, { error: 'A photo is not a valid JPEG.' });
      }
      pictures.push(picture);
    }
    // Unique upload folder per attempt prevents concurrent retries deleting each other's files.
    const folder = crypto.randomUUID();
    for (let i = 0; i < pictures.length; i++) {
      const path = `${input.restaurant_id}/${folder}/${i}.jpg`;
      await api(`/storage/v1/object/${bucket}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000' }, body: pictures[i],
      });
      uploaded.push(path);
    }
    await api('/rest/v1/restaurant_reviews', {
      method: 'POST', body: JSON.stringify({
        id: input.request_id, restaurant_id: input.restaurant_id, guest_hash: guestHash,
        rating: input.rating, body: input.body.trim(), author_name: input.author_name.trim() || 'Guest', photo_paths: uploaded,
      }),
    });
    saved = true;
    return reply(201, { id: input.request_id });
  } catch (error) {
    if (!saved && uploaded.length) {
      try { await api(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: JSON.stringify({ prefixes: uploaded }) }); }
      catch { console.error('Review photo cleanup failed', uploaded); }
    }
    if ((error as { code?: string }).code === '23505') {
      return reply(409, { error: 'This review has already been submitted. Reopen the reviews to see it.' });
    }
    console.error('Feedback request failed');
    return reply(500, { error: 'Your review could not be saved. Please try again.' });
  }
});
