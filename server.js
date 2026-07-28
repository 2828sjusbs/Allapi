require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const OWNER = '@sahilxalone';
const CHANNEL = '@OSINTNXERA';

const MASTER_KEYS = {
    ftosint: 'sahil-new',
    mistral: 'FVKec5Xqa2ORzSoBrqi21nRbIM6rFk2q'
};

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'api_keys.db');
const db = new sqlite3.Database(DB_PATH);

// ============ LIVE STATS STORAGE ============
let liveStats = {
    totalHits: 0,
    activeKeys: 0,
    apiStatus: {},
    requestsPerSecond: 0,
    uptime: new Date(),
    topAPIs: [],
    topKeys: [],
    recentErrors: []
};

let connectedClients = [];

// ============ DATABASE INITIALIZATION ============
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        name TEXT,
        owner_username TEXT,
        owner_channel TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        hits INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        unlimited_hits INTEGER DEFAULT 0,
        allowed_apis TEXT DEFAULT '["all"]',
        is_custom INTEGER DEFAULT 0,
        rate_limit_enabled INTEGER DEFAULT 1,
        rate_limit_per_day INTEGER DEFAULT 100,
        rate_limit_per_hour INTEGER DEFAULT 20,
        rate_limit_per_minute INTEGER DEFAULT 5,
        key_note TEXT DEFAULT '',
        note_enabled INTEGER DEFAULT 0,
        last_updated DATETIME,
        api_enabled INTEGER DEFAULT 1,
        geo_restrictions TEXT DEFAULT '[]',
        ip_whitelist TEXT DEFAULT '[]',
        webhook_url TEXT DEFAULT '',
        last_request DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS rate_limit_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date TEXT,
        hour INTEGER,
        minute INTEGER,
        requests INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        endpoint TEXT,
        status_code INTEGER,
        ip_address TEXT,
        response_time INTEGER,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        country TEXT DEFAULT 'Unknown'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS daily_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date DATE,
        calls INTEGER DEFAULT 0,
        UNIQUE(api_key, date)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER,
        event TEXT,
        payload TEXT,
        status_code INTEGER,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS api_health (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_name TEXT,
        status TEXT DEFAULT 'up',
        last_check DATETIME,
        response_time INTEGER,
        error_message TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS available_apis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        display_name TEXT,
        endpoint TEXT,
        required_params TEXT,
        example_params TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY,
        maintenance_message TEXT DEFAULT 'API is currently under maintenance.',
        master_api INTEGER DEFAULT 1
    )`);

    db.get(`SELECT * FROM settings WHERE id = 1`, [], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO settings (id, maintenance_message, master_api) VALUES (1, 'API is currently under maintenance.', 1)`);
        }
    });

    db.get(`SELECT * FROM users WHERE username = 'main'`, [], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role, created_by) VALUES (?, ?, ?, ?)`, 
                ['main', bcrypt.hashSync('sahil', 10), 'head_admin', 'system']);
        }
    });

    db.get(`SELECT * FROM users WHERE username = 'sahil'`, [], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role, created_by) VALUES (?, ?, ?, ?)`, 
                ['sahil', bcrypt.hashSync('sexy', 10), 'admin', 'main']);
        }
    });

    db.get(`SELECT COUNT(*) as count FROM available_apis`, [], (err, row) => {
        if (row && row.count === 0) {
            const apis = [
                ['leakpro', '🔓 Leak Pro', '/api/leakpro', 'number', '{"number":"918887882236"}', 'LEAK pro information'],
                ['vehicle-info', '🚗 Vehicle Info', '/api/vehicle-info', 'vehicle', '{"vehicle":"UP42BB2572"}', 'Get vehicle challan/info'],
                ['telegram-num', '📞 Telegram to Number', '/api/telegram-num', 'term', '{"term":"7577179320"}', 'Get number from Telegram ID'],
                ['family-info', '👨‍👩‍👧‍👦 Family Info', '/api/family-info', 'q', '{"q":"942660008471"}', 'Family information lookup'],
                ['number-info', '📱 Number Info', '/api/number-info', 'q', '{"q":"9876543321"}', 'Complete number information'],
                ['aadhar-info', '🆔 Aadhar Info', '/api/aadhar-info', 'q', '{"q":"942660008471"}', 'Aadhar card information'],
                ['num-newinfo', '🔍 Number New Info', '/api/num-newinfo', 'q', '{"q":"1234597890"}', 'Advanced number information'],
                ['email-info', '📧 Email Info', '/api/email-info', 'q', '{"q":"test@email.com"}', 'Email address information'],
                ['insta', '📸 Instagram Info', '/api/insta', 'username', '{"username":"instagram"}', 'Instagram profile'],
                ['num-india', '🇮🇳 Indian Number', '/api/num-india', 'num', '{"num":"9876543210"}', 'Indian mobile number details'],
                ['num-pak', '🇵🇰 Pakistani Number', '/api/num-pak', 'number', '{"number":"03001234567"}', 'Pakistani mobile number'],
                ['bank', '🏦 Bank IFSC', '/api/bank', 'ifsc', '{"ifsc":"SBIN0001234"}', 'Bank branch details'],
                ['pan', '📄 PAN Card', '/api/pan', 'pan', '{"pan":"AXDPR2606K"}', 'PAN card details'],
                ['rc', '📋 RC Details', '/api/rc', 'owner', '{"owner":"HR26EV0001"}', 'Registration certificate'],
                ['ip', '🌐 IP Geolocation', '/api/ip', 'ip', '{"ip":"8.8.8.8"}', 'IP address location'],
                ['pincode', '📍 Pincode Info', '/api/pincode', 'pin', '{"pin":"110001"}', 'Area details'],
                ['git', '🐙 GitHub User', '/api/git', 'username', '{"username":"octocat"}', 'GitHub profile'],
                ['bgmi', '🎮 BGMI Player', '/api/bgmi', 'uid', '{"uid":"5121439477"}', 'BGMI player stats'],
                ['ff', '🔫 FreeFire ID', '/api/ff', 'uid', '{"uid":"123456789"}', 'FreeFire player'],
                ['ai-image', '🎨 AI Image Gen', '/api/ai-image', 'prompt', '{"prompt":"cyberpunk cat"}', 'Generate AI images'],
                ['leak', '🔍 Leak Info', '/api/leak', 'number', '{"number":"918887882236"}', 'Complete phone info'],
                ['mistral', '🤖 Mistral AI', '/api/mistral', 'message', '{"message":"What is AI?"}', 'Chat with Mistral AI'],
                ['veh-to-num', '🚗 Vehicle to Number', '/api/veh-to-num', 'term', '{"term":"UP50P5434"}', 'Vehicle to mobile number']
            ];
            
            apis.forEach(api => {
                db.run(`INSERT INTO available_apis (name, display_name, endpoint, required_params, example_params, description) VALUES (?, ?, ?, ?, ?, ?)`, api);
            });
            console.log('✅ ' + apis.length + ' APIs inserted');
        }
    });
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(cors());

app.use(session({
    secret: 'osint_secret_2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: (req) => req.query.key || req.ip,
    handler: (req, res) => res.json({ error: 'Rate limit exceeded', contact: OWNER })
});

function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

function requireHeadAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'head_admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
}

// ============ WEBSOCKET LIVE UPDATES ============
wss.on('connection', (ws) => {
    console.log('🔗 Client connected to live stats');
    connectedClients.push(ws);
    
    ws.send(JSON.stringify({ type: 'connect', message: 'Connected to live dashboard', stats: liveStats }));
    
    ws.on('close', () => {
        connectedClients = connectedClients.filter(c => c !== ws);
        console.log('🔌 Client disconnected');
    });
});

// ============ BROADCAST LIVE STATS ============
function broadcastStats() {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'stats', data: liveStats }));
        }
    });
}

// ============ API PROXY MAP ============
const apiProxyMap = {
    'leakpro': (p) => `https://raxxosint.onrender.com/leakosint?key=Customer&quiry=${p.number}`,
    'vehicle-info': (p) => `https://leakapi.dpdns.org/vehicle-info?registration_number=${p.vehicle || p.q || p.term}`,
    'telegram-num': (p) => `https://tg-to-num-501x.onrender.com/api/tg?key=permanant&info=${p.term || p.id || p.username}`,
    'family-info': (p) => `https://osint.invalidayushh.workers.dev/adhar?key=Sahil&q=${p.q || p.term || p.id}`,
    'number-info': (p) => `https://osint.invalidayushh.workers.dev/num?key=Sahil&q=${p.q || p.number || p.num}`,
    'aadhar-info': (p) => `https://osint.invalidayushh.workers.dev/adhar?key=Sahil&q=${p.q || p.num || p.aadhar}`,
    'num-newinfo': (p) => `https://leakapi.dpdns.org/search?q=${p.q || p.number || p.num}`,
    'email-info': (p) => `https://osint.invalidayushh.workers.dev/email?key=Sahil&q=${p.q || p.email}`,
    'insta': (p) => `https://osint.invalidayushh.workers.dev/insta?key=Sahil&q=${p.username}`,
    'num-india': (p) => `https://ft-osint-api.duckdns.org/api/number?key=${MASTER_KEYS.ftosint}&num=${p.num}`,
    'num-pak': (p) => `https://ft-osint-api.duckdns.org/api/pk?key=${MASTER_KEYS.ftosint}&number=${p.number}`,
    'bank': (p) => `https://ft-osint-api.duckdns.org/api/ifsc?key=${MASTER_KEYS.ftosint}&ifsc=${p.ifsc}`,
    'pan': (p) => `https://ft-osint-api.duckdns.org/api/pan?key=${MASTER_KEYS.ftosint}&pan=${p.pan}`,
    'rc': (p) => `https://leakapi.dpdns.org/rc?registration_number=${p.owner}`,
    'ip': (p) => `https://ft-osint-api.duckdns.org/api/ip?key=${MASTER_KEYS.ftosint}&ip=${p.ip}`,
    'pincode': (p) => `https://ft-osint-api.duckdns.org/api/pincode?key=${MASTER_KEYS.ftosint}&pin=${p.pin}`,
    'git': (p) => `https://ft-osint-api.duckdns.org/api/git?key=${MASTER_KEYS.ftosint}&username=${p.username}`,
    'bgmi': (p) => `https://ft-osint-api.duckdns.org/api/bgmi?key=${MASTER_KEYS.ftosint}&uid=${p.uid}`,
    'ff': (p) => `https://ft-osint-api.duckdns.org/api/ff?key=${MASTER_KEYS.ftosint}&uid=${p.uid}`,
    'ai-image': (p) => `https://ayaanmods.site/aiimage.php?key=${MASTER_KEYS.ayaanmods}&prompt=${p.prompt}`,
    'leak': (p) => `https://leakapi.dpdns.org/chain?q=${p.number}`,
    'mistral': `mistral-direct`,
    'veh-to-num': (p) => `https://vehicleinfo.noobgamingv40.workers.dev/fetch?vehicle=${p.vehicle || p.term}`
};

// ============ WEBHOOK SENDER ============
async function sendWebhook(keyId, event, payload) {
    db.get('SELECT webhook_url FROM api_keys WHERE id = ?', [keyId], async (err, key) => {
        if (!key || !key.webhook_url) return;
        
        try {
            const response = await axios.post(key.webhook_url, { event, payload, timestamp: new Date() }, { timeout: 5000 });
            db.run('INSERT INTO webhook_logs (key_id, event, payload, status_code) VALUES (?, ?, ?, ?)',
                [keyId, event, JSON.stringify(payload), response.status]);
        } catch(e) {
            db.run('INSERT INTO webhook_logs (key_id, event, payload, status_code) VALUES (?, ?, ?, ?)',
                [keyId, event, JSON.stringify(payload), 0]);
        }
    });
}

// ============ API HEALTH CHECK ============
async function checkAPIHealth() {
    const apis = Object.entries(apiProxyMap).slice(0, 5);
    
    for (const [name, fn] of apis) {
        try {
            const start = Date.now();
            if (typeof fn === 'string') continue;
            const testUrl = fn({ test: '1' });
            await axios.head(testUrl, { timeout: 5000 });
            const responseTime = Date.now() - start;
            
            db.run(`INSERT OR REPLACE INTO api_health (api_name, status, response_time, last_check) VALUES (?, ?, ?, ?)`,
                [name, 'up', responseTime, new Date().toISOString()]);
        } catch(e) {
            db.run(`INSERT OR REPLACE INTO api_health (api_name, status, error_message, last_check) VALUES (?, ?, ?, ?)`,
                [name, 'down', e.message, new Date().toISOString()]);
        }
    }
}

// ============ ROUTES ============

app.get('/', (req, res) => {
    db.get('SELECT COUNT(*) as total_apis FROM available_apis', [], (err, apisCount) => {
        db.get('SELECT COUNT(*) as total_keys FROM api_keys', [], (err, keysCount) => {
            db.get('SELECT SUM(hits) as total_hits FROM api_keys', [], (err, hitsTotal) => {
                res.render('index', { 
                    user: req.session.user || null,
                    totalApis: apisCount ? apisCount.total_apis : 0,
                    totalKeys: keysCount ? keysCount.total_keys : 0,
                    totalHits: hitsTotal ? hitsTotal.total_hits : 0,
                    owner: OWNER,
                    channel: CHANNEL
                });
            });
        });
    });
});

// ============ LIVE ANALYTICS ENDPOINTS ============

app.get('/api/analytics/live', (req, res) => {
    res.json(liveStats);
});

app.get('/api/analytics/daily', requireAuth, (req, res) => {
    db.all(`SELECT date, SUM(calls) as total FROM daily_calls GROUP BY date ORDER BY date DESC LIMIT 30`, [], (err, data) => {
        res.json({ success: !err, data: data || [] });
    });
});

app.get('/api/analytics/endpoints', requireAuth, (req, res) => {
    db.all(`SELECT endpoint, COUNT(*) as count, AVG(response_time) as avg_time FROM analytics GROUP BY endpoint ORDER BY count DESC`, [], (err, data) => {
        res.json({ success: !err, data: data || [] });
    });
});

app.get('/api/analytics/top-keys', requireAuth, (req, res) => {
    db.all(`SELECT key, name, hits, status FROM api_keys ORDER BY hits DESC LIMIT 10`, [], (err, data) => {
        res.json({ success: !err, data: data || [] });
    });
});

app.get('/api/analytics/health', requireAuth, (req, res) => {
    db.all(`SELECT * FROM api_health ORDER BY last_check DESC`, [], (err, data) => {
        res.json({ success: !err, apis: data || [] });
    });
});

app.get('/api/analytics/errors', requireAuth, (req, res) => {
    const limit = req.query.limit || 50;
    db.all(`SELECT * FROM webhook_logs WHERE status_code != 200 ORDER BY date DESC LIMIT ?`, [limit], (err, data) => {
        res.json({ success: !err, data: data || [] });
    });
});

app.get('/api/analytics/search', requireAuth, (req, res) => {
    const { query, type } = req.query;
    if (!query) return res.json({ error: 'Search query required' });
    
    if (type === 'key') {
        db.all(`SELECT * FROM api_keys WHERE key LIKE ? OR name LIKE ? LIMIT 20`, [`%${query}%`, `%${query}%`], (err, data) => {
            res.json({ success: !err, results: data || [] });
        });
    } else if (type === 'analytics') {
        db.all(`SELECT * FROM analytics WHERE api_key LIKE ? OR endpoint LIKE ? ORDER BY date DESC LIMIT 20`, [`%${query}%`, `%${query}%`], (err, data) => {
            res.json({ success: !err, results: data || [] });
        });
    }
});

// ============ EXPORT FEATURES ============

app.get('/api/export/keys', requireAuth, (req, res) => {
    db.all('SELECT key, name, hits, status, created_at, expires_at FROM api_keys', [], (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = 'Key,Name,Hits,Status,Created,Expires\n' + 
            data.map(k => `${k.key},${k.name},${k.hits},${k.status},${k.created_at},${k.expires_at}`).join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=keys_export.csv');
        res.send(csv);
    });
});

app.get('/api/export/analytics', requireAuth, (req, res) => {
    db.all('SELECT * FROM analytics ORDER BY date DESC LIMIT 1000', [], (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = 'API Key,Endpoint,Status,IP,Response Time,Date\n' + 
            data.map(a => `${a.api_key},${a.endpoint},${a.status_code},${a.ip_address},${a.response_time},${a.date}`).join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=analytics_export.csv');
        res.send(csv);
    });
});

// ============ ADVANCED FILTERING ============

app.get('/api/keys/filter', requireAuth, (req, res) => {
    const { status, sort, limit } = req.query;
    let query = 'SELECT * FROM api_keys WHERE 1=1';
    const params = [];
    
    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }
    
    if (sort === 'hits-desc') query += ' ORDER BY hits DESC';
    else if (sort === 'hits-asc') query += ' ORDER BY hits ASC';
    else if (sort === 'latest') query += ' ORDER BY created_at DESC';
    else if (sort === 'oldest') query += ' ORDER BY created_at ASC';
    
    query += ' LIMIT ?';
    params.push(parseInt(limit) || 50);
    
    db.all(query, params, (err, data) => {
        res.json({ success: !err, keys: data || [] });
    });
});

// ============ KEY MANAGEMENT ============

app.post('/api/keys/update-webhook', requireAuth, (req, res) => {
    const { key_id, webhook_url } = req.body;
    
    db.run('UPDATE api_keys SET webhook_url = ? WHERE id = ?', [webhook_url, key_id], (err) => {
        res.json(err ? { error: err.message } : { success: true });
    });
});

app.post('/api/keys/add-ip-whitelist', requireAuth, (req, res) => {
    const { key_id, ip_address } = req.body;
    
    db.get('SELECT ip_whitelist FROM api_keys WHERE id = ?', [key_id], (err, key) => {
        let ips = [];
        try { ips = JSON.parse(key.ip_whitelist || '[]'); } catch(e) { ips = []; }
        
        if (!ips.includes(ip_address)) ips.push(ip_address);
        
        db.run('UPDATE api_keys SET ip_whitelist = ? WHERE id = ?', [JSON.stringify(ips), key_id], (err) => {
            res.json(err ? { error: err.message } : { success: true, ips });
        });
    });
});

// ============ MAIN API ENDPOINT (Enhanced) ============

app.all('/api/:endpoint', globalLimiter, async (req, res) => {
    const userKey = req.query.key || req.body.key;
    const endpoint = req.params.endpoint;
    const startTime = Date.now();
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    if (!userKey) return res.json({ error: 'API key required', contact: OWNER });
    
    db.get('SELECT * FROM api_keys WHERE key = ?', [userKey], async (err, keyData) => {
        if (err || !keyData) {
            liveStats.recentErrors.push({ error: 'Invalid key', time: new Date() });
            return res.json({ error: 'Invalid API key', contact: OWNER });
        }
        
        // Check IP whitelist
        if (keyData.ip_whitelist && keyData.ip_whitelist !== '[]') {
            try {
                const allowedIPs = JSON.parse(keyData.ip_whitelist);
                if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP)) {
                    await sendWebhook(keyData.id, 'blocked_ip', { ip: clientIP });
                    return res.json({ error: 'IP not whitelisted', contact: OWNER });
                }
            } catch(e) {}
        }
        
        if (keyData.api_enabled === 0) {
            await sendWebhook(keyData.id, 'api_disabled', {});
            return res.json({ success: false, error: 'API Key disabled by admin' });
        }
        
        if (keyData.status !== 'active') {
            return res.json({ error: `Key is ${keyData.status}`, contact: OWNER });
        }
        
        try {
            const allowedApis = JSON.parse(keyData.allowed_apis || '["all"]');
            if (!allowedApis.includes('all') && !allowedApis.includes(endpoint)) {
                return res.json({ success: false, error: `API endpoint "${endpoint}" not allowed` });
            }
        } catch(e) {}
        
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            db.run('UPDATE api_keys SET status = "expired" WHERE id = ?', [keyData.id]);
            await sendWebhook(keyData.id, 'key_expired', {});
            return res.json({ error: 'Key expired', contact: OWNER });
        }
        
        // Update stats
        db.run('UPDATE api_keys SET hits = hits + 1, last_request = ? WHERE id = ?', [new Date().toISOString(), keyData.id]);
        liveStats.totalHits++;
        broadcastStats();
        
        if (keyData.rate_limit_enabled === 1 && keyData.unlimited_hits !== 1) {
            const today = new Date().toISOString().split('T')[0];
            const dailyLimit = keyData.rate_limit_per_day || 100;
            
            db.get('SELECT requests FROM rate_limit_tracking WHERE api_key = ? AND date = ?', [userKey, today], async (err, row) => {
                const dailyCount = row ? row.requests : 0;
                
                if (dailyCount >= dailyLimit) {
                    await sendWebhook(keyData.id, 'rate_limit_exceeded', { limit: dailyLimit });
                    return res.json({ error: `Daily rate limit exceeded (${dailyLimit}/day)`, contact: OWNER });
                }
                
                db.run(`INSERT OR REPLACE INTO rate_limit_tracking (api_key, date, requests) VALUES (?, ?, ?)`,
                    [userKey, today, dailyCount + 1]);
            });
        }
        
        if (endpoint === 'mistral') {
            const message = req.query.message || req.body.message;
            if (!message) return res.json({ error: 'Message required' });
            
            try {
                const response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
                    model: 'mistral-medium-latest',
                    messages: [{ role: "user", content: message }]
                }, { headers: { 'Authorization': `Bearer ${MASTER_KEYS.mistral}` }, timeout: 30000 });
                
                const responseTime = Date.now() - startTime;
                db.run('INSERT INTO analytics (api_key, endpoint, status_code, ip_address, response_time) VALUES (?, ?, ?, ?, ?)',
                    [userKey, endpoint, 200, clientIP, responseTime]);
                
                return res.json({ success: true, response: response.data.choices[0].message.content });
            } catch(e) {
                db.run('INSERT INTO analytics (api_key, endpoint, status_code, ip_address, response_time) VALUES (?, ?, ?, ?, ?)',
                    [userKey, endpoint, 500, clientIP, Date.now() - startTime]);
                return res.json({ error: e.message });
            }
        }
        
        const proxyFn = apiProxyMap[endpoint];
        if (!proxyFn) return res.json({ error: 'Unknown endpoint', contact: OWNER });
        
        try {
            const targetUrl = proxyFn({ ...req.query, ...req.body });
            const response = await axios.get(targetUrl, { timeout: 30000 });
            
            const responseTime = Date.now() - startTime;
            db.run('INSERT INTO analytics (api_key, endpoint, status_code, ip_address, response_time) VALUES (?, ?, ?, ?, ?)',
                [userKey, endpoint, response.status, clientIP, responseTime]);
            
            liveStats.topAPIs[endpoint] = (liveStats.topAPIs[endpoint] || 0) + 1;
            broadcastStats();
            
            res.json(response.data);
        } catch (error) {
            db.run('INSERT INTO analytics (api_key, endpoint, status_code, ip_address, response_time) VALUES (?, ?, ?, ?, ?)',
                [userKey, endpoint, 500, clientIP, Date.now() - startTime]);
            
            liveStats.recentErrors.push({ error: error.message, endpoint, time: new Date() });
            res.json({ error: 'API request failed', contact: OWNER });
        }
    });
});

app.get('/endpoints', (req, res) => {
    db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
        res.render('endpoints', { apis: apis || [], owner: OWNER, channel: CHANNEL, user: req.session.user || null });
    });
});

app.get('/docs', (req, res) => {
    db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
        res.render('docs', { apis: apis || [], owner: OWNER, channel: CHANNEL, user: req.session.user || null });
    });
});

app.get('/login', (req, res) => { res.render('login', { error: req.query.error || null }); });

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.redirect('/login?error=missing');
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.redirect('/login?error=invalid');
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.user = { id: user.id, username: user.username, role: user.role };
            return res.redirect(user.role === 'head_admin' ? '/head-admin/dashboard' : '/admin/dashboard');
        }
        return res.redirect('/login?error=invalid');
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.get('/admin/dashboard', requireAuth, (req, res) => {
    if (req.session.user.role === 'head_admin') return res.redirect('/head-admin/dashboard');
    
    db.all('SELECT * FROM api_keys ORDER BY created_at DESC', [], (err, keys) => {
        db.get('SELECT SUM(hits) as total FROM api_keys', [], (err, hits) => {
            db.get('SELECT COUNT(*) as active FROM api_keys WHERE status="active"', [], (err, active) => {
                db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
                    db.get('SELECT * FROM settings WHERE id = 1', [], (err, settings) => {
                        res.render('dashboard', {
                            keys: keys || [],
                            totalHits: hits ? hits.total : 0,
                            active: active ? active.active : 0,
                            apis: apis || [],
                            user: req.session.user,
                            settings: settings || {}
                        });
                    });
                });
            });
        });
    });
});

app.get('/head-admin/dashboard', requireHeadAdmin, (req, res) => {
    db.all('SELECT * FROM users WHERE role != "head_admin"', [], (err, admins) => {
        db.all('SELECT * FROM api_keys ORDER BY created_at DESC', [], (err, keys) => {
            db.get('SELECT SUM(hits) as total_hits FROM api_keys', [], (err, totalHits) => {
                db.get('SELECT * FROM settings WHERE id = 1', [], (err, settings) => {
                    db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
                        res.render('head_admin_dashboard', {
                            user: req.session.user,
                            admins: admins || [],
                            keys: keys || [],
                            totalHits: totalHits ? totalHits.total_hits : 0,
                            settings: settings || {},
                            apis: apis || []
                        });
                    });
                });
            });
        });
    });
});

// ============ SAME GENERATE/EDIT/TOGGLE ROUTES ============
app.post('/admin/generate-key', requireAuth, (req, res) => {
    const { name, expiry, unlimited_hits, selected_api, custom_key, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute, note_enabled, key_note, custom_expiry_date, custom_expiry_time } = req.body;
    
    const isCustomEnabled = req.body.enable_custom === 'on';
    
    if (isCustomEnabled && (!custom_key || custom_key.trim() === '')) {
        return res.status(400).send('❌ Please enter a custom key');
    }
    
    function createKey(apiKey, isCustom) {
        let expires_at = null;
        const now = new Date();
        
        if (expiry === '7d') expires_at = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
        else if (expiry === '30d') expires_at = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        else if (expiry === '1y') expires_at = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
        else if (expiry === 'custom' && custom_expiry_date) {
            expires_at = new Date(`${custom_expiry_date}T${custom_expiry_time || '23:59'}`);
        }
        
        let allowedApisJson = JSON.stringify([selected_api || 'all']);
        const isUnlimited = unlimited_hits === 'on';
        const noteEnabled = note_enabled === 'on' ? 1 : 0;
        
        db.run(`INSERT INTO api_keys (key, name, owner_username, owner_channel, expires_at, unlimited_hits, allowed_apis, status, is_custom, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute, key_note, note_enabled, api_enabled, last_updated) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1, ?)`, 
            [apiKey, name, OWNER, CHANNEL, expires_at, isUnlimited ? 1 : 0, allowedApisJson, isCustom ? 1 : 0, rate_limit_per_day || 100, rate_limit_per_hour || 20, rate_limit_per_minute || 5, noteEnabled ? key_note : '', noteEnabled, new Date().toISOString()], 
            function(err) {
                if (err) return res.status(500).send('DB Error: ' + err.message);
                console.log('✅ Key created:', apiKey);
                res.redirect('/admin/dashboard');
            });
    }
    
    if (isCustomEnabled && custom_key && custom_key.trim()) {
        let apiKey = custom_key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
        if (apiKey.length < 3) return res.status(400).send('❌ Min 3 chars');
        
        db.get('SELECT key FROM api_keys WHERE key = ?', [apiKey], (err, existing) => {
            if (existing) return res.status(400).send('❌ Key exists');
            createKey(apiKey, true);
        });
    } else {
        let apiKey = 'OSINT_' + Math.random().toString(36).substring(2, 18).toUpperCase();
        createKey(apiKey, false);
    }
});

app.post('/admin/edit-key', requireAuth, (req, res) => {
    const { key_id, name, status, selected_api, unlimited_hits, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute } = req.body;
    
    let allowedApisJson = JSON.stringify([selected_api || 'all']);
    const isUnlimited = unlimited_hits === 'on' || unlimited_hits === 1;
    
    db.run(`UPDATE api_keys SET name=?, status=?, allowed_apis=?, unlimited_hits=?, rate_limit_per_day=?, rate_limit_per_hour=?, rate_limit_per_minute=?, last_updated=? WHERE id=?`,
        [name, status, allowedApisJson, isUnlimited ? 1 : 0, rate_limit_per_day || 100, rate_limit_per_hour || 20, rate_limit_per_minute || 5, new Date().toISOString(), key_id],
        (err) => res.json(err ? { error: err.message } : { success: true }));
});

app.post('/admin/delete-key', requireAuth, (req, res) => {
    db.run('DELETE FROM api_keys WHERE id = ?', [req.body.id]);
    res.redirect('/admin/dashboard');
});

app.post('/admin/toggle-key-enabled', requireAuth, (req, res) => {
    const { key_id, api_enabled } = req.body;
    const enabled = api_enabled ? 1 : 0;
    
    db.run('UPDATE api_keys SET api_enabled = ?, last_updated = ? WHERE id = ?',
        [enabled, new Date().toISOString(), key_id],
        (err) => res.json(err ? { success: false, error: err.message } : { success: true, api_enabled: enabled }));
});

app.post('/admin/update-settings', requireAuth, (req, res) => {
    const { master_api, maintenance_message } = req.body;
    
    db.run(`UPDATE settings SET master_api = ?, maintenance_message = ? WHERE id = 1`, 
        [master_api ? 1 : 0, maintenance_message || 'API under maintenance.'],
        (err) => res.json(err ? { error: err.message } : { success: true }));
});

app.use((err, req, res, next) => { 
    console.error('❌ Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message }); 
});

// ============ CRON JOBS ============
cron.schedule('*/30 * * * *', () => {
    checkAPIHealth();
    db.run(`UPDATE api_keys SET status = 'expired' WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`);
});

cron.schedule('0 0 * * *', () => {
    db.run(`DELETE FROM rate_limit_tracking WHERE date < datetime('now', '-7 days')`);
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('\n🚀 OSINT API HUB ENHANCED');
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`✅ Live Dashboard: ws://localhost:${PORT}`);
    console.log('✅ Analytics Endpoints Ready');
    console.log('✅ Webhook System Active');
    console.log('✅ API Health Monitoring Active');
    console.log('✅ Advanced Filtering Ready');
    console.log('=====================================\n');
});

module.exports = { app, server, wss };
