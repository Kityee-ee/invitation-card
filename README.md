# BKT Friyay night 🍲

Invitation page for the housewarming open house on Friday 16 October 2026: details, RSVP with a live guest list, a potluck board guests can claim from, and directions.

Plain HTML/CSS/JS with no build step. Data is stored in Supabase.

## Setup

1. **Database:** `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npx supabase db push`. This applies [supabase/migrations](supabase/migrations). Alternatively, paste the migration into the SQL Editor and run it once.
2. **Connect:** in Project Settings → API, copy the Project URL and the `anon` public key into [config.js](config.js).
3. **Publish:** push to `main`. GitHub Pages serves the repo root.

If `config.js` is left empty, the page runs in demo mode and keeps data in the browser only.

## Preview locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Editing

- Event text and itinerary: [index.html](index.html)
- Calendar times and address used by the buttons: `EVENT` in [app.js](app.js)
- Potluck slots: the `insert` at the bottom of the migration in [supabase/migrations](supabase/migrations). To change them after setup, edit the `potluck_items` table in Supabase's Table Editor.
