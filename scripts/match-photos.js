#!/usr/bin/env node
// Reads photos from Firebase Storage named by meal (e.g. "Spaghetti Carbonara.jpg").
// If the meal name appears in any station's description this week, that station gets the photo.
// Writes public/station-photos.json.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');

const BUCKET         = process.env.FIREBASE_BUCKET;
const MENU_URL       = 'https://monarch-cafe.web.app/api/menu';
const STORAGE_PREFIX = process.env.STORAGE_PREFIX || 'food-photos/';

const sa = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'MenuServiceAccount.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: BUCKET });
const bucket = admin.storage().bucket();

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Returns the station whose description contains the meal name (or vice versa)
function findStation(mealName, menuItems) {
  const meal = normalize(mealName);
  for (const item of menuItems) {
    const desc = normalize(item.description || '');
    if (desc.includes(meal) || meal.includes(normalize(item.description || ''))) {
      return item.station;
    }
  }
  return null;
}

async function main() {
  let menuItems = [];
  try {
    const res  = await fetch(MENU_URL);
    const data = await res.json();
    menuItems  = (data.days || []).flatMap(d => d.items || []);
    console.log(`Fetched menu: ${menuItems.length} station-day entries\n`);
  } catch(e) {
    console.error('Could not fetch live menu — aborting.');
    process.exit(1);
  }

  const [files] = await bucket.getFiles({ prefix: STORAGE_PREFIX });
  const images  = files.filter(f => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  console.log(`Found ${images.length} image(s) in "${STORAGE_PREFIX}"\n`);

  const matched = {};

  for (const file of images) {
    const mealName = path.basename(file.name).replace(/\.[^.]+$/, '');
    const station  = findStation(mealName, menuItems);

    if (!station) {
      console.log(`  ${mealName} → no match this week`);
      continue;
    }
    if (matched[station]) {
      console.log(`  ${mealName} → skip (${station} already filled)`);
      continue;
    }

    await file.makePublic();
    matched[station] = `https://storage.googleapis.com/${BUCKET}/${file.name}`;
    console.log(`  ${mealName} → ✓ ${station}`);
  }

  const outPath = path.resolve(__dirname, '../public/station-photos.json');
  fs.writeFileSync(outPath, JSON.stringify(matched, null, 2));

  console.log(`\nMatched ${Object.keys(matched).length} station(s)`);
  console.log(`Written → public/station-photos.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
