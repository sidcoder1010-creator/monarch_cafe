#!/usr/bin/env node
// One-time script: matches Drive food photos to menu stations via GPT-4o-mini vision,
// uploads winners to Firebase Storage, writes public/station-photos.json.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { execSync } = require('child_process');
const OpenAI  = require('openai');
const admin   = require('firebase-admin');

// ── Config ────────────────────────────────────────────────────────────────────
const FOLDER_ID  = process.env.DRIVE_FOLDER_ID;
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const BUCKET     = process.env.FIREBASE_BUCKET;

const STATIONS = [
  'Breakfast Bistro',
  'Breakfast Booster',
  'Soup of the Day',
  'Platillos Latinos',
  'Viva Italia',
  'Global Adventures',
  'Kitchen Table',
  'Sandwich Favorite',
  'Stone Hearth Oven',
  'Chef Special Bowl',
];

const STATION_HINTS = {
  'Breakfast Bistro':  'eggs, omelettes, breakfast plates, morning hot foods',
  'Breakfast Booster': 'pancakes, waffles, french toast, breakfast pastries',
  'Soup of the Day':   'soup, stew, broth, chowder',
  'Platillos Latinos': 'tacos, burritos, Mexican rice, beans, enchiladas, quesadillas',
  'Viva Italia':       'pasta, lasagna, Italian dishes, marinara, alfredo',
  'Global Adventures': 'Asian food, stir fry, sushi, Indian, Middle Eastern, international cuisine',
  'Kitchen Table':     'burgers, American comfort food, grilled chicken, fries, mac and cheese',
  'Sandwich Favorite': 'sandwiches, wraps, subs, paninis, deli',
  'Stone Hearth Oven': 'pizza, flatbread, calzone',
  'Chef Special Bowl': 'grain bowl, rice bowl, specialty bowl, poke',
};

// ── Init ──────────────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sa = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'serviceAccount.json'), 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: BUCKET,
});
const bucket = admin.storage().bucket();

// ── Drive helpers ─────────────────────────────────────────────────────────────
async function listDriveImages() {
  let files = [];
  let pageToken = '';
  do {
    const q   = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&key=${GOOGLE_KEY}&fields=nextPageToken,files(id,name,mimeType)&pageSize=100${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function downloadImage(fileId) {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const res  = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('Download returned empty/invalid response (file may not be public)');
  return buf;
}

// Convert any image (including HEIC) to JPEG using macOS sips
function toJpeg(buffer) {
  const id  = crypto.randomBytes(8).toString('hex');
  const inp = path.join(os.tmpdir(), `mc-in-${id}`);
  const out = path.join(os.tmpdir(), `mc-out-${id}.jpg`);
  try {
    fs.writeFileSync(inp, buffer);
    execSync(`sips -s format jpeg "${inp}" --out "${out}" -s formatOptions 85`, { stdio: 'pipe' });
    return fs.readFileSync(out);
  } finally {
    try { fs.unlinkSync(inp); } catch {}
    try { fs.unlinkSync(out); } catch {}
  }
}

// ── GPT-4o-mini vision ────────────────────────────────────────────────────────
async function matchStation(imageBuffer, mimeType) {
  const b64         = imageBuffer.toString('base64');
  const stationList = STATIONS.map(s => `- ${s}: ${STATION_HINTS[s]}`).join('\n');

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 20,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are matching a cafeteria food photo to a station. Reply with ONLY the exact station name from this list that best matches the image, or "none" if it clearly doesn't fit any:\n\n${stationList}\n\nReply with the exact station name only, nothing else.`,
        },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'low' },
        },
      ],
    }],
  });

  const answer = resp.choices[0].message.content.trim();
  return STATIONS.includes(answer) ? answer : null;
}

// ── Firebase Storage upload ───────────────────────────────────────────────────
async function uploadToStorage(buffer, mimeType, station) {
  const ext      = mimeType.split('/')[1] || 'jpg';
  const destPath = `station-photos/${station.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
  const file     = bucket.file(destPath);

  await file.save(buffer, { metadata: { contentType: mimeType } });
  await file.makePublic();

  return `https://storage.googleapis.com/${BUCKET}/${destPath}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Listing images in Drive folder…');
  const images = await listDriveImages();
  console.log(`Found ${images.length} image(s)\n`);

  const matched = {};

  for (const img of images) {
    if (Object.keys(matched).length === STATIONS.length) break;

    process.stdout.write(`  ${img.name} … `);
    try {
      const raw     = await downloadImage(img.id);
      const buf     = toJpeg(raw);
      const mime    = 'image/jpeg';
      const station = await matchStation(buf, mime);

      if (!station) { console.log('no match'); continue; }
      if (matched[station]) { console.log(`skip (${station} already filled)`); continue; }

      const url = await uploadToStorage(buf, mime, station);
      matched[station] = url;
      console.log(`✓  ${station}`);
    } catch (err) {
      console.log(`error: ${err.message}`);
    }
  }

  console.log(`\nMatched ${Object.keys(matched).length} / ${STATIONS.length} stations`);

  const outPath = path.resolve(__dirname, '../public/station-photos.json');
  fs.writeFileSync(outPath, JSON.stringify(matched, null, 2));
  console.log(`Written → public/station-photos.json`);

  const unmatched = STATIONS.filter(s => !matched[s]);
  if (unmatched.length) {
    console.log(`\nNo photo for: ${unmatched.join(', ')} — gradient placeholder will show instead.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
