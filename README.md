# 💃 Style Mitgalgel — סטייל מתגלגל

C2C Marketplace לבגדי יד שנייה, RTL Hebrew, רץ על Cloudflare.

## 📁 מבנה הפרויקט

```
style-mitgalgel/
  src/worker.js         # Cloudflare Worker (API + photo serving)
  public/               # Frontend (HTML/CSS/JS) - מוגש סטטית
    index.html          # דף הבית (feed)
    item.html           # דף פריט
    upload.html         # העלאת פריט
    profile.html        # הפרופיל שלי
    favorites.html      # מועדפים
    search.html         # חיפוש מתקדם
    style.css           # עיצוב משותף
    app.js              # API client + auth
    manifest.json       # PWA
  schema.sql            # D1 schema
  wrangler.toml         # Cloudflare config
```

## 🚀 הגדרה ראשונה (חד פעמי)

```bash
cd D:\yupoo\style-mitgalgel
npm install
npx wrangler login          # להתחבר לCloudflare account
npm run db:create           # צור D1 database — תקבל database_id
# העתק את ה-database_id ל-wrangler.toml (replace REPLACE_AFTER_CREATE)
npm run r2:create           # צור R2 bucket
npm run db:init             # הרץ את ה-schema על production DB
```

## 🧪 פיתוח לוקאלי

```bash
npm run db:init:local       # אתחל DB מקומי
npm run dev                 # רץ על http://localhost:8787
```

OTP בפיתוח: הקוד מודפס ל-console (לא נשלח באמת).

## 📤 דיפלוי

```bash
npm run deploy
```

יקבל URL זמני: `style-mitgalgel.<your-account>.workers.dev`

## 🔌 חיבור ל-WhatsApp Bot (לשליחת OTP אמיתי)

ב-`wrangler.toml` שנה את:
```toml
WHATSAPP_BOT_URL = "https://your-bot-url/send-otp"
```

הbot צריך לקבל POST בפורמט:
```json
{ "phone": "972501234567", "message": "הקוד שלך: 123456" }
```

אפשר להוסיף endpoint כזה ל-bot.js הקיים שלך (whatsapp-baileys).

## 🌐 חיבור דומיין (אחרי שתקנה)

ב-Cloudflare Dashboard → Workers → style-mitgalgel → Triggers → Add Custom Domain.

## 📋 TODO לעתיד

- [ ] Push notifications (כשמישהו פונה אליך)
- [ ] Reviews/ratings אחרי עסקה
- [ ] Stripe לעסקאות מאובטחות (אופציונלי)
- [ ] Promo posts (₪5 לקידום פריט)
- [ ] Admin dashboard (ניהול דיווחים, חסימות)
- [ ] Service Worker (offline mode)
- [ ] Email notifications כגיבוי ל-WhatsApp
