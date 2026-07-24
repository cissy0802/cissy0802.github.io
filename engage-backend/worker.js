/* BigCat Learning Hub — engagement backend (Cloudflare Worker + D1).
 *
 * Endpoints (all JSON, CORS-restricted to the hub origin):
 *   POST /subscribe   { email }                     -> capture an email (dedup by PK)
 *   POST /vote        { poll, choice, voter }        -> record/replace one vote per voter
 *   GET  /poll?id=... [&voter=...]                   -> tallies for a poll (+ this voter's choice)
 *   GET  /comments?page=...                          -> approved comments for a page
 *   POST /comment     { page, name, body, website }  -> post a comment (login-free)
 *   POST /notes-add    { token, id, page, title, lang, text, ts } -> upsert a highlight note
 *   POST /notes-list   { token }                     -> all notes, newest first
 *   POST /notes-delete { token, id }                 -> delete one note
 *   Notes are owner-private: every notes endpoint requires the NOTES_TOKEN
 *   secret (wrangler secret put NOTES_TOKEN). POST-only keeps it out of URLs.
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
        const voter = String(body.voter || "").trim().slice(0, 64);
        if (!poll || !choice || !voter) {
          return json({ ok: false, error: "missing_fields" }, 400, origin);
        }

        // Per-IP rate limit — `voter` is client-supplied, so without this an
        // attacker can stuff any poll (incl. thinker-arena topic ranking) with
        // unlimited fresh voter ids. 30/min is roomy for a human working down
        // the ideas list, fatal for a scripted loop.
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
      if (url.pathname === "/poll" && request.method === "GET") {
        const poll = String(url.searchParams.get("id") || "").trim().slice(0, 64);
        const voter = String(url.searchParams.get("voter") || "").trim().slice(0, 64);
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

        const page = String(body.page || "").trim().slice(0, 200);
        let name = String(body.name || "").trim().slice(0, NAME_MAX);
        const text = String(body.body || "").trim().slice(0, BODY_MAX);
        if (!page || !text) {
          return json({ ok: false, error: "missing_fields" }, 400, origin);
        }
        if (!name) name = "匿名 · Anonymous";

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

      // ---- Notes (owner-private highlights) ----------------------------
      // All three are POST so the token never lands in a URL or a log line.
      if (url.pathname.startsWith("/notes-")) {
        const body = await request.json().catch(() => ({}));
        if (request.method !== "POST") {
          return json({ ok: false, error: "method_not_allowed" }, 405, origin);
        }
        if (!env.NOTES_TOKEN || String(body.token || "") !== env.NOTES_TOKEN) {
          return json({ ok: false, error: "unauthorized" }, 401, origin);
        }

        if (url.pathname === "/notes-list") {
          const { results } = await env.DB.prepare(
            "SELECT id, page, title, lang, text, prefix, suffix, comment, ts " +
              "FROM notes ORDER BY ts DESC LIMIT 2000"
          ).all();
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
          const lang = String(body.lang || "").toLowerCase().startsWith("en") ? "en" : "zh";
          const prefix = String(body.prefix || "").slice(0, 200);
          const suffix = String(body.suffix || "").slice(0, 200);
          const comment = String(body.comment || "").trim().slice(0, 4000);
          const ts = Number(body.ts) || Date.now();
          await env.DB.prepare(
            "INSERT INTO notes (id, page, title, lang, text, prefix, suffix, comment, ts) " +
              "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) " +
              "ON CONFLICT(id) DO UPDATE SET comment = ?8, ts = ?9"
          )
            .bind(id, page, title, lang, text, prefix, suffix, comment, ts)
            .run();
          return json({ ok: true, id }, 200, origin);
        }

        if (url.pathname === "/notes-delete") {
          const id = String(body.id || "").trim().slice(0, 64);
          if (!id) return json({ ok: false, error: "missing_id" }, 400, origin);
          const res = await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
          return json({ ok: true, deleted: res.meta.changes > 0 }, 200, origin);
        }
      }

      return json({ ok: false, error: "not_found" }, 404, origin);
    } catch (err) {
      return json({ ok: false, error: "server_error", detail: String(err) }, 500, origin);
    }
  },
};

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
