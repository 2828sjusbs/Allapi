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

    // API Keys table with all required columns
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
        last_updated DATETIME
    )`);

    // Rate limit tracking
    db.run(`CREATE TABLE IF NOT EXISTS rate_limit_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date TEXT,
        hour INTEGER,
        minute INTEGER,
        requests INTEGER DEFAULT 0
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
        date DATE,
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
        master_api INTEGER DEFAULT 1,
        maintenance_message TEXT DEFAULT 'API is currently under maintenance.'
    )`);

    // Insert default settings if not exists
    db.get(`SELECT * FROM settings WHERE id = 1`, [], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO settings (id, master_api, maintenance_message) VALUES (1, 1, 'API is currently under maintenance.')`);
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

    // Update owner info
    db.run(`UPDATE api_keys SET owner_username = ?, owner_channel = ?`, [OWNER, CHANNEL]);

    // Insert default APIs if empty
    db.get(`SELECT COUNT(*) as count FROM available_apis`, [], (err, row) => {
        if (row && row.count === 0) {
            const apis = [
                ['vehicle_info', '🚗 Vehicle Info', '/api/vehicle-info', 'vehicle', '{"vehicle":"UP42BB2572"}', 'Get vehicle challan/info'],
                ['telegram_num', '📞 Telegram to Number', '/api/telegram-num', 'term', '{"term":"7577179320"}', 'Get number from Telegram ID'],
                ['family_info', '👨‍👩‍👧‍👦 Family Info', '/api/family-info', 'q', '{"q":"942660008471"}', 'Family information lookup'],
                ['number_info', '📱 Number Info', '/api/number-info', 'q', '{"q":"9876543321"}', 'Complete number information'],
                ['aadhar_info', '🆔 Aadhar Info', '/api/aadhar-info', 'q', '{"q":"942660008471"}', 'Aadhar card information'],
                ['num_newinfo', '🔍 Number New Info', '/api/num-newinfo', 'q', '{"q":"1234597890"}', 'Advanced number information'],
                ['email_info', '📧 Email Info', '/api/email-info', 'q', '{"q":"test@email.com"}', 'Email address information'],
                ['family', '👨‍👩‍👧‍👦 Family Tree', '/api/family', 'term', '{"term":"979607168114"}', 'Family relationship lookup'],
                ['num_india', '🇮🇳 Indian Number', '/api/num-india', 'num', '{"num":"9876543210"}', 'Indian mobile number details'],
                ['num_pak', '🇵🇰 Pakistani Number', '/api/num-pak', 'number', '{"number":"03001234567"}', 'Pakistani mobile number'],
                ['name_details', '👤 Name Details', '/api/name-details', 'name', '{"name":"abhiraaj"}', 'Name information'],
                ['bank_info', '🏦 Bank IFSC', '/api/bank', 'ifsc', '{"ifsc":"SBIN0001234"}', 'Bank branch details'],
                ['pan_info', '📄 PAN Card', '/api/pan', 'pan', '{"pan":"AXDPR2606K"}', 'PAN card details'],
                ['rc_info', '📋 RC Details', '/api/rc', 'owner', '{"owner":"HR26EV0001"}', 'Registration certificate'],
                ['ip_info', '🌐 IP Geolocation', '/api/ip', 'ip', '{"ip":"8.8.8.8"}', 'IP address location'],
                ['pincode_info', '📍 Pincode Info', '/api/pincode', 'pin', '{"pin":"110001"}', 'Area details'],
                ['git_info', '🐙 GitHub User', '/api/git', 'username', '{"username":"octocat"}', 'GitHub profile'],
                ['bgmi_info', '🎮 BGMI Player', '/api/bgmi', 'uid', '{"uid":"5121439477"}', 'BGMI player stats'],
                ['ff_info', '🔫 FreeFire ID', '/api/ff', 'uid', '{"uid":"123456789"}', 'FreeFire player'],
                ['ai_image', '🎨 AI Image Gen', '/api/ai-image', 'prompt', '{"prompt":"cyberpunk cat"}', 'Generate AI images'],
                ['insta_info', '📸 Instagram Info', '/api/insta', 'username', '{"username":"instagram"}', 'Instagram profile'],
                ['leak', '🔍 leak Info', '/api/leak', 'number', '{"number":"918887882236"}', 'Complete phone info'],
                ['mistral', '🤖 Mistral AI', '/api/mistral', 'message', '{"message":"What is AI?"}', 'Chat with Mistral AI'],
                ['veh_to_num', '🚗 Vehicle to Number', '/api/veh-to-num', 'term', '{"term":"UP50P5434"}', 'Vehicle to mobile number']
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

// ============ API PROXY MAP ============
const apiProxyMap = {
    'vehicle-info': (p) => `https://leakapi.dpdns.org/vehicle-info?registration_number=${p.vehicle || p.q || p.term}`,
    'telegram-num': (p) => `https://tg-to-num-501x.onrender.com/api/tg?key=permanant&info=${p.term || p.id || p.username}`,
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
    'name-details': (p) => `https://ft-osint-api.duckdns.org/api/name?key=${MASTER_KEYS.ftosint}&name=${p.name}`,
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
        'support', 'Support', 'help', 'Help'
    ];
    
    function cleanObject(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (let key in obj) {
            if (removeFields.includes(key) || removeFields.includes(key.toLowerCase())) {
                delete obj[key];
            } 
            else if (typeof obj[key] === 'string') {
                if (obj[key].includes('InvalidAyush') || 
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

// ============ MASTER API CHECK FUNCTION ============
function checkMasterApi() {
    return new Promise((resolve) => {
        db.get('SELECT master_api, maintenance_message FROM settings WHERE id = 1', [], (err, row) => {
            if (err || !row) {
                resolve({ master_api: 1, maintenance_message: 'API is currently under maintenance.' });
            } else {
                resolve(row);
            }
        });
    });
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
            db.get('SELECT SUM(hits) as total_hits FROM api_keys', [], (err, totalHits) => {
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
                            settings: settings || { master_api: 1, maintenance_message: 'API is currently under maintenance.' },
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
        db.get('SELECT SUM(hits) as total FROM api_keys', [], (err, hits) => {
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

// ============ GENERATE KEY WITH NEW FEATURES ============
app.post('/admin/generate-key', requireAuth, (req, res) => {
    const { 
        name, expiry, unlimited_hits, allowed_apis, custom_key,
        rate_limit_enabled, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute,
        note_enabled, key_note, custom_expiry_date, custom_expiry_time,
        selected_apis
    } = req.body;
    
    const isCustomEnabled = req.body.enable_custom === 'on' || req.body.enable_custom === true;
    
    console.log('📝 Generating key - Custom enabled:', isCustomEnabled, 'Custom key:', custom_key);
    
    if (isCustomEnabled && (!custom_key || custom_key.trim() === '')) {
        return res.status(400).send('❌ Please enter a custom key or disable custom key option');
    }
    
    function createKey(apiKey, isCustom) {
        let expires_at = null;
        const now = new Date();
        
        // Handle expiry
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
        
        // Handle allowed APIs
        let allowedApisJson = '["all"]';
        if (selected_apis && Array.isArray(selected_apis)) {
            if (selected_apis.includes('all')) {
                allowedApisJson = '["all"]';
            } else {
                allowedApisJson = JSON.stringify(selected_apis);
            }
        } else if (allowed_apis) {
            if (Array.isArray(allowed_apis)) {
                allowedApisJson = JSON.stringify(allowed_apis);
            } else if (typeof allowed_apis === 'string') {
                if (allowed_apis === 'all') {
                    allowedApisJson = '["all"]';
                } else {
                    const apiArray = allowed_apis.split(',').map(api => api.trim()).filter(api => api);
                    allowedApisJson = JSON.stringify(apiArray);
                }
            }
        }
        
        const isUnlimited = unlimited_hits === 'true' || unlimited_hits === 'on';
        const rateLimitEnabled = isUnlimited ? 0 : (rate_limit_enabled === 'on' || rate_limit_enabled === 'true' ? 1 : 0);
        const noteEnabled = note_enabled === 'on' || note_enabled === 'true' ? 1 : 0;
        const noteText = noteEnabled ? (key_note || '') : '';
        
        db.run(`INSERT INTO api_keys (
                key, name, owner_username, owner_channel, 
                expires_at, unlimited_hits, allowed_apis, status, is_custom,
                rate_limit_enabled, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute,
                key_note, note_enabled, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`, 
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
                noteEnabled,
                new Date().toISOString()
            ], 
            function(err) {
                if (err) {
                    console.error('❌ DB Error:', err.message);
                    return res.status(500).send('Database error: ' + err.message);
                }
                console.log('✅ Key created successfully:', apiKey);
                res.redirect('/admin/dashboard');
            });
    }
    
    if (isCustomEnabled && custom_key && custom_key.trim() !== '') {
        let apiKey = custom_key.trim().toUpperCase();
        apiKey = apiKey.replace(/[^A-Z0-9_]/g, '');
        
        if (apiKey.length < 3) {
            return res.status(400).send('❌ Custom key must be at least 3 characters');
        }
        
        db.get('SELECT key FROM api_keys WHERE key = ?', [apiKey], (err, existing) => {
            if (err) {
                return res.status(500).send('Database error');
            }
            if (existing) {
                return res.status(400).send('❌ Key already exists: ' + apiKey);
            }
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
        rate_limit_enabled, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute,
        note_enabled, key_note, status,
        selected_apis, custom_expiry_date, custom_expiry_time
    } = req.body;

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
    if (selected_apis && Array.isArray(selected_apis)) {
        if (selected_apis.includes('all')) {
            allowedApisJson = '["all"]';
        } else {
            allowedApisJson = JSON.stringify(selected_apis);
        }
    }

    const isUnlimited = unlimited_hits === 'true' || unlimited_hits === 'on' || unlimited_hits === 1;
    const rateLimitEnabled = isUnlimited ? 0 : (rate_limit_enabled === 'on' || rate_limit_enabled === 'true' ? 1 : 0);
    const noteEnabled = note_enabled === 'on' || note_enabled === 'true' ? 1 : 0;
    const noteText = noteEnabled ? (key_note || '') : '';

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) { updateFields.push('name = ?'); updateValues.push(name); }
    if (expires_at) { updateFields.push('expires_at = ?'); updateValues.push(expires_at); }
    if (allowedApisJson) { updateFields.push('allowed_apis = ?'); updateValues.push(allowedApisJson); }
    if (noteText !== undefined) { updateFields.push('key_note = ?'); updateValues.push(noteText); }
    if (noteEnabled !== undefined) { updateFields.push('note_enabled = ?'); updateValues.push(noteEnabled); }
    if (isUnlimited !== undefined) { updateFields.push('unlimited_hits = ?'); updateValues.push(isUnlimited ? 1 : 0); }
    if (rateLimitEnabled !== undefined) { updateFields.push('rate_limit_enabled = ?'); updateValues.push(rateLimitEnabled); }
    if (rate_limit_per_day !== undefined) { updateFields.push('rate_limit_per_day = ?'); updateValues.push(parseInt(rate_limit_per_day) || 100); }
    if (rate_limit_per_hour !== undefined) { updateFields.push('rate_limit_per_hour = ?'); updateValues.push(parseInt(rate_limit_per_hour) || 20); }
    if (rate_limit_per_minute !== undefined) { updateFields.push('rate_limit_per_minute = ?'); updateValues.push(parseInt(rate_limit_per_minute) || 5); }
    if (status !== undefined) { updateFields.push('status = ?'); updateValues.push(status); }
    
    updateFields.push('last_updated = ?');
    updateValues.push(new Date().toISOString());
    updateValues.push(key_id);

    const query = `UPDATE api_keys SET ${updateFields.join(', ')} WHERE id = ?`;

    db.run(query, updateValues, function(err) {
        if (err) {
            console.error('❌ Edit key error:', err);
            return res.status(500).json({ error: 'Failed to update key' });
        }
        res.json({ success: true });
    });
});

app.post('/admin/delete-key', requireAuth, (req, res) => {
    db.run('DELETE FROM api_keys WHERE id = ?', [req.body.id]);
    res.redirect('/admin/dashboard');
});

app.post('/admin/toggle-status', requireAuth, (req, res) => {
    const { id, status } = req.body;
    db.run('UPDATE api_keys SET status = ? WHERE id = ?', [status === 'active' ? 'disabled' : 'active', id]);
    res.redirect('/admin/dashboard');
});

// ============ UPDATE MASTER API SETTINGS ============
app.post('/admin/update-settings', requireAuth, (req, res) => {
    const { master_api, maintenance_message } = req.body;
    const masterApiValue = master_api === 'on' || master_api === 'true' ? 1 : 0;
    
    db.run(`UPDATE settings SET master_api = ?, maintenance_message = ? WHERE id = 1`, 
        [masterApiValue, maintenance_message || 'API is currently under maintenance.'],
        function(err) {
            if (err) {
                console.error('❌ Error updating settings:', err);
                return res.status(500).json({ error: 'Failed to update settings' });
            }
            res.json({ success: true, master_api: masterApiValue, maintenance_message: maintenance_message });
        });
});

app.post('/head-admin/update-rate-limit', requireHeadAdmin, (req, res) => {
    const { key_id, unlimited_hits, rate_limit_enabled, rate_limit_per_day, rate_limit_per_hour, rate_limit_per_minute } = req.body;
    const isUnlimited = unlimited_hits === 'true';
    db.run(`UPDATE api_keys SET unlimited_hits = ?, rate_limit_enabled = ?, rate_limit_per_day = ?, rate_limit_per_hour = ?, rate_limit_per_minute = ? WHERE id = ?`,
            [isUnlimited ? 1 : 0, isUnlimited ? 0 : (rate_limit_enabled === 'true' ? 1 : 0), rate_limit_per_day || 100, rate_limit_per_hour || 20, rate_limit_per_minute || 5, key_id],
            function(err) { res.json(err ? { error: err.message } : { success: true }); });
});

app.post('/head-admin/create-admin', requireHeadAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.json({ error: 'Username and password required' });
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, existing) => {
        if (existing) return res.json({ error: 'Username already exists' });
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password, role, created_by) VALUES (?, ?, ?, ?)`,
            [username, hashedPassword, role || 'admin', req.session.user.username],
            function(err) { res.json(err ? { error: err.message } : { success: true }); });
    });
});

app.post('/head-admin/remove-admin', requireHeadAdmin, (req, res) => {
    db.run('DELETE FROM users WHERE id = ? AND role != "head_admin"', [req.body.admin_id], function(err) {
        res.json(err ? { error: err.message } : { success: true });
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

// ============ MAIN API ENDPOINT WITH MASTER API CHECK ============
app.all('/api/:endpoint', globalLimiter, async (req, res) => {
    const userKey = req.query.key || req.body.key;
    const endpoint = req.params.endpoint;
    
    if (!userKey) return res.json({ error: 'API key required', contact: OWNER });
    
    // Check Master API status first
    const settings = await checkMasterApi();
    if (settings.master_api === 0 || settings.master_api === '0') {
        return res.json({
            success: false,
            status: 'maintenance',
            message: settings.maintenance_message || 'API is currently under maintenance.'
        });
    }
    
    db.get('SELECT * FROM api_keys WHERE key = ? AND status = "active"', [userKey], async (err, keyData) => {
        if (err || !keyData) return res.json({ error: 'Invalid API key', contact: OWNER });
        
        // Check if key has access to this endpoint
        try {
            const allowedApis = JSON.parse(keyData.allowed_apis || '["all"]');
            if (!allowedApis.includes('all') && !allowedApis.includes(endpoint)) {
                return res.json({
                    success: false,
                    error: `API endpoint "${endpoint}" not allowed for this key. Contact ${OWNER}`
                });
            }
        } catch(e) {
            // If parsing fails, allow all
        }
        
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            db.run('UPDATE api_keys SET status = "expired" WHERE id = ?', [keyData.id]);
            return res.json({ error: 'Key expired', contact: OWNER });
        }
        
        // Update hits
        db.run('UPDATE api_keys SET hits = hits + 1 WHERE id = ?', [keyData.id]);
        
        if (endpoint === 'mistral') {
            const message = req.query.message || req.body.message;
            if (!message) return res.json({ error: 'Message required' });
            const result = await handleMistralAI(message);
            const response = cleanResponseData(result);
            // Add key metadata
            response.expires_at = keyData.expires_at;
            response.unlimited = keyData.unlimited_hits === 1;
            if (keyData.note_enabled === 1 && keyData.key_note) {
                response.key_note = keyData.key_note;
            }
            return res.json(response);
        }
        
        const proxyFn = apiProxyMap[endpoint];
        if (!proxyFn) return res.json({ error: 'Unknown endpoint', contact: OWNER });
        
        try {
            const targetUrl = proxyFn({ ...req.query, ...req.body });
            const response = await axios.get(targetUrl, { timeout: 30000 });
            let cleanedData = cleanResponseData(response.data);
            
            // Add key metadata
            cleanedData.expires_at = keyData.expires_at;
            cleanedData.unlimited = keyData.unlimited_hits === 1;
            if (keyData.note_enabled === 1 && keyData.key_note) {
                cleanedData.key_note = keyData.key_note;
            }
            
            res.json(cleanedData);
        } catch (error) {
            res.json({ error: 'API request failed', details: error.message, contact: OWNER });
        }
    });
});

// ============ API INFO ============
app.get('/api-info', (req, res) => {
    db.all('SELECT name, display_name, endpoint, required_params, description FROM available_apis WHERE is_active = 1', [], (err, apis) => {
        res.json({ owner: OWNER, channel: CHANNEL, total_apis: (apis || []).length, apis: apis || [] });
    });
});

app.get('/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

app.use((err, req, res, next) => { 
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message }); 
});

// ============ CRON JOBS ============
cron.schedule('0 0 * * *', () => {
    db.run(`UPDATE api_keys SET status = 'expired' WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    db.run(`DELETE FROM rate_limit_tracking WHERE date < ?`, [sevenDaysAgo.toISOString().split('T')[0]]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('\n🚀 OSINT API HUB RUNNING');
    console.log(`📍 http://localhost:${PORT}`);
    console.log('👑 Head Admin: main / sahil');
    console.log('🔐 Admin: sahil / sexy');
    console.log(`✅ Owner: ${OWNER}`);
    console.log(`✅ Channel: ${CHANNEL}`);
    console.log('✅ Custom keys working!');
    console.log('✅ All APIs updated!');
    console.log('✅ Master API System added!');
    console.log('✅ Key Note Feature added!');
    console.log('✅ API Permissions added!');
    console.log('=====================================\n');
});

module.exports = app;
