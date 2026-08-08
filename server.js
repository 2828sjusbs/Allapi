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
const app = express();

const OWNER = '@BMW_AURA5';
const CHANNEL = '@OSINT_ERA1';

const MASTER_KEYS = {
    ftosint: 'sahil-new',
    mistral: 'FVKec5Xqa2ORzSoBrqi21nRbIM6rFk2q'
};

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'api_keys.db');
const db = new sqlite3.Database(DB_PATH);

// ============ DATABASE INITIALIZATION & MIGRATIONS ============
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // API Keys table
    db.run(`CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        name TEXT,
        app_name TEXT,
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
        max_total_hits INTEGER DEFAULT 0,
        ip_whitelist TEXT DEFAULT '',
        key_note TEXT DEFAULT '',
        note_enabled INTEGER DEFAULT 0,
        last_updated DATETIME,
        api_enabled INTEGER DEFAULT 1
    )`);

    // Rate limit tracking table
    db.run(`CREATE TABLE IF NOT EXISTS rate_limit_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date TEXT,
        hour INTEGER,
        minute INTEGER,
        requests INTEGER DEFAULT 0,
        UNIQUE(api_key, date, hour, minute)
    )`);

    // Available APIs
    db.run(`CREATE TABLE IF NOT EXISTS available_apis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        display_name TEXT,
        endpoint TEXT,
        required_params TEXT,
        example_params TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1
    )`);

    // Settings table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY,
        master_api INTEGER DEFAULT 1,
        maintenance_message TEXT DEFAULT 'API is currently under maintenance.'
    )`);

    // Safe DB column migrations
    db.run(`ALTER TABLE settings ADD COLUMN master_api INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE api_keys ADD COLUMN app_name TEXT`, () => {});
    db.run(`ALTER TABLE api_keys ADD COLUMN max_total_hits INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE api_keys ADD COLUMN ip_whitelist TEXT DEFAULT ''`, () => {});

    // Default settings setup
    db.get(`SELECT * FROM settings WHERE id = 1`, [], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO settings (id, master_api, maintenance_message) VALUES (1, 1, 'API is currently under maintenance.')`);
        }
    });

    // Default system users
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

    // Seed default endpoints
    db.get(`SELECT COUNT(*) as count FROM available_apis`, [], (err, row) => {
        if (row && row.count === 0) {
            const apis = [
                ['leakpro', '🔓 Leak Pro', '/api/leakpro', 'number', '{"number":"918887882236"}', 'LEAK pro information'],
                ['vehicle-info', '🚗 Vehicle Info', '/api/vehicle-info', 'vehicle', '{"vehicle":"UP42BB2572"}', 'Get vehicle info'],
                ['telegram-num', '📞 Telegram to Number', '/api/telegram-num', 'term', '{"term":"7577179320"}', 'Get number from Telegram ID'],
                ['family-info', '👨‍👩‍👧‍👦 Family Info', '/api/family-info', 'q', '{"q":"942660008471"}', 'Family information lookup'],
                ['number-info', '📱 Number Info', '/api/number-info', 'q', '{"q":"9876543321"}', 'Complete number information'],
                ['aadhar-info', '🆔 Aadhar Info', '/api/aadhar-info', 'q', '{"q":"942660008471"}', 'Aadhar card information'],
                ['num-newinfo', '🔍 Number New Info', '/api/num-newinfo', 'q', '{"q":"1234597890"}', 'Advanced number information'],
                ['email-info', '📧 Email Info', '/api/email-info', 'q', '{"q":"test@email.com"}', 'Email address information'],
                ['family', '👨‍👩‍👧‍👦 Family Tree', '/api/family', 'term', '{"term":"979607168114"}', 'Family relationship lookup'],
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
                ['insta', '📸 Instagram Info', '/api/insta', 'username', '{"username":"instagram"}', 'Instagram profile'],
                ['leak', '🔍 Leak Info', '/api/leak', 'number', '{"number":"918887882236"}', 'Complete phone info'],
                ['mistral', '🤖 Mistral AI', '/api/mistral', 'message', '{"message":"What is AI?"}', 'Chat with Mistral AI'],
                ['veh-to-num', '🚗 Vehicle to Number', '/api/veh-to-num', 'term', '{"term":"UP50P5434"}', 'Vehicle to mobile number']
            ];
            
            apis.forEach(api => {
                db.run(`INSERT OR IGNORE INTO available_apis (name, display_name, endpoint, required_params, example_params, description, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`, api);
            });
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
    max: 120,
    keyGenerator: (req) => req.query.key || req.ip,
    handler: (req, res) => res.status(429).json({ error: 'Global rate limit exceeded', contact: OWNER })
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

// ============ API PROXY MAP ============
const apiProxyMap = {
    'leakpro': (p) => `https://raxxosint.onrender.com/leakosint?key=Customer&quiry=${p.number}`,
    'vehicle-info': (p) => `https://leakapi.dpdns.org/vehicle-info?registration_number=${p.vehicle || p.q || p.term}`,
    'telegram-num': (p) => `https://tg-to-num-ten.vercel.app/tg?key=sahil_X&num=${p.term || p.id || p.username}`,
    'family-info': (p) => `https://osint.invalidayushh.workers.dev/adhar?key=Sahil&q=${p.q || p.term || p.id}`,
    'number-info': (p) => `https://osint.invalidayushh.workers.dev/num?key=Sahil&q=${p.q || p.number || p.num}`,
    'aadhar-info': (p) => `https://osint.invalidayushh.workers.dev/adhar?key=Sahil&q=${p.q || p.num || p.aadhar}`,
    'num-newinfo': (p) => `https://leakapi.dpdns.org/search?q=${p.q || p.number || p.num}`,
    'email-info': (p) => `https://osint.invalidayushh.workers.dev/email?key=Sahil&q=${p.q || p.email}`,
    'insta': (p) => `https://osint.invalidayushh.workers.dev/insta?key=Sahil&q=${p.username}`,
    'vehicle': (p) => `https://leakapi.dpdns.org/api/vehicle?vehicle=${p.vehicle}`,
    'family': (p) => `https://ayaanmods.site/family.php?term=${p.term}`,
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
    'ai-image': (p) => `https://ayaanmods.site/aiimage.php?prompt=${p.prompt}`,
    'leak': (p) => `https://leakapi.dpdns.org/chain?q=${p.number}`,
    'mistral': `mistral-direct`,
    'veh-to-num': (p) => `https://vehicleinfo.noobgamingv40.workers.dev/fetch?vehicle=${p.vehicle || p.term}`
};

// ============ CLEAN RESPONSE FUNCTION ============
function cleanResponseData(data) {
    if (!data || typeof data !== 'object') return data;
    let cleaned = JSON.parse(JSON.stringify(data));
    
    const removeFields = [
        'owner', 'OWNER', 'channel', 'CHANNEL', 'telegram', 'contact', 'instagram', 'twitter',
        'fb', 'facebook', 'website', 'github', 'created_by', 'createdBy', 'owner_username',
        'owner_channel', 'credit', 'Credits', 'Credit', 'Source', 'source', 'provider',
        'Provider', 'api_source', 'API_Source', 'developer', 'Developer', 'dev', 'Dev',
        'invalidayushh', 'ftgamerv2', 'ftgamer2', '@invalidayushh', '@ftgamerv2', '@ftgamer2',
        'InvalidAyush', '@InvalidAyush', 'invalidayush', '@invalidayush', 'DM TO BUY ACCESS',
        'xtradeep', 'Kon_Hu_Mai', 'support', '@raxusss', 'raxusss', 'Raxusss', 'Support', 'help'
    ];
    
    function cleanObject(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (let key in obj) {
            if (removeFields.includes(key) || removeFields.includes(key.toLowerCase())) {
                delete obj[key];
            } 
            else if (typeof obj[key] === 'string') {
                if (obj[key].includes('@raxusss') || obj[key].includes('raxusss') ||
                    obj[key].includes('InvalidAyush') || obj[key].includes('@InvalidAyush') ||
                    obj[key].includes('invalidayush') || obj[key].includes('ftgamerv2') || 
                    obj[key].includes('ftgamer2') || obj[key].includes('@ftgamerv2')) {
                    delete obj[key];
                }
            } else if (typeof obj[key] === 'object') {
                cleanObject(obj[key]);
            }
        }
    }
    cleanObject(cleaned);
    cleaned.owner = OWNER;
    cleaned.channel = CHANNEL;
    return cleaned;
}

// ============ ROUTES ============

app.get('/', (req, res) => {
    db.get('SELECT COUNT(*) as total_apis FROM available_apis WHERE is_active = 1', [], (err, apisCount) => {
        db.get('SELECT COUNT(*) as total_keys FROM api_keys', [], (err, keysCount) => {
            db.get('SELECT SUM(hits) as total_hits FROM api_keys', [], (err, hitsTotal) => {
                res.render('index', { 
                    user: req.session.user || null,
                    totalApis: apisCount ? apisCount.total_apis : 0,
                    totalKeys: keysCount ? keysCount.total_keys : 0,
                    totalHits: (hitsTotal && hitsTotal.total_hits) ? hitsTotal.total_hits : 0,
                    owner: OWNER,
                    channel: CHANNEL
                });
            });
        });
    });
});

app.get('/endpoints', (req, res) => {
    db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
        const formattedApis = (apis || []).map(api => {
            let params = {};
            try { params = JSON.parse(api.required_params || '{}'); } catch(e) { params = {}; }
            const paramName = Object.keys(params)[0] || 'param';
            return { 
                ...api, 
                param_name: paramName, 
                param_example: params[paramName] || 'value',
                full_url: api.endpoint
            };
        });
        res.render('endpoints', { 
            apis: formattedApis, 
            baseUrl: req.protocol + '://' + req.get('host'),
            owner: OWNER,
            channel: CHANNEL,
            user: req.session.user || null
        });
    });
});

app.get('/docs', (req, res) => {
    db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
        const formattedApis = (apis || []).map(api => {
            let params = {};
            try { params = JSON.parse(api.required_params || '{}'); } catch(e) { params = {}; }
            const paramName = Object.keys(params)[0] || 'param';
            return { ...api, param_name: paramName, param_example: params[paramName] || 'value' };
        });
        res.render('docs', { 
            apis: formattedApis, 
            baseUrl: req.protocol + '://' + req.get('host'),
            owner: OWNER,
            channel: CHANNEL,
            user: req.session.user || null
        });
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
            return res.redirect('/admin/dashboard');
        }
        return res.redirect('/login?error=invalid');
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ============ ADMIN DASHBOARD ============
app.get('/admin/dashboard', requireAuth, (req, res) => {
    db.all('SELECT * FROM api_keys ORDER BY created_at DESC', [], (err, keys) => {
        db.get('SELECT SUM(hits) as total FROM api_keys', [], (err, hits) => {
            db.get('SELECT COUNT(*) as active FROM api_keys WHERE status="active"', [], (err, active) => {
                db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
                    db.get('SELECT * FROM settings WHERE id = 1', [], (err, settings) => {
                        res.render('dashboard', {
                            keys: keys || [],
                            totalHits: (hits && hits.total) ? hits.total : 0,
                            active: active ? active.active : 0,
                            apis: apis || [],
                            user: req.session.user,
                            baseUrl: req.protocol + '://' + req.get('host'),
                            settings: settings || { master_api: 1, maintenance_message: 'API is currently under maintenance.' },
                            owner: OWNER,
                            channel: CHANNEL
                        });
                    });
                });
            });
        });
    });
});

// ============ GENERATE KEY ============
app.post('/admin/generate-key', requireAuth, (req, res) => {
    const { 
        name, app_name, expiry, 
        enable_custom, custom_key,
        note_enabled, key_note,
        custom_expiry_date, custom_expiry_time,
        daily_limit, limit_type, max_total_hits,
        rate_limit_hour, rate_limit_minute,
        ip_whitelist, allowed_apis
    } = req.body;
    
    let apiKey = '';
    if (enable_custom === 'on' && custom_key && custom_key.trim() !== '') {
        apiKey = custom_key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    } else {
        apiKey = 'OSINT_' + Math.random().toString(36).substring(2, 14).toUpperCase();
    }

    let expires_at = null;
    const now = new Date();
    
    if (expiry === '7d') expires_at = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    else if (expiry === '15d') expires_at = new Date(now.getTime() + (15 * 24 * 60 * 60 * 1000));
    else if (expiry === '1m') expires_at = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
    else if (expiry === '1y') expires_at = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
    else if (expiry === 'custom' && custom_expiry_date) {
        const dateTime = new Date(`${custom_expiry_date}T${custom_expiry_time || '23:59'}`);
        if (!isNaN(dateTime)) expires_at = dateTime;
    }

    let apisJson = '["all"]';
    if (allowed_apis) {
        let arr = Array.isArray(allowed_apis) ? allowed_apis : [allowed_apis];
        if (arr.length > 0) apisJson = JSON.stringify(arr);
    }

    const isUnlimited = limit_type === 'unlimited';
    const dailyLimit = parseInt(daily_limit) || 100;
    const hourLimit = parseInt(rate_limit_hour) || 20;
    const minLimit = parseInt(rate_limit_minute) || 5;
    const maxTotal = isUnlimited ? 0 : (parseInt(max_total_hits) || 0);

    db.run(`INSERT INTO api_keys (
            key, name, app_name, owner_username, owner_channel, 
            expires_at, unlimited_hits, allowed_apis, status, is_custom,
            rate_limit_enabled, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute,
            max_total_hits, ip_whitelist, key_note, note_enabled, last_updated, api_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, 
        [
            apiKey, name, app_name || '', OWNER, CHANNEL, 
            expires_at, 
            isUnlimited ? 1 : 0, 
            apisJson, 
            enable_custom === 'on' ? 1 : 0,
            dailyLimit,
            hourLimit,
            minLimit,
            maxTotal,
            ip_whitelist || '',
            note_enabled === 'on' ? (key_note || '') : '',
            note_enabled === 'on' ? 1 : 0,
            new Date().toISOString()
        ], 
        function(err) {
            if (err) return res.status(500).send('Database error: ' + err.message);
            res.redirect('/admin/dashboard');
        }
    );
});

// ============ EDIT KEY ============
app.post('/admin/edit-key', requireAuth, (req, res) => {
    const { 
        key_id, name, custom_expiry_date, custom_expiry_time, status, 
        unlimited_hits, note_enabled, key_note 
    } = req.body;

    let expires_at = null;
    if (custom_expiry_date) {
        const dateTime = new Date(`${custom_expiry_date}T${custom_expiry_time || '23:59'}`);
        if (!isNaN(dateTime)) expires_at = dateTime.toISOString();
    }

    const isUnlimited = unlimited_hits === 'on' || unlimited_hits === 'true' || unlimited_hits === '1' ? 1 : 0;
    const isNoteEnabled = note_enabled === 'on' || note_enabled === 'true' || note_enabled === '1' ? 1 : 0;

    let query = `UPDATE api_keys SET name = ?, status = ?, unlimited_hits = ?, note_enabled = ?, key_note = ?, last_updated = ?`;
    let params = [name, status, isUnlimited, isNoteEnabled, isNoteEnabled ? (key_note || '') : '', new Date().toISOString()];

    if (expires_at) {
        query += `, expires_at = ?`;
        params.push(expires_at);
    }

    query += ` WHERE id = ?`;
    params.push(key_id);

    db.run(query, params, function(err) {
        if (err) return res.status(500).send('Failed to update key');
        res.redirect('/admin/dashboard');
    });
});

app.post('/admin/toggle-status', requireAuth, (req, res) => {
    const { id, status } = req.body;
    db.run('UPDATE api_keys SET status = ? WHERE id = ?', [status === 'active' ? 'disabled' : 'active', id]);
    res.redirect('/admin/dashboard');
});

app.post('/admin/delete-key', requireAuth, (req, res) => {
    db.run('DELETE FROM api_keys WHERE id = ?', [req.body.id]);
    res.redirect('/admin/dashboard');
});

app.post('/admin/update-settings', requireAuth, (req, res) => {
    const { master_api, maintenance_message } = req.body;
    db.run(`UPDATE settings SET master_api = ?, maintenance_message = ? WHERE id = 1`, 
        [master_api ? 1 : 0, maintenance_message || 'API is currently under maintenance.'],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        });
});

// ============ MISTRAL AI HANDLER ============
async function handleMistralAI(message) {
    try {
        const response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
            model: 'mistral-medium-latest',
            messages: [{ role: "user", content: message }]
        }, { headers: { 'Authorization': `Bearer ${MASTER_KEYS.mistral}`, 'Content-Type': 'application/json' }, timeout: 30000 });
        return { success: true, response: response.data.choices[0].message.content };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============ MAIN API PROXY & RATE LIMITING ============
app.all('/api/:endpoint', globalLimiter, async (req, res) => {
    const userKey = req.query.key || req.body.key;
    const endpoint = req.params.endpoint;
    
    // Check Master System Setting
    const settings = await new Promise(resolve => db.get('SELECT * FROM settings WHERE id = 1', [], (err, row) => resolve(row)));
    if (settings && settings.master_api === 0) {
        return res.status(503).json({ success: false, error: settings.maintenance_message, contact: OWNER });
    }

    if (!userKey) return res.status(401).json({ error: 'API key required', contact: OWNER });

    db.get('SELECT * FROM api_keys WHERE key = ?', [userKey], async (err, keyData) => {
        if (err || !keyData) return res.status(401).json({ error: 'Invalid API key', contact: OWNER });
        
        if (keyData.status !== 'active' || keyData.api_enabled === 0) {
            return res.status(403).json({ error: `Key is currently ${keyData.status}`, contact: OWNER });
        }
        
        // Expiry Check
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            db.run('UPDATE api_keys SET status = "expired" WHERE id = ?', [keyData.id]);
            return res.status(403).json({ error: 'Key has expired', contact: OWNER });
        }

        // Allowed APIs Access Check
        try {
            const allowedApis = JSON.parse(keyData.allowed_apis || '["all"]');
            if (!allowedApis.includes('all') && !allowedApis.includes(endpoint)) {
                return res.status(403).json({ success: false, error: `API endpoint "${endpoint}" is not allowed for this key.`, contact: OWNER });
            }
        } catch(e) {}

        // Total Cap Limit Check
        if (keyData.unlimited_hits === 0 && keyData.max_total_hits > 0 && keyData.hits >= keyData.max_total_hits) {
            return res.status(429).json({ success: false, error: 'Maximum allowed hits reached for this key.', contact: OWNER });
        }

        // IP Whitelist Check
        if (keyData.ip_whitelist && keyData.ip_whitelist.trim() !== '') {
            const allowedIps = keyData.ip_whitelist.split(',').map(ip => ip.trim());
            const clientIp = req.ip || req.connection.remoteAddress;
            if (!allowedIps.includes(clientIp)) {
                return res.status(403).json({ error: 'IP address not authorized', contact: OWNER });
            }
        }

        // Rate Limiter Core Logic
        const today = new Date().toISOString().split('T')[0];
        const hour = new Date().getHours();
        const minute = Math.floor(new Date().getMinutes() / 5) * 5;

        if (keyData.unlimited_hits === 0) {
            const dailyCount = await new Promise(r => db.get('SELECT SUM(requests) as total FROM rate_limit_tracking WHERE api_key = ? AND date = ?', [userKey, today], (e, row) => r(row && row.total ? row.total : 0)));
            const hourlyCount = await new Promise(r => db.get('SELECT SUM(requests) as total FROM rate_limit_tracking WHERE api_key = ? AND date = ? AND hour = ?', [userKey, today, hour], (e, row) => r(row && row.total ? row.total : 0)));
            const minuteCount = await new Promise(r => db.get('SELECT requests FROM rate_limit_tracking WHERE api_key = ? AND date = ? AND hour = ? AND minute = ?', [userKey, today, hour, minute], (e, row) => r(row ? row.requests : 0)));

            if (keyData.rate_limit_per_day > 0 && dailyCount >= keyData.rate_limit_per_day) {
                return res.status(429).json({ error: 'Daily rate limit exceeded.', contact: OWNER });
            }
            if (keyData.rate_limit_per_hour > 0 && hourlyCount >= keyData.rate_limit_per_hour) {
                return res.status(429).json({ error: 'Hourly rate limit exceeded.', contact: OWNER });
            }
            if (keyData.rate_limit_per_minute > 0 && minuteCount >= keyData.rate_limit_per_minute) {
                return res.status(429).json({ error: 'Per-minute rate limit exceeded.', contact: OWNER });
            }

            // Track Current Call
            db.run(
                `INSERT INTO rate_limit_tracking (api_key, date, hour, minute, requests) 
                 VALUES (?, ?, ?, ?, 1) 
                 ON CONFLICT(api_key, date, hour, minute) 
                 DO UPDATE SET requests = requests + 1`,
                [userKey, today, hour, minute]
            );
        }

        // Increment Hits
        db.run('UPDATE api_keys SET hits = hits + 1 WHERE id = ?', [keyData.id]);

        // Route AI Direct or External Proxy
        if (endpoint === 'mistral') {
            const message = req.query.message || req.body.message;
            if (!message) return res.status(400).json({ error: 'Message required' });
            const result = await handleMistralAI(message);
            const response = cleanResponseData(result);
            return res.json(response);
        }

        const proxyFn = apiProxyMap[endpoint];
        if (!proxyFn) return res.status(404).json({ error: 'Unknown endpoint', contact: OWNER });

        try {
            const targetUrl = proxyFn({ ...req.query, ...req.body });
            const response = await axios.get(targetUrl, { timeout: 30000 });
            let cleanedData = cleanResponseData(response.data);
            res.json(cleanedData);
        } catch (error) {
            res.status(500).json({ error: 'API request failed', details: error.message, contact: OWNER });
        }
    });
});

app.get('/api-info', (req, res) => {
    db.all('SELECT name, display_name, endpoint, required_params, description FROM available_apis WHERE is_active = 1', [], (err, apis) => {
        res.json({ owner: OWNER, channel: CHANNEL, total_apis: (apis || []).length, apis: apis || [] });
    });
});

app.get('/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

cron.schedule('0 0 * * *', () => {
    db.run(`UPDATE api_keys SET status = 'expired' WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`);
    const sevenDaysAgo = new Date(); 
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    db.run(`DELETE FROM rate_limit_tracking WHERE date < ?`, [sevenDaysAgo.toISOString().split('T')[0]]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 OSINT API HUB RUNNING ON PORT ${PORT}`);
});

module.exports = app;
