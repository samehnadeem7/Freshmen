# Site administration

The footer **Admin login** controls gallery content, admin accounts, and restaurant review removal. The owner account is `fawazgp77@gmail.com`. Passwords are stored as hashes by Supabase Auth, never in static files or gallery tables. The former gallery invitation route has been retired.

## Accounts

- The owner can add another admin with an email and temporary password (10–128 characters). Only the owner sees this form, and the `site-admin` Edge Function checks the owner's authenticated identity again on the server.
- A new admin must change the temporary password at first sign-in. Gallery database and Storage policies also block writes until that change is complete.
- Each admin can change their own password. The server updates the Auth account and clears the temporary-password flag in the same action.

## Gallery

`gallery_occasions` stores each section's heading, date, and filter group. `gallery_photos` stores its images. The public gallery reads both tables and builds year/filter controls from the data, so additional sections and photos require no HTML edits. Sections without images show a placeholder.

The admin panel has one collapsible **Occasions** section and one collapsible editor per occasion. Each occasion editor contains its heading, date, filter group, photo upload, photo details, and photo removal controls in one place. Admins can add or edit sections, upload JPEG/PNG/WebP images up to 10 MB each, and delete photos or whole sections. Uploaded images live in the public `campus-gallery` bucket. Deleting a database entry also attempts to remove its uploaded files; if file cleanup fails, the dashboard reports that separately.

Filter groups are selected from the groups already used by occasions. The final option creates a new group inline; after saving an occasion, that group becomes a gallery filter automatically.

## Reviews and security

The dashboard lists published restaurant reviews with a restaurant filter and search of loaded rows. Removing a review calls the `site-admin` Edge Function. It verifies the caller through Supabase Auth, removes the review and its stored photos, and the existing `restaurant_rating_summary` view recalculates the average automatically. Guests cannot call this action as admins.

`database/site-admin.sql` replaces the old gallery-only RLS policies. Only `app_metadata.site_admin = true` accounts without a pending temporary-password change can write gallery data. The frontend contains only the publishable API key. Keep the service-role key in Supabase's Edge Function environment.
