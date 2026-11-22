export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    try {
      if (route === "GET /api/health") return health(env);
      if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
      if (route === "POST /api/admin-login") return adminLogin(request, env);

      // Everything below needs a valid member link.
      const me = await authenticate(request, env);
      if (!me) return json({ error: "Link inválido" }, 401);

      if (route === "GET /api/me") return getMe(env, me);

      // Wishlists
      if (route === "GET /api/wishlist") return listWishlist(env, me.id);
      if (route === "POST /api/wishlist") return addWishlistItem(request, env, me);
      const wishMatch = url.pathname.match(/^\/api\/wishlist\/(\d+)$/);
      if (request.method === "DELETE" && wishMatch) return deleteWishlistItem(env, me, Number(wishMatch[1]));
      if (route === "GET /api/receiver/wishlist") return receiverWishlist(env, me);

      // Chats
      if (route === "GET /api/chats") return getChats(env, me, url);
      const chatMatch = url.pathname.match(/^\/api\/chats\/(giving|receiving)$/);
      if (request.method === "POST" && chatMatch) return postChat(request, env, me, chatMatch[1]);

      // Admin
      if (url.pathname.startsWith("/api/admin/")) {
        if (!me.is_admin) return json({ error: "Acesso negado" }, 403);
        if (route === "GET /api/admin/members") return adminMembers(env);
        if (route === "POST /api/admin/draw") return adminDraw(env);
        if (route === "POST /api/admin/reset") return adminReset(env);
      }

      return json({ error: "Não encontrado" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Erro no servidor" }, 500);
    }
  },
};

async function health(env) {
  let db = false;
  try {
    await env.DB.prepare("SELECT 1").first();
    db = true;
  } catch {}
  return json({ ok: db, db, adminKeySet: Boolean(env.ADMIN_KEY) });
}

// The browser sends the token from the URL hash as "Authorization: Bearer <token>".
async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  return env.DB.prepare(
    "SELECT id, name, is_kid, is_admin, first_seen_at FROM members WHERE token = ?"
  )
    .bind(token)
    .first();
}

async function getMe(env, me) {
  if (!me.first_seen_at) {
    await env.DB.prepare(
      "UPDATE members SET first_seen_at = datetime('now') WHERE id = ? AND first_seen_at IS NULL"
    )
      .bind(me.id)
      .run();
  }

  const receiver = await env.DB.prepare(
    `SELECT m.name, (SELECT MAX(id) FROM draws) AS draw_id
     FROM assignments a JOIN members m ON m.id = a.receiver_id WHERE a.giver_id = ?`
  )
    .bind(me.id)
    .first();

  return json({
    name: me.name,
    isAdmin: Boolean(me.is_admin),
    drawn: Boolean(receiver),
    receiver: receiver ? receiver.name : null,
    drawId: receiver ? receiver.draw_id : null, // changes on every draw, so phones forget old reveals
  });
}

// ---------- Wishlists ----------

const MAX_WISH_ITEMS = 30;

async function listWishlist(env, memberId) {
  const { results } = await env.DB.prepare(
    "SELECT id, kind, text, url FROM wishlist_items WHERE member_id = ? ORDER BY id"
  )
    .bind(memberId)
    .all();
  return json({ items: results });
}

async function addWishlistItem(request, env, me) {
  const body = await readJson(request);
  const kind = body.kind;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  let link = kind === "item" && typeof body.url === "string" ? body.url.trim() : "";

  if (kind !== "item" && kind !== "idea") return json({ error: "Tipo inválido" }, 400);
  if (!text || text.length > 300) return json({ error: "Escreva algo (até 300 caracteres)." }, 400);
  if (link) {
    link = normalizeUrl(link);
    if (!link) return json({ error: "Link inválido." }, 400);
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM wishlist_items WHERE member_id = ?")
    .bind(me.id)
    .first("n");
  if (count >= MAX_WISH_ITEMS) return json({ error: `Máximo de ${MAX_WISH_ITEMS} itens.` }, 400);

  const item = await env.DB.prepare(
    "INSERT INTO wishlist_items (member_id, kind, text, url) VALUES (?, ?, ?, ?) RETURNING id, kind, text, url"
  )
    .bind(me.id, kind, text, link || null)
    .first();
  return json({ item }, 201);
}

async function deleteWishlistItem(env, me, id) {
  const { meta } = await env.DB.prepare("DELETE FROM wishlist_items WHERE id = ? AND member_id = ?")
    .bind(id, me.id)
    .run();
  if (!meta.changes) return json({ error: "Item não encontrado" }, 404);
  return json({ ok: true });
}

async function receiverWishlist(env, me) {
  const receiverId = await env.DB.prepare("SELECT receiver_id FROM assignments WHERE giver_id = ?")
    .bind(me.id)
    .first("receiver_id");
  if (receiverId == null) return json({ drawn: false, items: [] });
  return listWishlist(env, receiverId);
}

// Accepts "amazon.com.br/x" too. Only http(s), so no javascript: links reach the page.
function normalizeUrl(raw) {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (withScheme.length > 1000) return null;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

// ---------- Chats ----------
// Two chats per person: "giving" (me → the person I drew, I stay anonymous)
// and "receiving" (my anonymous santa → me). The giver's identity never leaves the server.

async function getPairs(env, me) {
  const { results } = await env.DB.prepare(
    "SELECT giver_id, receiver_id FROM assignments WHERE giver_id = ? OR receiver_id = ?"
  )
    .bind(me.id, me.id)
    .all();
  const giving = results.find((r) => r.giver_id === me.id);
  const receiving = results.find((r) => r.receiver_id === me.id);
  return {
    giving: giving && { giverId: me.id, receiverId: giving.receiver_id, myRole: "giver" },
    receiving: receiving && { giverId: receiving.giver_id, receiverId: me.id, myRole: "receiver" },
  };
}

async function getChats(env, me, url) {
  const pairs = await getPairs(env, me);
  const out = { drawn: Boolean(pairs.giving) };

  for (const side of ["giving", "receiving"]) {
    const pair = pairs[side];
    const since = Math.max(0, Number(url.searchParams.get(side)) || 0);
    if (!pair) {
      out[side] = [];
      continue;
    }
    const { results } = await env.DB.prepare(
      `SELECT id, from_role, body, created_at FROM messages
       WHERE giver_id = ? AND receiver_id = ? AND id > ? ORDER BY id LIMIT 200`
    )
      .bind(pair.giverId, pair.receiverId, since)
      .all();
    out[side] = results.map((m) => toClientMessage(m, pair.myRole));
  }
  return json(out);
}

async function postChat(request, env, me, side) {
  const pair = (await getPairs(env, me))[side];
  if (!pair) return json({ error: "O sorteio ainda não foi feito." }, 409);

  const { body } = await readJson(request);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text || text.length > 1000) return json({ error: "Mensagem vazia ou longa demais." }, 400);

  const row = await env.DB.prepare(
    `INSERT INTO messages (giver_id, receiver_id, from_role, body) VALUES (?, ?, ?, ?)
     RETURNING id, from_role, body, created_at`
  )
    .bind(pair.giverId, pair.receiverId, pair.myRole, text)
    .first();
  return json({ message: toClientMessage(row, pair.myRole) }, 201);
}

function toClientMessage(m, myRole) {
  return { id: m.id, mine: m.from_role === myRole, body: m.body, at: m.created_at };
}

// ---------- Admin ----------

// Fallback login for the admin: trade the ADMIN_KEY secret for the admin's own link token.
async function adminLogin(request, env) {
  if (!env.ADMIN_KEY) return json({ error: "ADMIN_KEY não configurada no servidor." }, 503);
  const { key } = await readJson(request);
  if (typeof key !== "string" || !(await safeEqual(key, env.ADMIN_KEY))) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return json({ error: "Chave incorreta." }, 401);
  }
  const token = await env.DB.prepare("SELECT token FROM members WHERE is_admin = 1").first("token");
  return json({ token });
}

// Compare SHA-256 digests in constant time, so response timing leaks nothing about the key.
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

// Status per person, never who got whom and never wishlist contents.
async function adminMembers(env) {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.name, m.is_kid, m.token,
            m.first_seen_at IS NOT NULL AS opened,
            EXISTS (SELECT 1 FROM wishlist_items w WHERE w.member_id = m.id) AS has_wishlist
     FROM members m ORDER BY m.name`
  ).all();
  const drawn = await env.DB.prepare("SELECT COUNT(*) AS n FROM assignments").first("n");

  return json({
    drawn: drawn > 0,
    members: results.map((m) => ({
      name: m.name,
      isKid: Boolean(m.is_kid),
      token: m.token,
      opened: Boolean(m.opened),
      hasWishlist: Boolean(m.has_wishlist),
    })),
  });
}

// Shuffle everyone, then each person gives to the next one; the last gives to the first.
// One single cycle, so no sub-loops and nobody gets themselves.
async function adminDraw(env) {
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM assignments").first("n");
  if (existing > 0) return json({ error: "O sorteio já foi feito. Reinicie antes." }, 409);

  const { results } = await env.DB.prepare("SELECT id FROM members").all();
  const ids = shuffle(results.map((r) => r.id));

  const insert = env.DB.prepare("INSERT INTO assignments (giver_id, receiver_id) VALUES (?, ?)");
  const statements = [
    env.DB.prepare("INSERT INTO draws DEFAULT VALUES"),
    ...ids.map((giver, i) => insert.bind(giver, ids[(i + 1) % ids.length])),
  ];

  try {
    await env.DB.batch(statements); // runs as one transaction
  } catch {
    // A double-click can start two draws at once; the unique keys make the second one fail.
    return json({ error: "O sorteio já foi feito." }, 409);
  }
  return json({ ok: true });
}

// Chats belong to a pairing, so they go too. Wishlists belong to people and stay.
async function adminReset(env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM messages"),
    env.DB.prepare("DELETE FROM assignments"),
  ]);
  return json({ ok: true });
}

// Fisher–Yates with crypto randomness and rejection sampling (no modulo bias).
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

// ---------- Helpers ----------

async function readJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
