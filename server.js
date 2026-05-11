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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'snapdemo_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api', api);
app.use('/admin', adminRoutes);

// Booking page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Init DB and start
db.init();
app.listen(PORT, () => {
  console.log(`\n✅ SnapDemo running at http://localhost:${PORT}`);
  console.log(`📅 Booking page: http://localhost:${PORT}`);
  console.log(`🔧 Admin panel:  http://localhost:${PORT}/admin`);
  console.log(`\n🔑 Admin login:  ${process.env.ADMIN_USERNAME} / ${process.env.ADMIN_PASSWORD}`);
});
