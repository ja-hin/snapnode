const nodemailer = require('nodemailer');

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function fmt12(t) {
  const [hh, mm] = t.split(':').map(Number);
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

async function sendConfirmation(appt) {
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your@gmail.com') {
    console.log('📧 Email skipped (SMTP not configured)');
    return;
  }
  try {
    const transport = getTransport();
    const meetHtml = appt.meet_link
      ? `<p><a href="${appt.meet_link}" style="background:#E8531D;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:12px">📹 Join Google Meet</a></p>`
      : '';
    await transport.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || '3rd I Visuals'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: appt.email,
      subject: `Confirmed: Strategy Call on ${appt.date} at ${fmt12(appt.time_slot)}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <h2 style="color:#E8531D">You're booked! 🎉</h2>
          <p>Hi ${appt.name}, your strategy call is confirmed.</p>
          <table style="border-collapse:collapse;width:100%;margin:20px 0">
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Date</td><td style="padding:8px;border:1px solid #eee">${appt.date}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Time</td><td style="padding:8px;border:1px solid #eee">${fmt12(appt.time_slot)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Format</td><td style="padding:8px;border:1px solid #eee">Google Meet (video call)</td></tr>
          </table>
          ${meetHtml}
          <p style="color:#888;font-size:13px">Need to reschedule? Reply to this email.</p>
        </div>
      `,
    });
    console.log(`📧 Confirmation sent to ${appt.email}`);
  } catch (e) {
    console.error('Email error:', e.message);
  }
}

async function sendAdminNotification(appt) {
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your@gmail.com') return;
  try {
    const transport = getTransport();
    await transport.sendMail({
      from: `"SnapDemo" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: `New booking: ${appt.name} on ${appt.date}`,
      html: `<p>New booking from <strong>${appt.name}</strong> (${appt.email})<br>
             Date: ${appt.date} at ${fmt12(appt.time_slot)}<br>
             ${appt.company ? `Company: ${appt.company}<br>` : ''}
             Goal: ${appt.goal || 'N/A'}</p>`,
    });
  } catch (e) {
    console.error('Admin email error:', e.message);
  }
}

module.exports = { sendConfirmation, sendAdminNotification };
