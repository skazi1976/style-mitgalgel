/**
 * Style Mitgalgel — C2C Fashion Marketplace
 * Cloudflare Worker API
 *
 * Endpoints:
 *   POST /api/auth/request-otp   { phone }
 *   POST /api/auth/verify-otp    { phone, code, name? }
 *   POST /api/auth/logout
 *   GET  /api/me
 *
 *   GET  /api/items                     ?q=&category=&size=&brand=&min=&max=&city=&page=
 *   GET  /api/items/:id
 *   POST /api/items                     (auth) multipart/form-data: photos[] + json fields
 *   PATCH /api/items/:id                (auth, owner) update status / fields
 *   DELETE /api/items/:id               (auth, owner)
 *
 *   POST /api/items/:id/favorite        (auth) toggle
 *   GET  /api/me/favorites              (auth)
 *   GET  /api/me/items                  (auth)
 *
 *   POST /api/items/:id/report          { reason }
 *   POST /api/items/:id/view            (anon — increments views)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });

const err = (msg, status = 400) => json({ error: msg }, status);

// ============================================================
// Helpers
// ============================================================

function now() { return Math.floor(Date.now() / 1000); }

function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function genToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("0")) p = "972" + p.slice(1);
  if (p.startsWith("972") && p.length >= 11 && p.length <= 12) return p;
  return null;
}

async function getUser(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const sess = await env.DB.prepare(
    "SELECT user_id, expires_at FROM sessions WHERE token = ?"
  ).bind(token).first();
  if (!sess || sess.expires_at < now()) return null;
  const user = await env.DB.prepare(
    "SELECT id, phone, name, city, items_listed, items_sold, rating, banned FROM users WHERE id = ?"
  ).bind(sess.user_id).first();
  if (!user || user.banned) return null;
  return user;
}

async function sendWhatsAppOTP(env, phone, code) {
  // Calls the local Baileys bot to send WhatsApp message
  // For now we just log; if WHATSAPP_BOT_URL is set we POST to it
  const msg = `הקוד שלך לסטייל מתגלגל: *${code}*\n\nתקף ל-5 דקות. אם לא בקשת — התעלמי.`;
  if (env.WHATSAPP_BOT_URL) {
    try {
      await fetch(env.WHATSAPP_BOT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: msg }),
      });
    } catch (e) {
      console.error("WA bot error:", e.message);
    }
  } else {
    console.log(`[OTP DEV] ${phone} → ${code}`);
  }
}

// ============================================================
// Auth handlers
// ============================================================

async function requestOtp(req, env) {
  const { phone: rawPhone } = await req.json().catch(() => ({}));
  const phone = normalizePhone(rawPhone);
  if (!phone) return err("מספר טלפון לא תקין");

  const code = genCode();
  const expires = now() + 300; // 5 min

  await env.DB.prepare(
    `INSERT INTO otp_codes (phone, code, expires_at, attempts)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(phone) DO UPDATE SET code = ?, expires_at = ?, attempts = 0`
  ).bind(phone, code, expires, code, expires).run();

  await sendWhatsAppOTP(env, phone, code);

  return json({ ok: true, phone, expires_at: expires });
}

async function verifyOtp(req, env) {
  const { phone: rawPhone, code, name } = await req.json().catch(() => ({}));
  const phone = normalizePhone(rawPhone);
  if (!phone || !code) return err("חסרים פרטים");

  const row = await env.DB.prepare(
    "SELECT code, expires_at, attempts FROM otp_codes WHERE phone = ?"
  ).bind(phone).first();

  if (!row) return err("לא נשלח קוד למספר הזה");
  if (row.attempts >= 5) return err("יותר מדי ניסיונות, בקשי קוד חדש", 429);
  if (row.expires_at < now()) return err("הקוד פג תוקף", 410);
  if (row.code !== code.toString()) {
    await env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?")
      .bind(phone).run();
    return err("קוד שגוי");
  }

  // Code OK — find/create user
  let user = await env.DB.prepare("SELECT id, name FROM users WHERE phone = ?").bind(phone).first();

  if (!user) {
    if (!name || name.trim().length < 2) return err("נדרש שם להרשמה ראשונה");
    const ts = now();
    const result = await env.DB.prepare(
      "INSERT INTO users (phone, name, created_at, last_active) VALUES (?, ?, ?, ?)"
    ).bind(phone, name.trim(), ts, ts).run();
    user = { id: result.meta.last_row_id, name: name.trim() };
  } else {
    await env.DB.prepare("UPDATE users SET last_active = ? WHERE id = ?")
      .bind(now(), user.id).run();
  }

  // Create session (30 days)
  const token = genToken();
  const expires = now() + 30 * 86400;
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, user.id, now(), expires).run();

  // Clean up OTP
  await env.DB.prepare("DELETE FROM otp_codes WHERE phone = ?").bind(phone).run();

  return json({ ok: true, token, user: { id: user.id, name: user.name, phone } });
}

async function logout(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true });
}

async function me(req, env) {
  const user = await getUser(req, env);
  if (!user) return err("לא מחוברת", 401);
  return json({ user });
}

// ============================================================
// Items handlers
// ============================================================

async function listItems(req, env, url) {
  const q = url.searchParams.get("q")?.trim() || "";
  const category = url.searchParams.get("category");
  const size = url.searchParams.get("size");
  const brand = url.searchParams.get("brand");
  const city = url.searchParams.get("city");
  const min = parseInt(url.searchParams.get("min") || "0");
  const max = parseInt(url.searchParams.get("max") || "999999");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = 24;
  const offset = (page - 1) * limit;

  let sql = `
    SELECT i.id, i.title, i.price, i.brand, i.size, i.category, i.condition,
           i.photos, i.city, i.created_at, i.views, i.favorites_count,
           u.name AS seller_name
    FROM items i
    JOIN users u ON u.id = i.user_id
    WHERE i.status = 'active' AND u.banned = 0 AND i.price BETWEEN ? AND ?
  `;
  const binds = [min, max];

  if (q) {
    sql += " AND (i.title LIKE ? OR i.description LIKE ? OR i.brand LIKE ?)";
    const w = `%${q}%`;
    binds.push(w, w, w);
  }
  if (category) { sql += " AND i.category = ?"; binds.push(category); }
  if (size)     { sql += " AND i.size = ?"; binds.push(size); }
  if (brand)    { sql += " AND i.brand LIKE ?"; binds.push(`%${brand}%`); }
  if (city)     { sql += " AND i.city = ?"; binds.push(city); }

  sql += " ORDER BY i.created_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();

  // Parse photos JSON for each
  const items = results.map(r => ({ ...r, photos: JSON.parse(r.photos || "[]") }));

  return json({ items, page, has_more: items.length === limit });
}

async function getItem(req, env, id) {
  const item = await env.DB.prepare(`
    SELECT i.*, u.name AS seller_name, u.phone AS seller_phone, u.rating AS seller_rating,
           u.items_sold AS seller_items_sold, u.created_at AS seller_joined
    FROM items i
    JOIN users u ON u.id = i.user_id
    WHERE i.id = ? AND u.banned = 0
  `).bind(id).first();

  if (!item) return err("פריט לא נמצא", 404);
  item.photos = JSON.parse(item.photos || "[]");
  return json({ item });
}

async function viewItem(req, env, id) {
  await env.DB.prepare("UPDATE items SET views = views + 1 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function createItem(req, env) {
  const user = await getUser(req, env);
  if (!user) return err("לא מחוברת", 401);

  const form = await req.formData();
  const title = form.get("title")?.toString().trim();
  const description = form.get("description")?.toString().trim() || "";
  const price = parseInt(form.get("price"));
  const brand = form.get("brand")?.toString().trim() || "";
  const size = form.get("size")?.toString().trim() || "";
  const category = form.get("category")?.toString().trim();
  const condition = form.get("condition")?.toString().trim();
  const city = form.get("city")?.toString().trim() || user.city || "";

  if (!title || title.length < 3) return err("כותרת חסרה");
  if (!price || price < 1 || price > 999999) return err("מחיר לא תקין");
  if (!category) return err("חסרה קטגוריה");
  if (!condition) return err("חסר מצב הפריט");

  // Upload photos to R2
  const photos = form.getAll("photos").filter(f => f instanceof File);
  if (photos.length === 0) return err("צריך לפחות תמונה אחת");
  if (photos.length > 5) return err("עד 5 תמונות");

  const photoUrls = [];
  for (const file of photos) {
    if (file.size > 5 * 1024 * 1024) return err("תמונה גדולה מ-5MB");
    if (!file.type.startsWith("image/")) return err("רק תמונות");
    const ext = file.type.split("/")[1] || "jpg";
    const key = `items/${user.id}/${now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await env.PHOTOS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    photoUrls.push(`/photos/${key}`);
  }

  const result = await env.DB.prepare(`
    INSERT INTO items (user_id, title, description, price, brand, size, category, condition, photos, city, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(user.id, title, description, price, brand, size, category, condition,
    JSON.stringify(photoUrls), city, now()).run();

  await env.DB.prepare("UPDATE users SET items_listed = items_listed + 1 WHERE id = ?")
    .bind(user.id).run();

  return json({ ok: true, id: result.meta.last_row_id });
}

async function patchItem(req, env, id) {
  const user = await getUser(req, env);
  if (!user) return err("לא מחוברת", 401);

  const item = await env.DB.prepare("SELECT user_id FROM items WHERE id = ?").bind(id).first();
  if (!item) return err("פריט לא נמצא", 404);
  if (item.user_id !== user.id) return err("אין הרשאה", 403);

  const body = await req.json().catch(() => ({}));
  const allowed = ["title", "description", "price", "brand", "size", "category", "condition", "city", "status"];
  const sets = [];
  const binds = [];
  for (const k of allowed) {
    if (k in body) { sets.push(`${k} = ?`); binds.push(body[k]); }
  }
  if (sets.length === 0) return err("שום דבר לעדכן");

  if (body.status === "sold") sets.push("sold_at = " + now());

  binds.push(id);
  await env.DB.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  if (body.status === "sold") {
    await env.DB.prepare("UPDATE users SET items_sold = items_sold + 1 WHERE id = ?")
      .bind(user.id).run();
  }

  return json({ ok: true });
}

async function deleteItem(req, env, id) {
  const user = await getUser(req, env);
  if (!user) return err("לא מחוברת", 401);
  const item = await env.DB.prepare("SELECT user_id, photos FROM items WHERE id = ?").bind(id).first();
  if (!item) return err("פריט לא נמצא", 404);
  if (item.user_id !== user.id) return err("אין הרשאה", 403);

  // Delete photos from R2
  const photos = JSON.parse(item.photos || "[]");
  for (const url of photos) {
    const key = url.replace(/^\/photos\//, "");
    await env.PHOTOS.delete(key).catch(() => {});
  }

  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ============================================================
// Favorites
// ============================================================

async function toggleFavorite(req, env, itemId) {
  const user = await getUser(req, env);
  if (!user) return err("לא מחוברת", 401);

  const existing = await env.DB.prepare(
    "SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?"
  ).bind(user.id, itemId).first();

  if (existing) {
    await env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND item_id = ?")
      .bind(user.id, itemId).run();
    await env.DB.prepare("UPDATE items SET favorites_count = MAX(0, favorites_count - 1) WHERE id = ?")
      .bind(itemId).run();
    return json({ favorited: false });
  } else {
    await env.DB.prepare("INSERT INTO favorites (user_id, item_id, created_at) VALUES (?, ?, ?)")
      .bind(user.id, itemId, now()).run();
    await env.DB.prepare("UPDATE items SET favorites_count = favorites_count + 1 WHERE id = ?")
      .bind(itemId).run();
    return json({ favorited: true });
  }
}

async function myFavorites(req, env) {
  const user = await getUser(req, env);
  if (!user) return err("לא מחוברת", 401);
  const { results } = await env.DB.prepare(`
    SELECT i.id, i.title, i.price, i.photos, i.status, i.brand, i.size
    FROM favorites f
    JOIN items i ON i.id = f.item_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).bind(user.id).all();
  const items = results.map(r => ({ ...r, photos: JSON.parse(r.photos || "[]") }));
  return json({ items });
}

async function myItems(req, env) {
  const user = await getUser(req, env);
  if (!user) return err("לא מחוברת", 401);
  const { results } = await env.DB.prepare(`
    SELECT id, title, price, photos, status, views, favorites_count, created_at
    FROM items WHERE user_id = ? ORDER BY created_at DESC
  `).bind(user.id).all();
  const items = results.map(r => ({ ...r, photos: JSON.parse(r.photos || "[]") }));
  return json({ items });
}

// ============================================================
// Reports
// ============================================================

async function reportItem(req, env, itemId) {
  const user = await getUser(req, env);
  const { reason } = await req.json().catch(() => ({}));
  if (!reason) return err("חסרה סיבה");
  await env.DB.prepare(
    "INSERT INTO reports (reporter_id, item_id, reason, created_at) VALUES (?, ?, ?, ?)"
  ).bind(user?.id || null, itemId, reason, now()).run();
  return json({ ok: true });
}

// ============================================================
// R2 photo serving
// ============================================================

async function servePhoto(env, key) {
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000",
      ...CORS,
    },
  });
}

// ============================================================
// Router
// ============================================================

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // Photos
      if (path.startsWith("/photos/")) {
        const key = path.slice(8);
        return await servePhoto(env, key);
      }

      // Auth
      if (path === "/api/auth/request-otp" && method === "POST") return await requestOtp(req, env);
      if (path === "/api/auth/verify-otp"  && method === "POST") return await verifyOtp(req, env);
      if (path === "/api/auth/logout"      && method === "POST") return await logout(req, env);
      if (path === "/api/me"               && method === "GET")  return await me(req, env);

      // Items collection
      if (path === "/api/items" && method === "GET")  return await listItems(req, env, url);
      if (path === "/api/items" && method === "POST") return await createItem(req, env);

      // Item by id
      const itemMatch = path.match(/^\/api\/items\/(\d+)(?:\/(\w+))?$/);
      if (itemMatch) {
        const id = parseInt(itemMatch[1]);
        const sub = itemMatch[2];
        if (!sub && method === "GET")    return await getItem(req, env, id);
        if (!sub && method === "PATCH")  return await patchItem(req, env, id);
        if (!sub && method === "DELETE") return await deleteItem(req, env, id);
        if (sub === "view"     && method === "POST") return await viewItem(req, env, id);
        if (sub === "favorite" && method === "POST") return await toggleFavorite(req, env, id);
        if (sub === "report"   && method === "POST") return await reportItem(req, env, id);
      }

      if (path === "/api/me/favorites" && method === "GET") return await myFavorites(req, env);
      if (path === "/api/me/items"     && method === "GET") return await myItems(req, env);

      // Fall through to static assets
      return env.ASSETS ? env.ASSETS.fetch(req) : err("not found", 404);
    } catch (e) {
      console.error(e);
      return err("שגיאת שרת: " + e.message, 500);
    }
  },
};
