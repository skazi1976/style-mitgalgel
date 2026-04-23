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
        headers: {
          "Content-Type": "application/json",
          "x-otp-secret": env.OTP_SECRET || "rolling-style-otp-2026",
        },
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

  // Fire-and-forget push to interested subscribers (don't block the response)
  const itemId = result.meta.last_row_id;
  sendPushForNewItem(env, {
    id: itemId, user_id: user.id, title, price, category,
    photos: JSON.stringify(photoUrls),
  }).catch((e) => console.error("push failed:", e.message));

  return json({ ok: true, id: itemId });
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
// Web Push (aes128gcm, VAPID)
// ============================================================

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concatBytes(...arrs) {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const _utf8 = (s) => new TextEncoder().encode(s);

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8
  );
  return new Uint8Array(bits);
}

async function vapidJWT(env, audience) {
  const header  = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "mailto:admin@rollingstyle.org",
  };
  const h = b64urlEncode(_utf8(JSON.stringify(header)));
  const p = b64urlEncode(_utf8(JSON.stringify(payload)));
  const toSign = _utf8(h + "." + p);

  const pubRaw = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: b64urlEncode(pubRaw.slice(1, 33)),
    y: b64urlEncode(pubRaw.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    ext: true,
  };
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, toSign
  ));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

async function sendWebPush(env, sub, payloadStr) {
  const payload  = _utf8(payloadStr);
  const p256dh   = b64urlDecode(sub.p256dh);
  const auth     = b64urlDecode(sub.auth);

  const serverKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKey.publicKey));
  const clientPubKey = await crypto.subtle.importKey(
    "raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPubKey }, serverKey.privateKey, 256
  ));

  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concatBytes(_utf8("WebPush: info\0"), p256dh, serverPubRaw);
  const ikm     = await hkdf(auth, sharedSecret, keyInfo, 32);
  const cek     = await hkdf(salt, ikm, _utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce   = await hkdf(salt, ikm, _utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concatBytes(payload, new Uint8Array([0x02]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, aesKey, padded
  ));

  // Header: salt(16) + rs(4, big-endian = 4096) + idlen(1=65) + keyid(serverPubRaw) + ciphertext
  const body = concatBytes(
    salt,
    new Uint8Array([0, 0, 0x10, 0]),
    new Uint8Array([serverPubRaw.length]),
    serverPubRaw,
    cipher,
  );

  const endpointURL = new URL(sub.endpoint);
  const jwt = await vapidJWT(env, endpointURL.origin);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "TTL": "86400",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });
  return res;
}

async function deliverPush(env, subscriptions, payloadObj) {
  const payloadStr = JSON.stringify(payloadObj);
  const results = await Promise.all(subscriptions.map(async (s) => {
    try {
      const r = await sendWebPush(env, s, payloadStr);
      if (r.status === 404 || r.status === 410) {
        // Gone — remove subscription
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(s.endpoint).run();
        return { ok: false, status: r.status, gone: true };
      }
      if (r.ok) {
        await env.DB.prepare("UPDATE push_subscriptions SET last_used = ?, failures = 0 WHERE endpoint = ?")
          .bind(now(), s.endpoint).run();
        return { ok: true, status: r.status };
      }
      await env.DB.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?")
        .bind(s.endpoint).run();
      return { ok: false, status: r.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }));
  return {
    total: subscriptions.length,
    sent: results.filter(r => r.ok).length,
    gone: results.filter(r => r.gone).length,
    failed: results.filter(r => !r.ok && !r.gone).length,
  };
}

// ============================================================
// Push subscriptions API
// ============================================================

async function pushSubscribe(req, env) {
  const body = await req.json().catch(() => ({}));
  const { endpoint, keys, categories } = body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return err("missing subscription fields");

  const user = await getUser(req, env);
  const userId = user?.id || null;
  const catsJson = categories ? JSON.stringify(categories) : null;
  const t = now();

  await env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, categories, created_at, last_used)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       categories = excluded.categories,
       last_used = excluded.last_used,
       failures = 0`
  ).bind(userId, endpoint, keys.p256dh, keys.auth, catsJson, t, t).run();

  return json({ ok: true });
}

async function pushUnsubscribe(req, env) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (!endpoint) return err("missing endpoint");
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
  return json({ ok: true });
}

async function sendPushForNewItem(env, item) {
  // Fetch subscriptions interested in this item's category (or unspecified = all)
  const { results } = await env.DB.prepare(
    `SELECT endpoint, p256dh, auth, categories
     FROM push_subscriptions
     WHERE user_id IS NULL OR user_id != ?`
  ).bind(item.user_id).all();

  const targets = results.filter((s) => {
    if (!s.categories) return true;
    try { return JSON.parse(s.categories).includes(item.category); }
    catch { return true; }
  });
  if (!targets.length) return { sent: 0 };

  const preview = (item.photos && JSON.parse(item.photos)[0]) || undefined;
  const payload = {
    title: "פריט חדש בסטייל מתגלגל 💃",
    body:  `${item.title} — ₪${item.price}`,
    url:   `/item.html?id=${item.id}`,
    icon:  "/icon-192.png",
    badge: "/icon-192.png",
    image: preview,
    tag:   `item-${item.id}`,
  };
  return await deliverPush(env, targets, payload);
}

// ============================================================
// Admin API
// ============================================================

function requireAdmin(req, env) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("AdminPass ")) return false;
  const provided = auth.slice(10);
  const expected = env.ADMIN_PASSWORD || "";
  if (!expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function adminLogin(req, env) {
  const { password } = await req.json().catch(() => ({}));
  if (!env.ADMIN_PASSWORD) return err("admin not configured", 500);
  if (password !== env.ADMIN_PASSWORD) return err("סיסמה שגויה", 401);
  return json({ ok: true });
}

async function adminStats(env) {
  const q = (sql) => env.DB.prepare(sql).first();
  const [u, items, act, sold, hid, rep, views, favs] = await Promise.all([
    q("SELECT COUNT(*) c FROM users"),
    q("SELECT COUNT(*) c FROM items"),
    q("SELECT COUNT(*) c FROM items WHERE status='active'"),
    q("SELECT COUNT(*) c FROM items WHERE status='sold'"),
    q("SELECT COUNT(*) c FROM items WHERE status='hidden'"),
    q("SELECT COUNT(*) c FROM reports WHERE resolved=0"),
    q("SELECT COALESCE(SUM(views),0) c FROM items"),
    q("SELECT COUNT(*) c FROM favorites"),
  ]);
  return json({
    users: u.c, items: items.c, active: act.c, sold: sold.c, hidden: hid.c,
    reports_open: rep.c, views: views.c, favorites: favs.c,
  });
}

async function adminUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, phone, name, city, created_at, last_active,
            items_listed, items_sold, rating, banned
     FROM users ORDER BY created_at DESC LIMIT 500`
  ).all();
  return json({ users: results });
}

async function adminBanUser(env, id) {
  await env.DB.prepare("UPDATE users SET banned = 1 - banned WHERE id = ?").bind(id).run();
  const u = await env.DB.prepare("SELECT id, banned FROM users WHERE id = ?").bind(id).first();
  if (!u) return err("not found", 404);
  if (u.banned) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  return json({ ok: true, banned: !!u.banned });
}

async function adminDeleteUser(env, id) {
  await env.DB.prepare("DELETE FROM favorites WHERE user_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM sessions  WHERE user_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM items     WHERE user_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM users     WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function adminItems(env, url) {
  const status = url.searchParams.get("status");
  const where = status ? "WHERE i.status = ?" : "";
  const bind  = status ? [status] : [];
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.title, i.price, i.category, i.condition, i.status,
            i.photos, i.views, i.favorites_count, i.created_at,
            u.id AS user_id, u.name AS seller_name, u.phone AS seller_phone
     FROM items i LEFT JOIN users u ON u.id = i.user_id
     ${where}
     ORDER BY i.created_at DESC LIMIT 500`
  ).bind(...bind).all();
  return json({
    items: results.map((r) => ({ ...r, photos: JSON.parse(r.photos || "[]") })),
  });
}

async function adminPatchItem(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const allowed = ["title", "price", "status", "category", "brand", "size", "city", "description"];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if (!sets.length) return err("no fields", 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true });
}

async function adminDeleteItem(env, id) {
  await env.DB.prepare("DELETE FROM favorites WHERE item_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM reports   WHERE item_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM items     WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function adminReports(env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.reason, r.created_at, r.resolved,
            r.item_id, i.title AS item_title,
            r.reporter_id, u.name AS reporter_name
     FROM reports r
     LEFT JOIN items i ON i.id = r.item_id
     LEFT JOIN users u ON u.id = r.reporter_id
     ORDER BY r.resolved ASC, r.created_at DESC LIMIT 500`
  ).all();
  return json({ reports: results });
}

async function adminResolveReport(env, id) {
  await env.DB.prepare("UPDATE reports SET resolved = 1 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function adminPushBroadcast(req, env) {
  const body = await req.json().catch(() => ({}));
  const { title, message, url, category } = body;
  if (!title || !message) return err("title and message required");

  let sql = "SELECT endpoint, p256dh, auth, categories FROM push_subscriptions";
  const { results } = await env.DB.prepare(sql).all();

  const targets = category
    ? results.filter((s) => {
        if (!s.categories) return true;
        try { return JSON.parse(s.categories).includes(category); } catch { return true; }
      })
    : results;

  const payload = {
    title,
    body: message,
    url: url || "/",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "broadcast-" + now(),
  };
  const stats = await deliverPush(env, targets, payload);
  return json({ ok: true, ...stats });
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

      // Web Push
      if (path === "/api/push/vapid-public" && method === "GET") {
        return json({ key: env.VAPID_PUBLIC_KEY || "" });
      }
      if (path === "/api/push/subscribe"   && method === "POST")   return await pushSubscribe(req, env);
      if (path === "/api/push/unsubscribe" && method === "POST")   return await pushUnsubscribe(req, env);

      // Admin API
      if (path.startsWith("/api/admin/")) {
        if (path === "/api/admin/login" && method === "POST") return await adminLogin(req, env);
        if (!requireAdmin(req, env)) return err("unauthorized", 401);

        if (path === "/api/admin/stats"   && method === "GET") return await adminStats(env);
        if (path === "/api/admin/users"   && method === "GET") return await adminUsers(env);
        if (path === "/api/admin/items"   && method === "GET") return await adminItems(env, url);
        if (path === "/api/admin/reports" && method === "GET") return await adminReports(env);
        if (path === "/api/admin/push/broadcast" && method === "POST") return await adminPushBroadcast(req, env);

        let m;
        if ((m = path.match(/^\/api\/admin\/users\/(\d+)\/ban$/)) && method === "POST")
          return await adminBanUser(env, parseInt(m[1]));
        if ((m = path.match(/^\/api\/admin\/users\/(\d+)$/)) && method === "DELETE")
          return await adminDeleteUser(env, parseInt(m[1]));

        if ((m = path.match(/^\/api\/admin\/items\/(\d+)$/))) {
          const id = parseInt(m[1]);
          if (method === "PATCH")  return await adminPatchItem(req, env, id);
          if (method === "DELETE") return await adminDeleteItem(env, id);
        }

        if ((m = path.match(/^\/api\/admin\/reports\/(\d+)\/resolve$/)) && method === "POST")
          return await adminResolveReport(env, parseInt(m[1]));

        return err("not found", 404);
      }

      // Fall through to static assets
      return env.ASSETS ? env.ASSETS.fetch(req) : err("not found", 404);
    } catch (e) {
      console.error(e);
      return err("שגיאת שרת: " + e.message, 500);
    }
  },
};
