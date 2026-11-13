const express = require('express'), crypto = require('crypto'), bcrypt = require('bcryptjs');
const { google } = require('googleapis'), nodemailer = require('nodemailer'), { Readable } = require('stream');
const E = process.env, app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));
app.use(express.static('public'));

const oauth = new google.auth.OAuth2(E.GOOGLE_CLIENT_ID, E.GOOGLE_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: E.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth });

// ---- משתמשים: נשמרים כקובץ users.json בתיקיית הדרייב (הדיסק של Render זמני) ----
let users = null, usersId = null;
async function loadUsers() {
  if (users) return;
  const r = await drive.files.list({ q: `name='users.json' and '${E.DRIVE_FOLDER_ID}' in parents and trashed=false`, fields: 'files(id)' });
  if (r.data.files.length) {
    usersId = r.data.files[0].id;
    const f = await drive.files.get({ fileId: usersId, alt: 'media' });
    users = typeof f.data === 'string' ? JSON.parse(f.data) : f.data;
  } else users = {};
}
async function saveUsers() {
  const media = { mimeType: 'application/json', body: Readable.from([JSON.stringify(users)]) };
  if (usersId) await drive.files.update({ fileId: usersId, media });
  else { const r = await drive.files.create({ requestBody: { name: 'users.json', parents: [E.DRIVE_FOLDER_ID] }, media, fields: 'id' }); usersId = r.data.id; }
}

// ---- תיקיית ארכיון חודשית (לפי שעון ישראל), נוצרת אוטומטית עם המסמך הראשון של החודש ----
const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
function ilNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return p; // year, month, day, hour, minute
}
const monthFolders = new Map();
function monthFolder(y, m) {
  const name = `${y}-${m} (${MONTHS[+m - 1]} ${y})`;
  if (!monthFolders.has(name)) {
    const pr = (async () => {
      const r = await drive.files.list({ q: `name='${name}' and '${E.DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: 'files(id)' });
      if (r.data.files.length) return r.data.files[0].id;
      const c = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [E.DRIVE_FOLDER_ID] }, fields: 'id' });
      console.log(`[drive] created month folder "${name}"`);
      return c.data.id;
    })();
    pr.catch(() => monthFolders.delete(name));
    monthFolders.set(name, pr);
  }
  return monthFolders.get(name);
}

// ---- "הדפיקה הסודית": 6 לחיצות רצופות (כל אחת עד 10 שניות מהקודמת), נספרות בשרת לפי מספר ה-ID ----
// (לא לפי IP: מאחורי הפרוקסי של Render כתובת ה-IP שהשרת רואה משתנה בין בקשות)
const knocks = new Map();
function knock(key) {
  const now = Date.now(), k = knocks.get(key);
  const c = k && now - k.t < 10000 ? k.c + 1 : 1;
  knocks.set(key, { c, t: now });
  console.log(`[enter] id=${key} knock=${c}/6`);
  if (c >= 6) { knocks.delete(key); return true; }
  return false;
}

// ---- סשן חתום בעוגייה ----
const sign = s => crypto.createHmac('sha256', E.SESSION_SECRET).update(s).digest('hex');
function auth(req, res, next) {
  const m = /(?:^|; )s=([^;]+)/.exec(req.headers.cookie || '');
  if (m) {
    const [p, s] = m[1].split('.'), good = sign(p);
    if (s && s.length === good.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) {
      const d = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (d.e > Date.now()) { req.user = d.n; req.uid = d.i; return next(); }
    }
  }
  res.status(401).json({ ok: false, msg: 'יש להתחבר' });
}

// ---- "השכמה": הדף פונה לכאן כשהוא נפתח / כשחוזרים ללשונית, כדי להעיר את השרת של Render מראש ----
app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.post('/api/enter', async (req, res) => {
  try {
    const { fn = '', ln = '', id = '', pw = '' } = req.body;
    if (!fn.trim() || !ln.trim() || !/^\d{5,12}$/.test(id) || pw.length < 4) return res.status(400).json({ ok: false, msg: 'יש למלא את כל השדות (ID: ספרות בלבד, סיסמה: 4 תווים לפחות)' });
    if (!knock(id)) return res.json({ ok: false, msg: 'ההתחברות נכשלה' });
    await loadUsers();
    const name = fn.trim() + ' ' + ln.trim();
    if (!users[id]) { users[id] = { name, hash: await bcrypt.hash(pw, 10) }; await saveUsers(); console.log(`[enter] id=${id} new user created`); }
    else if (users[id].name.toLowerCase() !== name.toLowerCase()) { console.log(`[enter] id=${id} name mismatch (stored: "${users[id].name}", got: "${name}")`); return res.status(401).json({ ok: false, msg: 'ההתחברות נכשלה' }); }
    else if (!(await bcrypt.compare(pw, users[id].hash))) { console.log(`[enter] id=${id} wrong password`); return res.status(401).json({ ok: false, msg: 'ההתחברות נכשלה' }); }
    console.log(`[enter] id=${id} login ok`);
    const p = Buffer.from(JSON.stringify({ n: name, i: id, e: Date.now() + 864e5 })).toString('base64url');
    res.cookie('s', p + '.' + sign(p), { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 864e5 });
    res.json({ ok: true, name, id });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, msg: 'שגיאת שרת' }); }
});

app.post('/api/save', auth, async (req, res) => {
  try {
    const buf = Buffer.from(req.body.pdf || '', 'base64');
    if (!buf.length) return res.status(400).json({ ok: false, msg: 'חסר קובץ' });
    let link = null, fileId = null, mailed = false;
    if (!req.body.skipDrive) {
      const t = ilNow(), stamp = `${t.year}-${t.month}-${t.day}-${t.hour}-${t.minute}`;
      const folder = await monthFolder(t.year, t.month);
      const r = await drive.files.create({
        requestBody: { name: `רשימת-קניות-${stamp}-${req.user}-${req.uid}.pdf`, parents: [folder] },
        media: { mimeType: 'application/pdf', body: Readable.from(buf) }, fields: 'id,webViewLink'
      });
      link = r.data.webViewLink; fileId = r.data.id;
    }
    const mail = (req.body.mail || '').trim();
    if (mail) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ ok: false, msg: 'מייל לא תקין' });
      await nodemailer.createTransport({ service: 'gmail', auth: { user: E.GMAIL_USER, pass: E.GMAIL_APP_PASSWORD } })
        .sendMail({ from: E.GMAIL_USER, to: mail, subject: 'רשימת קניות', text: 'מצורפת רשימת הקניות.', attachments: [{ filename: 'shopping-list.pdf', content: buf }] });
      mailed = true;
    }
    res.json({ ok: true, link, fileId, mailed });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, msg: 'שגיאת שרת' }); }
});

// ---- שיתוף בוואטסאפ: פותח לצפייה (לכל מי שיש לו את הקישור) קובץ PDF של המשתמש המחובר בלבד ----
app.post('/api/share', auth, async (req, res) => {
  try {
    const fileId = String(req.body.fileId || '');
    if (!/^[\w-]{10,}$/.test(fileId)) return res.status(400).json({ ok: false, msg: 'קובץ לא תקין' });
    const f = await drive.files.get({ fileId, fields: 'name,parents,webViewLink' });
    const parent = (f.data.parents || [])[0];
    let inArchive = parent === E.DRIVE_FOLDER_ID;
    if (!inArchive && parent) inArchive = ((await drive.files.get({ fileId: parent, fields: 'parents' })).data.parents || []).includes(E.DRIVE_FOLDER_ID);
    if (!inArchive || !f.data.name.endsWith(`-${req.uid}.pdf`))
      return res.status(403).json({ ok: false, msg: 'אין הרשאה לקובץ' });
    await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
    res.json({ ok: true, link: f.data.webViewLink });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, msg: 'שגיאת שרת' }); }
});

app.listen(E.PORT || 3000, () => console.log('up'));
