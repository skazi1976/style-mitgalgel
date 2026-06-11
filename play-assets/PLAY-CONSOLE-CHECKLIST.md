# Google Play Console — Submission Checklist
*נוצר 2026-04-24 — להשלמה אחרי אישור חשבון המפתח*

## 🟡 Blocker נוכחי
**ממתינים ל:**
- אימות זהות ע"י Google (2-7 ימים בד"כ)
- אימות מספר טלפון ליצירת קשר
חשבון: `6331869508739192626` (חשבון אישי, "סטייל מתגלגל")

---

## ✅ נכסים מוכנים

### קבצי חבילה (AAB/APK)
- [x] **AAB**: `D:\yupoo\backups\style-mitgalgel-2026-04-24\pack-keystore\סטייל מתגלגל.aab` (1.2 MB)
- [x] **APK** (גיבוי): `D:\yupoo\backups\style-mitgalgel-2026-04-24\pack-keystore\סטייל מתגלגל.apk` (1.1 MB)
- [x] **Signing keystore**: `signing.keystore` + `signing-key-info.txt`
- [x] **Package ID**: `org.rollingstyle.twa` (מאומת מול assetlinks.json ✅)

### נכסים גרפיים
- [x] **App icon 512×512**: `D:\yupoo\style-mitgalgel\public\icon-512.png`
- [x] **Feature graphic 1024×500**: `D:\yupoo\style-mitgalgel\play-assets\feature-graphic.png`
- [ ] **Screenshots (4)**: צריך להעביר מהטלפון ל-`D:\yupoo\style-mitgalgel\play-assets\screenshots\`
  - `01-feed.png` (פיד ראשי)
  - `02-item.png` (עמוד פריט — ווסט ג'ינס)
  - `03-upload.png` (העלאה — סנדלי טורי)
  - `04-favorites.png` (מועדפים — 3 פריטים)

### טקסטים
- [x] **שם**: סטייל מתגלגל
- [x] **תיאור קצר** (80 תו): מוכן ב-`play-store-listing.md`
- [x] **תיאור מלא** (4000 תו): מוכן ב-`play-store-listing.md`
- [x] **קטגוריה**: Shopping
- [x] **Keywords**: יד שנייה, בגדים, אופנה, סטייל, קניות, מכירה

### מדיניות ותאימות
- [x] **Privacy Policy**: https://rollingstyle.org/privacy (HTTP 200 ✅)
- [x] **Data Safety Form**: תשובות מוכנות ב-`DATA-SAFETY-FORM.md`
- [x] **assetlinks.json**: בחבילת keystore (לאימות Digital Asset Links)

---

## 📋 שלבי הגשה (אחרי אישור)

### שלב 1: יצירת אפליקציה
1. כניסה ל-[Play Console](https://play.google.com/console) → "צור אפליקציה"
2. שם: **סטייל מתגלגל**
3. שפת ברירת מחדל: **עברית (he-IL)**
4. סוג: **אפליקציה** (לא משחק)
5. חינם/בתשלום: **חינם**
6. הצהרות: Developer Program Policies, US export laws

### שלב 2: Setup חנות (Dashboard → תהליכי עבודה)

**Main store listing** (רישום ראשי):
- App name, Short description, Full description → העתק מ-`play-store-listing.md`
- App icon 512×512 → `public/icon-512.png`
- Feature graphic → `play-assets/feature-graphic.png`
- Phone screenshots (2-8) → `play-assets/screenshots/01–04`
- Category: Shopping
- Contact email: (להזין — אותו אימייל של החשבון)
- Privacy policy: `https://rollingstyle.org/privacy`

**App content** (תוכן אפליקציה):
- Privacy policy URL: `https://rollingstyle.org/privacy`
- App access: All functionality available without restrictions (or provide test account if login gate)
- Ads: **No** (אין פרסומות באפליקציה)
- Content rating: השלם את השאלון (Shopping, 18+, ללא תוכן למבוגרים)
- Target audience: **18+** (בלבד — לא ילדים)
- News app: **No**
- COVID-19 contact tracing: **No**
- Data safety: העתק מ-`DATA-SAFETY-FORM.md`
- Government app: **No**
- Financial features: **No**
- Health: **No**

### שלב 3: Release
1. **Production → צור גרסה חדשה**
2. **App Bundles**: העלה `סטייל מתגלגל.aab`
3. **Release name**: 1.0.0 (אוטומטי מה-AAB)
4. **Release notes (עברית)**:
   ```
   גרסה ראשונה! 🎉
   • קנייה ומכירה של בגדי יד שנייה בין נשים
   • העלאת פריטים תוך 30 שניות
   • שמירת מועדפים + התראות ירידת מחיר
   • צ'אט ישיר עם המוכרת דרך WhatsApp
   ```
5. **Review & Publish**

### שלב 4: Digital Asset Links (חובה ל-TWA!)
✅ **מאומת 2026-04-24**: `https://rollingstyle.org/.well-known/assetlinks.json` מחזיר HTTP 200 עם:
- `package_name`: `org.rollingstyle.twa`
- `sha256_cert_fingerprint`: `32:AD:27:51:85:9E:8B:84:2A:7B:79:EC:BB:23:BD:2A:A3:AE:1C:7E:98:49:90:F3:FF:AE:A7:CF:50:2E:04:2F`

אימות מחדש אחרי פרסום: `curl https://rollingstyle.org/.well-known/assetlinks.json`

---

## ⏱️ זמני המתנה צפויים

| שלב | זמן |
|-----|------|
| אימות חשבון מפתח | 2-7 ימים |
| בדיקת תוכן ראשונית (Content review) | 1-3 ימים |
| פרסום לפרודקשן | עד 7 ימים (לפעמים מיידי) |
| **סה"כ מהגשה לפרסום** | 3-17 ימים |

---

## 🔐 אזהרת אבטחה
**שמור בכספת דיגיטלית**:
- `signing.keystore`
- `signing-key-info.txt` (מכיל סיסמאות)

אם תאבד את ה-keystore — **לא תוכל להעלות עדכונים לאפליקציה**. גוגל לא מאפשרים להחליף keystore (אלא אם הצטרפת ל-Play App Signing, אז גוגל שומר לך עותק).
