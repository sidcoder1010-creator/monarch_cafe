const { onRequest } = require('firebase-functions/v2/https');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const pdf     = require('pdf-parse');
const admin   = require('firebase-admin');

admin.initializeApp();
const bucket = admin.storage().bucket('monarch-cafe.firebasestorage.app');
const db     = admin.firestore();

const ADMIN_EMAILS = ['iamkylechristman@gmail.com', 'vsiddarth1010@gmail.com'];

const app     = express();
app.use(express.json());
const PDF_URL = 'https://s3-us-west-1.amazonaws.com/mittyportal/lunch.pdf';

const CFG_PATH = path.join(__dirname, 'config.json');

function loadHolidays() {
    try { return new Set(JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')).holidays ?? []); }
    catch { return new Set(); }
}

const MONTHS = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
                July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};
function toISO(dateStr) {
    const m = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
    return m ? `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2,'0')}` : null;
}

const STATIONS = [
    'Breakfast Bistro', 'Breakfast Booster', 'Soup of the Day',
    'Platillos Latinos', 'Viva Italia', 'Global Adventures',
    'Kitchen Table', 'Sandwich Favorite', 'Stone Hearth Oven', 'Chef Special Bowl',
];

const CATEGORY = {
    'Breakfast Bistro':  'breakfast', 'Breakfast Booster': 'breakfast',
    'Soup of the Day':   'soup',
    'Platillos Latinos': 'main', 'Viva Italia': 'main',
    'Global Adventures': 'main', 'Kitchen Table': 'main',
    'Sandwich Favorite': 'sandwich',
    'Stone Hearth Oven': 'pizza',
    'Chef Special Bowl': 'bowl',
};

const NOISE = [
    /Caf[eé]\s+Service\s+Hours/gi,
    /Breakfast:\s*[\d:]+\s*[AP]M\s*[-–]\s*[\d:]+\s*[AP]M/gi,
    /Lunch:\s*[\d:]+\s*[AP]M\s*[-–]\s*[\d:]+\s*[AP]M(?:\s*\/\s*[\d:]+\s*[AP]M\s*[-–]\s*[\d:]+\s*[AP]M)?/gi,
    /Faculty\s*Staff[^\n]*/gi,
    /After\s+School\s+Snack[^\n]*/gi,
    /Windows\s+(?:Lunch|All\s+Day|Afternoon\s+Snack\s*&\s*Beverage)\s+Menu/gi,
    /Smoothies?\s+\$[\d.]+/gi,
    /Iced\s+Matcha[^\n]*\$[\d.]+/gi,
    /Fresh\s+Fruit\s+Cup\s+\$[\d.]+/gi,
    /Yogurt\s+Parfait[^\n]*\$[\d.]+/gi,
    /Onion\s+Rings\s+\$[\d.]+/gi,
    /Mozzarella\s+Sticks\s+\$[\d.]+/gi,
    /Protein\s+Bars?\s+\$[\d.]+/gi,
    /Fresh\s+Baked\s+Cookie[^\n]*/gi,
    /,?\s*(?:Chocolate\s+Chip|Triple\s+Chocolate|Snickerdoodle|M&M)(?:\s*,\s*(?:Chocolate\s+Chip|Triple\s+Chocolate|Snickerdoodle|M&M))*/gi,
    /Cereal\s+cup[^\n]*\$[\d.]+/gi,
    /Assorted\s+Chips[^\n]*\$[\d.]+/gi,
    /Whole\s+Fresh\s+Fruit\s+\$[\d.]+/gi,
    /Ice\s+Cream[^\n]*(?:\(MP\)|\$[\d.]+)/gi,
    /Crispy\s+Chicken\s+Wings[^\n]*\$[\d.]+/gi,
    /Sandwich\s+Favorite\s+of\s+the\s+Day[^\n]*\$[\d.]+/gi,
    /Chef\s+Special\s+Bowl\s+of\s+the\s+Day[^\n]*\$[\d.]+/gi,
    /Niman\s+Ranch\s+Cheeseburger[^\n]*\$[\d.]+/gi,
    /Burrito\s+Wrap\s+or\s+Bowl[^\n]*\$[\d.\/]+/gi,
    /House\s+Made\s+Three\s+Cheese[^\n]*\$[\d.]+/gi,
    /Traditional\s+(?:Grilled\s+Chicken\s+)?Caesar\s+Salad[^\n]*\$[\d.]+/gi,
    /House\s+Turkey[^\n]*\$[\d.]+/gi,
    /Very-Veggie\s+Sandwich[^\n]*\$[\d.]+/gi,
    /Protein\s+Pack[^\n]*\$[\d.]+/gi,
    /(?:The\s+)?Very.Veggie\s+Sandwich[\s\S]*?\$7\.75/gi,
    /Protein\s+Pack[\s\S]*?\$7\.75/gi,
    /House\s+Turkey[\s\S]*?\$7\.75/gi,
    /Traditional\s+Grilled\s+Chicken\s+Caesar[\s\S]*?\$7\.75/gi,
    /Epicurean\s+Group[\s\S]*/i,
    /General\s+Manager:[^\n]*/gi,
    /Executive[^\n]*Chef:[^\n]*/gi,
    /Caf[eé]\s+Phone:[^\n]*/gi,
    /Monarch\s+Caf[eé]/gi,
    /Who\s+We\s+Are/gi,
];

function parseMenu(rawText) {
    const holidays = loadHolidays();
    const DAY_RE = /(Monday|Tuesday|Wednesday|Thursday|Friday)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4})/g;
    const dayMatches = [...rawText.matchAll(DAY_RE)];

    return dayMatches.map((m, i) => {
        const start = m.index;
        const end   = i + 1 < dayMatches.length ? dayMatches[i + 1].index : rawText.length;
        const chunk = rawText.slice(start, end);

        const iso     = toISO(m[2]);
        const holiday = holidays.has(iso) || /school\s+holiday/i.test(chunk);

        return {
            name:  m[1],
            date:  m[2],
            holiday,
            items: holiday ? [] : parseStations(chunk),
        };
    });
}

function parseStations(chunk) {
    let cleaned = chunk;
    cleaned = cleaned.replace(/Global Adventure(?!s)/gi, 'Global Adventures');
    cleaned = cleaned.replace(/Pasta\s+Day/gi, 'Viva Italia');
    cleaned = cleaned.replace(/American\s+BBQ/gi, 'Kitchen Table');
    for (const p of NOISE) cleaned = cleaned.replace(p, ' ');

    const STATION_RE = new RegExp(
        `(${STATIONS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
        'gi'
    );

    const matches = [...cleaned.matchAll(STATION_RE)];
    const items   = [];
    const seen    = new Set();

    for (let i = 0; i < matches.length; i++) {
        const name = STATIONS.find(s => s.toLowerCase() === matches[i][1].toLowerCase()) ?? matches[i][1];
        if (seen.has(name)) continue;
        seen.add(name);

        const from    = matches[i].index + matches[i][1].length;
        const to      = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
        let   content = cleaned.slice(from, to).trim();

        const priceMatch = content.match(/\$\d+\.\d+(?:\/\$\d+\.\d+)?/);
        const price       = priceMatch ? priceMatch[0] : null;

        content = content.replace(/\$\d+\.\d+(?:\/\$\d+\.\d+)?/g, ' ');
        content = content.replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();

        if (content.length > 5) {
            items.push({ station: name, category: CATEGORY[name] ?? 'main', description: content, price });
        }
    }

    return items;
}

// ── Menu cache (1 hour TTL) ───────────────────────────────────────────────────
let cachedMenu     = null;
let menuCacheUntil = 0;

async function getMenu() {
    if (cachedMenu && Date.now() < menuCacheUntil) return cachedMenu;

    const resp = await fetch(PDF_URL);
    if (!resp.ok) throw new Error(`PDF fetch failed: HTTP ${resp.status}`);

    const buf      = Buffer.from(await resp.arrayBuffer());
    const { text } = await pdf(buf);
    const days     = parseMenu(text);

    // Apply admin overrides
    try {
        const doc = await db.collection('config').doc('menuOverrides').get();
        const overrides = doc.exists ? (doc.data().overrides || {}) : {};
        for (const day of days) {
            for (const item of day.items) {
                const key = item.station + '||' + item.description;
                if (overrides[key]) item.description = overrides[key];
            }
        }
    } catch {}

    cachedMenu     = { days, fetchedAt: new Date().toISOString() };
    menuCacheUntil = Date.now() + 60 * 60 * 1000;
    return cachedMenu;
}

// ── Photo matching ────────────────────────────────────────────────────────────
const OUTDOOR_ITEMS = [
    'Niman Ranch Cheeseburger',
    'Burrito Wrap or Bowl',
    'House Made Three Cheese',
    'Crispy Chicken Wings',
];

function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function findOutdoorItem(mealName) {
    const meal = normalize(mealName);
    return OUTDOOR_ITEMS.find(n => normalize(n).includes(meal) || meal.includes(normalize(n))) || null;
}

function findStation(mealName, menuItems) {
    const norm = normalize(mealName);
    // Direct station name match — any station assigned by name maps back to itself
    const directStation = STATIONS.find(s => normalize(s) === norm);
    if (directStation) return directStation;
    // Fall back to matching against the day's dish descriptions
    for (const item of menuItems) {
        const desc = normalize(item.description || '');
        if (desc.includes(norm) || norm.includes(desc)) return item.station;
    }
    return null;
}

// "Chow Mein 2" → { base: "Chow Mein", index: 2 }
// "Chow Mein"   → { base: "Chow Mein", index: 1 }
// "IMG_0805"    → { base: "IMG_0805",  index: 1 }  (no space before digits → treated as one unit)
function parsePhotoName(filename) {
    const m = filename.match(/^(.+?)\s+(\d{1,2})$/);
    return m ? { base: m[1].trim(), index: parseInt(m[2]) }
             : { base: filename.trim(), index: 1 };
}

// Cache keyed by day name so Monday/Tuesday/etc each get their own matched photos
const photosCache = new Map();

async function getManualAssignments() {
    try {
        const doc = await db.collection('config').doc('photoAssignments').get();
        return doc.exists ? (doc.data().assignments || {}) : {};
    } catch { return {}; }
}

function clearPhotosCache() {
    photosCache.clear();
}

async function updateVersion() {
    try { await db.collection('config').doc('version').set({ updatedAt: admin.firestore.FieldValue.serverTimestamp() }); } catch(e) {}
}

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function getPhotos(menuItems, dayName = 'default') {
    const cached = photosCache.get(dayName);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    const [files] = await bucket.getFiles({ prefix: 'food-photos/' });
    const images  = files.filter(f => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    const manual  = await getManualAssignments();

    // Group files by base meal name
    const groups = {};
    for (const file of images) {
        const filename = path.basename(file.name).replace(/\.[^.]+$/, '');
        const { base, index } = parsePhotoName(filename);
        if (!groups[base]) groups[base] = {};
        await file.makePublic();
        const encoded = file.name.split('/').map(p => encodeURIComponent(p)).join('/');
        groups[base][index] = `https://storage.googleapis.com/monarch-cafe.firebasestorage.app/${encoded}`;
    }

    const matched = {};
    const usedStations = new Set();
    for (const [base, indexedUrls] of Object.entries(groups)) {
        const target = manual[base];
        if (target === '__none__') continue; // explicitly hidden by admin
        const station = findStation(target || base, menuItems) || findOutdoorItem(target || base);
        if (!station || usedStations.has(station)) continue;
        usedStations.add(station);

        const gallery = Object.keys(indexedUrls)
            .map(Number)
            .sort((a, b) => a - b)
            .map(i => indexedUrls[i]);

        matched[base] = { main: gallery[0], gallery };
    }

    photosCache.set(dayName, { data: matched, expiresAt: Date.now() + 15 * 60 * 1000 });
    return matched;
}

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/menu', async (req, res) => {
    try {
        res.json(await getMenu());
    } catch (err) {
        console.error('Menu error:', err.message);
        if (cachedMenu) return res.json({ ...cachedMenu, stale: true });
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/photos', async (req, res) => {
    try {
        const menu  = await getMenu();
        const dayName = req.query.day;
        const day   = (dayName ? menu.days.find(d => d.name === dayName) : null) || menu.days[0];
        const items = day?.items || [];
        const photos = await getPhotos(items, day?.name || 'default');
        res.set('Cache-Control', 'no-store');
        res.json(photos);
    } catch (err) {
        console.error('Photos error:', err.message);
        res.status(500).json({});
    }
});

// ── Admin middleware ──────────────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        if (!ADMIN_EMAILS.includes(decoded.email)) return res.status(403).json({ error: 'Forbidden' });
        req.adminUser = decoded;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ── Admin routes ──────────────────────────────────────────────────────────────
app.get('/api/admin/menu', requireAdmin, async (req, res) => {
    try { res.json(await getMenu()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/photos', requireAdmin, async (req, res) => {
    try {
        const menu  = await getMenu();
        const items = menu.days.flatMap(d => d.items);
        const photos = await getPhotos(items);
        const KNOWN = [...STATIONS, ...OUTDOOR_ITEMS];
        const report = KNOWN.map(name => ({
            name,
            hasPhoto: !!photos[name],
            main: photos[name]?.main || null,
            gallery: photos[name]?.gallery?.length || 0,
        }));
        res.json(report);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/photos/all', requireAdmin, async (req, res) => {
    try {
        const [files]  = await bucket.getFiles({ prefix: 'food-photos/' });
        const images   = files.filter(f => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
        const menu     = await getMenu();
        const allItems = menu.days.flatMap(d => d.items);
        const manual   = await getManualAssignments();

        const result = await Promise.all(images.map(async file => {
            const filename = path.basename(file.name).replace(/\.[^.]+$/, '');
            const { base } = parsePhotoName(filename);
            const autoStation   = findStation(base, allItems) || findOutdoorItem(base);
            const rawManual     = manual[base] || null;
            const manualStation = (rawManual && rawManual !== '__none__') ? rawManual : null;
            const hidden        = rawManual === '__none__';
            await file.makePublic();
            const encoded = file.name.split('/').map(p => encodeURIComponent(p)).join('/');
            const url     = `https://storage.googleapis.com/monarch-cafe.firebasestorage.app/${encoded}`;
            return { path: file.name, filename, base, url,
                     matchedStation: hidden ? null : (manualStation || autoStation || null),
                     matchedDish:    hidden ? null : (manualStation || (autoStation ? base : null)),
                     manualStation, autoStation, hidden };
        }));
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/photos/assign', requireAdmin, async (req, res) => {
    try {
        const { photoBase, targetName } = req.body;
        if (!photoBase || !targetName) return res.status(400).json({ error: 'photoBase and targetName required' });
        const manual = await getManualAssignments();
        manual[photoBase] = targetName;
        await db.collection('config').doc('photoAssignments').set({ assignments: manual });
        clearPhotosCache();
        await updateVersion();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/photos/assign', requireAdmin, async (req, res) => {
    try {
        const { photoBase } = req.body;
        if (!photoBase) return res.status(400).json({ error: 'photoBase required' });
        const manual = await getManualAssignments();
        delete manual[photoBase];
        await db.collection('config').doc('photoAssignments').set({ assignments: manual });
        clearPhotosCache();
        await updateVersion();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/photos', requireAdmin, async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath) return res.status(400).json({ error: 'filePath required' });
        if (!filePath.startsWith('food-photos/')) return res.status(400).json({ error: 'Invalid path' });
        await bucket.file(filePath).delete();
        clearPhotosCache();
        await updateVersion();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/photos/rename', requireAdmin, async (req, res) => {
    try {
        const { oldPath, newName } = req.body;
        if (!oldPath || !newName) return res.status(400).json({ error: 'oldPath and newName required' });
        if (!oldPath.startsWith('food-photos/')) return res.status(400).json({ error: 'Invalid path' });
        const clean = newName.replace(/[<>:"/\\|?*]/g, '').trim();
        if (!clean) return res.status(400).json({ error: 'Invalid name' });
        const ext = path.extname(oldPath) || '.jpg';
        const newPath = 'food-photos/' + clean + ext;
        if (oldPath === newPath) return res.json({ ok: true });
        await bucket.file(oldPath).copy(bucket.file(newPath));
        await bucket.file(newPath).makePublic();
        await bucket.file(oldPath).delete();
        const oldBase = path.basename(oldPath).replace(/\.[^.]+$/, '');
        const manual = await getManualAssignments();
        if (manual[oldBase] !== undefined) {
            manual[clean] = manual[oldBase];
            delete manual[oldBase];
            await db.collection('config').doc('photoAssignments').set({ assignments: manual });
        }
        clearPhotosCache();
        await updateVersion();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Renames files so they form a numbered gallery under targetName
app.post('/api/admin/photos/gallery-assign', requireAdmin, async (req, res) => {
    try {
        const { newPhotoPath, targetName } = req.body;
        if (!newPhotoPath || !targetName) return res.status(400).json({ error: 'newPhotoPath and targetName required' });
        if (!newPhotoPath.startsWith('food-photos/')) return res.status(400).json({ error: 'Invalid path' });

        const [files] = await bucket.getFiles({ prefix: 'food-photos/' });
        const images  = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f.name));

        // Find existing files whose base name matches targetName exactly (with optional space+digits suffix)
        const re = new RegExp(`^${escapeRegex(targetName)}( \\d+)?$`, 'i');
        const existing = [];
        for (const file of images) {
            if (file.name === newPhotoPath) continue;
            const filename = path.basename(file.name).replace(/\.[^.]+$/, '');
            if (re.test(filename.trim())) existing.push({ file, filename });
        }

        const manual = await getManualAssignments();

        // Helper: copy then delete only if src !== dest
        async function safeRename(src, dst) {
            if (src === dst) return; // already has the right name — nothing to do
            await bucket.file(src).copy(bucket.file(dst));
            await bucket.file(dst).makePublic();
            await bucket.file(src).delete();
        }

        if (existing.length === 0) {
            // First photo for this station — rename to targetName.jpg
            const dest = 'food-photos/' + targetName + '.jpg';
            await safeRename(newPhotoPath, dest);
            const oldBase = path.basename(newPhotoPath).replace(/\.[^.]+$/, '');
            delete manual[oldBase];
        } else {
            // Promote unnumbered existing photo to targetName 1.jpg
            const unnumbered = existing.find(e => !/\s\d+$/.test(e.filename));
            if (unnumbered) {
                const dest1 = 'food-photos/' + targetName + ' 1.jpg';
                await safeRename(unnumbered.file.name, dest1);
                delete manual[unnumbered.filename];
            }
            // Add new photo as targetName N+1.jpg
            const nextN = existing.length + 1;
            const dest = 'food-photos/' + targetName + ' ' + nextN + '.jpg';
            await safeRename(newPhotoPath, dest);
            const oldBase = path.basename(newPhotoPath).replace(/\.[^.]+$/, '');
            delete manual[oldBase];
        }

        await db.collection('config').doc('photoAssignments').set({ assignments: manual });
        clearPhotosCache();
        await updateVersion();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/reviews', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('reviews').orderBy('createdAt', 'desc').get();
        const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(reviews);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
    try {
        await db.collection('reviews').doc(req.params.id).delete();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/photos/refresh', requireAdmin, (req, res) => {
    clearPhotosCache();
    res.json({ ok: true, message: 'Photo cache cleared' });
});

app.post('/api/admin/menu/refresh', requireAdmin, (req, res) => {
    cachedMenu = null;
    menuCacheUntil = 0;
    res.json({ ok: true, message: 'Menu cache cleared' });
});

app.get('/api/admin/menu/overrides', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('config').doc('menuOverrides').get();
        res.json(doc.exists ? (doc.data().overrides || {}) : {});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/menu/overrides', requireAdmin, async (req, res) => {
    try {
        const { overrides } = req.body;
        if (typeof overrides !== 'object') return res.status(400).json({ error: 'overrides must be object' });
        await db.collection('config').doc('menuOverrides').set({ overrides });
        cachedMenu = null; menuCacheUntil = 0;
        await updateVersion();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/holidays', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('config').doc('holidays').get();
        res.json({ holidays: doc.exists ? (doc.data().dates || []) : [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/holidays', requireAdmin, async (req, res) => {
    try {
        const { holidays } = req.body;
        if (!Array.isArray(holidays)) return res.status(400).json({ error: 'holidays must be array' });
        await db.collection('config').doc('holidays').set({ dates: holidays });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

exports.api = onRequest({ memory: '512MiB', timeoutSeconds: 60 }, app);
