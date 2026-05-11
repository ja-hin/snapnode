const express = require('express');
const router  = express.Router();
const db      = require('../db');
const gcal    = require('../helpers/googleCalendar');
const mailer  = require('../helpers/mailer');

function requireAdmin(req, res, next) {
  if (!req.session?.adminLoggedIn) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── PUBLIC ────────────────────────────────────────────────────

// GET /api/slots?date=YYYY-MM-DD
router.get('/slots', (req, res) => {
  const { date } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  const slots = db.getAvailableSlots(date);
  res.json({ date, slots });
});

// GET /api/working_hours
router.get('/working_hours', (req, res) => {
  res.json(db.getWorkingHours());
});

// POST /api/book
router.post('/book', async (req, res) => {
  const body = req.body;
  for (const f of ['name', 'email', 'date', 'time_slot']) {
    if (!body[f]) return res.status(400).json({ error: `Missing: ${f}` });
  }

  const available = db.getAvailableSlots(body.date);
  if (!available.includes(body.time_slot)) {
    return res.status(409).json({ error: 'This slot is no longer available. Please choose another.' });
  }

  body.source   = 'self-booked';
  body.duration = parseInt(db.getSetting('meeting_duration') || process.env.MEETING_DURATION || 30);

  let meetLink = null;
  try {
    const gcalResult = await gcal.createEvent(body);
    if (gcalResult.success) {
      body.google_event_id = gcalResult.event_id;
      body.meet_link       = gcalResult.meet_link;
      meetLink             = gcalResult.meet_link;
    } else {
      console.warn('Google Calendar error:', gcalResult.error);
    }
  } catch (e) {
    console.warn('Google Calendar exception:', e.message);
  }

  const id   = db.createAppointment(body);
  const appt = db.getAppointmentById(id);

  mailer.sendConfirmation(appt).catch(console.error);
  mailer.sendAdminNotification(appt).catch(console.error);

  res.json({ success: true, id, meet_link: meetLink, message: 'Booking confirmed! Check your email.' });
});

// ── ADMIN ─────────────────────────────────────────────────────

router.get('/appointments', requireAdmin, (req, res) => {
  res.json(db.getAllAppointments(req.query.filter || 'all'));
});

router.get('/stats', requireAdmin, (req, res) => {
  res.json(db.getStats());
});

router.post('/create_meeting', requireAdmin, async (req, res) => {
  const body = req.body;
  for (const f of ['name', 'email', 'date', 'time_slot']) {
    if (!body[f]) return res.status(400).json({ error: `Missing: ${f}` });
  }

  body.source       = 'admin-created';
  body.status       = 'confirmed';
  body.duration     = parseInt(body.duration || db.getSetting('meeting_duration') || 30);
  body.meeting_type = body.meeting_type || 'Product demo';

  let gcalResult = { success: false };
  try {
    gcalResult = await gcal.createEvent(body);
    if (gcalResult.success) {
      body.google_event_id = gcalResult.event_id;
      body.meet_link       = gcalResult.meet_link;
    }
  } catch (e) { console.warn('GCal error:', e.message); }

  const id   = db.createAppointment(body);
  const appt = db.getAppointmentById(id);

  if (body.send_invite) mailer.sendConfirmation(appt).catch(console.error);

  res.json({
    success:    true, id,
    meet_link:  gcalResult.meet_link  || null,
    event_link: gcalResult.html_link  || null,
    gcal_ok:    gcalResult.success,
    message:    'Meeting created successfully',
  });
});

router.delete('/appointment', requireAdmin, async (req, res) => {
  const id   = parseInt(req.query.id);
  const appt = db.getAppointmentById(id);
  if (!appt) return res.status(404).json({ error: 'Not found' });

  if (appt.google_event_id) await gcal.deleteEvent(appt.google_event_id).catch(() => {});
  db.updateAppointment(id, { status: 'cancelled' });
  res.json({ success: true });
});

router.post('/block_slot', requireAdmin, (req, res) => {
  const { date, period, time_slot, reason } = req.body;
  db.addBlockedSlot(date, period || 'full', time_slot || null, reason || null);
  res.json({ success: true });
});

router.delete('/block_slot', requireAdmin, (req, res) => {
  db.removeBlockedSlot(parseInt(req.query.id));
  res.json({ success: true });
});

router.post('/save_hours', requireAdmin, (req, res) => {
  if (req.body.hours) db.saveWorkingHours(req.body.hours);
  if (req.body.settings) {
    for (const [k, v] of Object.entries(req.body.settings)) {
      db.saveSetting(k, v);
    }
  }
  res.json({ success: true });
});

router.get('/gcal_status', requireAdmin, (req, res) => {
  res.json({ connected: gcal.isConnected() });
});

module.exports = router;
