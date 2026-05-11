const axios = require('axios');
const db = require('../db');

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
    access_type:   'offline',
    prompt:        'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const res = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
    grant_type:    'authorization_code',
  }));
  return res.data;
}

async function refreshToken(refreshTok) {
  const res = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    refresh_token: refreshTok,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type:    'refresh_token',
  }));
  return res.data;
}

async function getAccessToken() {
  let token = db.loadToken();
  if (!token) return null;

  if (token.expires_at && Date.now() / 1000 > token.expires_at - 60) {
    if (!token.refresh_token) return null;
    try {
      const fresh = await refreshToken(token.refresh_token);
      fresh.refresh_token = token.refresh_token;
      fresh.expires_at = Math.floor(Date.now() / 1000) + (fresh.expires_in || 3600);
      db.saveToken(fresh);
      return fresh.access_token;
    } catch { return null; }
  }
  return token.access_token;
}

function isConnected() {
  return db.loadToken() !== null;
}

async function createEvent(appt) {
  const accessToken = await getAccessToken();
  if (!accessToken) return { success: false, error: 'Not authenticated with Google' };

  const tz = process.env.TIMEZONE || 'Asia/Kolkata';
  const duration = parseInt(appt.duration || process.env.MEETING_DURATION || 30);

  const start = new Date(`${appt.date}T${appt.time_slot}:00`);
  const end   = new Date(start.getTime() + duration * 60000);

  const toRFC = (d) => d.toISOString().replace(/\.\d{3}Z$/, '+05:30'); // adjust for IST

  const body = {
    summary: `${appt.meeting_type || 'Product Demo'} — ${appt.name}`,
    description: buildDescription(appt),
    start: { dateTime: start.toISOString(), timeZone: tz },
    end:   { dateTime: end.toISOString(),   timeZone: tz },
    attendees: [{ email: appt.email }],
    conferenceData: {
      createRequest: {
        requestId: `sdemo_${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'popup', minutes: 15 },
      ],
    },
  };

  try {
    const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');
    const res = await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?conferenceDataVersion=1&sendUpdates=all`,
      body,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    const data = res.data;
    return {
      success:   true,
      event_id:  data.id,
      meet_link: data.conferenceData?.entryPoints?.[0]?.uri || '',
      html_link: data.htmlLink || '',
    };
  } catch (e) {
    return { success: false, error: e.response?.data?.error?.message || e.message };
  }
}

async function deleteEvent(eventId) {
  const accessToken = await getAccessToken();
  if (!accessToken) return false;
  try {
    const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');
    await axios.delete(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return true;
  } catch { return false; }
}

function buildDescription(a) {
  const lines = ['📅 Booking via 3rd I Visuals Demo Scheduler\n'];
  if (a.company)   lines.push(`🏢 Company: ${a.company}`);
  if (a.phone)     lines.push(`📱 Phone: ${a.phone}`);
  if (a.team_size) lines.push(`👥 Team size: ${a.team_size}`);
  if (a.goal)      lines.push(`\n💬 Goal:\n${a.goal}`);
  return lines.join('\n');
}

module.exports = { getAuthUrl, exchangeCode, isConnected, createEvent, deleteEvent };
