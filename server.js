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
    mistral: 'FVKec5Xqa2ORzSoBrqi21nRbIM6rFk2q',
    subhxco: 'subh-key',
    ayaanmods: 'ayaan-key'
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
        rate_limit_per_minute INTEGER DEFAULT 5,
        key_note TEXT DEFAULT '',
        note_enabled INTEGER DEFAULT 0,
        last_updated DATETIME,
        api_enabled INTEGER DEFAULT 1
    )`);

    // Rate limit tracking
    db.run(`CREATE TABLE IF NOT EXISTS rate_limit_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date TEXT,
        minute_timestamp INTEGER,
        requests INTEGER DEFAULT 0,
        UNIQUE(api_key, date, minute_timestamp)
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

    // Daily calls tracking
    db.run(`CREATE TABLE IF NOT EXISTS daily_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        date TEXT,
        calls INTEGER DEFAULT 0,
        UNIQUE(api_key, date)
    )`);

    // Available APIs Table (with custom_message column)
    db.run(`CREATE TABLE IF NOT EXISTS available_apis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        display_name TEXT,
        endpoint TEXT,
        required_params TEXT,
        example_params TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        custom_message TEXT DEFAULT 'API is currently turned off.'
    )`);

    // Auto-migrate schema: Add custom_message column if missing in existing DB
    db.run(`ALTER TABLE available_apis ADD COLUMN custom_message TEXT DEFAULT 'API is currently turned off.'`, (err) => {
        // Ignore error if column already exists
    });

    // Settings table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY,
        maintenance_message TEXT DEFAULT 'API is currently under maintenance.'
    )`);

    // Insert default settings
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

    // Default APIs
    db.get(`SELECT COUNT(*) as count FROM available_apis`, [], (err, row) => {
        if (row && row.count === 0) {
            const apis = [
                ['leakpro', '🔓 Leak Pro', '/api/leakpro', 'number', '{"number":"919876543210"}', 'LEAK pro information'],
                ['vehicle-info', '🚗 Vehicle Info', '/api/vehicle-info', 'vehicle', '{"vehicle":"UP42BB2572"}', 'Get vehicle challan/info'],
                ['telegram-num', '📞 Telegram to Number', '/api/telegram-num', 'term', '{"term":"7577179320"}', 'Get number from Telegram ID'],
                ['family-info', '👨‍👩‍👧‍👦 Family Info', '/api/family-info', 'q', '{"q":"123456789012"}', 'Family information lookup'],
                ['number-info', '📱 Number Info', '/api/number-info', 'q', '{"q":"9876543321"}', 'Complete number information'],
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
                ['leak', '🔍 Leak Info', '/api/leak', 'number', '{"number":"919876543210"}', 'Complete phone info'],
                ['mistral', '🤖 Mistral AI', '/api/mistral', 'message', '{"message":"What is AI?"}', 'Chat with Mistral AI'],
                ['veh-to-num', '🚗 Vehicle to Number', '/api/veh-to-num', 'term', '{"term":"UP50P5434"}', 'Vehicle to mobile number']
            ];
            
            apis.forEach(api => {
                db.run(`INSERT INTO available_apis (name, display_name, endpoint, required_params, example_params, description, is_active, custom_message) VALUES (?, ?, ?, ?, ?, ?, 1, 'API is currently turned off.')`, api);
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

// ============ HELPER FUNCTION FOR FLEXIBLE PARAMETER EXTRACTION ============
const getParam = (p, ...keys) => {
    for (let k of keys) {
        if (p[k] !== undefined && p[k] !== null && p[k] !== '') {
            return encodeURIComponent(p[k]);
        }
    }
    return '';
};

// ============ API PROXY MAP ============
const apiProxyMap = {
    'leakpro': (p) => `https://raxxosint.onrender.com/leakosint?key=Customer&quiry=${getParam(p, 'number', 'query', 'q', 'num', 'quiry', 'term')}`,
    'vehicle-info': (p) => `https://leakapi.dpdns.org/vehicle-info?registration_number=${getParam(p, 'vehicle', 'registration_number', 'q', 'term', 'query')}`,
    'telegram-num': (p) => `https://tg-to-num-ten.vercel.app/tg?key=sahil_X&num=${getParam(p, 'term', 'id', 'username', 'num', 'query', 'q')}`,
    'family-info': (p) => `https://osint.invalidayushh.workers.dev/adhar?key=Sahil&q=${getParam(p, 'q', 'term', 'id', 'query', 'number')}`,
    'number-info': (p) => `https://osint.invalidayushh.workers.dev/num?key=Sahil&q=${getParam(p, 'q', 'number', 'num', 'query', 'term')}`,
    'num-newinfo': (p) => `https://leakapi.dpdns.org/search?q=${getParam(p, 'q', 'number', 'num', 'query', 'term')}`,
    'email-info': (p) => `https://osint.invalidayushh.workers.dev/email?key=Sahil&q=${getParam(p, 'q', 'email', 'query')}`,
    'insta': (p) => `https://osint.invalidayushh.workers.dev/insta?key=Sahil&q=${getParam(p, 'username', 'q', 'query')}`,
    'vehicle': (p) => `https://leakapi.dpdns.org/api/vehicle?vehicle=${getParam(p, 'vehicle', 'q', 'term', 'query')}`,
    'family': (p) => `https://ayaanmods.site/family.php?key=${MASTER_KEYS.subhxco}&term=${getParam(p, 'term', 'q', 'query', 'number')}`,
    'num-india': (p) => `https://ft-osint-api.duckdns.org/api/number?key=${MASTER_KEYS.ftosint}&num=${getParam(p, 'num', 'number', 'q', 'query')}`,
    'num-pak': (p) => `https://ft-osint-api.duckdns.org/api/pk?key=${MASTER_KEYS.ftosint}&number=${getParam(p, 'number', 'num', 'q', 'query')}`,
    'bank': (p) => `https://ft-osint-api.duckdns.org/api/ifsc?key=${MASTER_KEYS.ftosint}&ifsc=${getParam(p, 'ifsc', 'q', 'query')}`,
    'pan': (p) => `https://ft-osint-api.duckdns.org/api/pan?key=${MASTER_KEYS.ftosint}&pan=${getParam(p, 'pan', 'q', 'query')}`,
    'rc': (p) => `https://leakapi.dpdns.org/rc?registration_number=${getParam(p, 'owner', 'vehicle', 'q', 'query')}`,
    'ip': (p) => `https://ft-osint-api.duckdns.org/api/ip?key=${MASTER_KEYS.ftosint}&ip=${getParam(p, 'ip', 'q', 'query')}`,
    'pincode': (p) => `https://ft-osint-api.duckdns.org/api/pincode?key=${MASTER_KEYS.ftosint}&pin=${getParam(p, 'pin', 'q', 'query')}`,
    'git': (p) => `https://ft-osint-api.duckdns.org/api/git?key=${MASTER_KEYS.ftosint}&username=${getParam(p, 'username', 'q', 'query')}`,
    'bgmi': (p) => `https://ft-osint-api.duckdns.org/api/bgmi?key=${MASTER_KEYS.ftosint}&uid=${getParam(p, 'uid', 'q', 'query')}`,
    'ff': (p) => `https://ft-osint-api.duckdns.org/api/ff?key=${MASTER_KEYS.ftosint}&uid=${getParam(p, 'uid', 'q', 'query')}`,
    'ai-image': (p) => `https://ayaanmods.site/aiimage.php?key=${MASTER_KEYS.ayaanmods}&prompt=${getParam(p, 'prompt', 'q', 'query')}`,
    'leak': (p) => `https://leakapi.dpdns.org/chain?q=${getParam(p, 'number', 'query', 'q', 'num', 'term')}`,
    'mistral': `mistral-direct`,
    'veh-to-num': (p) => `https://vehicleinfo.noobgamingv40.workers.dev/fetch?vehicle=${getParam(p, 'vehicle', 'term', 'q', 'query')}`
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

// ============ PUBLIC ROUTES ============
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

app.get('/docs', (req, res) => {
    db.all('SELECT * FROM available_apis WHERE is_active = 1', [], (err, apis) => {
        if (err) return res.status(500).send('Database Error');
        const formattedApis = (apis || []).map(api => {
            let params = {};
            try { params = JSON.parse(api.required_params || '{}'); } catch(e) { params = {}; }
            let examples = {};
            try { examples = JSON.parse(api.example_params || '{}'); } catch(e) { examples = {}; }
            
            const primaryParam = Object.keys(params)[0] || 'query';
            const exampleValue = examples[primaryParam] || 'sample_value';

            return { 
                ...api, 
                param_name: primaryParam, 
                param_example: exampleValue,
                full_example_url: `${req.protocol}://${req.get('host')}${api.endpoint}?key=YOUR_API_KEY&${primaryParam}=${exampleValue}`
            };
        });

        res.render('docs', { 
            apis: formattedApis, 
            baseUrl: req.protocol + '://' + req.get('host'),
            owner: OWNER,
            channel: CHANNEL,
            user: req.session ? req.session.user : null
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

// ============ ADMIN DASHBOARD ROUTES ============
app.get('/admin/dashboard', requireAuth, (req, res) => {
    if (req.session.user.role === 'head_admin') return res.redirect('/head-admin/dashboard');
    
    db.all('SELECT * FROM api_keys ORDER BY created_at DESC', [], (err, keys) => {
        db.get('SELECT COALESCE(SUM(hits), 0) as total FROM api_keys', [], (err, hits) => {
            db.get('SELECT COUNT(*) as active FROM api_keys WHERE status="active"', [], (err, active) => {
                db.all('SELECT * FROM available_apis', [], (err, apis) => {
                    db.get('SELECT * FROM settings WHERE id = 1', [], (err, settings) => {
                        db.all(`SELECT date, SUM(calls) as total_calls FROM daily_calls GROUP BY date ORDER BY date DESC LIMIT 7`, [], (err, chartRows) => {
                            const chartData = (chartRows || []).reverse();
                            const formattedApis = (apis || []).map(api => {
                                let params = {};
                                try { params = JSON.parse(api.required_params || '{}'); } catch(e) { params = {}; }
                                return { ...api, param_name: Object.keys(params)[0] || 'param' };
                            });

                            res.render('dashboard', {
                                keys: keys || [],
                                totalHits: hits ? hits.total : 0,
                                active: active ? active.active : 0,
                                apis: formattedApis,
                                chartData: chartData,
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
});

app.get('/head-admin/dashboard', requireHeadAdmin, (req, res) => {
    res.redirect('/admin/dashboard');
});

// ============ GENERATE KEY ============
app.post('/admin/generate-key', requireAuth, (req, res) => {
    const { 
        name, expiry, unlimited_hits, 
        selected_apis,
        custom_key,
        rate_limit_per_day, rate_limit_per_minute,
        key_note, custom_expiry_date, custom_expiry_time
    } = req.body;
    
    const isCustomEnabled = req.body.enable_custom === 'on' || req.body.enable_custom === true;
    
    if (isCustomEnabled && (!custom_key || custom_key.trim() === '')) {
        return res.status(400).send('❌ Please enter a custom key string.');
    }
    
    function createKey(apiKey, isCustom) {
        let expires_at = null;
        const now = new Date();
        
        if (expiry === '3d') expires_at = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
        else if (expiry === '7d') expires_at = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
        else if (expiry === '30d') expires_at = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        else if (expiry === 'custom' && custom_expiry_date) {
            const dateTime = new Date(`${custom_expiry_date}T${custom_expiry_time || '23:59'}`);
            if (!isNaN(dateTime)) expires_at = dateTime;
        }
        
        let allowedApisJson = '["all"]';
        if (selected_apis) {
            if (selected_apis === 'all' || (Array.isArray(selected_apis) && selected_apis.includes('all'))) {
                allowedApisJson = '["all"]';
            } else if (Array.isArray(selected_apis)) {
                allowedApisJson = JSON.stringify(selected_apis);
            } else {
                allowedApisJson = JSON.stringify([selected_apis]);
            }
        }
        
        const isUnlimited = unlimited_hits === 'true' || unlimited_hits === 'on' || unlimited_hits === '1';
        const rateLimitEnabled = isUnlimited ? 0 : 1;
        const noteText = key_note ? key_note.trim() : '';

        db.run(`INSERT INTO api_keys (
                key, name, owner_username, owner_channel, 
                expires_at, unlimited_hits, allowed_apis, status, is_custom,
                rate_limit_enabled, rate_limit_per_day, rate_limit_per_minute,
                key_note, note_enabled, last_updated, api_enabled
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 1)`, 
            [
                apiKey, name, OWNER, CHANNEL, 
                expires_at, 
                isUnlimited ? 1 : 0, 
                allowedApisJson, 
                isCustom ? 1 : 0,
                rateLimitEnabled,
                isUnlimited ? 0 : (parseInt(rate_limit_per_day) || 100),
                isUnlimited ? 0 : (parseInt(rate_limit_per_minute) || 0),
                noteText,
                noteText.length > 0 ? 1 : 0,
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

// ============ EDIT KEY ROUTE ============
app.post('/admin/edit-key', requireAuth, (req, res) => {
    const { 
        key_id, name, expiry, unlimited_hits, 
        rate_limit_per_day, rate_limit_per_minute,
        key_note, status, selected_apis, api_enabled 
    } = req.body;

    if (!key_id) {
        return res.status(400).json({ success: false, error: 'Key ID required' });
    }

    let expires_at = null;
    if (expiry && expiry !== 'keep') {
        const now = new Date();
        if (expiry === '3d') expires_at = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
        else if (expiry === '7d') expires_at = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
        else if (expiry === '30d') expires_at = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        else if (expiry === 'never') expires_at = null;
    }

    let allowedApisJson = '["all"]';
    if (selected_apis) {
        if (selected_apis === 'all' || (Array.isArray(selected_apis) && selected_apis.includes('all'))) {
            allowedApisJson = '["all"]';
        } else if (Array.isArray(selected_apis)) {
            allowedApisJson = JSON.stringify(selected_apis);
        } else {
            allowedApisJson = JSON.stringify([selected_apis]);
        }
    }

    const isUnlimited = unlimited_hits === 'true' || unlimited_hits === 'on' || unlimited_hits === '1' || unlimited_hits === 1;
    const rateLimitEnabled = isUnlimited ? 0 : 1;
    const enabled = api_enabled === 'false' || api_enabled === 0 || api_enabled === '0' ? 0 : 1;
    const noteText = key_note ? key_note.trim() : '';

    const perDay = isUnlimited ? 0 : (parseInt(rate_limit_per_day) >= 0 ? parseInt(rate_limit_per_day) : 100);
    const perMinute = isUnlimited ? 0 : (parseInt(rate_limit_per_minute) >= 0 ? parseInt(rate_limit_per_minute) : 0);

    const query = `UPDATE api_keys SET 
        name = COALESCE(?, name), 
        allowed_apis = ?, 
        key_note = ?, 
        note_enabled = ?, 
        unlimited_hits = ?, 
        rate_limit_enabled = ?, 
        rate_limit_per_day = ?, 
        rate_limit_per_minute = ?, 
        status = COALESCE(?, status), 
        api_enabled = ?, 
        expires_at = CASE WHEN ? = 'never' THEN NULL WHEN ? IS NOT NULL THEN ? ELSE expires_at END,
        last_updated = ? 
        WHERE id = ?`;

    const values = [
        name || null,
        allowedApisJson,
        noteText,
        noteText.length > 0 ? 1 : 0,
        isUnlimited ? 1 : 0,
        rateLimitEnabled,
        perDay,
        perMinute,
        status || null,
        enabled,
        expiry,
        expires_at ? expires_at.toISOString() : null,
        expires_at ? expires_at.toISOString() : null,
        new Date().toISOString(),
        key_id
    ];

    db.run(query, values, function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Key updated successfully' });
    });
});

app.post('/admin/delete-key', requireAuth, (req, res) => {
    db.run('DELETE FROM api_keys WHERE id = ?', [req.body.id], () => res.redirect('/admin/dashboard'));
});

app.post('/admin/toggle-key-enabled', requireAuth, (req, res) => {
    const { key_id, api_enabled } = req.body;
    const enabled = api_enabled === true || api_enabled === 'true' || api_enabled === 1 || api_enabled === '1' ? 1 : 0;
    
    db.run('UPDATE api_keys SET api_enabled = ?, last_updated = ? WHERE id = ?',
        [enabled, new Date().toISOString(), key_id],
        (err) => res.json({ success: !err })
    );
});

app.post('/admin/bulk-key-action', requireAuth, (req, res) => {
    const { key_ids, action } = req.body;
    if (!key_ids || !Array.isArray(key_ids) || key_ids.length === 0) {
        return res.status(400).json({ success: false, error: 'No keys selected' });
    }

    const placeholders = key_ids.map(() => '?').join(',');
    let sql = '';

    if (action === 'enable') sql = `UPDATE api_keys SET api_enabled = 1 WHERE id IN (${placeholders})`;
    else if (action === 'disable') sql = `UPDATE api_keys SET api_enabled = 0 WHERE id IN (${placeholders})`;
    else if (action === 'revoke') sql = `UPDATE api_keys SET status = 'disabled' WHERE id IN (${placeholders})`;
    else if (action === 'delete') sql = `DELETE FROM api_keys WHERE id IN (${placeholders})`;
    else return res.status(400).json({ success: false, error: 'Invalid action' });

    db.run(sql, key_ids, function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

app.post('/admin/toggle-api', requireAuth, (req, res) => {
    const { api_id, is_active } = req.body;
    db.run('UPDATE available_apis SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, api_id], function(err) {
        res.json(err ? { error: err.message } : { success: true });
    });
});

// Update API Status & Custom Response Message
app.post('/admin/update-api-status', requireAuth, (req, res) => {
    const { api_id, is_active, custom_message } = req.body;
    db.run('UPDATE available_apis SET is_active = ?, custom_message = ? WHERE id = ?', 
        [is_active ? 1 : 0, custom_message || 'API is currently turned off.', api_id], 
        function(err) {
            res.json(err ? { error: err.message } : { success: true });
        }
    );
});

app.post('/admin/update-api-name', requireAuth, (req, res) => {
    const { api_id, display_name } = req.body;
    db.run('UPDATE available_apis SET display_name = ? WHERE id = ?', [display_name, api_id], function(err) {
        res.json(err ? { error: err.message } : { success: true });
    });
});

app.post('/admin/update-settings', requireAuth, (req, res) => {
    const { maintenance_message } = req.body;
    db.run(`UPDATE settings SET maintenance_message = ? WHERE id = 1`, 
        [maintenance_message || 'API is currently under maintenance.'],
        () => res.redirect('/admin/dashboard')
    );
});

// ============ MAIN API ENDPOINT WITH FLEXIBLE PARAMS ============
app.all('/api/:endpoint', globalLimiter, async (req, res) => {
    const userKey = req.query.key || req.body.key;
    const endpoint = req.params.endpoint;
    
    if (!userKey) return res.status(401).json({ error: 'API key required', contact: OWNER });

    // Check Global API Status (On/Off) and Custom Message
    const targetApi = await new Promise((resolve) => {
        db.get('SELECT * FROM available_apis WHERE name = ? OR endpoint = ?', [endpoint, `/api/${endpoint}`], (err, row) => {
            resolve(row || null);
        });
    });

    if (targetApi && targetApi.is_active === 0) {
        return res.status(200).json({
            status: false,
            message: targetApi.custom_message || 'This API is currently turned off by administrator.'
        });
    }

    db.get('SELECT * FROM api_keys WHERE key = ?', [userKey], async (err, keyData) => {
        if (err || !keyData) return res.status(403).json({ error: 'Invalid API key', contact: OWNER });
        
        if (keyData.api_enabled === 0) {
            return res.status(403).json({ success: false, message: 'This API Key has been disabled by administrator.' });
        }
        
        if (keyData.status !== 'active') {
            return res.status(403).json({ error: `Key status is ${keyData.status}`, contact: OWNER });
        }
        
        // Allowed API Permission check (Select All vs Single/Specific Select)
        try {
            const allowedApis = JSON.parse(keyData.allowed_apis || '["all"]');
            if (!allowedApis.includes('all') && !allowedApis.includes(endpoint)) {
                return res.status(403).json({ success: false, error: `API endpoint "${endpoint}" is not allowed for this key.` });
            }
        } catch(e) {}
        
        // Expiry check
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            db.run('UPDATE api_keys SET status = "expired" WHERE id = ?', [keyData.id]);
            return res.status(403).json({ error: 'Key expired', contact: OWNER });
        }
        
        // ================= RATE LIMITING LOGIC =================
        let rateLimitInfo = {};
        
        if (keyData.unlimited_hits !== 1 && keyData.rate_limit_enabled === 1) {
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            const currentMinuteTs = Math.floor(now.getTime() / (60 * 1000));

            const perMinuteLimit = parseInt(keyData.rate_limit_per_minute) || 0;
            const perDayLimit = parseInt(keyData.rate_limit_per_day) || 100;

            // 1. Daily Usage Check
            const dailyCount = await new Promise((resolve) => {
                db.get(
                    'SELECT SUM(requests) as total FROM rate_limit_tracking WHERE api_key = ? AND date = ?',
                    [userKey, today],
                    (err, row) => resolve(row ? (row.total || 0) : 0)
                );
            });

            if (perDayLimit > 0 && dailyCount >= perDayLimit) {
                return res.status(429).json({
                    success: false,
                    error: `Daily rate limit exceeded (${perDayLimit} req/day)`,
                    rate_limit: { per_day: { limit: perDayLimit, used: dailyCount, remaining: 0 } },
                    contact: OWNER
                });
            }

            // 2. Per Minute Check (Skip if perMinuteLimit === 0)
            let minuteCount = 0;
            if (perMinuteLimit > 0) {
                minuteCount = await new Promise((resolve) => {
                    db.get(
                        'SELECT requests FROM rate_limit_tracking WHERE api_key = ? AND minute_timestamp = ?',
                        [userKey, currentMinuteTs],
                        (err, row) => resolve(row ? row.requests : 0)
                    );
                });

                if (minuteCount >= perMinuteLimit) {
                    return res.status(429).json({
                        success: false,
                        error: `Per-minute rate limit exceeded (${perMinuteLimit} req/min). Please wait a moment.`,
                        rate_limit: {
                            per_minute: { limit: perMinuteLimit, used: minuteCount, remaining: 0 },
                            per_day: { limit: perDayLimit, used: dailyCount, remaining: Math.max(0, perDayLimit - dailyCount) }
                        },
                        contact: OWNER
                    });
                }
            }

            // Record Rate Limit Hit
            db.run(
                `INSERT INTO rate_limit_tracking (api_key, date, minute_timestamp, requests) 
                 VALUES (?, ?, ?, 1) 
                 ON CONFLICT(api_key, date, minute_timestamp) 
                 DO UPDATE SET requests = requests + 1`,
                [userKey, today, currentMinuteTs]
            );

            // Construct Rate Limit Info Output
            rateLimitInfo.per_day = {
                limit: perDayLimit,
                used: dailyCount + 1,
                remaining: Math.max(0, perDayLimit - (dailyCount + 1))
            };

            if (perMinuteLimit > 0) {
                rateLimitInfo.per_minute = {
                    limit: perMinuteLimit,
                    used: minuteCount + 1,
                    remaining: Math.max(0, perMinuteLimit - (minuteCount + 1))
                };
            }
        }

        // Record Daily Calls Analytics
        const todayStr = new Date().toISOString().split('T')[0];
        db.run(
            `INSERT INTO daily_calls (api_key, date, calls) VALUES (?, ?, 1)
             ON CONFLICT(api_key, date) DO UPDATE SET calls = calls + 1`,
            [userKey, todayStr]
        );

        // Increase Hits Counter
        db.run('UPDATE api_keys SET hits = hits + 1 WHERE id = ?', [keyData.id]);

        // Route Forwarding
        const proxyFn = apiProxyMap[endpoint];
        if (!proxyFn) return res.status(404).json({ error: 'Unknown endpoint', contact: OWNER });

        try {
            const params = { ...req.query, ...req.body };
            const targetUrl = proxyFn(params);
            const response = await axios.get(targetUrl, { timeout: 30000 });
            let cleanedData = cleanResponseData(response.data);

            if (Object.keys(rateLimitInfo).length > 0) {
                cleanedData.rate_limit = rateLimitInfo;
            }

            if ((keyData.note_enabled === 1 || keyData.note_enabled === '1') && keyData.key_note) {
                cleanedData.key_note = keyData.key_note;
            }

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
