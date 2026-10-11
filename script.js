/* Trades Book API - Cloudflare Worker + D1 database.
   Bindings / settings (see README):
     DB             D1 database binding (required)
     ACCESS_CODE    secret: code landlords enter once to read/add/recommend/review (recommended)
     ADMIN_CODE     secret: code needed to edit or delete contacts (required for edit/delete)
     ALLOWED_ORIGIN variable: your website address, e.g. https://my-site.netlify.app (comma-separate several)
*/
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const clean = (v, max) => String(v ?? "").trim().slice(0, max);

/* Phone number is the unique key (digits only, Irish +353 / 00353 become 0...) */
const pkey = p => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("353") && d.length > 9) d = "0" + d.slice(3);
  return d;
};

async function sha(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function safeEq(a, b) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map(s => s.trim()).filter(Boolean);
  const any = allowed.includes("*");
  return {
    "Access-Control-Allow-Origin": any ? "*" : (allowed.includes(origin) ? origin : allowed[0]),
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Device,X-Access-Code,X-Admin-Code",
    "Vary": "Origin"
  };
}

/* Codes are compared after trimming spaces/line breaks, so a stray space pasted into Cloudflare does not lock you out. */
const code = v => String(v ?? "").trim();

async function needAdmin(req, env) {
  if (!code(env.ADMIN_CODE)) return json({ error: "Admin code is not configured on the server." }, 403);
  if (!(await safeEq(code(req.headers.get("X-Admin-Code")), code(env.ADMIN_CODE))))
    return json({ error: "Admin code required", need: "admin" }, 401);
  return null;
}

async function readBody(req) {
  if (Number(req.headers.get("Content-Length") || 0) > 5000) return null;
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" ? b : null;
}

const today = () => new Date().toISOString().slice(0, 10);

async function handle(req, env) {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/contacts(?:\/(\d{3,20}))?(?:\/(recommend|review))?\/?$/);
  if (!m) return json({ error: "Not found" }, 404);
  const [, key, action] = m;

  if (code(env.ACCESS_CODE) && !(await safeEq(code(req.headers.get("X-Access-Code")), code(env.ACCESS_CODE))))
    return json({ error: "Access code required", need: "access" }, 401);

  const db = env.DB, method = req.method;
  const dev = clean(req.headers.get("X-Device"), 64).replace(/[^a-z0-9]/gi, "");
  const ipHash = await sha((req.headers.get("CF-Connecting-IP") || "") + "|" + (env.SALT || "tb"));

  /* ---- list ---- */
  if (!key && method === "GET") {
    const [c, r, v] = await Promise.all([
      db.prepare("SELECT phone_key,name,trade,phone,email,notes FROM contacts").all(),
      db.prepare("SELECT phone_key,dev,ip_hash,name,text,date,created_at FROM recommendations ORDER BY created_at DESC").all(),
      db.prepare("SELECT phone_key,author,text,date,created_at FROM reviews ORDER BY created_at DESC").all()
    ]);
    const map = new Map(c.results.map(x => [x.phone_key,
      { id: x.phone_key, name: x.name, trade: x.trade, phone: x.phone, email: x.email, notes: x.notes,
        recCount: 0, recs: [], reviews: [], voted: false }]));
    for (const x of r.results) {
      const o = map.get(x.phone_key); if (!o) continue;
      o.recCount++;
      if (x.name || x.text) o.recs.push({ name: x.name, text: x.text, date: x.date, t: x.created_at });
      if ((dev && x.dev === dev) || x.ip_hash === ipHash) o.voted = true;
    }
    for (const x of v.results) {
      const o = map.get(x.phone_key); if (!o) continue;
      o.reviews.push({ author: x.author, text: x.text, date: x.date, ts: x.created_at });
    }
    return json([...map.values()]);
  }

  /* ---- add contact ---- */
  if (!key && method === "POST") {
    const b = await readBody(req); if (!b) return json({ error: "Bad request" }, 400);
    const name = clean(b.name, 100), trade = clean(b.trade, 50), phone = clean(b.phone, 30);
    const email = clean(b.email, 100), notes = clean(b.notes, 500);
    const k = pkey(phone);
    if (!name || !trade) return json({ error: "Name and category are required." }, 400);
    if (k.length < 7 || k.length > 15) return json({ error: "Please enter a valid phone number." }, 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);
    const ex = await db.prepare("SELECT name,trade FROM contacts WHERE phone_key=?").bind(k).first();
    if (ex) return json({ error: "exists", name: ex.name, trade: ex.trade }, 409);
    try {
      await db.prepare("INSERT INTO contacts (phone_key,name,trade,phone,email,notes,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(k, name, trade, phone, email, notes, Date.now()).run();
    } catch (e) { return json({ error: "exists" }, 409); }
    return json({ id: k }, 201);
  }

  if (!key) return json({ error: "Method not allowed" }, 405);

  /* ---- one contact ---- */
  if (!action && method === "GET") {
    const c = await db.prepare("SELECT phone_key AS id,name,trade,phone FROM contacts WHERE phone_key=?").bind(key).first();
    return c ? json(c) : json({ error: "Not found" }, 404);
  }

  /* ---- edit (admin) ---- */
  if (!action && method === "PATCH") {
    const bad = await needAdmin(req, env); if (bad) return bad;
    const b = await readBody(req); if (!b) return json({ error: "Bad request" }, 400);
    const name = clean(b.name, 100), trade = clean(b.trade, 50), email = clean(b.email, 100), notes = clean(b.notes, 500);
    if (!name || !trade) return json({ error: "Name and category are required." }, 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);
    await db.prepare("UPDATE contacts SET name=?,trade=?,email=?,notes=? WHERE phone_key=?").bind(name, trade, email, notes, key).run();
    return json({ ok: true });
  }

  /* ---- delete (admin) ---- */
  if (!action && method === "DELETE") {
    const bad = await needAdmin(req, env); if (bad) return bad;
    await db.batch([
      db.prepare("DELETE FROM recommendations WHERE phone_key=?").bind(key),
      db.prepare("DELETE FROM reviews WHERE phone_key=?").bind(key),
      db.prepare("DELETE FROM contacts WHERE phone_key=?").bind(key)
    ]);
    return json({ ok: true });
  }

  if (method !== "POST") return json({ error: "Method not allowed" }, 405);
  const exists = await db.prepare("SELECT 1 AS x FROM contacts WHERE phone_key=?").bind(key).first();
  if (!exists) return json({ error: "Not found" }, 404);
  const b = await readBody(req); if (!b) return json({ error: "Bad request" }, 400);

  /* ---- recommend: one per device or connection ---- */
  if (action === "recommend") {
    const name = clean(b.name, 40), text = clean(b.text, 400);
    if (!name) return json({ error: "Please enter your name." }, 400);
    if (dev.length < 8) return json({ error: "Missing device code." }, 400);
    const seen = await db.prepare("SELECT 1 AS x FROM recommendations WHERE phone_key=? AND (dev=? OR ip_hash=?)").bind(key, dev, ipHash).first();
    if (seen) return json({ status: "already" });
    await db.prepare("INSERT INTO recommendations (phone_key,dev,ip_hash,name,text,date,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(key, dev, ipHash, name, text, today(), Date.now()).run();
    return json({ status: "ok" });
  }

  /* ---- negative review ---- */
  const text = clean(b.text, 400), author = clean(b.author, 40);
  if (!text) return json({ error: "Please write a short review." }, 400);
  await db.prepare("INSERT INTO reviews (phone_key,author,text,date,created_at) VALUES (?,?,?,?,?)")
    .bind(key, author, text, today(), Date.now()).run();
  return json({ ok: true }, 201);
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try { res = await handle(req, env); } catch (e) { res = json({ error: "Server error" }, 500); }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }
};