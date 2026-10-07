// Retired after the gallery-only login was replaced by the site admin panel.
Deno.serve(() => new Response(JSON.stringify({ error: 'This setup route has been retired.' }), {
  status: 410,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
}))
