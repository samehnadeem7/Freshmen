# Restaurant feedback

The static site uses `feedback.js` and `feedback.css`. Existing restaurant names and Maps links stay intact. Each restaurant link has a stable `data-restaurant-id`; repeated appearances (such as Mughal Darbar) use the same ID and share ratings.

## Connected Supabase resources

Project: `bsaxkggwofrzjroqxezp`.

- `guide_restaurants`: the 27 restaurant IDs and display names.
- `restaurant_reviews`: star ratings, names, text, photo paths, timestamps, and private hashed guest identifiers.
- `restaurant_rating_summary`: a security-invoker view that calculates the average from every review, independent of review-list pagination.
- `guide_private.feedback_limits`: server-only, hourly submission attempt counters. Old counters are pruned when another submission is processed.
- `restaurant-review-photos`: public JPEG images, limited to 750 KB per compressed photo. Direct browser uploads are disabled.
- `restaurant-feedback`: the deployed Edge Function; source is in `supabase/functions/restaurant-feedback/index.ts`. Keep JWT verification enabled.

`restaurant-feedback.sql` records the initial setup applied with Supabase MCP migration `restaurant_feedback`; it is not an idempotent reset script. Do not rerun it over the existing database. `restaurants.json` records the seeded IDs. Keep an ID unchanged when editing a restaurant's display name; add new restaurants to the database as well as the HTML.

## Guest behavior and limits

Guests can post 1–5 stars, up to 2,000 characters of optional text, an optional name, and up to three photos. JPEG, PNG, and WebP originals up to 5 MB can be selected or pasted. The browser converts images to JPEG, resizes them to at most 1,280 pixels on the longest side, and strips original camera metadata before upload. Reviews and photos are public immediately.

A random guest token is retained in local storage. A database uniqueness constraint allows one review per restaurant per token. This is lightweight duplicate prevention, not verified identity: another browser or cleared site storage can create a new guest. Server limits also allow at most 10 submission attempts per guest and 60 per IP per hourly window; a shared campus connection may share that limit. Raw IP addresses are not stored. Guest hashes and rate-limit state cannot be read through the public API.

Only the publishable key and public anon JWT belong in the frontend. The latter is used for Edge Function gateway verification. The service-role key stays inside the Edge Function runtime. Guests cannot insert, update, or delete reviews directly. Unsuccessful upload sequences are cleaned up through the Storage API. Guests can remove their own review from the same browser; signed-in site admins can remove any review through the separate `site-admin` Edge Function. No review editing, moderation queue, or CAPTCHA is implemented.

Review lists show ten at a time using a timestamp/ID cursor. Averages refresh after posting, when opening a panel, and when returning to the page. Failed submissions retain form text and prepared photos for retry; the request ID makes a retry after a lost success response idempotent.

## Verification

- `node --check feedback.js`
- `node tests/feedback-api.mjs`: live public read/access-control and invalid-submission checks; creates no reviews or images.
- `tests/feedback-database.sql`: database assertions for averages, constraints, and rate limits, wrapped in a transaction that rolls back all fixtures.
- Browser checks: stars and text, PNG clipboard paste/compression, stored photo rendering, successful posting and average refresh, duplicate rejection, desktop/mobile layout, and keyboard controls.

Security advisors report an informational “RLS enabled, no policy” finding for the private rate-limit table. This is intentional: no guest policies are permitted there; only the backend service role accesses it.

The website remains static. Deploy `index.html`, `feedback.js`, and `feedback.css` together using the existing hosting workflow. The database/function are already deployed; no frontend hosting deployment was performed by this change.

Restaurant suggestions use the additive `restaurant-requests.sql` schema and `supabase/functions/restaurant-requests/index.ts`. Those two remote resources still need to be applied when Supabase deployment access is available. The Gmail worker and setup steps are in `gmail-apps-script/README.md`; it sends each claimed request through the owner's Gmail account and acknowledges it only after Gmail accepts the message.
