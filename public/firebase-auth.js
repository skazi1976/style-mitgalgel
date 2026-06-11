// Firebase Phone Auth wrapper — replaces the old WhatsApp OTP flow
// Uses compat SDK loaded dynamically from gstatic CDN

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyChT4d_9aS3hJx6hoyqzta2uIL0Bwc5PhI",
  authDomain: "rollingstyle.org", // self-hosted via worker proxy (/__/auth/*) so signInWithRedirect works in the TWA
  projectId: "rolling-style",
  storageBucket: "rolling-style.firebasestorage.app",
  messagingSenderId: "964248208414",
  appId: "1:964248208414:web:2c953b96c89a7111bf5a0f",
  measurementId: "G-0FMERREK69",
};

const SDK_VERSION = "10.13.2";
const SDK_URLS = [
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`,
  `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js`,
];

let _loadPromise = null;
let _recaptcha = null;
let _confirmation = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false; // preserve order
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

async function loadFirebase() {
  if (window.firebase?.auth) return window.firebase;
  if (!_loadPromise) {
    _loadPromise = (async () => {
      for (const url of SDK_URLS) await loadScript(url);
      window.firebase.initializeApp(FIREBASE_CONFIG);
    })();
  }
  await _loadPromise;
  return window.firebase;
}

// Kick off SDK download immediately on script parse — by the time the user
// clicks "Send code", Firebase is already loaded (saves 1-3 seconds on slow networks).
// requestIdleCallback ensures we don't block initial page render.
if (typeof window !== "undefined") {
  const preload = () => loadFirebase().catch(() => {});
  if (window.requestIdleCallback) {
    window.requestIdleCallback(preload, { timeout: 2000 });
  } else {
    setTimeout(preload, 800);
  }
}

function toE164(phone) {
  let p = (phone || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "972" + p.slice(1);
  if (!p.startsWith("972")) p = "972" + p;
  return "+" + p;
}

// Create a fresh reCAPTCHA verifier tied to a fresh DOM container.
// RecaptchaVerifier is one-shot; reusing it causes "already rendered" errors,
// especially when Firebase falls back from invisible to visible mode.
async function ensureRecaptcha(containerId) {
  const firebase = await loadFirebase();
  try { _recaptcha?.clear(); } catch (_) {}
  _recaptcha = null;

  const old = document.getElementById(containerId);
  if (old) {
    const fresh = document.createElement("div");
    fresh.id = containerId;
    old.replaceWith(fresh);
  }

  // Invisible reCAPTCHA: skips the visible checkbox for most users.
  // Google only triggers a visible challenge if it detects suspicious activity.
  // Massively reduces friction (saves 2-5 seconds for almost every user).
  _recaptcha = new firebase.auth.RecaptchaVerifier(containerId, {
    size: "invisible",
  });
  return _recaptcha;
}

// Reset reCAPTCHA (call after failed verify so user can retry)
function resetRecaptcha() {
  try {
    _recaptcha?.clear();
  } catch (_) {}
  _recaptcha = null;
  _confirmation = null;
}

// Send SMS OTP. phone is raw input (e.g. 050-1234567 or 0501234567).
// Returns the E.164 phone that was used.
async function sendFirebaseOtp(phone, recaptchaContainerId) {
  const firebase = await loadFirebase();
  const verifier = await ensureRecaptcha(recaptchaContainerId);
  const e164 = toE164(phone);
  _confirmation = await firebase.auth().signInWithPhoneNumber(e164, verifier);
  return e164;
}

// Verify OTP code → get Firebase ID token
async function verifyFirebaseOtp(code) {
  if (!_confirmation) throw new Error("קודם שלחי קוד");
  const result = await _confirmation.confirm(code);
  const idToken = await result.user.getIdToken();
  return idToken;
}

// Exchange Firebase ID token for server session
async function firebaseLogin(idToken, name) {
  const body = { idToken };
  if (name) body.name = name;
  try { const s = localStorage.getItem("smg_src"); if (s) body.source = s; } catch (e) {}
  const res = await fetch("/api/auth/firebase-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Login failed");
  return data;
}

// Google Sign-In via popup (web) or redirect (TWA / Android in-app browser).
// In TWA the popup is blocked, so we detect that case and use redirect.
// Returns the Firebase ID token after successful sign-in.
async function signInWithGoogle() {
  const firebase = await loadFirebase();
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope("email");
  provider.addScope("profile");
  // Hebrew picker UI
  provider.setCustomParameters({ hl: "he" });

  // TWA / WebView usually blocks popups. Detect and fall back to redirect.
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith("android-app://");

  try {
    if (isStandalone) {
      // Redirect flow — page reloads to Google then back to us. The result
      // is collected by getRedirectResult on next page load.
      await firebase.auth().signInWithRedirect(provider);
      // Execution stops here until page reloads
      return null;
    }
    const result = await firebase.auth().signInWithPopup(provider);
    return await result.user.getIdToken();
  } catch (err) {
    // If popup was blocked, fall back to redirect
    if (err?.code === "auth/popup-blocked" ||
        err?.code === "auth/operation-not-supported-in-this-environment") {
      await firebase.auth().signInWithRedirect(provider);
      return null;
    }
    throw err;
  }
}

// Pick up the redirect result on page load (called from app.js boot).
// Returns the ID token if the user just came back from Google, else null.
async function consumeGoogleRedirect() {
  try {
    const firebase = await loadFirebase();
    const result = await firebase.auth().getRedirectResult();
    if (result?.user) return await result.user.getIdToken();
  } catch (err) {
    console.error("[Auth] Google redirect error:", err);
    throw err;
  }
  return null;
}

window.FirebaseAuth = {
  sendOtp: sendFirebaseOtp,
  verifyOtp: verifyFirebaseOtp,
  login: firebaseLogin,
  reset: resetRecaptcha,
  toE164,
  signInWithGoogle,
  consumeGoogleRedirect,
};
