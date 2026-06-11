// Style Mitgalgel — Shared client-side helpers

const API = ""; // same origin (worker serves static + API)

// ---------- Signup-source attribution (first-touch) ----------
// Capture utm_source from the landing URL (e.g. Facebook ad) ONCE and keep it
// until the visitor registers, so we can attribute the new user to the channel.
(function captureSignupSource() {
  try {
    const p = new URLSearchParams(location.search);
    const src = (p.get("utm_source") || "").trim().toLowerCase();
    if (src && !localStorage.getItem("smg_src")) {
      localStorage.setItem("smg_src", src.slice(0, 40));
      const camp = (p.get("utm_campaign") || "").trim();
      if (camp) localStorage.setItem("smg_camp", camp.slice(0, 60));
    }
  } catch (e) {}
})();
// Returns the stored signup source (or undefined) — sent with registration calls.
function smgSource() {
  try { return localStorage.getItem("smg_src") || undefined; } catch (e) { return undefined; }
}

// ---------- Auth state (localStorage) ----------
const Auth = {
  token: () => localStorage.getItem("smg_token"),
  user:  () => { const u = localStorage.getItem("smg_user"); return u ? JSON.parse(u) : null; },
  set: (token, user) => {
    localStorage.setItem("smg_token", token);
    localStorage.setItem("smg_user", JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem("smg_token");
    localStorage.removeItem("smg_user");
  },
  isLoggedIn: () => !!localStorage.getItem("smg_token"),
};

// ---------- Fetch wrapper ----------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = Auth.token();
  if (token) headers["Authorization"] = "Bearer " + token;
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === "object") {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(API + path, { ...opts, headers });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || `שגיאה (${res.status})`);
  return data;
}

// ---------- Install / device tracking ----------
// Pings the server with a stable device_id so admin can see "X devices installed,
// Y active in last 7 days". Sent once per page load (cheap).
(function trackDevice() {
  try {
    let deviceId = localStorage.getItem("smg_device_id");
    if (!deviceId) {
      deviceId = (crypto.randomUUID && crypto.randomUUID()) ||
        (Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10));
      localStorage.setItem("smg_device_id", deviceId);
    }
    // Throttle: at most once per 30 minutes per page-load session
    const lastPing = parseInt(sessionStorage.getItem("smg_install_pinged") || "0", 10);
    if (Date.now() - lastPing < 30 * 60 * 1000) return;
    sessionStorage.setItem("smg_install_pinged", String(Date.now()));

    const headers = { "Content-Type": "application/json" };
    const token = localStorage.getItem("smg_token");
    if (token) headers["Authorization"] = "Bearer " + token;
    // is_app = running inside the installed app (TWA / PWA standalone), not a browser tab
    const isApp = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true;
    // push_on = this device has currently granted notification permission
    const pushOn = !!(window.Notification && Notification.permission === "granted");
    fetch("/api/track/install", {
      method: "POST",
      headers,
      body: JSON.stringify({ device_id: deviceId, is_app: isApp, push_on: pushOn }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) { /* never break page load over tracking */ }
})();

// ---------- Google Sign-In redirect handler ----------
// In TWA / installed PWA, Google sign-in uses redirect (popup is blocked).
// When the user returns from Google, this consumes the redirect result and
// completes login. Runs once per page load, only relevant if redirect happened.
(async function consumeGoogleRedirectOnBoot() {
  // Skip if already logged in OR if Firebase script hasn't loaded yet
  if (Auth.token()) return;
  if (!window.FirebaseAuth?.consumeGoogleRedirect) return;
  try {
    const idToken = await window.FirebaseAuth.consumeGoogleRedirect();
    if (!idToken) return;
    const res = await fetch("/api/auth/firebase-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, source: smgSource() }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      Auth.set(data.token, data.user);
      if (data.isNew) localStorage.setItem("smg_welcome_push", "1");
      // Tiny delay so toast lib (loaded later) has a chance — and refresh page state
      setTimeout(() => location.reload(), 200);
    }
  } catch (e) {
    console.error("[Auth] redirect consume failed:", e);
  }
})();

// ---------- Toast notifications ----------
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

// ---------- Hebrew labels ----------
const CATEGORIES = {
  dress: "שמלה",
  shirt: "חולצה",
  pants: "מכנסיים",
  jeans: "ג'ינס",
  skirt: "חצאית",
  jacket: "מעיל / ז'קט",
  shoes: "נעליים",
  bag: "תיק",
  accessories: "אקססוריז",
  swimwear: "בגדי ים",
  underwear: "הלבשה תחתונה",
  kids: "ילדים",
  other: "אחר",
};

const CATEGORY_EMOJI = {
  "":            "✨",
  dress:         "👗",
  shirt:         "👚",
  pants:         "👖",
  jeans:         "👖",
  skirt:         "🩱",
  jacket:        "🧥",
  shoes:         "👠",
  bag:           "👜",
  accessories:   "💍",
  swimwear:      "🩲",
  underwear:     "🩲",
  kids:          "🧒",
  other:         "🎀",
};

const CONDITIONS = {
  new: "חדש עם תווית",
  like_new: "כמו חדש",
  good: "במצב טוב",
  fair: "סביר",
};

const CITIES = [
  "תל אביב", "ירושלים", "חיפה", "ראשון לציון", "פתח תקווה", "אשדוד",
  "נתניה", "באר שבע", "בני ברק", "חולון", "רמת גן", "אשקלון", "רחובות",
  "בת ים", "הרצליה", "כפר סבא", "מודיעין", "רעננה", "אחר",
];

// ---------- Time helpers ----------
function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "כרגע";
  if (diff < 3600) return `לפני ${Math.floor(diff / 60)} דק'`;
  if (diff < 86400) return `לפני ${Math.floor(diff / 3600)} שעות`;
  if (diff < 86400 * 7) return `לפני ${Math.floor(diff / 86400)} ימים`;
  if (diff < 86400 * 30) return `לפני ${Math.floor(diff / (86400 * 7))} שבועות`;
  return `לפני ${Math.floor(diff / (86400 * 30))} חודשים`;
}

function formatPrice(price) {
  return `₪${parseInt(price).toLocaleString("he-IL")}`;
}

// ---------- Login modal (used from any page) ----------
function showLoginModal(onSuccess) {
  let modal = document.getElementById("loginModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "loginModal";
    modal.className = "modal-bg";
    modal.innerHTML = `
      <div class="modal">
        <h2>התחברות לסטייל מתגלגל</h2>
        <div id="step1">
          <button class="btn-google" id="googleBtn">
            <svg width="20" height="20" viewBox="0 0 48 48" style="vertical-align:middle;margin-left:8px"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>
            המשך עם Google
          </button>
          <div class="login-divider"><span>או</span></div>
          <div class="form">
            <div>
              <label>מספר טלפון</label>
              <input type="tel" id="phoneInput" placeholder="050-1234567" inputmode="tel" maxlength="13">
            </div>
            <button class="btn btn-secondary" id="sendCodeBtn">שלחי קוד SMS</button>
          </div>
        </div>
        <div id="step2" style="display:none">
          <p class="text-muted text-center" style="margin-bottom:12px">
            שלחנו קוד ל-<span id="phoneDisplay"></span> <span id="codeChannel">ב-SMS</span>
          </p>
          <div class="form">
            <div>
              <label>קוד אימות (6 ספרות)</label>
              <input type="text" id="codeInput" placeholder="123456" inputmode="numeric" maxlength="6">
            </div>
            <div id="nameField" style="display:none">
              <label>איך לקרוא לך?</label>
              <input type="text" id="nameInput" placeholder="השם שלך">
            </div>
            <button class="btn" id="verifyBtn">אישור</button>
            <button class="btn btn-secondary" id="resendBtn">שלחי קוד מחדש</button>
          </div>
        </div>
        <p class="text-center" style="margin-top:14px">
          <button id="closeLoginBtn" class="text-muted" style="background:none">ביטול</button>
        </p>
      </div>
    `;
    document.body.appendChild(modal);

    let pendingPhone = "";
    let cachedIdToken = null;
    let authChannel = "sms"; // "sms" (Vonage, primary) or "firebase" (legacy fallback)

    modal.querySelector("#closeLoginBtn").onclick = () => modal.classList.remove("show");

    // Google Sign-In — primary login method (free, no SMS cost)
    modal.querySelector("#googleBtn").onclick = async (e) => {
      const btn = e.target.closest("button");
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = "⏳ פותחת חלון של Google...";
      try {
        if (!window.FirebaseAuth) {
          throw new Error("שגיאה בטעינת אימות — רענני את הדף");
        }
        const idToken = await window.FirebaseAuth.signInWithGoogle();
        if (!idToken) {
          // We're in TWA — page is redirecting to Google now. consumeGoogleRedirect
          // on next load will finish the flow.
          return;
        }
        const res = await window.FirebaseAuth.login(idToken);
        Auth.set(res.token, res.user);
        if (res.isNew) localStorage.setItem("smg_welcome_push", "1");
        toast("ברוכה הבאה!");
        modal.classList.remove("show");
        if (onSuccess) onSuccess(res.user);
        else location.reload();
      } catch (err) {
        console.error("[Auth] Google sign-in failed:", err);
        if (err?.code === "auth/popup-closed-by-user" || err?.code === "auth/cancelled-popup-request") {
          toast("הביטול אושר");
        } else {
          toast(err.message || "כניסה דרך Google נכשלה");
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    };

    // Resend countdown helper — locks the resend button for N seconds
    function startResendCountdown(btn, seconds = 45) {
      btn.disabled = true;
      const origText = "שלחי קוד מחדש";
      let remaining = seconds;
      btn.textContent = `שלחי קוד מחדש (${remaining})`;
      const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = origText;
        } else {
          btn.textContent = `שלחי קוד מחדש (${remaining})`;
        }
      }, 1000);
    }

    modal.querySelector("#sendCodeBtn").onclick = async (e) => {
      const btn = e.target;
      const phone = modal.querySelector("#phoneInput").value;
      if (!phone) return toast("מספר חסר");
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "⏳ שולחת...";
      let info = modal.querySelector("#sendInfo");
      if (!info) {
        info = document.createElement("div");
        info.id = "sendInfo";
        info.style.cssText = "font-size:13px;color:#888;text-align:center;margin-top:10px;line-height:1.5";
        btn.parentNode.appendChild(info);
      }
      info.innerHTML = "📲 שולחים SMS... <br>הקוד אמור להגיע תוך 10-30 שניות";
      try {
        // Direct SMS via Vonage (server picks transport via VONAGE_API_KEY)
        const res = await api("/api/auth/request-otp", { method: "POST", body: { phone } });
        authChannel = "sms";
        pendingPhone = res.phone;
        cachedIdToken = null;
        modal.querySelector("#codeChannel").textContent = "ב-SMS";
        modal.querySelector("#phoneDisplay").textContent = pendingPhone;
        modal.querySelector("#step1").style.display = "none";
        modal.querySelector("#step2").style.display = "block";
        modal.querySelector("#codeInput").focus();
        const resendBtn = modal.querySelector("#resendBtn");
        if (resendBtn) startResendCountdown(resendBtn, 45);
      } catch (err) {
        console.error("[Auth] SMS send failed:", err);
        toast(err.message || "שליחת הקוד נכשלה");
        info.textContent = "";
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    };

    modal.querySelector("#resendBtn").onclick = async (e) => {
      const btn = e.target;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = "⏳ שולחת...";
      try {
        cachedIdToken = null;
        await api("/api/auth/request-otp", { method: "POST", body: { phone: pendingPhone } });
        toast("קוד חדש נשלח 📲");
        startResendCountdown(btn, 45);
      } catch (err) {
        toast(err.message || "שליחה מחדש נכשלה");
        btn.disabled = false;
        btn.textContent = orig;
      }
    };

    modal.querySelector("#verifyBtn").onclick = async () => {
      const vbtn = modal.querySelector("#verifyBtn");
      if (vbtn.disabled) return;                 // robust guard against double-submit
      const code = modal.querySelector("#codeInput").value;
      const name = modal.querySelector("#nameInput").value;
      if (!code) return toast("חסר קוד");
      vbtn.disabled = true;
      const vorig = vbtn.textContent;
      vbtn.textContent = "⏳ מאמת...";
      try {
        const res = await api("/api/auth/verify-otp", {
          method: "POST",
          body: { phone: pendingPhone, code, name: name || undefined, source: smgSource() },
        });
        Auth.set(res.token, res.user);
        if (res.isNew) localStorage.setItem("smg_welcome_push", "1");
        toast("ברוכה הבאה!");
        modal.classList.remove("show");
        if (onSuccess) onSuccess(res.user);
        else location.reload();
      } catch (err) {
        if ((err.message || "").includes("שם להרשמה")) {
          modal.querySelector("#nameField").style.display = "block";
          modal.querySelector("#nameInput").focus();
          toast("הרשמה ראשונה — אנא הזיני שם");
        } else {
          toast(err.message || "קוד שגוי");
        }
        vbtn.disabled = false;
        vbtn.textContent = vorig;
      }
    };
  }
  modal.classList.add("show");
}

// ---------- Contextual push opt-in prompt (reusable on any page) ----------
// Shows a focused "enable notifications" modal with custom copy. `onDone` is
// ALWAYS called exactly once — after enabling, after "later", after closing, or
// immediately if push can't/needn't be asked — so callers can safely chain a
// redirect off it. The permission request fires from the button click (a user
// gesture), which browsers require.
async function showPushPrompt(opts = {}) {
  const {
    title = "🔔 רוצה לקבל עדכונים?",
    body  = "נעדכן אותך כאן בכל חדש.",
    cta   = "🔔 כן, הפעילי התראות",
    onDone = () => {},
    cooldownDays = 3,                  // don't re-ask within this window (any trigger)
    cooldownKey = "smg_push_prompt_ts",
  } = opts;

  let done = false;
  const finish = () => { if (done) return; done = true; try { onDone(); } catch (_) {} };

  // Can't ask (unsupported / blocked) or already on → just continue silently.
  if (!Push.supported() || Push.permission() === "denied") return finish();
  try { if (await Push.isEnabled()) return finish(); } catch (_) {}

  // Global cooldown — the prompt fires from several places (upload, favorite,
  // post-registration). This makes sure a user who said "later" isn't nagged on
  // every heart click; they get asked again only after `cooldownDays`.
  if (cooldownDays > 0) {
    const last = parseInt(localStorage.getItem(cooldownKey) || "0", 10);
    if (last && (Date.now() - last) < cooldownDays * 86400000) return finish();
  }
  try { localStorage.setItem(cooldownKey, String(Date.now())); } catch (_) {}

  const modal = document.createElement("div");
  modal.className = "modal-bg";
  modal.innerHTML = `
    <div class="modal" style="text-align:center">
      <div style="font-size:46px;line-height:1;margin-bottom:6px">📬</div>
      <h2 style="margin:0 0 8px">${title}</h2>
      <p class="text-muted" style="margin:0 0 18px;line-height:1.6">${body}</p>
      <button class="btn" id="pushPromptEnable" style="width:100%">${cta}</button>
      <button class="btn btn-secondary" id="pushPromptLater" style="width:100%;margin-top:10px">אחר כך</button>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("show"));

  const close = () => { modal.classList.remove("show"); setTimeout(() => modal.remove(), 200); };

  modal.querySelector("#pushPromptLater").onclick = () => { close(); finish(); };
  modal.addEventListener("click", (e) => { if (e.target === modal) { close(); finish(); } });

  const enableBtn = modal.querySelector("#pushPromptEnable");
  enableBtn.onclick = async () => {
    enableBtn.disabled = true;
    const orig = enableBtn.textContent;
    enableBtn.textContent = "מפעילה...";
    try {
      await Push.enable();
      enableBtn.textContent = "הופעל ✓";
      toast("מעולה! נעדכן אותך 🔔");
      setTimeout(() => { close(); finish(); }, 700);
    } catch (e) {
      toast(e.message || "ההפעלה נכשלה");
      enableBtn.disabled = false;
      enableBtn.textContent = orig;
    }
  };
}

// ---------- Bottom nav ----------
function renderBottomNav(active) {
  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  const items = [
    { href: "/",          icon: "🏠", label: "בית",        key: "home" },
    { href: "/search.html", icon: "🔍", label: "חיפוש",   key: "search" },
    { href: "/upload.html", icon: "➕", label: "העלאה",   key: "upload" },
    { href: "/favorites.html", icon: "❤️", label: "מועדפים", key: "favorites" },
    { href: "/profile.html", icon: "👤", label: "אני",     key: "profile" },
  ];
  nav.innerHTML = items.map(i =>
    `<a href="${i.href}" class="${i.key === active ? "active" : ""}">
      <span class="nav-icon">${i.icon}</span>
      <span>${i.label}</span>
    </a>`
  ).join("");
  document.body.appendChild(nav);
  document.body.appendChild(Object.assign(document.createElement("div"), { className: "bottom-nav-spacer" }));
}

// ---------- Push notifications ----------
const Push = {
  // NOTE: do NOT require window.Notification here. Inside a TWA (the installed
  // Android app) the Notification constructor is often absent, yet web push
  // still works — notifications are shown via ServiceWorkerRegistration
  // .showNotification(), and permission is delegated from the Android app.
  supported: () => "serviceWorker" in navigator && "PushManager" in window,

  permission: () => (window.Notification && Notification.permission) || "default",

  _urlB64ToUint8Array(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },

  async getSubscription() {
    if (!Push.supported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  },

  async enable() {
    if (!Push.supported()) throw new Error("הדפדפן לא תומך בהתראות");

    // Request permission only if the Notification API exists. Inside a TWA it
    // may be missing — there, permission is delegated from the Android app and
    // pushManager.subscribe() will surface any permission problem itself.
    if ("Notification" in window && Notification.requestPermission) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("נדחתה הרשאה להתראות");
    }

    const keyRes = await api("/api/push/vapid-public");
    if (!keyRes.key) throw new Error("שרת הפושים לא מוגדר");

    const reg = await navigator.serviceWorker.ready;
    const appServerKey = Push._urlB64ToUint8Array(keyRes.key);
    let sub = await reg.pushManager.getSubscription();

    // If an existing subscription was created with a DIFFERENT VAPID key
    // (e.g. the server key was rotated), it can never receive pushes — the
    // browser silently drops messages whose VAPID signature doesn't match.
    // Detect the mismatch and force a fresh subscription with the current key.
    if (sub) {
      const existing = sub.options && sub.options.applicationServerKey
        ? new Uint8Array(sub.options.applicationServerKey) : null;
      // Only drop the subscription if we can POSITIVELY confirm a key mismatch.
      // In a TWA, applicationServerKey is often unreadable (null) — in that case
      // we MUST keep the existing subscription. Recreating it on every load
      // (the old behavior) churned subscriptions and made them expire (410).
      if (existing) {
        const matches = existing.length === appServerKey.length
          && existing.every((b, i) => b === appServerKey[i]);
        if (!matches) {
          try { await sub.unsubscribe(); } catch (_) { /* ignore */ }
          sub = null;
        }
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
    }
    await api("/api/push/subscribe", {
      method: "POST",
      body: {
        endpoint: sub.endpoint,
        keys: sub.toJSON().keys,
        categories: null,
      },
    });
    localStorage.setItem("smg_push_enabled", "1");
    return true;
  },

  async disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    localStorage.setItem("smg_push_enabled", "0");
  },

  async isEnabled() {
    if (!Push.supported()) return false;
    if (Push.permission() !== "granted") return false;
    const sub = await Push.getSubscription();
    return !!sub;
  },
};

// ---------- Favorites cache ----------
// Tracks which item IDs the current user has favorited. Loaded once per page.
const FavCache = {
  set: new Set(),
  loaded: false,
  async load() {
    if (this.loaded || !Auth.token()) return;
    try {
      const res = await api("/api/me/favorites");
      this.set = new Set((res.items || []).map(i => i.id));
      this.loaded = true;
      // Re-mark any cards already on the page that are now known to be favorited
      document.querySelectorAll(".card-fav").forEach(btn => {
        const m = btn.getAttribute("onclick")?.match(/(\d+)/);
        const id = m ? parseInt(m[1]) : null;
        if (id && this.set.has(id)) {
          btn.textContent = "❤️";
          btn.classList.add("active");
        }
      });
    } catch (_) { /* not logged in or network — skip */ }
  },
  has(id) { return this.set.has(id); },
  add(id) { this.set.add(id); },
  remove(id) { this.set.delete(id); },
};

// Toggle favorite on a card (called from heart button)
async function toggleCardFavorite(ev, itemId) {
  ev.stopPropagation();
  ev.preventDefault();
  if (!Auth.token()) { showLoginModal(); return; }
  const btn = ev.currentTarget;
  btn.classList.add("loading");
  try {
    const res = await api(`/api/items/${itemId}/favorite`, { method: "POST" });
    if (res.favorited) {
      FavCache.add(itemId);
      btn.textContent = "❤️";
      btn.classList.add("active");
      // Nudge push at the moment they show interest — they'll want to hear if it
      // drops in price or sells. (Respects the global cooldown; never redirects.)
      showPushPrompt({
        title: "נשמר במועדפים ❤️",
        body: "רוצה לדעת אם המחיר יורד או אם הפריט עומד להימכר? הפעילי התראות ונעדכן אותך.",
        cta: "🔔 כן, עדכנו אותי",
      });
    } else {
      FavCache.remove(itemId);
      btn.textContent = "🤍";
      btn.classList.remove("active");
    }
  } catch (e) {
    toast(e.message || "שגיאה");
  } finally {
    btn.classList.remove("loading");
  }
}

// ---------- Card renderer ----------
function itemCard(item) {
  const photo = item.photos?.[0] || "/placeholder.png";
  const sold = item.status === "sold";
  const isNew = item.created_at && (Date.now() / 1000 - item.created_at < 86400 * 2);
  let badge = "";
  if (sold)      badge = '<div class="badge-sold">נמכר</div>';
  else if (isNew) badge = '<div class="badge-new">חדש</div>';
  const fav = FavCache.has(item.id);
  const heart = `<button class="card-fav${fav ? " active" : ""}" onclick="toggleCardFavorite(event, ${item.id})" aria-label="הוסיפי למועדפים" title="הוסיפי למועדפים">${fav ? "❤️" : "🤍"}</button>`;
  return `
    <div class="card" onclick="location.href='/item.html?id=${item.id}'">
      <div class="card-img" style="background-image:url('${photo}')">
        ${badge}
        ${heart}
      </div>
      <div class="card-body">
        <div class="card-title">${item.title}</div>
        <div class="card-price">${formatPrice(item.price)}</div>
        <div class="card-meta">
          <span>${item.brand || ""}</span>
          <span>${item.size ? "מידה " + item.size : ""}</span>
        </div>
      </div>
    </div>
  `;
}

// Pre-load favorites on every page so cards render with correct heart state
if (typeof Auth !== "undefined" && Auth.token()) {
  FavCache.load();
}

// ---------- Welcome push prompt after first registration ----------
// Set by the login flow when the server reports isNew. We show it on the NEXT
// page load (registration usually reloads/navigates), once the page has settled.
window.addEventListener("load", () => {
  if (localStorage.getItem("smg_welcome_push") !== "1") return;
  localStorage.removeItem("smg_welcome_push");
  setTimeout(() => {
    showPushPrompt({
      title: "ברוכה הבאה לסטייל מתגלגל! 🎀",
      body: "הפעילי התראות ותהיי הראשונה לדעת על פריטים חדשים, ירידות מחיר ופניות לפריטים שלך.",
      cta: "🔔 כן, הפעילי התראות",
    });
  }, 1200);
});
