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

// ============ DATABASE INITIALIZATION ============
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
        api_enabled INTEGER DEFAULT 1
    )`);

    // Rate limit tracking with UNIQUE CONSTRAINT for upsert
    db.run(`CREATE TABLE IF NOT EXISTS rate_limit_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date TEXT,
        hour INTEGER,
        minute INTEGER,
        requests INTEGER DEFAULT 0,
        UNIQUE(api_key, date, hour, minute)
    )`);

    // Analytics
    db.run(`CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        endpoint TEXT,
        status_code INTEGER,
        ip_address TEXT,
        date DATE DEFAULT CURRENT_DATE
    )`);

    // Daily calls
    db.run(`CREATE TABLE IF NOT EXISTS daily_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date TEXT,
        calls INTEGER DEFAULT 0,
        UNIQUE(api_key, date)
    )`);

    // Available APIs
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

    // Settings table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY,
        maintenance_message TEXT DEFAULT 'API is currently under maintenance.'
    )`);

    // Insert default settings if not exists
    db.get(`SELECT * FROM settings WHERE id = 1`, [], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO settings (id, maintenance_message) VALUES (1, 'API is currently under maintenance.')`);
        }
    });

    // Default users
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

    // Insert default APIs if empty
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
                db.run(`INSERT INTO available_apis (name, display_name, endpoint, required_params, example_params, description) VALUES (?, ?, ?, ?, ?, ?)`, api);
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
    max: 60,
    keyGenerator: (req) => req.query.key || req.ip,
    handler: (req, res) => res.json({ error: 'Global IP rate limit exceeded', contact: OWNER })
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
    'family': (p) => `https://ayaanmods.site/family.php?key=${MASTER_KEYS.subhxco}&term=${p.term}`,
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
    'aadhar': (p) => `https://ft-osint-api.duckdns.org/api/aadhar?key=${MASTER_KEYS.ftosint}&num=${p.num}`,
    'ai-image': (p) => `https://ayaanmods.site/aiimage.php?key=${MASTER_KEYS.ayaanmods}&prompt=${p.prompt}`,
    'leak': (p) => `https://leakapi.dpdns.org/chain?q=${p.number}`,
    'mistral': `mistral-direct`,
    'veh-to-num': (p) => `https://vehicleinfo.noobgamingv40.workers.dev/fetch?vehicle=${p.vehicle || p.term}`
};

// ============ CLEAN FUNCTION ============
function cleanResponseData(data) {
    if (!data || typeof data !== 'object') return data;
    let cleaned = JSON.parse(JSON.stringify(data));
    
    const removeFields = [
        'owner', 'OWNER', 'channel', 'CHANNEL',
        'telegram', 'contact', 'instagram', 'twitter', 'fb', 'facebook',
        'website', 'github', 'created_by', 'createdBy', 'owner_username', 'owner_channel',
        'credit', 'Credits', 'Credit', 'Source', 'source', 'provider', 'Provider',
        'api_source', 'API_Source', 'developer', 'Developer', 'dev', 'Dev',
        'invalidayushh', 'ftgamerv2', 'ftgamer2', 
        '@invalidayushh', '@ftgamerv2', '@ftgamer2',
        'InvalidAyush', '@InvalidAyush', 'invalidayush', '@invalidayush',
        'DM TO BUY ACCESS', 'xtradeep', 'Kon_Hu_Mai',
        'support', '@raxusss', 'raxusss', 'Raxusss', 'Support', 'help', 'Help'
    ];
    
    function cleanObject(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (let key in obj) {
            if (removeFields.includes(key) || removeFields.includes(key.toLowerCase())) {
                delete obj[key];
            } 
            else if (typeof obj[key] === 'string') {
                if (obj[key].includes('@raxusss') || 
                    obj[key].includes('raxusss') ||
                    obj[key].includes('InvalidAyush') || 
                    obj[key].includes('@InvalidAyush') ||
                    obj[key].includes('invalidayush') ||
                    obj[key].includes('ftgamerv2') || 
                    obj[key].includes('ftgamer2') ||
                    obj[key].includes('@ftgamerv2') || 
                    obj[key].includes('@ftgamer2')) {
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
    db.get('SELECT COUNT(*) as total_apis FROM available_apis', [], (err, apisCount) => {
        db.get('SELECT COUNT(*) as total_keys FROM api_keys', [], (err, keysCount) => {
            db.get('SELECT COALESCE(SUM(hits), 0) as total_hits FROM api_keys', [], (err, hitsTotal) => {
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

// ============ ADMIN ROUTES ============

app.get('/head-admin/dashboard', requireHeadAdmin, (req, res) => {
    db.all('SELECT * FROM users WHERE role != "head_admin"', [], (err, admins) => {
        db.all('SELECT * FROM api_keys ORDER BY created_at DESC', [], (err, keys) => {
            db.get('SELECT COALESCE(SUM(hits), 0) as total_hits FROM api_keys', [], (err, totalHits) => {
                db.get('SELECT * FROM settings WHERE id = 1', [], (err, settings) => {
                    db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
                        res.render('head_admin_dashboard', {
                            user: req.session.user,
                            admins: admins || [],
                            keys: keys || [],
                            totalHits: totalHits ? totalHits.total_hits : 0,
                            popular: [],
                            topUsers: [],
                            todayCalls: {},
                            settings: settings || { maintenance_message: 'API is currently under maintenance.' },
                            apis: apis || [],
                            owner: OWNER,
                            channel: CHANNEL
                        });
                    });
                });
            });
        });
    });
});

app.get('/admin/dashboard', requireAuth, (req, res) => {
    if (req.session.user.role === 'head_admin') return res.redirect('/head-admin/dashboard');
    
    db.all('SELECT * FROM api_keys ORDER BY created_at DESC', [], (err, keys) => {
        db.get('SELECT COALESCE(SUM(hits), 0) as total FROM api_keys', [], (err, hits) => {
            db.get('SELECT COUNT(*) as active FROM api_keys WHERE status="active"', [], (err, active) => {
                db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
                    db.get('SELECT * FROM settings WHERE id = 1', [], (err, settings) => {
                        const formattedApis = (apis || []).map(api => {
                            let params = {};
                            try { params = JSON.parse(api.required_params || '{}'); } catch(e) { params = {}; }
                            const paramName = Object.keys(params)[0] || 'param';
                            return { ...api, param_name: paramName, param_example: params[paramName] || 'value' };
                        });
                        res.render('dashboard', {
                            keys: keys || [],
                            totalHits: hits ? hits.total : 0,
                            active: active ? active.active : 0,
                            apis: formattedApis,
                            popular: [],
                            topUsers: [],
                            todayCalls: {},
                            user: req.session.user,
                            baseUrl: req.protocol + '://' + req.get('host'),
                            settings: settings || { maintenance_message: 'API is currently under maintenance.' },
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
        name, expiry, unlimited_hits, 
        selected_api,
        custom_key,
        rate_limit_enabled, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute,
        note_enabled, key_note, custom_expiry_date, custom_expiry_time
    } = req.body;
    
    const isCustomEnabled = req.body.enable_custom === 'on' || req.body.enable_custom === true;
    
    if (isCustomEnabled && (!custom_key || custom_key.trim() === '')) {
        return res.status(400).send('❌ Please enter a custom key or disable custom key option');
    }
    
    function createKey(apiKey, isCustom) {
        let expires_at = null;
        const now = new Date();
        
        if (expiry === '3d') {
            expires_at = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
        } else if (expiry === '7d') {
            expires_at = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
        } else if (expiry === '30d') {
            expires_at = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        } else if (expiry === 'custom' && custom_expiry_date) {
            const dateTime = new Date(`${custom_expiry_date}T${custom_expiry_time || '23:59'}`);
            if (!isNaN(dateTime)) {
                expires_at = dateTime;
            }
        }
        
        let allowedApisJson = '["all"]';
        if (selected_api) {
            if (selected_api === 'all') {
                allowedApisJson = '["all"]';
            } else if (Array.isArray(selected_api)) {
                allowedApisJson = JSON.stringify(selected_api);
            } else {
                allowedApisJson = JSON.stringify([selected_api]);
            }
        }
        
        const isUnlimited = unlimited_hits === 'true' || unlimited_hits === 'on';
        const rateLimitEnabled = isUnlimited ? 0 : 1;
        const noteText = key_note || '';
        
        db.run(`INSERT INTO api_keys (
                key, name, owner_username, owner_channel, 
                expires_at, unlimited_hits, allowed_apis, status, is_custom,
                rate_limit_enabled, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute,
                key_note, note_enabled, last_updated, api_enabled
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, 1)`, 
            [
                apiKey, name, OWNER, CHANNEL, 
                expires_at, 
                isUnlimited ? 1 : 0, 
                allowedApisJson, 
                isCustom ? 1 : 0,
                rateLimitEnabled,
                isUnlimited ? 0 : (parseInt(rate_limit_per_day) || 100),
                isUnlimited ? 0 : (parseInt(rate_limit_per_hour) || 20),
                isUnlimited ? 0 : (parseInt(rate_limit_per_minute) || 5),
                noteText,
                noteText ? 1 : 0,
                new Date().toISOString()
            ], 
            function(err) {
                if (err) return res.status(500).send('Database error: ' + err.message);
                res.redirect('/admin/dashboard');
            });
    }
    
    if (isCustomEnabled && custom_key && custom_key.trim() !== '') {
        let apiKey = custom_key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
        if (apiKey.length < 3) return res.status(400).send('❌ Custom key must be at least 3 characters');
        
        db.get('SELECT key FROM api_keys WHERE key = ?', [apiKey], (err, existing) => {
            if (existing) return res.status(400).send('❌ Key already exists: ' + apiKey);
            createKey(apiKey, true);
        });
    } else {
        let apiKey = 'OSINT_' + Math.random().toString(36).substring(2, 18).toUpperCase();
        createKey(apiKey, false);
    }
});

// ============ EDIT KEY ============
app.post('/admin/edit-key', requireAuth, (req, res) => {
    const { 
        key_id, name, expiry, unlimited_hits, 
        rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute,
        key_note, status, selected_api, api_enabled
    } = req.body;

    let expires_at = null;
    const now = new Date();

    if (expiry === '3d') expires_at = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    else if (expiry === '7d') expires_at = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    else if (expiry === '30d') expires_at = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));

    let allowedApisJson = '["all"]';
    if (selected_api) {
        if (selected_api === 'all') allowedApisJson = '["all"]';
        else if (Array.isArray(selected_api)) allowedApisJson = JSON.stringify(selected_api);
        else allowedApisJson = JSON.stringify([selected_api]);
    }

    const isUnlimited = unlimited_hits === 'true' || unlimited_hits === 'on' || unlimited_hits === '1' || unlimited_hits === 1;
    const rateLimitEnabled = isUnlimited ? 0 : 1;
    const enabled = api_enabled === 'true' || api_enabled === 1 || api_enabled === '1' ? 1 : 0;

    const query = `UPDATE api_keys SET 
        name = ?, 
        allowed_apis = ?, 
        key_note = ?, 
        note_enabled = ?, 
        unlimited_hits = ?, 
        rate_limit_enabled = ?, 
        rate_limit_per_day = ?, 
        rate_limit_per_hour = ?, 
        rate_limit_per_minute = ?, 
        status = ?, 
        api_enabled = ?, 
        expires_at = COALESCE(?, expires_at),
        last_updated = ? 
        WHERE id = ?`;

    const values = [
        name,
        allowedApisJson,
        key_note || '',
        key_note ? 1 : 0,
        isUnlimited ? 1 : 0,
        rateLimitEnabled,
        parseInt(rate_limit_per_day) || 100,
        parseInt(rate_limit_per_hour) || 20,
        parseInt(rate_limit_per_minute) || 5,
        status || 'active',
        enabled,
        expires_at,
        new Date().toISOString(),
        key_id
    ];

    db.run(query, values, function(err) {
        if (err) return res.status(500).json({ error: 'Failed to update key: ' + err.message });
        res.json({ success: true });
    });
});

app.post('/admin/delete-key', requireAuth, (req, res) => {
    db.run('DELETE FROM api_keys WHERE id = ?', [req.body.id]);
    res.redirect('/admin/dashboard');
});

app.post('/admin/toggle-key-enabled', requireAuth, (req, res) => {
    const { key_id, api_enabled } = req.body;
    const enabled = api_enabled === 'true' || api_enabled === 1 || api_enabled === '1' ? 1 : 0;
    
    db.run(
        'UPDATE api_keys SET api_enabled = ?, last_updated = ? WHERE id = ?',
        [enabled, new Date().toISOString(), key_id],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to toggle key' });
            res.json({ success: true, api_enabled: enabled });
        }
    );
});

app.post('/admin/toggle-api', requireAuth, (req, res) => {
    const { api_id, is_active } = req.body;
    db.run('UPDATE available_apis SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, api_id], function(err) {
        res.json(err ? { error: err.message } : { success: true });
    });
});

app.post('/admin/update-settings', requireAuth, (req, res) => {
    const { maintenance_message } = req.body;
    db.run(`UPDATE settings SET maintenance_message = ? WHERE id = 1`, 
        [maintenance_message || 'API is currently under maintenance.'],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to update settings' });
            res.json({ success: true });
        });
});

// ============ MAIN API ENDPOINT WITH WORKING RATE LIMIT ============
app.all('/api/:endpoint', globalLimiter, async (req, res) => {
    const userKey = req.query.key || req.body.key;
    const endpoint = req.params.endpoint;
    
    if (!userKey) return res.status(401).json({ error: 'API key required', contact: OWNER });
    
    db.get('SELECT * FROM api_keys WHERE key = ?', [userKey], async (err, keyData) => {
        if (err || !keyData) return res.status(403).json({ error: 'Invalid API key', contact: OWNER });
        
        if (keyData.api_enabled === 0) {
            return res.status(403).json({ success: false, message: 'This API Key has been disabled by administrator.' });
        }
        
        if (keyData.status !== 'active') {
            return res.status(403).json({ error: `Key is ${keyData.status}`, contact: OWNER });
        }
        
        // Allowed API check
        try {
            const allowedApis = JSON.parse(keyData.allowed_apis || '["all"]');
            if (!allowedApis.includes('all') && !allowedApis.includes(endpoint)) {
                return res.status(403).json({ success: false, error: `API endpoint "${endpoint}" not allowed for this key.` });
            }
        } catch(e) {}
        
        // Expiry check
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            db.run('UPDATE api_keys SET status = "expired" WHERE id = ?', [keyData.id]);
            return res.status(403).json({ error: 'Key expired', contact: OWNER });
        }
        
        // ================= RATE LIMITING LOGIC =================
        if (keyData.unlimited_hits !== 1 && keyData.rate_limit_enabled === 1) {
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();

            // 1. Minute Limit Check
            const minuteLimit = keyData.rate_limit_per_minute || 5;
            const minuteCount = await new Promise((resolve) => {
                db.get(
                    'SELECT requests FROM rate_limit_tracking WHERE api_key = ? AND date = ? AND hour = ? AND minute = ?',
                    [userKey, today, currentHour, currentMinute],
                    (err, row) => resolve(row ? row.requests : 0)
                );
            });

            if (minuteCount >= minuteLimit) {
                return res.status(429).json({ error: `Rate limit exceeded (${minuteLimit} req/min). Try again in a minute.`, contact: OWNER });
            }

            // 2. Hour Limit Check
            const hourlyLimit = keyData.rate_limit_per_hour || 20;
            const hourlyCount = await new Promise((resolve) => {
                db.get(
                    'SELECT SUM(requests) as total FROM rate_limit_tracking WHERE api_key = ? AND date = ? AND hour = ?',
                    [userKey, today, currentHour],
                    (err, row) => resolve(row ? row.total || 0 : 0)
                );
            });

            if (hourlyCount >= hourlyLimit) {
                return res.status(429).json({ error: `Hourly rate limit exceeded (${hourlyLimit} req/hour)`, contact: OWNER });
            }

            // 3. Daily Limit Check
            const dailyLimit = keyData.rate_limit_per_day || 100;
            const dailyCount = await new Promise((resolve) => {
                db.get(
                    'SELECT SUM(requests) as total FROM rate_limit_tracking WHERE api_key = ? AND date = ?',
                    [userKey, today],
                    (err, row) => resolve(row ? row.total || 0 : 0)
                );
            });

            if (dailyCount >= dailyLimit) {
                return res.status(429).json({ error: `Daily rate limit exceeded (${dailyLimit} req/day)`, contact: OWNER });
            }

            // Record this hit in Rate Limit Tracker
            db.run(
                `INSERT INTO rate_limit_tracking (api_key, date, hour, minute, requests) 
                 VALUES (?, ?, ?, ?, 1) 
                 ON CONFLICT(api_key, date, hour, minute) 
                 DO UPDATE SET requests = requests + 1`,
                [userKey, today, currentHour, currentMinute]
            );
        }

        // Increase Hits Counter
        db.run('UPDATE api_keys SET hits = hits + 1 WHERE id = ?', [keyData.id]);

        // Route Forwarding
        const proxyFn = apiProxyMap[endpoint];
        if (!proxyFn) return res.status(404).json({ error: 'Unknown endpoint', contact: OWNER });

        try {
            const targetUrl = proxyFn({ ...req.query, ...req.body });
            const response = await axios.get(targetUrl, { timeout: 30000 });
            let cleanedData = cleanResponseData(response.data);
            res.json(cleanedData);
        } catch (error) {
            res.status(500).json({ error: 'Target API request failed', details: error.message });
        }
    });
});

app.get('/health', (req, res) => { res.json({ status: 'ok' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 OSINT API HUB RUNNING ON PORT ${PORT}`);
});

module.exports = app;
