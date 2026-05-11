require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const api = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, ''); // e.g. '/snap' or ''

// Injects window.__BASE__ into any HTML file before serving
function serveHtml(filePath) {
  return (_req, res) => {
    const html = fs.readFileSync(filePath, 'utf8')
      .replace('</head>', `<script>window.__BASE__='${BASE}'</script></head>`);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  };
}
exports.serveHtml = serveHtml;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'snapdemo_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Static assets (served under BASE path, index:false so HTML goes through serveHtml)
app.use(BASE || '/', express.static(path.join(__dirname, 'public'), { index: false }));

// Routes
app.use(`${BASE}/api`, api);
app.use(`${BASE}/admin`, adminRoutes);

// Booking page (inject BASE)
app.get(`${BASE}/`, serveHtml(path.join(__dirname, 'public', 'index.html')));
app.get(`${BASE}`,  serveHtml(path.join(__dirname, 'public', 'index.html')));

// Init DB and start
db.init();
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}${BASE}`;
  console.log(`\n✅ SnapDemo running at ${url}`);
  console.log(`📅 Booking page: ${url}/`);
  console.log(`🔧 Admin panel:  ${url}/admin`);
  console.log(`\n🔑 Admin login:  ${process.env.ADMIN_USERNAME} / ${process.env.ADMIN_PASSWORD}`);
});
