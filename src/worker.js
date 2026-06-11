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

// Vonage Verify v1 — managed OTP. Vonage generates the code, sends it, and we
// validate via /verify/check/json. ~$0.05 per SUCCESSFUL verification (5x
// cheaper than raw SMS-to-Israel which costs $0.25/message). Failed/abandoned
// flows cost nothing.
async function vonageVerifyStart(env, phone) {
  if (!env.VONAGE_API_KEY || !env.VONAGE_API_SECRET) {
    console.log(`[OTP DEV] would verify ${phone}`);
    return { ok: true, request_id: "dev-mock", channel: "dev" };
  }
  const params = new URLSearchParams({
    api_key: env.VONAGE_API_KEY,
    api_secret: env.VONAGE_API_SECRET,
    number: phone,
    brand: "RollingStyl",
    code_length: "6",
    pin_expiry: "300", // 5 min
    workflow_id: "6", // SMS-only (no voice fallback)
    lg: "he-il",
  });
  try {
    const r = await fetch("https://api.nexmo.com/verify/json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await r.json();
    if (data.status === "0" && data.request_id) {
      console.log(`[OTP] Verify started ${phone} → ${data.request_id}`);
      return { ok: true, request_id: data.request_id, channel: "sms" };
    }
    console.error(`[OTP] Verify start error: ${data.status} ${data.error_text}`);
    return { ok: false, error: data.error_text || "Vonage verify start failed" };
  } catch (e) {
    console.error("[OTP] Verify fetch threw:", e.message);
    return { ok: false, error: e.message };
  }
}

async function vonageVerifyCheck(env, requestId, code) {
  if (!env.VONAGE_API_KEY || !env.VONAGE_API_SECRET) {
    // Dev: any 6-digit code passes
    return { ok: /^\d{6}$/.test(code) };
  }
  const params = new URLSearchParams({
    api_key: env.VONAGE_API_KEY,
    api_secret: env.VONAGE_API_SECRET,
    request_id: requestId,
    code,
  });
  try {
    const r = await fetch("https://api.nexmo.com/verify/check/json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await r.json();
    if (data.status === "0") {
      console.log(`[OTP] Verify check OK ${requestId}`);
      return { ok: true };
    }
    console.error(`[OTP] Verify check failed: ${data.status} ${data.error_text}`);
    return { ok: false, error: data.error_text || "קוד שגוי", status: data.status };
  } catch (e) {
    console.error("[OTP] Verify check threw:", e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// Auth handlers
// ============================================================

// Demo account for Google Play reviewers + closed-testing testers (PrimeTestLab).
// Google Sign-In + Vonage SMS often fail in closed testing, so this fixed
// phone+code pair bypasses both — testers can always get into the app.
const DEMO_PHONE = "972500000000"; // entered as 0500000000
const DEMO_CODE = "123456";

async function requestOtp(req, env) {
  const { phone: rawPhone } = await req.json().catch(() => ({}));
  const phone = normalizePhone(rawPhone);
  if (!phone) return err("מספר טלפון לא תקין");

  // Demo account — skip Vonage entirely, no SMS sent
  if (phone === DEMO_PHONE) {
    return json({ ok: true, phone, expires_at: now() + 600, channel: "demo" });
  }

  // Ask Vonage Verify to send the code. Vonage owns code generation +
  // delivery + retry; we just store the request_id so verify-otp can check.
  const result = await vonageVerifyStart(env, phone);
  if (!result.ok) {
    return err(`שליחת SMS נכשלה: ${result.error || "שגיאה"}`, 502);
  }

  const expires = now() + 300;
  // Reuse otp_codes table — `code` column holds Vonage request_id
  await env.DB.prepare(
    `INSERT INTO otp_codes (phone, code, expires_at, attempts, verified)
     VALUES (?, ?, ?, 0, 0)
     ON CONFLICT(phone) DO UPDATE SET code = ?, expires_at = ?, attempts = 0, verified = 0`
  ).bind(phone, result.request_id, expires, result.request_id, expires).run();

  return json({ ok: true, phone, expires_at: expires, channel: result.channel });
}

// Sanitize a client-supplied signup source (utm_source). Short, safe, nullable.
function cleanSource(s) {
  if (typeof s !== "string") return null;
  const v = s.trim().toLowerCase().slice(0, 40).replace(/[^a-z0-9_\-.]/g, "");
  return v || null;
}
// Sanitize a utm_campaign value (which ad). Slightly looser than source.
function cleanCampaign(s) {
  if (typeof s !== "string") return null;
  const v = s.trim().slice(0, 60).replace(/[^a-zA-Z0-9_\-. ]/g, "");
  return v || null;
}

// Logs an anonymous landing visit that carried a utm_source (e.g. a Facebook
// ad click), so the admin can measure total traffic per channel — including
// visitors who never registered. One row per browser session (client dedups).
async function trackVisit(req, env) {
  const { source, campaign, path } = await req.json().catch(() => ({}));
  const src = cleanSource(source);
  if (!src) return json({ ok: true }); // only count tagged traffic
  const camp = (typeof campaign === "string" ? campaign : "").slice(0, 60) || null;
  const p = (typeof path === "string" ? path : "").slice(0, 120) || null;
  try {
    await env.DB.prepare(
      "INSERT INTO visits (source, campaign, path, ts) VALUES (?, ?, ?, ?)"
    ).bind(src, camp, p, now()).run();
  } catch (e) {}
  return json({ ok: true });
}

async function verifyOtp(req, env) {
  const { phone: rawPhone, code, name, source, campaign } = await req.json().catch(() => ({}));
  const signupSource = cleanSource(source);
  const signupCampaign = cleanCampaign(campaign);
  const phone = normalizePhone(rawPhone);
  if (!phone || !code) return err("חסרים פרטים");

  // Demo account — fixed code, no Vonage, no SMS. For closed-testing testers.
  if (phone === DEMO_PHONE && code.toString() === DEMO_CODE) {
    let demoUser = await env.DB.prepare("SELECT id, name FROM users WHERE phone = ?").bind(phone).first();
    if (!demoUser) {
      const ts = now();
      const r = await env.DB.prepare(
        "INSERT INTO users (phone, name, created_at, last_active) VALUES (?, ?, ?, ?)"
      ).bind(phone, "חשבון דמו", ts, ts).run();
      demoUser = { id: r.meta.last_row_id, name: "חשבון דמו" };
    } else {
      await env.DB.prepare("UPDATE users SET last_active = ? WHERE id = ?").bind(now(), demoUser.id).run();
    }
    const demoToken = genToken();
    await env.DB.prepare(
      "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(demoToken, demoUser.id, now(), now() + 30 * 86400).run();
    return json({ ok: true, token: demoToken, user: { id: demoUser.id, name: demoUser.name, phone } });
  }

  // The "code" column now holds the Vonage Verify request_id (not the user code)
  const row = await env.DB.prepare(
    "SELECT code, expires_at, attempts, verified FROM otp_codes WHERE phone = ?"
  ).bind(phone).first();

  if (!row) return err("לא נשלח קוד למספר הזה");
  if (row.attempts >= 5) return err("יותר מדי ניסיונות, בקשי קוד חדש", 429);
  if (row.expires_at < now()) return err("הקוד פג תוקף", 410);

  // A Vonage Verify request_id is SINGLE-USE: once /check succeeds it's consumed,
  // and a second /check returns "already verified" (status 6). For first-time
  // signup we verify the code BEFORE we have the name, so we remember that the
  // phone was verified and skip the re-check on the follow-up call (with the name).
  if (!row.verified) {
    const checkResult = await vonageVerifyCheck(env, row.code, code.toString());
    if (!checkResult.ok) {
      await env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?")
        .bind(phone).run();
      // Map Vonage status codes to friendly Hebrew (never show raw English to users).
      const st = String(checkResult.status || "");
      let msg = "האימות נכשל, נסי שוב";
      if (st === "16")      msg = "הקוד שגוי. בדקי שוב 🔢";
      else if (st === "6")  msg = "הקוד פג תוקף או כבר שומש — בקשי קוד חדש 🔄";
      else if (st === "17") msg = "יותר מדי ניסיונות — בקשי קוד חדש";
      return err(msg);
    }
    // Mark verified so a follow-up call (e.g. after entering the name) won't re-check.
    await env.DB.prepare("UPDATE otp_codes SET verified = 1 WHERE phone = ?").bind(phone).run();
  }

  // Code OK — find/create user
  let user = await env.DB.prepare("SELECT id, name FROM users WHERE phone = ?").bind(phone).first();
  const isNew = !user;

  if (!user) {
    if (!name || name.trim().length < 2) return err("נדרש שם להרשמה ראשונה");
    const ts = now();
    const result = await env.DB.prepare(
      "INSERT INTO users (phone, name, created_at, last_active, signup_source, signup_campaign) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(phone, name.trim(), ts, ts, signupSource, signupCampaign).run();
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

  return json({ ok: true, token, isNew, user: { id: user.id, name: user.name, phone } });
}

// Verifies a Firebase ID token (Phone Auth OR Google Sign-In) and issues a
// session. Phone Auth tokens carry phoneNumber; Google tokens carry email +
// displayName. The schema requires phone NOT NULL, so Google users get a
// stable placeholder phone of "google:<localId>" (won't collide with real
// numeric phones). Returning users are matched by email first, phone second.
async function firebaseLogin(req, env) {
  const { idToken, name: bodyName, source, campaign } = await req.json().catch(() => ({}));
  if (!idToken) return err("חסר טוקן");
  const signupSource = cleanSource(source);
  const signupCampaign = cleanCampaign(campaign);

  const apiKey = env.FIREBASE_API_KEY || "AIzaSyChT4d_9aS3hJx6hoyqzta2uIL0Bwc5PhI";
  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!lookupRes.ok) return err("אימות נכשל", 401);
  const data = await lookupRes.json().catch(() => ({}));
  const fbUser = data.users?.[0];
  if (!fbUser) return err("טוקן לא תקין", 401);

  const rawPhone = fbUser.phoneNumber;
  const email = (fbUser.email || "").toLowerCase().trim();
  const fbName = fbUser.displayName || bodyName || "";

  // Determine the identity for our DB
  let phone = null;
  let user = null;

  if (rawPhone) {
    // Phone Auth path
    phone = normalizePhone(rawPhone);
    if (!phone) return err("מספר טלפון לא תקין");
    user = await env.DB.prepare(
      "SELECT id, name FROM users WHERE phone = ?",
    ).bind(phone).first();
  } else if (email) {
    // Google path — match by email first, then create with placeholder phone
    user = await env.DB.prepare(
      "SELECT id, name, phone FROM users WHERE email = ?",
    ).bind(email).first();
    if (!user) {
      // Stable per-Google-user placeholder; localId is a Firebase UID
      phone = `google:${fbUser.localId}`;
    } else {
      phone = user.phone; // existing user, keep their stored phone
    }
  } else {
    return err("טוקן ללא מספר טלפון או אימייל", 401);
  }

  const isNew = !user;

  if (!user) {
    const finalName = (fbName || bodyName || "").trim();
    if (!finalName || finalName.length < 2) {
      return err("נדרש שם להרשמה ראשונה");
    }
    const ts = now();
    const result = await env.DB.prepare(
      `INSERT INTO users (phone, email, name, created_at, last_active, signup_source, signup_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(phone, email || null, finalName, ts, ts, signupSource, signupCampaign).run();
    user = { id: result.meta.last_row_id, name: finalName };
  } else {
    await env.DB.prepare(
      "UPDATE users SET last_active = ? WHERE id = ?",
    ).bind(now(), user.id).run();
  }

  const token = genToken();
  const expires = now() + 30 * 86400;
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(token, user.id, now(), expires).run();

  return json({
    ok: true,
    token,
    isNew,
    user: { id: user.id, name: user.name, phone, email: email || null },
  });
}

async function logout(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true });
}

async function me(req, env) {
  const user = await getUser(req, env);
  if (!user) return err("פג תוקף ההתחברות, התחברי שוב", 401);
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

// Records a WhatsApp "contact seller" click for an item — so sellers/admin can see
// which listings actually drive contacts (not just views). Auth is optional.
async function contactItem(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const user = await getUser(req, env);
  await env.DB.prepare("UPDATE items SET whatsapp_contacts = whatsapp_contacts + 1 WHERE id = ?").bind(id).run();
  await env.DB.prepare(
    "INSERT INTO contact_events (item_id, user_id, device_id, created_at) VALUES (?, ?, ?, ?)"
  ).bind(id, user?.id || null, body.device_id || null, now()).run();
  return json({ ok: true });
}

const MAX_ACTIVE_ITEMS_PER_USER = 5;

async function createItem(req, env) {
  const user = await getUser(req, env);
  if (!user) return err("פג תוקף ההתחברות, התחברי שוב", 401);

  // Limit: max 5 active items per user
  const { c: activeCount } = await env.DB.prepare(
    "SELECT COUNT(*) c FROM items WHERE user_id = ? AND status = 'active'"
  ).bind(user.id).first();
  if (activeCount >= MAX_ACTIVE_ITEMS_PER_USER) {
    return err(`הגעת למגבלה — מותר עד ${MAX_ACTIVE_ITEMS_PER_USER} פריטים פעילים. סמני פריט כ"נמכר" או הסתירי כדי להעלות פריט חדש.`, 403);
  }

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
  if (!city) return err("חסר אזור");

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
  if (!user) return err("פג תוקף ההתחברות, התחברי שוב", 401);

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
  if (!user) return err("פג תוקף ההתחברות, התחברי שוב", 401);
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
  if (!user) return err("פג תוקף ההתחברות, התחברי שוב", 401);

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
  if (!user) return err("פג תוקף ההתחברות, התחברי שוב", 401);
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
  if (!user) return err("פג תוקף ההתחברות, התחברי שוב", 401);
  const { results } = await env.DB.prepare(`
    SELECT id, title, price, photos, status, views, favorites_count, whatsapp_contacts, created_at
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
  const pk = (env.VAPID_PRIVATE_KEY || "").trim();
  console.log("vapid d length", pk.length, "public length", (env.VAPID_PUBLIC_KEY || "").length);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: b64urlEncode(pubRaw.slice(1, 33)),
    y: b64urlEncode(pubRaw.slice(33, 65)),
    d: pk,
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
      // High urgency → FCM delivers promptly even when the device is in Doze /
      // aggressive battery-saver (e.g. Samsung), instead of batching the message.
      "Urgency": "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });
  return res;
}

async function deliverPush(env, subscriptions, payloadObj, campaignId) {
  const results = await Promise.all(subscriptions.map(async (s) => {
    try {
      // Per-recipient payload: bake in userId so we know who clicked
      const perPayload = { ...payloadObj };
      if (campaignId) perPayload.campaignId = campaignId;
      if (s.user_id != null) perPayload.userId = s.user_id;
      const payloadStr = JSON.stringify(perPayload);
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
      const bodyText = await r.text().catch(() => "");
      console.log("push non-ok", r.status, bodyText.slice(0, 200), s.endpoint.slice(0, 60));
      await env.DB.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?")
        .bind(s.endpoint).run();
      return { ok: false, status: r.status, body: bodyText.slice(0, 200) };
    } catch (e) {
      console.log("push exception", e.message, s.endpoint.slice(0, 60));
      return { ok: false, error: e.message };
    }
  }));
  return {
    total: subscriptions.length,
    sent: results.filter(r => r.ok).length,
    gone: results.filter(r => r.gone).length,
    failed: results.filter(r => !r.ok && !r.gone).length,
    errors: results.filter(r => !r.ok).map(r => ({ status: r.status, error: r.error, body: r.body })).slice(0, 3),
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

async function recordPushClick(req, env) {
  const body = await req.json().catch(() => ({}));
  const { campaignId, userId, url } = body || {};
  if (!campaignId) return err("missing campaignId");
  const ua = (req.headers.get("User-Agent") || "").slice(0, 500);
  const uid = (userId === null || userId === undefined) ? null : Number(userId);
  await env.DB.prepare(
    `INSERT INTO push_clicks (campaign_id, user_id, url, user_agent, clicked_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(campaignId, Number.isFinite(uid) ? uid : null, url || null, ua, now()).run();
  return json({ ok: true });
}

async function sendPushForNewItem(env, item) {
  // Fetch subscriptions interested in this item's category (or unspecified = all)
  const { results } = await env.DB.prepare(
    `SELECT endpoint, p256dh, auth, categories, user_id
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
  const campaignId = `item-${item.id}-${now()}`;
  const payload = {
    title: "פריט חדש בסטייל מתגלגל 💃",
    body:  `${item.title} — ₪${item.price}`,
    url:   `/item.html?id=${item.id}`,
    icon:  "/icon-192.png",
    badge: "/icon-192.png",
    image: preview,
    tag:   `item-${item.id}`,
  };

  await env.DB.prepare(
    `INSERT INTO push_campaigns (campaign_id, kind, title, body, url, category, total_count, created_at)
     VALUES (?, 'new_item', ?, ?, ?, ?, ?, ?)`
  ).bind(campaignId, payload.title, payload.body, payload.url, item.category || null, targets.length, now()).run();

  const stats = await deliverPush(env, targets, payload, campaignId);

  await env.DB.prepare(
    `UPDATE push_campaigns SET sent_count = ?, failed_count = ? WHERE campaign_id = ?`
  ).bind(stats.sent, stats.failed, campaignId).run();

  return stats;
}

// ============================================================
// Install tracking
// ============================================================

async function trackInstall(req, env) {
  const body = await req.json().catch(() => ({}));
  const deviceId = (body.device_id || "").slice(0, 64);
  if (!deviceId) return err("missing device_id");
  const ua = (req.headers.get("User-Agent") || "").slice(0, 500);
  const platform = /iPad|iPhone|iPod/.test(ua) ? "ios"
                  : /Android/.test(ua) ? "android"
                  : /Windows|Macintosh|Linux/.test(ua) ? "desktop"
                  : "other";
  const user = await getUser(req, env);
  const userId = user?.id || null;
  const isApp = body.is_app ? 1 : 0;
  const pushOn = body.push_on ? 1 : 0;
  const t = now();

  await env.DB.prepare(
    `INSERT INTO installs (device_id, user_id, user_agent, platform, created_at, last_seen, is_app, push_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       last_seen = excluded.last_seen,
       user_id = COALESCE(installs.user_id, excluded.user_id),
       is_app = MAX(installs.is_app, excluded.is_app),
       push_on = excluded.push_on`
  ).bind(deviceId, userId, ua, platform, t, t, isApp, pushOn).run();

  return json({ ok: true });
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
  const sevenDaysAgo = now() - 7 * 86400;
  const [u, items, act, sold, hid, rep, views, favs, inst, instIos, instAndroid, instActive, push, instApp, instAppActive, instAppPush, fbSignups, fbVisits] = await Promise.all([
    q("SELECT COUNT(*) c FROM users"),
    q("SELECT COUNT(*) c FROM items"),
    q("SELECT COUNT(*) c FROM items WHERE status='active'"),
    q("SELECT COUNT(*) c FROM items WHERE status='sold'"),
    q("SELECT COUNT(*) c FROM items WHERE status='hidden'"),
    q("SELECT COUNT(*) c FROM reports WHERE resolved=0"),
    q("SELECT COALESCE(SUM(views),0) c FROM items"),
    q("SELECT COUNT(*) c FROM favorites"),
    q("SELECT COUNT(*) c FROM installs"),
    q("SELECT COUNT(*) c FROM installs WHERE platform='ios'"),
    q("SELECT COUNT(*) c FROM installs WHERE platform='android'"),
    env.DB.prepare("SELECT COUNT(*) c FROM installs WHERE last_seen > ?").bind(sevenDaysAgo).first(),
    q("SELECT COUNT(*) c FROM push_subscriptions WHERE failures < 3"),
    q("SELECT COUNT(*) c FROM installs WHERE is_app=1"),
    env.DB.prepare("SELECT COUNT(*) c FROM installs WHERE is_app=1 AND last_seen > ?").bind(sevenDaysAgo).first(),
    q("SELECT COUNT(*) c FROM installs WHERE is_app=1 AND push_on=1"),
    q("SELECT COUNT(*) c FROM users WHERE signup_source='facebook'"),
    q("SELECT COUNT(*) c FROM visits WHERE source='facebook'").catch(() => ({ c: 0 })),
  ]);

  // Per-campaign (per-ad) breakdown for Facebook: visits + signups merged by campaign.
  let fbCampaigns = [];
  try {
    const [vRows, sRows] = await Promise.all([
      env.DB.prepare("SELECT campaign, COUNT(*) c FROM visits WHERE source='facebook' GROUP BY campaign").all(),
      env.DB.prepare("SELECT signup_campaign campaign, COUNT(*) c FROM users WHERE signup_source='facebook' GROUP BY signup_campaign").all(),
    ]);
    const map = new Map();
    for (const r of (vRows.results || [])) map.set(r.campaign || "—", { campaign: r.campaign || "—", visits: r.c, signups: 0 });
    for (const r of (sRows.results || [])) {
      const k = r.campaign || "—";
      const e = map.get(k) || { campaign: k, visits: 0, signups: 0 };
      e.signups = r.c; map.set(k, e);
    }
    fbCampaigns = [...map.values()].sort((a, b) => b.visits - a.visits);
  } catch (e) {}
  return json({
    users: u.c, items: items.c, active: act.c, sold: sold.c, hidden: hid.c,
    reports_open: rep.c, views: views.c, favorites: favs.c,
    installs: inst.c, installs_ios: instIos.c, installs_android: instAndroid.c,
    installs_active_7d: instActive.c,
    installs_app: instApp.c, installs_app_active_7d: instAppActive.c,
    installs_app_push: instAppPush.c,
    push_enabled: push.c,
    signups_facebook: fbSignups.c,
    visits_facebook: (fbVisits && fbVisits.c) || 0,
    fb_campaigns: fbCampaigns,
  });
}

async function adminInstalls(env) {
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.device_id, i.platform, i.user_agent, i.created_at, i.last_seen,
            i.is_app, i.push_on, i.user_id, u.name AS user_name, u.phone AS user_phone
     FROM installs i
     LEFT JOIN users u ON u.id = i.user_id
     ORDER BY i.last_seen DESC
     LIMIT 500`
  ).all();
  return json({ installs: results });
}

async function adminUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, phone, name, city, created_at, last_active,
            items_listed, items_sold, rating, banned, signup_source
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
            i.photos, i.views, i.favorites_count, i.whatsapp_contacts, i.created_at,
            u.id AS user_id, u.name AS seller_name, u.phone AS seller_phone
     FROM items i LEFT JOIN users u ON u.id = i.user_id
     ${where}
     ORDER BY i.created_at DESC LIMIT 500`
  ).bind(...bind).all();
  return json({
    items: results.map((r) => ({ ...r, photos: JSON.parse(r.photos || "[]") })),
  });
}

// Ranking of listings by WhatsApp "contact seller" clicks. ?days=N filters by the
// contact_events log (date-bounded); no days param = all-time from the item counter.
async function adminContactStats(env, url) {
  const days = parseInt(url.searchParams.get("days") || "0");
  let rows;
  if (days > 0) {
    const since = now() - days * 86400;
    rows = (await env.DB.prepare(
      `SELECT ce.item_id AS id, COUNT(*) AS contacts, i.title, i.price, i.status,
              i.photos, u.name AS seller_name
       FROM contact_events ce
       JOIN items i ON i.id = ce.item_id
       LEFT JOIN users u ON u.id = i.user_id
       WHERE ce.created_at > ?
       GROUP BY ce.item_id ORDER BY contacts DESC LIMIT 50`
    ).bind(since).all()).results;
  } else {
    rows = (await env.DB.prepare(
      `SELECT i.id, i.whatsapp_contacts AS contacts, i.title, i.price, i.status,
              i.photos, i.views, u.name AS seller_name
       FROM items i LEFT JOIN users u ON u.id = i.user_id
       WHERE i.whatsapp_contacts > 0
       ORDER BY i.whatsapp_contacts DESC LIMIT 50`
    ).all()).results;
  }
  const totalRow = await env.DB.prepare(
    days > 0
      ? `SELECT COUNT(*) AS total FROM contact_events WHERE created_at > ${now() - days * 86400}`
      : `SELECT COALESCE(SUM(whatsapp_contacts),0) AS total FROM items`
  ).first();
  return json({
    total: totalRow?.total || 0,
    items: rows.map((r) => ({ ...r, photos: JSON.parse(r.photos || "[]") })),
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

async function adminPushCampaigns(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.campaign_id, c.kind, c.title, c.body, c.url, c.category,
            c.total_count, c.sent_count, c.failed_count, c.created_at,
            (SELECT COUNT(*) FROM push_clicks pc WHERE pc.campaign_id = c.campaign_id) AS click_count,
            (SELECT COUNT(DISTINCT pc.user_id) FROM push_clicks pc
              WHERE pc.campaign_id = c.campaign_id AND pc.user_id IS NOT NULL) AS unique_users
     FROM push_campaigns c
     ORDER BY c.created_at DESC
     LIMIT 200`
  ).all();
  return json({ campaigns: results });
}

async function adminPushClicks(env, url) {
  const campaignId = url.searchParams.get("campaign_id");
  let sql = `SELECT pc.id, pc.campaign_id, pc.user_id, pc.url, pc.user_agent, pc.clicked_at,
                    u.name AS user_name, u.phone AS user_phone, u.city AS user_city,
                    c.title AS campaign_title
             FROM push_clicks pc
             LEFT JOIN users u ON u.id = pc.user_id
             LEFT JOIN push_campaigns c ON c.campaign_id = pc.campaign_id`;
  const binds = [];
  if (campaignId) { sql += " WHERE pc.campaign_id = ?"; binds.push(campaignId); }
  sql += " ORDER BY pc.clicked_at DESC LIMIT 500";
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ clicks: results });
}

async function adminPushSubscribers(env, url) {
  const limit  = Math.min(1000, parseInt(url.searchParams.get("limit") || "500"));
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const { results } = await env.DB.prepare(
    `SELECT ps.id, ps.user_id, ps.endpoint, ps.categories, ps.created_at, ps.last_used, ps.failures,
            u.name AS user_name, u.phone AS user_phone, u.city AS user_city,
            CASE
              WHEN ps.endpoint LIKE 'https://fcm.googleapis.com/%' THEN 'android/chrome'
              WHEN ps.endpoint LIKE 'https://web.push.apple.com/%' THEN 'ios/safari'
              WHEN ps.endpoint LIKE 'https://updates.push.services.mozilla.com/%' THEN 'firefox'
              WHEN ps.endpoint LIKE 'https://wns2-%.notify.windows.com/%' THEN 'windows/edge'
              ELSE 'other'
            END AS provider
     FROM push_subscriptions ps
     LEFT JOIN users u ON u.id = ps.user_id
     ORDER BY ps.last_used DESC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const total       = (await env.DB.prepare("SELECT COUNT(*) c FROM push_subscriptions").first()).c;
  const active      = (await env.DB.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE failures < 3").first()).c;
  const withUser    = (await env.DB.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE user_id IS NOT NULL").first()).c;
  return json({ subscribers: results || [], total, active, with_user: withUser, anonymous: total - withUser });
}

async function adminPushBroadcast(req, env) {
  const body = await req.json().catch(() => ({}));
  const { title, message, url, category, phone } = body;
  if (!title || !message) return err("title and message required");

  let sql = "SELECT endpoint, p256dh, auth, categories, user_id FROM push_subscriptions";
  const binds = [];
  if (phone) {
    // Generate all reasonable variants for Israeli numbers
    let digits = String(phone).replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);     // 00972... -> 972...
    if (digits.startsWith("0")) digits = "972" + digits.slice(1); // 050... -> 97250...
    if (!digits.startsWith("972") && digits.length === 9) digits = "972" + digits; // 50... -> 97250...
    const variants = Array.from(new Set([
      digits,                  // 972506818716
      "+" + digits,            // +972506818716
      "0" + digits.slice(3),   // 0506818716 (if israeli)
    ]));
    sql += ` WHERE user_id IN (SELECT id FROM users WHERE phone IN (${variants.map(() => "?").join(",")}))`;
    binds.push(...variants);
  }
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  if (phone && !results.length) return err("לא נמצאו מנויי פוש למספר הזה", 404);

  const targets = category
    ? results.filter((s) => {
        if (!s.categories) return true;
        try { return JSON.parse(s.categories).includes(category); } catch { return true; }
      })
    : results;

  const campaignId = "broadcast-" + now();
  const payload = {
    title,
    body: message,
    url: url || "/",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: campaignId,
  };

  await env.DB.prepare(
    `INSERT INTO push_campaigns (campaign_id, kind, title, body, url, category, total_count, created_at)
     VALUES (?, 'broadcast', ?, ?, ?, ?, ?, ?)`
  ).bind(campaignId, title, message, url || "/", category || null, targets.length, now()).run();

  const stats = await deliverPush(env, targets, payload, campaignId);

  await env.DB.prepare(
    `UPDATE push_campaigns SET sent_count = ?, failed_count = ? WHERE campaign_id = ?`
  ).bind(stats.sent, stats.failed, campaignId).run();

  return json({ ok: true, campaign_id: campaignId, ...stats });
}

// ============================================================
// Waitlist (Coming Soon page)
// ============================================================

// ============================================================
// Health check — verifies critical wiring is alive
// ============================================================
async function healthCheck(env) {
  const checks = {};
  const start = Date.now();

  // DB read
  try {
    const r = await env.DB.prepare("SELECT 1 AS ok").first();
    checks.db = { ok: r?.ok === 1 };
  } catch (e) { checks.db = { ok: false, error: e.message }; }

  // Critical tables exist (no rows-required, just probing)
  for (const tbl of ["users", "items", "installs", "waitlist", "push_campaigns", "push_clicks", "favorites", "reports", "sessions"]) {
    try {
      const r = await env.DB.prepare(`SELECT COUNT(*) c FROM ${tbl}`).first();
      checks[`tbl_${tbl}`] = { ok: true, count: r.c };
    } catch (e) {
      checks[`tbl_${tbl}`] = { ok: false, error: e.message };
    }
  }

  // R2 bucket binding
  checks.r2 = { ok: !!env.PHOTOS };

  // Critical secrets present
  checks.admin_password = { ok: !!env.ADMIN_PASSWORD };
  checks.vapid_public  = { ok: !!env.VAPID_PUBLIC_KEY };
  checks.vapid_private = { ok: !!env.VAPID_PRIVATE_KEY };

  // Recent activity flags (warn if zero in last 7 days)
  try {
    const sevenDaysAgo = now() - 7 * 86400;
    const recentInstalls = await env.DB.prepare("SELECT COUNT(*) c FROM installs WHERE last_seen > ?").bind(sevenDaysAgo).first();
    checks.installs_active_7d = { ok: recentInstalls.c > 0, count: recentInstalls.c };
    const recentItems = await env.DB.prepare("SELECT COUNT(*) c FROM items WHERE created_at > ?").bind(sevenDaysAgo).first();
    checks.items_new_7d = { ok: true, count: recentItems.c }; // informational
  } catch (e) { checks.recent = { ok: false, error: e.message }; }

  const allOk = Object.values(checks).every(c => c.ok);
  return json({
    ok: allOk,
    checks,
    duration_ms: Date.now() - start,
    deployed_at: new Date().toISOString(),
  }, allOk ? 200 : 503);
}

async function waitlistJoin(req, env) {
  const body = await req.json().catch(() => ({}));
  const phone = normalizePhone(body.phone);
  const email = (body.email || "").trim().toLowerCase() || null;
  const name  = (body.name  || "").trim() || null;
  const city  = (body.city  || "").trim() || null;
  const source = (body.source || "direct").trim().slice(0, 50);

  if (!phone && !email) return err("נדרש טלפון או אימייל", 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("אימייל לא תקין", 400);
  if (phone && phone.replace(/\D/g, "").length < 10) return err("מספר טלפון לא תקין", 400);

  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "";
  const ua = (req.headers.get("User-Agent") || "").slice(0, 300);

  // Check duplicates first (so we can return friendly message)
  if (phone) {
    const existing = await env.DB.prepare("SELECT id FROM waitlist WHERE phone = ?").bind(phone).first();
    if (existing) return json({ ok: true, already: true });
  }
  if (email) {
    const existing = await env.DB.prepare("SELECT id FROM waitlist WHERE email = ?").bind(email).first();
    if (existing) return json({ ok: true, already: true });
  }

  await env.DB.prepare(
    `INSERT INTO waitlist (phone, email, name, city, source, user_agent, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(phone, email, name, city, source, ua, ip, Date.now()).run();

  return json({ ok: true });
}

async function waitlistCount(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist").first();
  return json({ count: (row && row.c) || 0 });
}

async function adminWaitlist(env, url) {
  const limit  = Math.min(500, parseInt(url.searchParams.get("limit") || "100"));
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const { results } = await env.DB.prepare(
    `SELECT id, phone, email, name, city, source, notified, created_at
     FROM waitlist ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const total = (await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist").first()).c;
  return json({ items: results || [], total });
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

      // Firebase Auth helper reverse-proxy — serve Google's sign-in handler under
      // OUR origin (rollingstyle.org) instead of rolling-style.firebaseapp.com.
      // signInWithRedirect breaks inside the installed app (TWA) because the
      // browser partitions storage across the two origins, so the returned token
      // can't be read back ("bounces to login"). Same-origin auth fixes it.
      // Requires: authDomain="rollingstyle.org" in firebase-auth.js AND
      // "https://rollingstyle.org/__/auth/handler" added to the OAuth client's
      // authorized redirect URIs in Google Cloud Console.
      if (path.startsWith("/__/auth/") || path === "/__/firebase/init.json") {
        const target = "https://rolling-style.firebaseapp.com" + path + url.search;
        const fwdHeaders = new Headers(req.headers);
        fwdHeaders.delete("host");
        const upstream = await fetch(target, {
          method: req.method,
          headers: fwdHeaders,
          body: (method === "GET" || method === "HEAD") ? undefined : await req.arrayBuffer(),
          redirect: "manual",
        });
        const respHeaders = new Headers(upstream.headers);
        respHeaders.delete("content-security-policy");
        respHeaders.delete("x-frame-options");
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: respHeaders,
        });
      }

      // Anonymous traffic tracking (UTM landing beacon)
      if (path === "/api/track-visit" && method === "POST") return await trackVisit(req, env);

      // Auth
      if (path === "/api/auth/firebase-login" && method === "POST") return await firebaseLogin(req, env);
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
        if (sub === "contact"  && method === "POST") return await contactItem(req, env, id);
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
      if (path === "/api/push/click"       && method === "POST")   return await recordPushClick(req, env);

      // Install tracking
      if (path === "/api/track/install" && method === "POST") return await trackInstall(req, env);

      // Waitlist (Coming Soon)
      if (path === "/api/waitlist"       && method === "POST") return await waitlistJoin(req, env);
      if (path === "/api/waitlist/count" && method === "GET")  return await waitlistCount(env);

      // Health check (public — for monitoring)
      if (path === "/api/health" && method === "GET") return await healthCheck(env);

      // Admin API
      if (path.startsWith("/api/admin/")) {
        if (path === "/api/admin/login" && method === "POST") return await adminLogin(req, env);
        if (!requireAdmin(req, env)) return err("unauthorized", 401);

        if (path === "/api/admin/stats"    && method === "GET") return await adminStats(env);
        if (path === "/api/admin/installs" && method === "GET") return await adminInstalls(env);
        if (path === "/api/admin/users"    && method === "GET") return await adminUsers(env);
        if (path === "/api/admin/items"   && method === "GET") return await adminItems(env, url);
        if (path === "/api/admin/contacts" && method === "GET") return await adminContactStats(env, url);
        if (path === "/api/admin/reports" && method === "GET") return await adminReports(env);
        if (path === "/api/admin/push/broadcast" && method === "POST") return await adminPushBroadcast(req, env);
        if (path === "/api/admin/push/campaigns" && method === "GET")  return await adminPushCampaigns(env);
        if (path === "/api/admin/push/clicks"      && method === "GET")  return await adminPushClicks(env, url);
        if (path === "/api/admin/push/subscribers" && method === "GET")  return await adminPushSubscribers(env, url);
        if (path === "/api/admin/waitlist"       && method === "GET")  return await adminWaitlist(env, url);

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
