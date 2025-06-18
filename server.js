const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const csvParser = require('csv-parser');
const ping = require('ping');

const app = express();
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use('/static', express.static(path.join(__dirname, 'static')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: UPLOAD_DIR });

let servers = [];
let originalData = [];
let sourceFile = null;
let pingInterval = 5;
let pingTimer = null;

function allowedToPing(name) {
  return name.startsWith('DP') || name.startsWith('CDN77');
}

function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', row => rows.push(Object.values(row)))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function parseXlsx(filePath) {
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { header: 1 });
}

async function loadFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let rows;
  if (ext === '.csv') {
    rows = await parseCsv(filePath);
  } else {
    rows = parseXlsx(filePath);
  }
  originalData = rows;
  sourceFile = filePath;
  servers = rows.map(r => ({
    name: r[0] || '',
    primary_ip: r[1] || '',
    ipmi_ip: r[2] || '',
    last_primary: null,
    last_ipmi: null,
    primary_up: null,
    ipmi_up: null
  }));
}

async function pingAddress(address) {
  try {
    const res = await ping.promise.probe(address, { timeout: 1 });
    return res.alive;
  } catch {
    return false;
  }
}

async function runPings() {
  for (const srv of servers) {
    if (srv.primary_ip && allowedToPing(srv.name)) {
      const ok = await pingAddress(srv.primary_ip);
      srv.primary_up = ok;
      if (ok) srv.last_primary = Date.now();
    }
    if (srv.ipmi_ip && allowedToPing(srv.name)) {
      const now = Date.now();
      if (!srv.last_ipmi || now - srv.last_ipmi > 60000) {
        const ok = await pingAddress(srv.ipmi_ip);
        srv.ipmi_up = ok;
        if (ok) srv.last_ipmi = Date.now();
      }
    }
  }
}

function startPinging() {
  if (pingTimer) return;
  pingTimer = setInterval(runPings, pingInterval * 1000);
  runPings();
}

function stopPinging() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

app.get('/', (req, res) => {
  res.render('index', { servers, running: !!pingTimer, interval: pingInterval, allowedToPing });
});

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file');
  }
  await loadFile(req.file.path);
  res.redirect('/');
});

app.post('/start_ping', (req, res) => {
  const interval = parseInt(req.body.interval || '5', 10);
  pingInterval = interval;
  startPinging();
  res.status(204).end();
});

app.post('/stop_ping', (req, res) => {
  stopPinging();
  res.status(204).end();
});

app.get('/status', (req, res) => {
  const now = Date.now();
  const data = servers.map(s => ({
    name: s.name,
    primary_ip: s.primary_ip,
    ipmi_ip: s.ipmi_ip,
    last_primary: s.last_primary ? Math.floor((now - s.last_primary) / 1000) : null,
    last_ipmi: s.last_ipmi ? Math.floor((now - s.last_ipmi) / 1000) : null,
    primary_up: s.primary_up,
    ipmi_up: s.ipmi_up
  }));
  res.json(data);
});

app.post('/update_ip', express.urlencoded({ extended: true }), (req, res) => {
  const idx = parseInt(req.body.index, 10);
  const field = req.body.field;
  const value = req.body.value || '';
  const srv = servers[idx];
  if (srv) {
    if (field === 'primary') {
      srv.primary_ip = value;
      srv.last_primary = null;
      srv.primary_up = null;
    } else {
      srv.ipmi_ip = value;
      srv.last_ipmi = null;
      srv.ipmi_up = null;
    }
  }
  res.status(204).end();
});

app.get('/export', (req, res) => {
  if (!originalData.length) return res.status(400).send('No data');
  const rows = originalData.map((r, i) => {
    const srv = servers[i] || {};
    return [
      r[0] || '',
      r[1] || '',
      r[2] || '',
      srv.last_primary ? new Date(srv.last_primary).toISOString() : '',
      srv.last_ipmi ? new Date(srv.last_ipmi).toISOString() : ''
    ];
  });
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet([['Server','Primary IP','IPMI IP','Last Ping Primary IP','Last Ping IPMI IP'], ...rows]);
  xlsx.utils.book_append_sheet(wb, ws, 'Export');
  const outPath = path.join(UPLOAD_DIR, path.basename(sourceFile, path.extname(sourceFile)) + '_export.csv');
  xlsx.writeFile(wb, outPath, { bookType: 'csv' });
  res.download(outPath);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
