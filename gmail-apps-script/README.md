# Gmail notifications for restaurant requests

The website stores a restaurant suggestion in Supabase. This Apps Script worker claims pending suggestions every five minutes and sends each one through the Gmail account that owns the script.

1. Open [script.google.com](https://script.google.com), create a project, and paste in `Code.gs`.
2. In **Project Settings → Script Properties**, add:
   - `RESTAURANT_REQUEST_EMAIL`: the Gmail address that should receive suggestions.
   - `RESTAURANT_MAIL_ENDPOINT`: `https://bsaxkggwofrzjroqxezp.supabase.co/functions/v1/restaurant-requests`.
   - `RESTAURANT_MAIL_TOKEN`: a long random value. Keep it private.
3. Deploy → **New deployment** → **Web app**. Set **Execute as** to your account and access to **Anyone with the link**. Copy the `/exec` URL into `RESTAURANT_MAIL_ENDPOINT` only if using a separate proxy; the worker calls the Supabase endpoint directly.
4. In the Apps Script editor, run `installRestaurantRequestTrigger` once and approve the Gmail permission. The trigger then runs every five minutes.

The matching `RESTAURANT_MAIL_TOKEN` must also be stored as a Supabase Edge Function secret before the `restaurant-requests` function is deployed. The website never sees this token. `GmailApp.sendEmail` sends from the account that owns the script. Failed claims are leased for ten minutes and become available again, while a successful acknowledgement marks the request sent.
