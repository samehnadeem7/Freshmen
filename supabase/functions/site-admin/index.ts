const OWNER_EMAIL = 'fawazgp77@gmail.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return reply(503, { error: 'Admin service is unavailable.' })
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: 'Sign in to continue.' })
  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (!userResponse?.ok) return reply(401, { error: 'Sign in again to continue.' })
  const user = await userResponse.json()
  if (user.app_metadata?.site_admin !== true) return reply(403, { error: 'Admin access is required.' })
  let input: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid request')
    input = parsed
  } catch { return reply(400, { error: 'Invalid request.' }) }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  if (input.action === 'status') {
    return reply(200, { ok: true, can_manage: user.app_metadata?.must_change_password !== true })
  }

  if (input.action === 'change_password') {
    const password = String(input.password || '')
    if (password.length < 10 || password.length > 128) return reply(400, { error: 'Use a password of 10 to 128 characters.' })
    const result = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ password, app_metadata: { ...user.app_metadata, must_change_password: false } }),
    }).catch(() => null)
    if (!result?.ok) return reply(502, { error: 'Could not update the password.' })
    return reply(200, { ok: true })
  }

  if (user.app_metadata?.must_change_password === true) {
    return reply(403, { error: 'Change your temporary password before continuing.' })
  }

  if (input.action === 'add_admin') {
    if (user.email?.toLowerCase() !== OWNER_EMAIL) return reply(403, { error: 'Only the owner can add admins.' })
    const email = String(input.email || '').trim().toLowerCase()
    const password = String(input.password || '')
    if (!EMAIL.test(email) || email.length > 254 || password.length < 10 || password.length > 128) {
      return reply(400, { error: 'Enter a valid email and a temporary password of 10 to 128 characters.' })
    }
    const result = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST', headers,
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { site_admin: true, must_change_password: true } }),
    }).catch(() => null)
    if (!result) return reply(502, { error: 'Could not reach the account service.' })
    if (!result.ok) {
      if (result.status === 422) return reply(409, { error: 'An account already exists with this email.' })
      return reply(502, { error: 'Could not create the admin account.' })
    }
    return reply(201, { ok: true, email })
  }

  if (input.action === 'remove_review') {
    const reviewId = String(input.review_id || '')
    if (!UUID.test(reviewId)) return reply(400, { error: 'Invalid review.' })
    const found = await fetch(`${url}/rest/v1/restaurant_reviews?id=eq.${reviewId}&select=id,photo_paths`, { headers }).catch(() => null)
    if (!found?.ok) return reply(502, { error: 'Could not find the review.' })
    const rows = await found.json()
    if (!rows.length) return reply(404, { error: 'Review not found.' })
    const deleted = await fetch(`${url}/rest/v1/restaurant_reviews?id=eq.${reviewId}`, {
      method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' },
    }).catch(() => null)
    if (!deleted?.ok) return reply(502, { error: 'Could not remove the review.' })
    const removed = await deleted.json()
    if (!removed.length) return reply(404, { error: 'Review was already removed.' })
    const paths = rows[0].photo_paths || []
    if (paths.length) {
      const cleanup = await fetch(`${url}/storage/v1/object/restaurant-review-photos`, {
        method: 'DELETE', headers, body: JSON.stringify({ prefixes: paths }),
      }).catch(() => null)
      if (!cleanup?.ok) console.error('Review removed, but photo cleanup failed:', reviewId)
    }
    return reply(200, { ok: true })
  }

  if (input.action === 'list_restaurant_requests') {
    const result = await fetch(`${url}/rest/v1/restaurant_requests?select=id,restaurant_name,listing_url,location,restaurant_type,created_at,notification_status&order=created_at.desc&limit=100`, { headers }).catch(() => null)
    if (!result?.ok) return reply(502, { error: 'Could not load restaurant suggestions.' })
    return reply(200, { requests: await result.json() })
  }

  return reply(400, { error: 'Unknown admin action.' })
})
