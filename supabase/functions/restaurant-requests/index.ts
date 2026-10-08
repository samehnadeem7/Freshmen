const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    b => b.toString(16).padStart(2, '0')).join('');
}
function validListing(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['zomato.com', 'swiggy.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST to send a restaurant request.' });
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const url = Deno.env.get('SUPABASE_URL')!;
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(url + path, { ...init, headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers,
    } });
    const data = await response.text();
    const parsed = data ? JSON.parse(data) : null;
    if (!response.ok) throw new Error('Database operation failed');
    return parsed;
  };
  try {
    // Bound actual streamed bytes rather than trusting Content-Length.
    if (!req.body) return reply(400, { error: 'Request details are missing.' });
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16000) { await reader.cancel(); return reply(413, { error: 'Request details are too long.' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return reply(400, { error: 'Invalid request format.' }); }
    if (!input || typeof input !== 'object') return reply(400, { error: 'Invalid request.' });

    // Called only by the Gmail worker, with a separate server-side shared secret.
    if (input.action === 'mail_claim' || input.action === 'mail_ack') {
      const expected = Deno.env.get('RESTAURANT_MAIL_TOKEN');
      const supplied = req.headers.get('x-restaurant-mail-token');
      if (!expected || !supplied || await hash(supplied) !== await hash(expected)) {
        return reply(403, { error: 'Mail worker authorization required.' });
      }
      if (input.action === 'mail_claim') {
        const rows = await api('/rest/v1/rpc/claim_restaurant_request_mail', { method: 'POST', body: '{}' });
        return reply(200, { requests: rows.map((r: Record<string, unknown>) => ({
          id: r.id, restaurant_name: r.restaurant_name, listing_url: r.listing_url,
          location: r.location, restaurant_type: r.restaurant_type, created_at: r.created_at, mail_lease: r.mail_lease,
        })) });
      }
      if (!uuid.test(input.id ?? '') || !uuid.test(input.mail_lease ?? '')) return reply(400, { error: 'Invalid acknowledgement.' });
      const rows = await api(`/rest/v1/restaurant_requests?id=eq.${input.id}&mail_lease=eq.${input.mail_lease}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ notification_status: 'sent', notification_sent_at: new Date().toISOString(), mail_lease: null, mail_lease_until: null }),
      });
      return reply(200, { acknowledged: rows.length === 1 });
    }
    if (!uuid.test(input.request_id ?? '') || !uuid.test(input.guest_token ?? '') ||
        typeof input.restaurant_name !== 'string' || input.restaurant_name.trim().length < 2 || input.restaurant_name.length > 120 ||
        typeof input.location !== 'string' || input.location.trim().length < 2 || input.location.length > 500 ||
        typeof input.restaurant_type !== 'string' || input.restaurant_type.trim().length < 2 || input.restaurant_type.length > 80 ||
        typeof input.listing_url !== 'string' || input.listing_url.length > 1000 || !validListing(input.listing_url.trim())) {
      return reply(400, { error: 'Enter a restaurant name, location and type. If provided, use a full HTTPS Zomato or Swiggy link.' });
    }
    const guestHash = await hash(`guest:${input.guest_token}`);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const allowed = await api('/rest/v1/rpc/reserve_feedback_attempt', {
      method: 'POST', body: JSON.stringify({ p_guest: `request:${guestHash}`, p_ip: `request:${await hash(`${key}:${ip}`)}` }),
    });
    if (!allowed) return reply(429, { error: 'Too many requests. Please try again in an hour.' });
    const existing = await api(`/rest/v1/restaurant_requests?id=eq.${input.request_id}&select=id,guest_hash`);
    if (existing.length) {
      return existing[0].guest_hash === guestHash
        ? reply(200, { id: input.request_id, status: 'received' })
        : reply(409, { error: 'Please reopen the form and try again.' });
    }
    await api('/rest/v1/restaurant_requests?on_conflict=id', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({
        id: input.request_id, guest_hash: guestHash, restaurant_name: input.restaurant_name.trim(),
        listing_url: input.listing_url.trim(), location: input.location.trim(), restaurant_type: input.restaurant_type.trim(),
      }),
    });
    return reply(201, { id: input.request_id, status: 'received' });
  } catch {
    return reply(500, { error: 'Your request could not be processed. Please try again.' });
  }
});
