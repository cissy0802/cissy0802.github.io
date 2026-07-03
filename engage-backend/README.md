# BigCat Engage — Cloudflare Worker backend

Backend for the hub's **email subscribe**, **poll/voting**, and **comments**
(`/engage.js` + `/comments.js`). Comments are login-free — this replaces Giscus,
so visitors no longer need a GitHub account.

Stack: Cloudflare Worker (`worker.js`) + D1 SQLite (`schema.sql`). Free tier is plenty
(100k Worker requests/day, 5M D1 reads/day).

## One-time deploy

From this folder (`engage-backend/`):

```bash
# 1. Log in (opens browser)
npx wrangler login

# 2. Create the D1 database — copy the printed database_id
npx wrangler d1 create bigcat-engage

# 3. Paste that id into wrangler.toml  ->  database_id = "..."

# 4. Create the tables (remote = the live DB, not local)
npx wrangler d1 execute bigcat-engage --file=schema.sql --remote

# 5. Deploy the Worker — prints your URL, e.g.
#    https://bigcat-engage.<your-subdomain>.workers.dev
npx wrangler deploy
```

> Already deployed an earlier version? Just re-run step 4 (it creates the new
> `comments` table with `IF NOT EXISTS`, leaving existing data untouched) and
> `npx wrangler deploy`.

## Wire up the frontend

Set the URL from step 5 (no trailing slash) in **both** files:

- `../engage.js`   → `var API = "https://bigcat-engage.YOUR-SUBDOMAIN.workers.dev";`
- `../comments.js` → `var API = ... ;`

Commit + push the repo. Done — subscribe + poll live on the hub landing; comments
go live everywhere (all content pages already load `/comments.js`).

## Migrating off Giscus

- The switch is instant: every content page loads `/comments.js` from the hub root,
  so updating that one file flips the whole site to the new login-free comments.
- **Old Giscus comments are not deleted** — they still live in your repo's GitHub
  Discussions. They just won't render in the new UI. If any are worth keeping, copy
  them over manually (there likely aren't many).

## Spam defense (important — anonymous comments get botted)

Giscus's GitHub login was your spam wall. Now that anyone can post, three defenses
are built in:

1. **Honeypot** — a hidden `website` field; bots fill it and get silently dropped.
2. **Per-IP rate limit** — max 3 comments / 60s per IP (tune `RATE_MAX` /
   `RATE_WINDOW_MS` in `worker.js`).
3. **Cloudflare Turnstile** (optional, free, recommended if spam appears):
   - In the Cloudflare dashboard → Turnstile → create a widget → get a **site key**
     and **secret key**.
   - Bind the secret to the Worker: `npx wrangler secret put TURNSTILE_SECRET`
     (paste the secret). The Worker auto-enforces it once bound.
   - Put the **site key** into `TURNSTILE_SITEKEY` at the top of `../comments.js`.

### Moderation

Comments are auto-approved by default. To hold every new comment for review instead,
set `MODERATE = true` in `worker.js` and redeploy; then approve with SQL below.

```bash
# List recent comments
npx wrangler d1 execute bigcat-engage --remote \
  --command "SELECT id, page, name, substr(body,1,60), datetime(ts/1000,'unixepoch') at, approved FROM comments ORDER BY ts DESC LIMIT 50"

# Approve a held comment
npx wrangler d1 execute bigcat-engage --remote --command "UPDATE comments SET approved=1 WHERE id=123"

# Delete spam
npx wrangler d1 execute bigcat-engage --remote --command "DELETE FROM comments WHERE id=123"
```

## Reading your data

```bash
# All subscribed emails
npx wrangler d1 execute bigcat-engage --remote \
  --command "SELECT email, datetime(ts/1000,'unixepoch') AS at FROM subscribers ORDER BY ts DESC"

# Poll results
npx wrangler d1 execute bigcat-engage --remote \
  --command "SELECT poll, choice, COUNT(*) n FROM votes GROUP BY poll, choice ORDER BY poll, n DESC"
```

## Local dev

```bash
npx wrangler dev            # runs the Worker locally on http://localhost:8787
```

Point `API` at `http://localhost:8787` temporarily, and serve the site with
`python3 -m http.server 8000` from the repo root to test end-to-end.

## Notes / limits

- **Abuse:** endpoints are open (no auth) and CORS-locked to `cissy0802.github.io`.
  Cloudflare's built-in DDoS protection covers the basics; add Turnstile if spam shows up.
- **XSS:** comment name/body are stored raw and rendered with `textContent` only —
  markup in a comment can never execute.
- **Voting is honest-but-not-airtight:** dedup is by a random `localStorage` token,
  so a determined user can clear it and re-vote. Fine for a casual hub poll.
- **Sending newsletters:** this only *collects* emails. To actually email subscribers,
  export the list and paste into Buttondown / MailerLite, or add a send route later.
- **To change the poll:** edit the `POLL` object at the top of `../engage.js`. A new
  `id` starts a fresh tally.
