# 🚀 Rolling Style — Coming Soon launch package

חבילת שיווק מוכנה להפעלה. כל קובץ עומד בפני עצמו וניתן להריץ/לשלוח באופן עצמאי.

---

## 📦 מה יש כאן?

| קובץ | מטרה | איך מפעילים |
|------|------|-------------|
| `tailwind_rollingstyle_launch.py` | 5 פינים ב-Pinterest דרך Tailwind | `python tailwind_rollingstyle_launch.py` |
| `email_vip_launch.html` | תבנית מייל ל-VIP customers (RTL HTML) | תבנית — נשלחת דרך הסקריפט הבא |
| `send_launch_email.py` | שולח את ה-HTML לכל הלקוחות החוזרים | `python send_launch_email.py --dry-run` ראשית |
| `telegram_post.md` | טקסט מוכן ל-@zara4everybody | העתק/הדבק ידני או דרך bot API |
| `whatsapp_post.md` | טקסט מוכן ל-34 קבוצות וואטסאפ | דרך הבוט הקיים או ידנית |

תמונות: `D:\yupoo\style-mitgalgel\public\launch\` — feature-graphic.png + 4 screenshots, נגישות גם ב-`https://rollingstyle.org/launch/`.

---

## 🎯 סדר הפעלה מומלץ

### יום 1 (היום)
1. ✅ דף Coming Soon חי — `https://rollingstyle.org/coming-soon`
2. ✅ באנר באתר הראשי מוביל לשם
3. 🟡 **שלחי מייל ל-VIP** — `python send_launch_email.py --dry-run` ואז ללא הדגל
4. 🟡 **תזמני 5 פינים** — `python tailwind_rollingstyle_launch.py`

### יום 2
5. 🟡 **פוסט בטלגרם** — מתוך `telegram_post.md`
6. 🟡 **פוסט בוואטסאפ** — מתוך `whatsapp_post.md` (גרסה קצרה)

### יום 3 ואילך (עד ההשקה)
7. 🟢 וריאציות פוסטים יומיות בוואטסאפ (יש 9 וריאציות מוצעות ב-`whatsapp_post.md`)
8. 🟢 פוסט תזכורת בטלגרם 3 ימים לפני ההשקה
9. 🟢 פוסט "השבוע נסגרת רשימת ה-VIP" יומיים לפני

### ביום ההשקה
10. 🔴 **שלחי SMS לכל הטלפונים שנרשמו** — ייצוא טלפונים מהאדמין → שליחה
11. 🔴 **פוסט "אנחנו חיים!" בכל הערוצים** עם קישור Google Play

---

## 🔍 איך לעקוב אחרי תוצאות?

### Google Analytics
- `Events → waitlist_signup` — מי נרשם
- `Acquisition → Source/Medium` — איזה ערוץ עובד הכי טוב (utm_source: pinterest / email / direct וכו')

### Admin Panel
1. כניסה: `https://rollingstyle.org/admin.html`
2. לשונית "⏳ רשימת המתנה"
3. רואה את הנרשמים, source, וזמן הרשמה
4. כפתורי export: CSV מלא או רק טלפונים

### API ישיר
```bash
# כמה נרשמו עד עכשיו?
curl https://rollingstyle.org/api/waitlist/count
```

---

## ⚙️ תצורה / Secrets

| שירות | מקום שמירה |
|-------|-----------|
| Tailwind API | בקובץ הסקריפט — `API_KEY` (כבר מוגדר) |
| Brevo SMTP | `D:\yupoo\pinterest-bot\.env` (קיים, כבר עובד) |
| Telegram bot | `D:\yupoo\pinterest-bot\.env` — `TELEGRAM_BOT_TOKEN` (קיים) |
| WhatsApp Baileys | רץ אוטומטית מ-startup — לא נדרש שינוי |

---

## 💡 רעיונות נוספים אם יש זמן

- **דף /coming-soon ב-2 שפות נוספות** — אנגלית/ספרדית, פתיחה לשוק עולמי
- **טפסי לידים בפייסבוק/אינסטגרם** — מקושרים ל-/api/waitlist
- **באנר פינתי ב-stylevault** — קהל הקיים של הקטלוג, יודעים על אופנה
- **קמפיין Google Ads $5/יום** — keyword: "אפליקציה לבגדים יד שנייה"

---

## 📊 KPI יעד עד יום ההשקה

| מדד | יעד |
|-----|-----|
| נרשמות לרשימת המתנה | **300+** |
| Pinterest pins clicks | **1,000+** |
| Email open rate | **30%+** (תקין ל-VIP) |
| Email click rate | **8%+** |
| WhatsApp שליחות | 34 קבוצות × 2-3 פעמים = **70-100 שליחות** |
