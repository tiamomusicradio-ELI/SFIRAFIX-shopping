# רשימת קניות – הוראות הקמה

## 1. Google (פעם אחת, בחשבון sfirafix@gmail.com)
1. ב-Drive צרו תיקייה "רשימות קניות". מזהה התיקייה = החלק האחרון בכתובת → `DRIVE_FOLDER_ID`.
2. ב-Google Cloud Console: צרו פרויקט, הפעילו Google Drive API ו-Gmail API, צרו OAuth Client (Web) → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
3. ב-OAuth Playground (developers.google.com/oauthplayground): הגדרות ⚙ → Use your own OAuth credentials, הזינו בתיבה את שני ה-scopes (מופרדים ברווח):
   `https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.send`
   אשרו ובקשו Refresh token → `GOOGLE_REFRESH_TOKEN`.
4. `GMAIL_USER=sfirafix@gmail.com`. המיילים נשלחים דרך Gmail API (Render בחשבון החינמי חוסם SMTP).
   `GMAIL_APP_PASSWORD` (App Password של Gmail) משמש רק כגיבוי, אם Gmail API נכשל.

## 2. Git + Render
1. העלו את התיקייה לריפו ב-GitHub.
2. ב-Render: New → Web Service → בחרו את הריפו. Build: `npm install`, Start: `npm start`.
3. ב-Environment הוסיפו: DRIVE_FOLDER_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_USER, GMAIL_APP_PASSWORD, SESSION_SECRET (מחרוזת אקראית ארוכה).
4. כל `git push` יעדכן את האתר אוטומטית.

## כניסה סודית
לוחצים 6 פעמים רצוף על "שלח" (עד 10 שניות בין לחיצה ללחיצה) אחרי מילוי הפרטים.
הזיהוי לפי מספר ID. בפעם הראשונה נוצר משתמש חדש, ובפעמים הבאות מתבצעת כניסה.
