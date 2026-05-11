const express = require('express');
const router  = express.Router();
const path    = require('path');
const gcal    = require('../helpers/googleCalendar');
const db      = require('../db');

function requireAdmin(req, res, next) {
  if (!req.session?.adminLoggedIn) return res.redirect('/admin/login');
  next();
}

// ── Login ─────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/login.html'));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.adminLoggedIn = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ── Main admin panel ─────────────────────────────────────────
router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// ── Google OAuth ──────────────────────────────────────────────
router.get('/oauth/connect', requireAdmin, (req, res) => {
  res.redirect(gcal.getAuthUrl());
});

// This is the key fix: no ModSecurity issues since it's on localhost!
router.get('/oauth/callback', requireAdmin, async (req, res) => {
  const { code, error } = req.query;

  if (error) return res.send(`<p>OAuth error: ${error}. <a href="/admin">Back</a></p>`);
  if (!code)  return res.send(`<p>No code received. <a href="/admin">Back</a></p>`);

  try {
    const token = await gcal.exchangeCode(code);
    if (!token.access_token) {
      return res.send(`<p>Token exchange failed: ${JSON.stringify(token)}. <a href="/admin">Back</a></p>`);
    }
    token.expires_at = Math.floor(Date.now() / 1000) + (token.expires_in || 3600);
    db.saveToken(token);
    res.redirect('/admin?connected=1');
  } catch (e) {
    res.send(`<p>Error: ${e.message}. <a href="/admin">Back</a></p>`);
  }
});

router.get('/oauth/disconnect', requireAdmin, (req, res) => {
  db.deleteToken();
  res.redirect('/admin');
});

// ── Admin data endpoints (for the SPA) ───────────────────────
router.get('/data/init', requireAdmin, (req, res) => {
  res.json({
    gcalConnected: gcal.isConnected(),
    gcalAuthUrl:   '/admin/oauth/connect',
    stats:         db.getStats(),
    upcoming:      db.getAllAppointments('upcoming').slice(0, 10),
    workingHours:  db.getWorkingHours(),
    blockedDates:  db.getBlockedDates(),
    duration:      db.getSetting('meeting_duration') || process.env.MEETING_DURATION || 30,
    buffer:        db.getSetting('buffer_minutes')   || process.env.BUFFER_MINUTES   || 15,
    calendarId:    process.env.GOOGLE_CALENDAR_ID    || 'primary',
  });
});

module.exports = router;
