/* BigCat Learning Hub — engagement backend (Cloudflare Worker + D1).
 *
 * Endpoints (all JSON, CORS-restricted to the hub origin):
 *   POST /subscribe   { email }                     -> capture an email (dedup by PK)
 *   POST /vote        { poll, choice, session }      -> one vote per ACCOUNT (login required)
 *   GET  /poll?id=... [&voter=...]                   -> tallies for a poll (public)
 *   POST /poll        { id, session }                -> tallies + this account's own choice
 *   GET  /comments?page=...                          -> approved comments for a page (public)
 *   POST /comment     { page, body, session, website } -> post a comment (login required;
 *                                                       the name shown is the account's)
 *   POST /auth-register{ email, password, name }     -> create account, email a verify link
 *   POST /auth-name   { session, name }              -> change public display name
 *   POST /auth-verify  { token }                     -> activate an account
 *   POST /auth-login   { email, password }           -> { session }
 *   POST /auth-me      { session }                   -> { email }
 *   POST /auth-logout  { session }                   -> end this session
 *   POST /auth-forgot  { email }                     -> email a reset link
 *   POST /auth-reset   { token, password }           -> set a new password
 *   POST /notes-add    { session, id, page, title, lang, text, ts } -> upsert a note
 *   POST /notes-list   { session }                   -> that account's notes, newest first
 *   POST /notes-delete { session, id }               -> delete one of that account's notes
 *   Notes are private per account: every note is scoped to the session's user,
 *   so one account can never read or delete another's. POST-only keeps
 *   passwords and session tokens out of URLs and logs.
 *
 * Storage is a single D1 database bound as `DB` (see wrangler.toml + schema.sql).
 * Comments replace Giscus — no GitHub login required. Spam defenses: honeypot,
 * per-IP rate limit, and optional Cloudflare Turnstile (bind TURNSTILE_SECRET).
 */

const ALLOWED_ORIGINS = new Set([
  "https://cissy0802.github.io",
  "https://hub.cissychen.com", // custom-domain hub mirror (English-default)
  "http://localhost:8000", // local preview
  "http://127.0.0.1:8000",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Comment tuning.
const MODERATE = false; // true => new comments start hidden (approved=0) until you approve
const RATE_WINDOW_MS = 60000; // per-IP window
const RATE_MAX = 3; // max comments per IP per window
const VOTE_RATE_WINDOW_MS = 60000; // per-IP window for votes
const VOTE_RATE_MAX = 30; // generous for a human on the ideas list, fatal for a script
const BODY_MAX = 2000;
const NAME_MAX = 40;
const IP_SALT = "bigcat-comments-v1"; // just so stored hashes aren't raw IPs

// Accounts.
const DISPLAY_NAME_MAX = 40;
// Public display name for an account. Never expose the email: fall back to its
// local part only when the account has no name set yet.
function publicName(user) {
  var n = String((user && user.display_name) || "").trim();
  if (n) return n.slice(0, DISPLAY_NAME_MAX);
  var e = String((user && user.email) || "");
  var local = e.split("@")[0] || "";
  return local ? local.slice(0, DISPLAY_NAME_MAX) : "匿名 · Anonymous";
}
const PBKDF2_ITER = 100000; // Workers refuses anything above this
const PW_MIN = 8;
const SESSION_TTL = 90 * 24 * 3600 * 1000; // 90 days
const RESET_TTL = 60 * 60 * 1000; // reset links die after an hour
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10; // failed logins per IP per window

// Double opt-in (only active once RESEND_API_KEY is bound as a secret).
const SITE_BASE = "https://hub.cissychen.com"; // where /confirm.html lives
const FROM_EMAIL = "BigCat <hi@cissychen.com>"; // needs cissychen.com verified in Resend

function cors(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://cissy0802.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

async function hashIp(ip) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(IP_SALT + "|" + ip)
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    try {
      // ---- Subscribe ---------------------------------------------------
      // { email, list }  — `list` tags which tab they subscribed under
      // (e.g. "mental-models", or "hub" for the landing). One row per
      // (email, list), so an address can subscribe to several tabs.
      if (url.pathname === "/subscribe" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const email = String(body.email || "").trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) {
          return json({ ok: false, error: "invalid_email" }, 400, origin);
        }
        // list slug: letters/digits/dash, default "hub".
        let list = String(body.list || "hub").trim().toLowerCase().slice(0, 64);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(list)) list = "hub";
        // language of the page they subscribed from → language of their emails.
        const lang = String(body.lang || "").toLowerCase().startsWith("en") ? "en" : "zh";

        // Double opt-in only when an email sender is configured; otherwise
        // fall back to immediate confirmed subscription (current behaviour).
        const doubleOptIn = !!env.RESEND_API_KEY;

        // Already confirmed on this list? Nothing to do.
        const existing = await env.DB.prepare(
          "SELECT confirmed FROM subscriptions WHERE email = ? AND list = ?"
        )
          .bind(email, list)
          .first();
        if (existing && existing.confirmed === 1) {
          return json({ ok: true, already: true, list, pending: false }, 200, origin);
        }

        if (!doubleOptIn) {
          await env.DB.prepare(
            "INSERT INTO subscriptions (email, list, ts, confirmed, token, lang) VALUES (?1, ?2, ?3, 1, NULL, ?4) " +
              "ON CONFLICT(email, list) DO UPDATE SET confirmed = 1, lang = ?4"
          )
            .bind(email, list, Date.now(), lang)
            .run();
          return json({ ok: true, already: false, list, pending: false }, 200, origin);
        }

        // Pending: store token, email a confirmation link.
        const token = crypto.randomUUID().replace(/-/g, "");
        await env.DB.prepare(
          "INSERT INTO subscriptions (email, list, ts, confirmed, token, lang) VALUES (?1, ?2, ?3, 0, ?4, ?5) " +
            "ON CONFLICT(email, list) DO UPDATE SET token = ?4, ts = ?3, lang = ?5"
        )
          .bind(email, list, Date.now(), token, lang)
          .run();
        const sent = await sendConfirmEmail(env, email, list, token, lang);
        if (!sent) {
          // Couldn't email (e.g. Resend domain not verified yet) — confirm now
          // so the subscriber isn't stranded in an unconfirmable pending state.
          await env.DB.prepare(
            "UPDATE subscriptions SET confirmed = 1, token = NULL WHERE email = ? AND list = ?"
          )
            .bind(email, list)
            .run();
          return json({ ok: true, already: false, list, pending: false, sent: false }, 200, origin);
        }
        return json({ ok: true, already: false, list, pending: true, sent: true }, 200, origin);
      }

      // ---- Confirm a subscription (double opt-in link target) ----------
      if (url.pathname === "/confirm" && request.method === "GET") {
        const token = String(url.searchParams.get("t") || "").trim().slice(0, 64);
        if (!token || !/^[a-f0-9]{16,64}$/.test(token)) {
          return json({ ok: false, error: "bad_token" }, 400, origin);
        }
        const res = await env.DB.prepare(
          "UPDATE subscriptions SET confirmed = 1, token = NULL WHERE token = ?"
        )
          .bind(token)
          .run();
        const ok = res.meta.changes > 0;
        return json({ ok, confirmed: ok }, ok ? 200 : 404, origin);
      }

      // ---- Unsubscribe (signed link from a newsletter) -----------------
      if (url.pathname === "/unsubscribe" && (request.method === "GET" || request.method === "POST")) {
        const e = String(url.searchParams.get("e") || "").trim().toLowerCase().slice(0, 254);
        const l = String(url.searchParams.get("l") || "").trim().toLowerCase().slice(0, 64);
        const tk = String(url.searchParams.get("t") || "").trim().slice(0, 64);
        if (!e || !l || !tk) return json({ ok: false, error: "bad_request" }, 400, origin);
        const expect = await unsubToken(env, e, l);
        if (tk !== expect) return json({ ok: false, error: "bad_token" }, 403, origin);
        const res = await env.DB.prepare(
          "DELETE FROM subscriptions WHERE email = ? AND list = ?"
        )
          .bind(e, l)
          .run();
        return json({ ok: true, removed: res.meta.changes > 0 }, 200, origin);
      }

      // ---- Send a newsletter to a list (admin only) --------------------
      if (url.pathname === "/send" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!env.ADMIN_TOKEN || body.admin !== env.ADMIN_TOKEN) {
          return json({ ok: false, error: "unauthorized" }, 401, origin);
        }
        const list = String(body.list || "").trim().toLowerCase().slice(0, 64);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(list)) {
          return json({ ok: false, error: "bad_list" }, 400, origin);
        }
        const subject = String(body.subject || "").trim().slice(0, 200);
        const html = String(body.html || "");
        if (!subject || !html) return json({ ok: false, error: "missing_fields" }, 400, origin);
        if (!env.RESEND_API_KEY) return json({ ok: false, error: "no_sender" }, 400, origin);

        // Optional language filter: "en" or "zh" targets only that language's subscribers.
        const langFilter = String(body.lang || "").toLowerCase();
        const useLang = langFilter === "en" || langFilter === "zh";
        const { results } = await (useLang
          ? env.DB.prepare(
              "SELECT email FROM subscriptions WHERE list = ? AND confirmed = 1 AND lang = ?"
            ).bind(list, langFilter)
          : env.DB.prepare(
              "SELECT email FROM subscriptions WHERE list = ? AND confirmed = 1"
            ).bind(list)
        ).all();
        const emails = results.map((r) => r.email);
        if (body.dry) {
          return json({ ok: true, dry: true, list, recipients: emails.length }, 200, origin);
        }
        if (!emails.length) return json({ ok: true, sent: 0, list }, 200, origin);

        let sent = 0;
        for (let i = 0; i < emails.length; i += 100) {
          const chunk = emails.slice(i, i + 100);
          const batch = [];
          for (const e of chunk) {
            const tk = await unsubToken(env, e, list);
            const api = new URL(request.url).origin;
            const q =
              "?e=" + encodeURIComponent(e) + "&l=" + encodeURIComponent(list) + "&t=" + tk;
            const humanUnsub = SITE_BASE + "/unsubscribe.html" + q;
            const machineUnsub = api + "/unsubscribe" + q;
            const footer = unsubFooter(list, humanUnsub);
            const fullHtml = html.includes("</body>")
              ? html.replace("</body>", footer + "</body>")
              : html + footer;
            batch.push({
              from: FROM_EMAIL,
              to: e,
              subject,
              html: fullHtml,
              headers: {
                "List-Unsubscribe": "<" + machineUnsub + ">",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            });
          }
          const r = await fetch("https://api.resend.com/emails/batch", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + env.RESEND_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(batch),
          });
          if (r.ok) sent += chunk.length;
        }
        return json({ ok: true, sent, total: emails.length, list }, 200, origin);
      }

      // ---- Vote --------------------------------------------------------
      if (url.pathname === "/vote" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const poll = String(body.poll || "").trim().slice(0, 64);
        const choice = String(body.choice || "").trim().slice(0, 128);
        // Voting requires an account, and the voter id IS the account id — so
        // it's genuinely one vote per person (clearing localStorage no longer
        // buys another). Votes cast before accounts existed keep their old
        // random ids and still count.
        const votingUser = await sessionUser(env, body.session);
        if (!votingUser) {
          return json({ ok: false, error: "login_required" }, 401, origin);
        }
        const voter = votingUser.id;
        if (!poll || !choice) {
          return json({ ok: false, error: "missing_fields" }, 400, origin);
        }

        // Per-IP rate limit: still a cheap backstop against a scripted loop
        // driving one account down the whole ideas list.
        const vIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
        const vIphash = await hashIp(vIp);
        const vRl = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM votes WHERE iphash = ? AND ts > ?"
        )
          .bind(vIphash, Date.now() - VOTE_RATE_WINDOW_MS)
          .first();
        if (vRl && vRl.n >= VOTE_RATE_MAX) {
          return json({ ok: false, error: "rate_limited" }, 429, origin);
        }

        await env.DB.prepare(
          "INSERT INTO votes (poll, choice, voter, ts, iphash) VALUES (?1, ?2, ?3, ?4, ?5) " +
            "ON CONFLICT(poll, voter) DO UPDATE SET choice = ?2, ts = ?4, iphash = ?5"
        )
          .bind(poll, choice, voter, Date.now(), vIphash)
          .run();
        const tally = await tallyPoll(env, poll);
        return json({ ok: true, poll, choice, tally }, 200, origin);
      }

      // ---- Poll tallies ------------------------------------------------
      // GET  /poll?id=…[&voter=…]  tallies, readable by anyone (voter kept for
      //                            pre-account clients that still hold one).
      // POST /poll {id, session}   tallies + this ACCOUNT's own choice; POST so
      //                            the session token never lands in a URL/log.
      if (url.pathname === "/poll" && (request.method === "GET" || request.method === "POST")) {
        let poll, voter;
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          poll = String(body.id || "").trim().slice(0, 64);
          const me = await sessionUser(env, body.session);
          voter = me ? me.id : "";
        } else {
          poll = String(url.searchParams.get("id") || "").trim().slice(0, 64);
          voter = String(url.searchParams.get("voter") || "").trim().slice(0, 64);
        }
        if (!poll) return json({ ok: false, error: "missing_id" }, 400, origin);
        const tally = await tallyPoll(env, poll);
        let mine = null;
        if (voter) {
          const row = await env.DB.prepare(
            "SELECT choice FROM votes WHERE poll = ? AND voter = ?"
          )
            .bind(poll, voter)
            .first();
          mine = row ? row.choice : null;
        }
        return json({ ok: true, poll, tally, mine }, 200, origin);
      }

      // ---- Batch net votes by poll prefix (for thinker-arena ranking) --
      // GET /votes-net?prefix=topic:  ->  { "topic:foo": {up,down,net}, ... }
      // choice "up"/"down"; net = up - down. Used by ideas.js + refresh_votes.py.
      if (url.pathname === "/votes-net" && request.method === "GET") {
        const prefix = String(url.searchParams.get("prefix") || "").trim().slice(0, 64);
        if (!prefix) return json({ ok: false, error: "missing_prefix" }, 400, origin);
        const { results } = await env.DB.prepare(
          "SELECT poll, choice, COUNT(*) AS n FROM votes WHERE poll LIKE ?1 GROUP BY poll, choice"
        )
          .bind(prefix + "%")
          .all();
        const votes = {};
        for (const r of results) {
          const p = votes[r.poll] || (votes[r.poll] = { up: 0, down: 0, net: 0 });
          if (r.choice === "up") p.up = r.n;
          else if (r.choice === "down") p.down = r.n;
        }
        for (const k in votes) votes[k].net = votes[k].up - votes[k].down;
        return json({ ok: true, prefix, votes }, 200, origin);
      }

      // ---- List comments -----------------------------------------------
      if (url.pathname === "/comments" && request.method === "GET") {
        const page = String(url.searchParams.get("page") || "").trim().slice(0, 200);
        if (!page) return json({ ok: false, error: "missing_page" }, 400, origin);
        const { results } = await env.DB.prepare(
          "SELECT id, name, body, ts FROM comments WHERE page = ? AND approved = 1 " +
            "ORDER BY ts ASC LIMIT 500"
        )
          .bind(page)
          .all();
        return json({ ok: true, page, comments: results }, 200, origin);
      }

      // ---- Post a comment ----------------------------------------------
      if (url.pathname === "/comment" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));

        // Honeypot: real users never see/fill `website`. Bots do -> silent drop.
        if (String(body.website || "").trim() !== "") {
          return json({ ok: true, dropped: true }, 200, origin);
        }

        // Commenting requires an account. The displayed name comes from that
        // account, never from the request body — so nobody can post under
        // someone else's name, and the email is never exposed.
        const commenter = await sessionUser(env, body.session);
        if (!commenter) {
          return json({ ok: false, error: "login_required" }, 401, origin);
        }
        const page = String(body.page || "").trim().slice(0, 200);
        const name = commenter.name.slice(0, NAME_MAX);
        const text = String(body.body || "").trim().slice(0, BODY_MAX);
        if (!page || !text) {
          return json({ ok: false, error: "missing_fields" }, 400, origin);
        }

        // Optional Turnstile verification (only if the secret is bound).
        if (env.TURNSTILE_SECRET) {
          const ip0 = request.headers.get("CF-Connecting-IP") || "";
          const fd = new FormData();
          fd.append("secret", env.TURNSTILE_SECRET);
          fd.append("response", String(body.token || ""));
          if (ip0) fd.append("remoteip", ip0);
          const v = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            { method: "POST", body: fd }
          )
            .then((r) => r.json())
            .catch(() => ({ success: false }));
          if (!v.success) {
            return json({ ok: false, error: "captcha_failed" }, 403, origin);
          }
        }

        const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
        const iphash = await hashIp(ip);

        // Per-IP rate limit.
        const rl = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM comments WHERE iphash = ? AND ts > ?"
        )
          .bind(iphash, Date.now() - RATE_WINDOW_MS)
          .first();
        if (rl && rl.n >= RATE_MAX) {
          return json({ ok: false, error: "rate_limited" }, 429, origin);
        }

        const ts = Date.now();
        const approved = MODERATE ? 0 : 1;
        const ins = await env.DB.prepare(
          "INSERT INTO comments (page, name, body, ts, approved, iphash) " +
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        )
          .bind(page, name, text, ts, approved, iphash)
          .run();

        return json(
          {
            ok: true,
            approved: !!approved,
            comment: approved
              ? { id: ins.meta.last_row_id, name, body: text, ts }
              : null,
          },
          200,
          origin
        );
      }

      // ---- Accounts ----------------------------------------------------
      // POST-only throughout, so passwords and session tokens never appear in
      // a URL, a referrer or an access log.
      if (url.pathname.startsWith("/auth-")) {
        if (request.method !== "POST") {
          return json({ ok: false, error: "method_not_allowed" }, 405, origin);
        }
        const body = await request.json().catch(() => ({}));
        const lang = String(body.lang || "").toLowerCase().startsWith("en") ? "en" : "zh";

        // ---- Register: always answers the same way, so the endpoint can't
        // be used to enumerate which addresses have accounts.
        if (url.pathname === "/auth-register") {
          const email = String(body.email || "").trim().toLowerCase();
          const password = String(body.password || "");
          if (!EMAIL_RE.test(email) || email.length > 254) {
            return json({ ok: false, error: "invalid_email" }, 400, origin);
          }
          if (password.length < PW_MIN || password.length > 200) {
            return json({ ok: false, error: "weak_password", min: PW_MIN }, 400, origin);
          }
          // Public display name for comments (optional; blank falls back to the
          // email's local part). Strip control chars so it can't fake markup.
          const dispName = String(body.name || "")
            .replace(/[\x00-\x1f<>]/g, "")
            .trim()
            .slice(0, DISPLAY_NAME_MAX);
          if (!env.RESEND_API_KEY) {
            return json({ ok: false, error: "no_sender" }, 503, origin);
          }

          const existing = await env.DB.prepare(
            "SELECT id, verified FROM users WHERE email = ?"
          )
            .bind(email)
            .first();

          if (existing && existing.verified === 1) {
            // Already a live account: say nothing revealing, but do tell the
            // real owner (by email) that someone tried to re-register.
            await sendAuthEmail(env, email, "exists", null, lang);
          } else {
            const vtoken = randomToken(24);
            const pwhash = await hashPassword(env, password);
            if (existing) {
              await env.DB.prepare(
                "UPDATE users SET pwhash = ?2, vtoken = ?3, created = ?4, " +
                  "display_name = CASE WHEN ?5 <> '' THEN ?5 ELSE display_name END " +
                  "WHERE id = ?1"
              )
                .bind(existing.id, pwhash, vtoken, Date.now(), dispName)
                .run();
            } else {
              await env.DB.prepare(
                "INSERT INTO users (id, email, pwhash, verified, vtoken, created, display_name) " +
                  "VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)"
              )
                .bind(crypto.randomUUID(), email, pwhash, vtoken, Date.now(), dispName)
                .run();
            }
            await sendAuthEmail(env, email, "verify", vtoken, lang);
          }
          return json({ ok: true, pending: true }, 200, origin);
        }

        // ---- Verify an account (target of the emailed link)
        if (url.pathname === "/auth-verify") {
          const t = String(body.token || "").trim();
          if (!/^[a-f0-9]{16,64}$/.test(t)) {
            return json({ ok: false, error: "bad_token" }, 400, origin);
          }
          const row = await env.DB.prepare("SELECT id FROM users WHERE vtoken = ?")
            .bind(t)
            .first();
          if (!row) return json({ ok: false, error: "bad_token" }, 404, origin);
          await env.DB.prepare(
            "UPDATE users SET verified = 1, vtoken = NULL WHERE id = ?"
          )
            .bind(row.id)
            .run();
          const session = await newSession(env, row.id);
          return json({ ok: true, session }, 200, origin);
        }

        // ---- Log in
        if (url.pathname === "/auth-login") {
          const email = String(body.email || "").trim().toLowerCase();
          const password = String(body.password || "");
          const iphash = await hashIp(request.headers.get("CF-Connecting-IP") || "0.0.0.0");

          const rl = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM auth_attempts WHERE iphash = ? AND ts > ?"
          )
            .bind(iphash, Date.now() - LOGIN_WINDOW_MS)
            .first();
          if (rl && rl.n >= LOGIN_MAX) {
            return json({ ok: false, error: "rate_limited" }, 429, origin);
          }

          const user = await env.DB.prepare(
            "SELECT id, pwhash, verified FROM users WHERE email = ?"
          )
            .bind(email)
            .first();
          // Hash even when the user doesn't exist, so a missing account and a
          // wrong password take the same time to answer.
          const ok = await verifyPassword(
            env,
            password,
            user ? user.pwhash : "pbkdf2$" + PBKDF2_ITER + "$" + b64(new Uint8Array(16)) + "$x"
          );
          if (!user || !ok) {
            await env.DB.prepare("INSERT INTO auth_attempts (iphash, ts) VALUES (?, ?)")
              .bind(iphash, Date.now())
              .run();
            return json({ ok: false, error: "bad_credentials" }, 401, origin);
          }
          if (user.verified !== 1) {
            return json({ ok: false, error: "unverified" }, 403, origin);
          }
          const session = await newSession(env, user.id);
          return json({ ok: true, session, email }, 200, origin);
        }

        // ---- Who am I
        if (url.pathname === "/auth-me") {
          const me = await sessionUser(env, body.session);
          if (!me) return json({ ok: false, error: "unauthorized" }, 401, origin);
          return json({ ok: true, email: me.email, name: me.name }, 200, origin);
        }

        // ---- Change the public display name used on comments
        if (url.pathname === "/auth-name") {
          const me = await sessionUser(env, body.session);
          if (!me) return json({ ok: false, error: "unauthorized" }, 401, origin);
          const name = String(body.name || "")
            .replace(/[\x00-\x1f<>]/g, "")
            .trim()
            .slice(0, DISPLAY_NAME_MAX);
          if (!name) return json({ ok: false, error: "missing_fields" }, 400, origin);
          await env.DB.prepare("UPDATE users SET display_name = ?2 WHERE id = ?1")
            .bind(me.id, name)
            .run();
          return json({ ok: true, name }, 200, origin);
        }

        // ---- Log out (this session only)
        if (url.pathname === "/auth-logout") {
          const s = String(body.session || "").trim();
          if (/^[a-f0-9]{16,128}$/.test(s)) {
            await env.DB.prepare("DELETE FROM sessions WHERE token = ?")
              .bind(await sha256hex(s))
              .run();
          }
          return json({ ok: true }, 200, origin);
        }

        // ---- Forgot password: same answer whether or not the account exists.
        if (url.pathname === "/auth-forgot") {
          const email = String(body.email || "").trim().toLowerCase();
          if (EMAIL_RE.test(email) && env.RESEND_API_KEY) {
            const user = await env.DB.prepare(
              "SELECT id FROM users WHERE email = ? AND verified = 1"
            )
              .bind(email)
              .first();
            if (user) {
              const rtoken = randomToken(24);
              await env.DB.prepare(
                "UPDATE users SET rtoken = ?2, rexpires = ?3 WHERE id = ?1"
              )
                .bind(user.id, rtoken, Date.now() + RESET_TTL)
                .run();
              await sendAuthEmail(env, email, "reset", rtoken, lang);
            }
          }
          return json({ ok: true, sent: true }, 200, origin);
        }

        // ---- Set a new password from a reset link
        if (url.pathname === "/auth-reset") {
          const t = String(body.token || "").trim();
          const password = String(body.password || "");
          if (!/^[a-f0-9]{16,64}$/.test(t)) {
            return json({ ok: false, error: "bad_token" }, 400, origin);
          }
          if (password.length < PW_MIN || password.length > 200) {
            return json({ ok: false, error: "weak_password", min: PW_MIN }, 400, origin);
          }
          const row = await env.DB.prepare(
            "SELECT id, rexpires FROM users WHERE rtoken = ?"
          )
            .bind(t)
            .first();
          if (!row || !row.rexpires || row.rexpires < Date.now()) {
            return json({ ok: false, error: "bad_token" }, 404, origin);
          }
          const pwhash = await hashPassword(env, password);
          await env.DB.prepare(
            "UPDATE users SET pwhash = ?2, rtoken = NULL, rexpires = NULL, verified = 1 WHERE id = ?1"
          )
            .bind(row.id, pwhash)
            .run();
          // A password change logs every other device out.
          await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
          const session = await newSession(env, row.id);
          return json({ ok: true, session }, 200, origin);
        }
      }

      // ---- Notes (private per account) ---------------------------------
      // Every statement filters on the session's user_id, so one account can
      // never read, overwrite or delete another account's notes.
      if (url.pathname.startsWith("/notes-")) {
        if (request.method !== "POST") {
          return json({ ok: false, error: "method_not_allowed" }, 405, origin);
        }
        const body = await request.json().catch(() => ({}));
        const me = await sessionUser(env, body.session);
        if (!me) return json({ ok: false, error: "unauthorized" }, 401, origin);

        if (url.pathname === "/notes-list") {
          const { results } = await env.DB.prepare(
            "SELECT id, page, title, lang, text, prefix, suffix, comment, ts " +
              "FROM notes WHERE user_id = ? ORDER BY ts DESC LIMIT 2000"
          )
            .bind(me.id)
            .all();
          return json({ ok: true, notes: results }, 200, origin);
        }

        if (url.pathname === "/notes-add") {
          const id = String(body.id || "").trim().slice(0, 64);
          const page = String(body.page || "").trim().slice(0, 200);
          const text = String(body.text || "").trim().slice(0, 4000);
          if (!id || !page || !text) {
            return json({ ok: false, error: "missing_fields" }, 400, origin);
          }
          const title = String(body.title || "").trim().slice(0, 300);
          const nlang = String(body.lang || "").toLowerCase().startsWith("en") ? "en" : "zh";
          const prefix = String(body.prefix || "").slice(0, 200);
          const suffix = String(body.suffix || "").slice(0, 200);
          const comment = String(body.comment || "").trim().slice(0, 4000);
          const ts = Number(body.ts) || Date.now();
          // The WHERE on the upsert stops a guessed id from overwriting
          // someone else's note.
          await env.DB.prepare(
            "INSERT INTO notes (id, user_id, page, title, lang, text, prefix, suffix, comment, ts) " +
              "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) " +
              "ON CONFLICT(id) DO UPDATE SET comment = ?9, ts = ?10 WHERE notes.user_id = ?2"
          )
            .bind(id, me.id, page, title, nlang, text, prefix, suffix, comment, ts)
            .run();
          return json({ ok: true, id }, 200, origin);
        }

        if (url.pathname === "/notes-delete") {
          const id = String(body.id || "").trim().slice(0, 64);
          if (!id) return json({ ok: false, error: "missing_id" }, 400, origin);
          const res = await env.DB.prepare(
            "DELETE FROM notes WHERE id = ? AND user_id = ?"
          )
            .bind(id, me.id)
            .run();
          return json({ ok: true, deleted: res.meta.changes > 0 }, 200, origin);
        }
      }

      return json({ ok: false, error: "not_found" }, 404, origin);
    } catch (err) {
      return json({ ok: false, error: "server_error", detail: String(err) }, 500, origin);
    }
  },
};

// ---- accounts: hashing, sessions, helpers --------------------------------

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomToken(n) {
  return [...crypto.getRandomValues(new Uint8Array(n || 32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Length-independent compare, so an attacker can't time their way to a token.
function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The pepper is a Worker secret, never in the database — so dumping D1 alone
// doesn't let anyone mount an offline dictionary attack on these hashes.
async function pepperPassword(env, password) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.AUTH_PEPPER || "bigcat-unpeppered"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password));
  return new Uint8Array(sig);
}
async function derivePw(env, password, salt, iterations) {
  const peppered = await pepperPassword(env, password);
  const key = await crypto.subtle.importKey("raw", peppered, { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return new Uint8Array(bits);
}
async function hashPassword(env, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await derivePw(env, password, salt, PBKDF2_ITER);
  return "pbkdf2$" + PBKDF2_ITER + "$" + b64(salt) + "$" + b64(h);
}
async function verifyPassword(env, password, stored) {
  const p = String(stored || "").split("$");
  if (p.length !== 4 || p[0] !== "pbkdf2") return false;
  const iter = parseInt(p[1], 10);
  if (!(iter > 0 && iter <= PBKDF2_ITER)) return false;
  let salt;
  try {
    salt = unb64(p[2]);
  } catch (e) {
    return false;
  }
  const h = await derivePw(env, password, salt, iter);
  return safeEqual(b64(h), p[3]);
}

async function newSession(env, userId) {
  const raw = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, created, expires) VALUES (?1, ?2, ?3, ?4)"
  )
    .bind(await sha256hex(raw), userId, now, now + SESSION_TTL)
    .run();
  return raw;
}
// Resolves a session secret to its account, or null. Expired rows are treated
// as absent (a nightly cleanup isn't worth a cron here).
async function sessionUser(env, raw) {
  const s = String(raw || "").trim();
  if (!/^[a-f0-9]{16,128}$/.test(s)) return null;
  const row = await env.DB.prepare(
    "SELECT s.user_id AS id, s.expires AS expires, u.email AS email, " +
      "u.display_name AS display_name " +
      "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  )
    .bind(await sha256hex(s))
    .first();
  if (!row || row.expires < Date.now()) return null;
  return { id: row.id, email: row.email, name: publicName(row) };
}

async function unsubToken(env, email, list) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_TOKEN || "bigcat-unsub"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(email.toLowerCase() + "|" + list)
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function unsubFooter(list, link) {
  const label = list === "hub" ? "BigCat's Learning Hub" : list;
  return (
    '<hr style="border:none;border-top:1px solid #eee;margin:26px 0 12px">' +
    '<p style="font-size:12px;color:#999;line-height:1.6;font-family:-apple-system,sans-serif">' +
    "你收到这封邮件是因为订阅了 <b>" + label + "</b>。" +
    '<a href="' + link + '" style="color:#999">退订</a> · ' +
    'You subscribed to <b>' + label + '</b>. <a href="' + link + '" style="color:#999">Unsubscribe</a></p>'
  );
}

async function sendConfirmEmail(env, email, list, token, lang) {
  const link = SITE_BASE + "/confirm.html?t=" + token;
  const en = lang === "en";
  const label = list === "hub" ? "BigCat's Learning Hub" : list;
  const wrap = (inner) =>
    '<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#222">' +
    inner +
    "</div>";
  const subject = en
    ? "Confirm your subscription (" + label + ")"
    : "确认订阅 · " + label;
  const btn =
    '<p><a href="' + link + '" style="display:inline-block;background:#7b61ff;color:#fff;' +
    'padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700">' +
    (en ? "Confirm subscription" : "确认订阅") +
    "</a></p>";
  const html = en
    ? wrap(
        "<h2>Confirm your subscription</h2>" +
          "<p>You (or someone) subscribed to <b>" + label + "</b>. Click to confirm — we won't email you until you do.</p>" +
          btn +
          '<p style="font-size:12px;color:#888">Not you? Just ignore this email.</p>'
      )
    : wrap(
        "<h2>确认订阅</h2>" +
          "<p>你（或有人用这个邮箱）订阅了 <b>" + label + "</b>。点下面确认，之后才会给你发邮件。</p>" +
          btn +
          '<p style="font-size:12px;color:#888">没订阅过就忽略这封邮件。</p>'
      );
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: email, subject, html }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

// Account emails: verification, password reset, and the "someone tried to
// register your address" notice that keeps /auth-register non-enumerable.
async function sendAuthEmail(env, email, kind, token, lang) {
  if (!env.RESEND_API_KEY) return false;
  const en = lang === "en";
  const acct = SITE_BASE + (en ? "/account.en.html" : "/account.html");
  const wrap = (inner) =>
    '<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#222">' +
    inner +
    "</div>";
  const button = (href, label) =>
    '<p><a href="' + href + '" style="display:inline-block;background:#7b61ff;color:#fff;' +
    'padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700">' + label + "</a></p>";

  let subject, html;
  if (kind === "verify") {
    const link = acct + "?verify=" + token;
    subject = en ? "Verify your BigCat Hub account" : "验证你的 BigCat Hub 账号";
    html = en
      ? wrap("<h2>Verify your account</h2><p>Click to activate your account and start saving notes.</p>" +
          button(link, "Verify account") +
          '<p style="font-size:12px;color:#888">Didn\'t sign up? Ignore this email.</p>')
      : wrap("<h2>验证你的账号</h2><p>点击激活账号，之后就可以保存划线笔记了。</p>" +
          button(link, "验证账号") +
          '<p style="font-size:12px;color:#888">不是你注册的？忽略这封邮件即可。</p>');
  } else if (kind === "reset") {
    const link = acct + "?reset=" + token;
    subject = en ? "Reset your BigCat Hub password" : "重置 BigCat Hub 密码";
    html = en
      ? wrap("<h2>Reset your password</h2><p>This link works once and expires in an hour.</p>" +
          button(link, "Set a new password") +
          '<p style="font-size:12px;color:#888">Didn\'t ask for this? Ignore this email; your password is unchanged.</p>')
      : wrap("<h2>重置密码</h2><p>这个链接只能用一次，一小时后失效。</p>" +
          button(link, "设置新密码") +
          '<p style="font-size:12px;color:#888">不是你申请的？忽略即可，密码不会改变。</p>');
  } else {
    const link = acct;
    subject = en ? "You already have a BigCat Hub account" : "你已经有 BigCat Hub 账号了";
    html = en
      ? wrap("<h2>You already have an account</h2><p>Someone tried to register with this address. Just log in — or reset your password if you've forgotten it.</p>" +
          button(link, "Log in"))
      : wrap("<h2>你已经有账号了</h2><p>有人用这个邮箱尝试注册。直接登录即可——忘记密码就用「忘记密码」重置。</p>" +
          button(link, "登录"));
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: email, subject, html }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function tallyPoll(env, poll) {
  const { results } = await env.DB.prepare(
    "SELECT choice, COUNT(*) AS n FROM votes WHERE poll = ? GROUP BY choice"
  )
    .bind(poll)
    .all();
  const tally = {};
  for (const r of results) tally[r.choice] = r.n;
  return tally;
}
