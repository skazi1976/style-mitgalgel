// Style Mitgalgel — Shared client-side helpers

const API = ""; // same origin (worker serves static + API)

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
          <div class="form">
            <div>
              <label>מספר טלפון</label>
              <input type="tel" id="phoneInput" placeholder="050-1234567" inputmode="tel" maxlength="13">
            </div>
            <button class="btn" id="sendCodeBtn">שלחי קוד WhatsApp</button>
          </div>
        </div>
        <div id="step2" style="display:none">
          <p class="text-muted text-center" style="margin-bottom:12px">
            שלחנו קוד ל-<span id="phoneDisplay"></span> בWhatsApp
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

    modal.querySelector("#closeLoginBtn").onclick = () => modal.classList.remove("show");

    modal.querySelector("#sendCodeBtn").onclick = async (e) => {
      const phone = modal.querySelector("#phoneInput").value;
      if (!phone) return toast("מספר חסר");
      e.target.disabled = true;
      try {
        const res = await api("/api/auth/request-otp", { method: "POST", body: { phone } });
        pendingPhone = res.phone;
        modal.querySelector("#phoneDisplay").textContent = pendingPhone;
        modal.querySelector("#step1").style.display = "none";
        modal.querySelector("#step2").style.display = "block";
        modal.querySelector("#codeInput").focus();
      } catch (err) {
        toast(err.message);
      } finally {
        e.target.disabled = false;
      }
    };

    modal.querySelector("#resendBtn").onclick = async () => {
      try {
        await api("/api/auth/request-otp", { method: "POST", body: { phone: pendingPhone } });
        toast("קוד חדש נשלח");
      } catch (err) { toast(err.message); }
    };

    modal.querySelector("#verifyBtn").onclick = async (e) => {
      const code = modal.querySelector("#codeInput").value;
      const name = modal.querySelector("#nameInput").value;
      if (!code) return toast("חסר קוד");
      e.target.disabled = true;
      try {
        const body = { phone: pendingPhone, code };
        if (name) body.name = name;
        const res = await api("/api/auth/verify-otp", { method: "POST", body });
        Auth.set(res.token, res.user);
        toast("ברוכה הבאה!");
        modal.classList.remove("show");
        if (onSuccess) onSuccess(res.user);
        else location.reload();
      } catch (err) {
        if (err.message.includes("שם להרשמה")) {
          modal.querySelector("#nameField").style.display = "block";
          modal.querySelector("#nameInput").focus();
          toast("הרשמה ראשונה — אנא הזיני שם");
        } else {
          toast(err.message);
        }
      } finally {
        e.target.disabled = false;
      }
    };
  }
  modal.classList.add("show");
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

// ---------- Card renderer ----------
function itemCard(item) {
  const photo = item.photos?.[0] || "/placeholder.png";
  const sold = item.status === "sold";
  return `
    <div class="card" onclick="location.href='/item.html?id=${item.id}'">
      <div class="card-img" style="background-image:url('${photo}')">
        ${sold ? '<div class="badge-sold">נמכר</div>' : ''}
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
