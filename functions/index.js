const { onRequest } = require('firebase-functions/v2/https');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const pdf     = require('pdf-parse');
const admin   = require('firebase-admin');

admin.initializeApp();
const bucket = admin.storage().bucket('monarch-cafe.firebasestorage.app');

const app     = express();
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
    // If the name matches a station directly, always use it
    const direct = STATIONS.find(s => normalize(s) === normalize(mealName));
    if (direct) return direct;

    // Otherwise match against this day's menu descriptions
    const meal = normalize(mealName);
    for (const item of menuItems) {
        const desc = normalize(item.description || '');
        if (desc.includes(meal) || meal.includes(desc)) return item.station;
    }
    return null;
}

// "Chow Mein2" → { base: "Chow Mein", index: 2 }
// "Chow Mein"  → { base: "Chow Mein", index: 1 }
function parsePhotoName(filename) {
    const m = filename.match(/^(.+?)(\d{1,2})$/);
    return m ? { base: m[1].trim(), index: parseInt(m[2]) }
             : { base: filename.trim(), index: 1 };
}

let cachedPhotos = null, photosCacheUntil = 0;

async function getPhotos(menuItems) {
    if (cachedPhotos && Date.now() < photosCacheUntil) return cachedPhotos;
    const [files] = await bucket.getFiles({ prefix: 'food-photos/' });
    const images  = files.filter(f => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));

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
    for (const [base, indexedUrls] of Object.entries(groups)) {
        const station = findStation(base, menuItems) || findOutdoorItem(base);
        if (!station || matched[station]) continue;

        const gallery = Object.keys(indexedUrls)
            .map(Number)
            .sort((a, b) => a - b)
            .map(i => indexedUrls[i]);

        matched[station] = { main: gallery[0], gallery };
    }

    cachedPhotos = matched;
    photosCacheUntil = Date.now() + 15 * 60 * 1000;
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
        const photos = await getPhotos(items);
        res.set('Cache-Control', 'no-store');
        res.json(photos);
    } catch (err) {
        console.error('Photos error:', err.message);
        res.status(500).json({});
    }
});

exports.api = onRequest({ memory: '512MiB', timeoutSeconds: 60 }, app);
