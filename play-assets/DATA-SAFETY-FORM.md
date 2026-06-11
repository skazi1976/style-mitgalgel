# Google Play — Data Safety Form
## טופס בטיחות נתונים — תשובות מוכנות להעתקה

---

## 1. Data collection and security

### Does your app collect or share any of the required user data types?
**✅ Yes** (האפליקציה אוספת מידע)

### Is all of the user data collected by your app encrypted in transit?
**✅ Yes** — All traffic over HTTPS (Cloudflare TLS)

### Do you provide a way for users to request that their data is deleted?
**✅ Yes** — Users can email admin@rollingstyle.org to request deletion

---

## 2. Data types collected

### 👤 Personal info
| Data type | Collected | Shared | Purpose | Optional? |
|-----------|-----------|--------|---------|-----------|
| **Name** | ✅ Yes | ❌ No | App functionality, Account management | Required |
| **Phone number** | ✅ Yes | ❌ No | App functionality, Account management, Fraud prevention | Required |
| Email address | ❌ No | - | - | - |
| User IDs | ✅ Yes | ❌ No | App functionality | Required |

### 📸 Photos and videos
| Data type | Collected | Shared | Purpose | Optional? |
|-----------|-----------|--------|---------|-----------|
| **Photos** | ✅ Yes | ❌ No | App functionality (users upload photos of items for sale) | Required (to sell) |

### 📍 Location
| Data type | Collected | Shared | Purpose | Optional? |
|-----------|-----------|--------|---------|-----------|
| **Approximate location** | ✅ Yes (city/region only, user-typed) | ❌ No | App functionality (show nearby items) | Required |
| Precise location (GPS) | ❌ No | - | - | - |

### 📱 App activity
| Data type | Collected | Shared | Purpose | Optional? |
|-----------|-----------|--------|---------|-----------|
| App interactions | ✅ Yes | ❌ No | Analytics, App functionality | Required |
| In-app search history | ❌ No | - | - | - |

### 📨 Messages
❌ **Not collected** — Messaging happens outside the app (direct WhatsApp between buyer and seller; we never see the message content)

### 💳 Financial info
❌ **Not collected** — No payments processed in the app (transactions happen between users directly)

### 📞 Contacts
❌ **Not collected**

### 🎙️ Audio
❌ **Not collected**

### 📂 Files and docs
❌ **Not collected**

### 📅 Calendar / Health / Fitness
❌ **Not collected**

### 🌐 Web browsing
❌ **Not collected**

### 🔧 Device or other IDs
| Data type | Collected | Shared | Purpose | Optional? |
|-----------|-----------|--------|---------|-----------|
| **Device ID** | ✅ Yes | ❌ No | App functionality (push notification subscription) | Required |

---

## 3. Security practices

### Is data encrypted in transit?
**✅ Yes** — HTTPS/TLS via Cloudflare on all endpoints

### Do you follow the Families Policy?
**❌ No** (app targets adults 18+, not children)

### Independent security review?
**❌ No** (not required for your scale)

### Can users request data deletion?
**✅ Yes** — Via email to admin@rollingstyle.org

---

## 4. Privacy Policy URL
```
https://rollingstyle.org/privacy.html
```

---

## 💡 הערות חשובות למילוי

1. **Messages**: WhatsApp מחוץ לאפליקציה = לא מסמנים "Messages collected"
2. **Location**: כי אנחנו רק מבקשים **עיר** (טקסט חופשי) ולא GPS → זה "Approximate location" מסוג user-provided
3. **Photos**: חובה לסמן — גם אם זה רק "העלאת תמונות פריט"
4. **Data sharing**: אף שדה לא "Shared" — אנחנו לא מעבירים לאף ספק שלישי שמשתמש בזה בעצמו
5. **Fraud prevention**: מותר לסמן עבור Phone כי OTP מונע חשבונות מזויפים
