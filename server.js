const express = require('express');
const path    = require('path');
const fs      = require('fs');
const pdf     = require('pdf-parse');

const app      = express();
const PORT     = process.env.PORT || 3001;
const PDF_URL  = 'https://s3-us-west-1.amazonaws.com/mittyportal/lunch.pdf';
const CFG_PATH = path.join(__dirname, 'config.json');

// Dates in YYYY-MM-DD format — loaded fresh on each menu parse so edits take effect
function loadHolidays() {
    try { return new Set(JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')).holidays ?? []); }
    catch { return new Set(); }
}

// "March 6, 2026" → "2026-03-06"
const MONTHS = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
                July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};
function toISO(dateStr) {
    const m = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
    return m ? `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2,'0')}` : null;
}

// ── Known station names (order matters for parsing) ──────────────────────────
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

// Right-column noise that gets interleaved in multi-column PDF extraction
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
    /Fresh\s+Baked\s+Cookie[^\n]*\$[\d.]+/gi,
    /Cereal\s+cup[^\n]*\$[\d.]+/gi,
    /Assorted\s+Chips[^\n]*\$[\d.]+/gi,
    /Whole\s+Fresh\s+Fruit\s+\$[\d.]+/gi,
    /Ice\s+Cream[^\n]*(?:\(MP\)|\$[\d.]+)/gi,
    /Crispy\s+Chicken\s+Wings[^\n]*\$[\d.]+/gi,
    /Sandwich\s+Favorite\s+of\s+the\s+Day[^\n]*\$[\d.]+/gi,
    /Chef\s+Special\s+Bowl\s+of\s+the\s+Day[^\n]*\$[\d.]+/gi,
    // Windows/Monarch always-available items
    /Niman\s+Ranch\s+Cheeseburger[^\n]*\$[\d.]+/gi,
    /Burrito\s+Wrap\s+or\s+Bowl[^\n]*\$[\d.\/]+/gi,
    /House\s+Made\s+Three\s+Cheese[^\n]*\$[\d.]+/gi,
    /Traditional\s+(?:Grilled\s+Chicken\s+)?Caesar\s+Salad[^\n]*\$[\d.]+/gi,
    /House\s+Turkey[^\n]*\$[\d.]+/gi,
    /Very-Veggie\s+Sandwich[^\n]*\$[\d.]+/gi,
    /Protein\s+Pack[^\n]*\$[\d.]+/gi,
    // Multi-line always-available items (right column, wrapped text)
    /(?:The\s+)?Very.Veggie\s+Sandwich[\s\S]*?\$7\.75/gi,
    /Protein\s+Pack[\s\S]*?\$7\.75/gi,
    /House\s+Turkey[\s\S]*?\$7\.75/gi,
    /Traditional\s+Grilled\s+Chicken\s+Caesar[\s\S]*?\$7\.75/gi,
    // Footer — strip everything from here to end of chunk
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

        // Detect holiday from config file (PDF banner is an image — not extractable as text)
        const iso     = toISO(m[2]);
        const holiday = holidays.has(iso) || /school\s+holiday/i.test(chunk);

        return {
            name:    m[1],
            date:    m[2],
            holiday,
            items:   holiday ? [] : parseStations(chunk),
        };
    });
}

function parseStations(chunk) {
    // Strip noise from the whole chunk FIRST so Windows/right-column items don't
    // get mistaken for station entries (e.g. "Sandwich Favorite of the Day…")
    let cleaned = chunk;
    for (const p of NOISE) cleaned = cleaned.replace(p, ' ');

    // Case-insensitive match so "Kitchen table" (as seen in some PDFs) still works
    const STATION_RE = new RegExp(
        `(${STATIONS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
        'gi'
    );

    const matches = [...cleaned.matchAll(STATION_RE)];
    const items   = [];
    const seen    = new Set(); // deduplicate stations that appear more than once

    for (let i = 0; i < matches.length; i++) {
        // Normalise back to proper casing
        const name = STATIONS.find(s => s.toLowerCase() === matches[i][1].toLowerCase()) ?? matches[i][1];

        // Skip duplicate station occurrences (Windows menu leftovers)
        if (seen.has(name)) continue;
        seen.add(name);

        const from    = matches[i].index + matches[i][1].length;
        const to      = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
        let   content = cleaned.slice(from, to).trim();

        // Grab the first price before we strip anything
        const priceMatch = content.match(/\$\d+\.\d+(?:\/\$\d+\.\d+)?/);
        const price       = priceMatch ? priceMatch[0] : null;

        // Strip remaining prices and whitespace
        content = content.replace(/\$\d+\.\d+(?:\/\$\d+\.\d+)?/g, ' ');
        content = content.replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();

        if (content.length > 5) {
            items.push({ station: name, category: CATEGORY[name] ?? 'main', description: content, price });
        }
    }

    return items;
}

// ── Cache (1 hour TTL) ────────────────────────────────────────────────────────
let cached     = null;
let cacheUntil = 0;

async function getMenu() {
    if (cached && Date.now() < cacheUntil) return cached;

    const resp = await fetch(PDF_URL);
    if (!resp.ok) throw new Error(`PDF fetch failed: HTTP ${resp.status}`);

    const buf        = Buffer.from(await resp.arrayBuffer());
    const { text }   = await pdf(buf);
    const days       = parseMenu(text);

    cached     = { days, fetchedAt: new Date().toISOString() };
    cacheUntil = Date.now() + 60 * 60 * 1000;
    return cached;
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/menu', async (req, res) => {
    try {
        res.json(await getMenu());
    } catch (err) {
        console.error('Menu error:', err.message);
        if (cached) return res.json({ ...cached, stale: true });
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Lunch menu → http://localhost:${PORT}`));
