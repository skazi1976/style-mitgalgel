# Google Play Store — Listings Index

| שפה | קובץ | קוד שפה ב-Play Console |
|-----|------|----------------------|
| 🇮🇱 עברית | [play-store-listing.md](play-store-listing.md) | `iw-IL` (Hebrew) |
| 🇬🇧 English | [play-store-listing-en.md](play-store-listing-en.md) | `en-US` (default fallback) |
| 🇪🇸 Español | [play-store-listing-es.md](play-store-listing-es.md) | `es-ES`, `es-419` |

---

## איך להוסיף תרגומים ב-Google Play Console

1. Play Console → אפליקציה → **Grow → Store presence → Main store listing**
2. למעלה — **Manage translations → Add translations**
3. בחרי שפה (English / Spanish — Spain) → **Add**
4. עברי לשפה החדשה והעתיקי-הדביקי מהקובץ הרלוונטי:
   - שם → "App name"
   - תיאור קצר → "Short description"
   - תיאור מלא → "Full description"
5. נכסים גרפיים (אייקון, feature graphic, screenshots) — משותפים, אין צורך להעלות שוב.
6. **Save → Send for review**

הקבלה לוקחת 1-3 ימים. ברגע שעוברת — משתמשים שמכשיר מוגדר באנגלית/ספרדית יראו את הליסטינג בשפה שלהם.

---

## למה שווה?

📊 **שוקי יעד פוטנציאליים**:
- 🇬🇧 English: 1.5B+ דוברי אנגלית. אפילו 0.001% conversion = אלפי משתמשות.
- 🇪🇸 Español: 500M+ דוברי ספרדית. שוק חזק במדריד, ברצלונה, מקסיקו, ארגנטינה.
- בלי תרגום: רק שוק ישראל (~3M נשים בקהל יעד).

📈 **ROI**: השקעה של 30 דקות עכשיו = פתיחת 99.9% מהשוק העולמי לאפליקציה.

⚠️ **אזהרה**: האפליקציה עצמה כתובה בעברית. משתמשים מחו"ל יראו טקסט בעברית — **אבל** אופנה היא שפה ויזואלית. אם רוצה תרגום מלא של ה-UI עצמו (המסכים, הכפתורים) — זה פרויקט נפרד גדול יותר (~יום עבודה).

---

## פעם אחת בעתיד: לוקליזציה מלאה של ה-UI

אם רוצה לעשות לוקליזציה מלאה (כולל המסכים), הצעדים:
1. ייצוא כל הטקסט מ-`public/*.html` ו-`public/app.js` למערכת i18n (קובץ JSON לשפה)
2. הוספת language switcher בכותרת
3. שמירת בחירת השפה ב-localStorage
4. תרגום של כל המחרוזות (יש בערך 200-300)
5. בדיקה שכיוון הטקסט מתחלף נכון (RTL → LTR לאנגלית/ספרדית)

זמן משוער: 1-2 ימים. הרוויח: גישה ישירה לשוק עולמי.
