const initSqlJs = require('sql.js');
const pathModule = require('path');
const fs = require('fs');

const DB_PATH    = pathModule.join(__dirname, 'data', 'snapdemo.db');
const TOKEN_PATH = pathModule.join(__dirname, 'data', 'google_token.json');

let _db  = null;

function persist() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function init() {
  const dataDir = pathModule.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new SQL.Database();
  }

  _db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT,
    team_size TEXT, goal TEXT, notes TEXT, date TEXT NOT NULL,
    time_slot TEXT NOT NULL, duration INTEGER DEFAULT 30,
    status TEXT DEFAULT 'confirmed', source TEXT DEFAULT 'self-booked',
    meeting_type TEXT DEFAULT 'Product demo', google_event_id TEXT,
    meet_link TEXT, reminder_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS working_hours (
    day_of_week INTEGER PRIMARY KEY, is_active INTEGER DEFAULT 1,
    from_time TEXT DEFAULT '09:00', to_time TEXT DEFAULT '18:00'
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS blocked_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
    period TEXT DEFAULT 'full', time_slot TEXT, reason TEXT
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

  const c = qa('SELECT COUNT(*) as c FROM working_hours')[0];
  if (!c || c.c === 0) {
    for (let i = 0; i <= 6; i++) {
      _db.run('INSERT INTO working_hours (day_of_week,is_active,from_time,to_time) VALUES (?,?,?,?)',
        [i, (i >= 1 && i <= 5) ? 1 : 0, '09:00', '18:00']);
    }
  }

  persist();
  console.log('✅ Database ready:', DB_PATH);
}

function qa(sql, p=[]) {
  const stmt = _db.prepare(sql); stmt.bind(p);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function q1(sql, p=[]) { return qa(sql,p)[0] || null; }
function rw(sql, p=[]) { _db.run(sql,p); persist(); }
function ri(sql, p=[]) { _db.run(sql,p); const r=q1('SELECT last_insert_rowid() as id'); persist(); return r?r.id:null; }

function getAvailableSlots(date) {
  const dow = new Date(date+'T00:00:00').getDay();
  const hours = q1('SELECT * FROM working_hours WHERE day_of_week=?',[dow]);
  if (!hours || !hours.is_active) return [];
  const duration = parseInt(getSetting('meeting_duration')||process.env.MEETING_DURATION||30);
  const buffer   = parseInt(getSetting('buffer_minutes')  ||process.env.BUFFER_MINUTES  ||15);
  const slots=[], end=(+hours.to_time.split(':')[0])*60+(+hours.to_time.split(':')[1]);
  let cur=(+hours.from_time.split(':')[0])*60+(+hours.from_time.split(':')[1]);
  while(cur+duration<=end){slots.push(`${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`);cur+=duration+buffer;}
  const booked  = qa("SELECT time_slot FROM appointments WHERE date=? AND status!='cancelled'",[date]).map(r=>r.time_slot);
  const blocked = qa('SELECT * FROM blocked_slots WHERE date=?',[date]);
  if(blocked.some(b=>b.period==='full'&&!b.time_slot)) return [];
  return slots.filter(s=>{
    if(booked.includes(s)) return false;
    for(const b of blocked){
      if(b.time_slot===s) return false;
      if(b.period==='morning'&&s<'12:00') return false;
      if(b.period==='afternoon'&&s>='12:00') return false;
    }
    return true;
  });
}

function createAppointment(d) {
  return ri(`INSERT INTO appointments (name,email,phone,company,team_size,goal,notes,date,time_slot,duration,status,source,meeting_type,google_event_id,meet_link) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [d.name,d.email,d.phone||null,d.company||null,d.team_size||null,d.goal||null,d.notes||null,d.date,d.time_slot,d.duration||30,d.status||'confirmed',d.source||'self-booked',d.meeting_type||'Product demo',d.google_event_id||null,d.meet_link||null]);
}
function getAppointmentById(id){ return q1('SELECT * FROM appointments WHERE id=?',[id]); }
function getAllAppointments(filter='all'){
  const Q={upcoming:"SELECT * FROM appointments WHERE date>=date('now') AND status!='cancelled' ORDER BY date ASC,time_slot ASC",past:"SELECT * FROM appointments WHERE date<date('now') ORDER BY date DESC",cancelled:"SELECT * FROM appointments WHERE status='cancelled' ORDER BY date DESC",all:"SELECT * FROM appointments ORDER BY date DESC,time_slot DESC"};
  return qa(Q[filter]||Q.all);
}
function updateAppointment(id,fields){ const sets=Object.keys(fields).map(k=>k+'=?').join(','); rw(`UPDATE appointments SET ${sets} WHERE id=?`,[...Object.values(fields),id]); }
function getStats(){
  return {
    this_week: q1("SELECT COUNT(*) as c FROM appointments WHERE date>=date('now','weekday 1','-7 days') AND status!='cancelled'")?.c||0,
    this_month:q1("SELECT COUNT(*) as c FROM appointments WHERE strftime('%Y-%m',date)=strftime('%Y-%m','now') AND status!='cancelled'")?.c||0,
    total:     q1("SELECT COUNT(*) as c FROM appointments WHERE status!='cancelled'")?.c||0,
    next_slot: q1("SELECT date,time_slot FROM appointments WHERE date>=date('now') AND status!='cancelled' ORDER BY date,time_slot LIMIT 1"),
  };
}
function getWorkingHours(){ return qa('SELECT * FROM working_hours ORDER BY day_of_week'); }
function saveWorkingHours(hours){ hours.forEach(h=>rw('UPDATE working_hours SET is_active=?,from_time=?,to_time=? WHERE day_of_week=?',[h.is_active,h.from_time,h.to_time,h.day_of_week])); }
function getBlockedDates(){ return qa('SELECT * FROM blocked_slots ORDER BY date'); }
function addBlockedSlot(date,period='full',timeSlot=null,reason=null){ ri('INSERT INTO blocked_slots (date,period,time_slot,reason) VALUES (?,?,?,?)',[date,period,timeSlot,reason]); }
function removeBlockedSlot(id){ rw('DELETE FROM blocked_slots WHERE id=?',[id]); }
function getSetting(key,def=null){ const r=q1('SELECT value FROM settings WHERE key=?',[key]); return r?r.value:def; }
function saveSetting(key,value){ rw('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)',[key,String(value)]); }
function saveToken(t){ fs.writeFileSync(TOKEN_PATH,JSON.stringify(t)); }
function loadToken(){ if(!fs.existsSync(TOKEN_PATH))return null; try{return JSON.parse(fs.readFileSync(TOKEN_PATH,'utf8'));}catch{return null;} }
function deleteToken(){ if(fs.existsSync(TOKEN_PATH))fs.unlinkSync(TOKEN_PATH); }

module.exports = { init, getAvailableSlots, createAppointment, getAppointmentById, getAllAppointments, updateAppointment, getStats, getWorkingHours, saveWorkingHours, getBlockedDates, addBlockedSlot, removeBlockedSlot, getSetting, saveSetting, saveToken, loadToken, deleteToken };
