export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      let db = false;
      try {
        await env.DB.prepare("SELECT 1").first();
        db = true;
      } catch {}
      return Response.json({ ok: db, db, adminKeySet: Boolean(env.ADMIN_KEY) });
    }

    return new Response("Not found", { status: 404 });
  },
};
