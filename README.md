# זמני תפילות — Telegram → GitHub Actions → JSON

ניהול זמני תפילות של בתי כנסת בלי שרת, בלי בסיס נתונים, בלי Webhook ובלי AI.

מעבירים לבוט טלגרם הודעת גבאי (טקסט), Parser מבוסס־חוקים מנתח אותה, מגיעה
תצוגה מקדימה לאישור, ואחרי אישור ה־JSON מתפרסם לריפו הזה. האתר קורא אותו
ישירות מ־GitHub Raw.

```
הודעת WhatsApp מגבאי
        ↓  (העתקה ידנית)
   Telegram Bot
        ↓
GitHub Actions — כל 5 דקות, ~90 שניות האזנה בכל הרצה
        ↓
   getUpdates  (long polling אמיתי, timeout=25, ללא webhook)
        ↓
   parser.js → validator.js
        ↓
   state/pending/<id>.json   +   תצוגה מקדימה בטלגרם
        ↓
   אישור שלך (כפתור או /approve)
        ↓
אותה הרצה (או הבאה) מזהה את האישור
        ↓
   data/synagogues/<id>.json   +   data/all.json
        ↓
   האתר קורא GitHub Raw
```

**אפס תלויות npm.** הכל רץ על Node 24 המובנה: `fetch` גלובלי ו־`node:test`.

---

## התקנה

### 1. יצירת הבוט

1. פתח שיחה עם [@BotFather](https://t.me/BotFather) ושלח `/newbot`.
2. שמור את הטוקן שקיבלת.
3. פתח שיחה עם [@userinfobot](https://t.me/userinfobot) כדי לקבל את מזהה
   המשתמש המספרי שלך. הבוט **מתעלם מכל הודעה** שלא מגיעה מהמזהה הזה.
4. שלח `/start` לבוט החדש שלך — אחרת טלגרם לא ירשה לו לשלוח לך הודעות.

### 2. הגדרת ה־Secrets

שתי הפקודות האלה מבקשות ממך להקליד את הערך — הוא לא נשמר בהיסטוריית הפקודות:

```bash
gh secret set TELEGRAM_BOT_TOKEN --repo AfriatMichi/synagogue-prayer-times
```

```bash
gh secret set TELEGRAM_OWNER_ID --repo AfriatMichi/synagogue-prayer-times
```

לחלופין: **Settings → Secrets and variables → Actions → New repository secret**.

### 3. הפעלה

ה־cron מתחיל לרוץ לבד. להרצה מיידית:

```bash
gh workflow run telegram-poller.yml --repo AfriatMichi/synagogue-prayer-times
```

---

## כתובות ה־JSON לאתר

```
https://raw.githubusercontent.com/AfriatMichi/synagogue-prayer-times/main/data/all.json
https://raw.githubusercontent.com/AfriatMichi/synagogue-prayer-times/main/data/index.json
https://raw.githubusercontent.com/AfriatMichi/synagogue-prayer-times/main/data/synagogues/<id>.json
```

> `raw.githubusercontent.com` שומר cache של כ־5 דקות. פרסום לא מופיע באתר מיידית.

### מבנה הקובץ

```jsonc
{
  "id": "makdash-meat",
  "name": "בית כנסת מקדש מעט",
  "icon": "🕍",
  "weekday": {
    "prayers": [
      {
        "type": "shacharit",      // מפתח קנוני — ראה טבלה למטה
        "name": "תפילת שחרית",     // הניסוח של הגבאי, כפי שנכתב
        "time": "06:00",          // "HH:MM" או null (שיעור ללא שעה)
        "minyan": 1,              // 1..n, או null כשהתפילה מופיעה פעם אחת
        "nusach": null,           // "sepharadi" | "ashkenazi" | "teimani" | null
        "note": "הודו",           // שארית השורה
        "order": 0
      }
    ],
    "notes": ["בברכה ועד בית הכנסת."],
    "updatedAt": "2026-09-14T08:17:00.000Z"
  },
  "shabbat": { "prayers": [], "notes": [], "updatedAt": null },
  "holidays": [
    {
      "slug": "tzom-gedalia",
      "label": "צום גדליה",
      "date": null,               // אופציונלי — נקבע ידנית ב-/date
      "prayers": [],
      "notes": [],
      "updatedAt": "..."
    }
  ],
  "updatedAt": "2026-09-14T08:17:00.000Z",
  "source": { "channel": "telegram", "updateId": 123, "messageId": 45, "receivedAt": "..." }
}
```

`data/all.json` הוא `{ updatedAt, synagogues: [ ...כל הקבצים... ] }` — בקשה אחת
לכל האתר. `data/index.json` הוא רשימה קלה של `{ id, name, icon, updatedAt }`.

**ערכי `type`:** `selichot`, `shacharit`, `hatarat_nedarim`, `musaf`, `mincha`,
`mincha_gedola`, `mincha_ketana`, `kabbalat_shabbat`, `arvit`, `candle_lighting`,
`tzet`, `shofar`, `tashlich`, `daf_yomi`, `drasha`, `shiur`, `avot_ubanim`,
`children`, `other`.

---

## פקודות הבוט

| פקודה | מה היא עושה |
| --- | --- |
| `/pending` | רשימת העדכונים הממתינים לאישור |
| `/approve <id>` | אישור ופרסום |
| `/reject <id>` | ביטול |
| `/date <id> YYYY-MM-DD` | קביעת תאריך לועזי לחג |
| `/shul <id> <synagogue-id>` | שיוך ידני לבית כנסת |
| `/raw <id>` | הצגת ההודעה המקורית |
| `/list` | מזהי בתי הכנסת |
| `/help` | עזרה |

אותן פעולות זמינות גם ככפתורים מתחת לתצוגה המקדימה.

---

## איך ה־Parser עובד

`src/parser.js` הוא מנוע חוקים דטרמיניסטי. אין AI ואין קריאת רשת.

1. **נרמול** — הסרת תווי RTL בלתי נראים, כוכביות של טלגרם, ואיחוד ארבעה סוגי
   מקפים לאחד.
2. **זיהוי שורה־שורה** — בית כנסת (לפי `synagogues/registry.json`), סוג היום,
   שם החג, נוסח, מספר מניין, שם התפילה ושעה.
3. **ארבעת כללי המניינים**, שנגזרו מהודעות אמיתיות:
   - `מניין שני- 06:00` בלי שם תפילה — יורש את התפילה מהשורה שמעליו.
   - כותרת `מניין שני:` חלה **רק** על תפילות שכבר הופיעו מעליה. לכן היא לא
     "דולפת" על מנחה וערבית שמופיעות אחריה.
   - סימון מניין מתחת לכותרת (`שחרית + התרת נדרים:`) לוקח את שם התפילה מהכותרת.
   - תפילה שמופיעה פעם אחת אינה מניין — `minyan: null`.
4. **הגנה מפני פרוזה** — שורה כמו
   `לאחר מנחה גדולה נסדר בע"ה את בית הכנסת...` מכילה שם תפילה, אבל היא ארוכה
   ומתחילה במילת פתיחה של משפט, ולכן נשמרת כ־`note` ולא כזמן תפילה.

### מגבלות — חשוב

ניתוח עברית חופשית בחוקים **לא יהיה מדויק ב־100%**. לכן:

- כל שורה עם שעה שה־Parser לא הצליח לשייך מופיעה בתצוגה המקדימה תחת
  **"שורות עם שעה שלא זוהו"**. שום דבר לא נעלם בשקט.
- לצד הזמנים מוצגות גם ההערות החופשיות והאזהרות, כדי שתראה ניתוח שגוי
  *לפני* הפרסום.
- **תמונות לא נתמכות בכלל.** אין OCR במערכת. הודעה עם תמונה בלבד מקבלת הודעת
  שגיאה; אם יש כיתוב לתמונה — רק הכיתוב מנותח.
- פרסום **מחליף את כל הרשימה** של אותו סוג יום, כי הודעת גבאי היא רשימה מלאה.

### בדיקת הודעה בלי טלגרם

```bash
node src/cli.js tests/fixtures/makdash-meat-tzom-gedalia.txt
```

הפקודה מדפיסה מה זוהה, מה נשמר כהערה ומה לא זוהה. זה הכלי לכוונון
`synagogues/registry.json` ו־`src/dictionary.js` כשהודעה יוצאת שגויה.

---

## מבנה הפרויקט

```
src/
  config.js        נתיבים ומשתני סביבה
  normalize.js     נרמול טקסט עברי
  dictionary.js    טבלאות מילות מפתח: תפילות, חגים, נוסחים, מניינים
  parser.js        טקסט → מבנה נתונים
  validator.js     שגיאות (חוסמות) ואזהרות (מוצגות)
  synagogues.js    טעינת הרישום וזיהוי לפי כינויים
  pending.js       אחסון העדכונים הממתינים (קבצי JSON בריפו)
  publisher.js     כתיבה ל-data/ ובניית האגרגטים
  preview.js       בניית ההודעה והמקלדת בטלגרם
  telegram.js      קליינט Bot API מינימלי
  run.js           נקודת הכניסה של ה-Action
  cli.js           בדיקת Parser מקומית
  bootstrap.js     יצירת קבצים לבתי כנסת חדשים
data/              הפלט שהאתר קורא
synagogues/        registry.json + הוראות הוספה
state/             offset.json, pending/, archive/
tests/             node --test, כולל שלוש הודעות גבאי אמיתיות כ-fixtures
```

### בדיקות

```bash
npm test
```

---

## תפעול ותקלות

**כמה זמן לוקח פרסום?** ה-Action רץ כל 5 דקות, ובכל הרצה מאזין ~90 שניות עם
long polling של טלגרם. אם ההודעה נשלחת בזמן שההרצה פעילה — התגובה מגיעה תוך
שניות, וגם האישור מטופל באותה הרצה. אחרת ממתינים עד ~5 דקות לתיזמון הבא.
GitHub לא מאפשר cron תכוף מ-5 דקות, ודוחה הרצות מתוזמנות בזמני עומס.
`gh workflow run telegram-poller.yml` מזרז כל שלב.

**שגיאת 409 ב־Actions** — מישהו רשם Webhook לבוט. ההרצה מזהה את זה, מוחקת את
ה־Webhook וממשיכה לבד.

**הודעה נשלחה ולא קרה כלום** — ודא ששלחת `/start` לבוט, ושה־`TELEGRAM_OWNER_ID`
הוא המזהה שלך. כל הודעה ממזהה אחר נזרקת ונרשמת בלוג ההרצה.

**עדכון שהתקבל פעמיים** — המערכת מבטיחה *at-least-once*. אם ה־push נכשל,
ההרצה הבאה קוראת את אותן הודעות שוב. `state/offset.json` זוכר את 200 מזהי
העדכונים האחרונים כדי לבלוע כפילויות.

**ה־cron הפסיק לרוץ** — GitHub משבית `schedule:` בריפו ללא פעילות 60 יום.
ההרצה כותבת חותמת יומית ל־`state/offset.json` בדיוק כדי למנוע את זה.

**אני רוצה לראות מה פורסם ומתי** — `state/archive/` שומר כל עדכון שאושר או
בוטל, כולל ההודעה המקורית. זה יומן הביקורת של המערכת.
