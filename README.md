# Monarch Café — v1.1 Food Photos

Builds on [v1.0](https://github.com/sidcoder1010-creator/monarch_cafe/tree/1.0_original) with real food photography and a redesigned card layout.

---

## What's New in v1.1

### Real Food Photos
Station cards now display actual food photography instead of color gradients. Photos are matched to stations using AI vision and served from Firebase Storage. Stations without a matched photo fall back to the v1.0 gradient placeholder automatically.

### Full-Bleed Card Design
Cards are now **220px tall** with the photo filling the entire card edge-to-edge. Station name, description, and price are overlaid directly on the image over a dark gradient scrim — no separate text section below the photo.

### Hover Animation
Cards scale up slightly (`1.02×`) on hover with a soft drop shadow, giving the grid a tactile feel.

---

## Photo Matching Pipeline

A one-time local script (`scripts/match-photos.js`) handles the full pipeline:

1. **Lists** all images in a Google Drive folder via the Drive API
2. **Downloads** each image and converts it to JPEG (handles iPhone HEIC files via macOS `sips`)
3. **Identifies** the food using OpenAI `gpt-4o-mini` vision — matches against the 10 station names
4. **Uploads** the best match per station to Firebase Storage and makes it public
5. **Writes** `public/station-photos.json` — a map of station name → CDN URL

The frontend fetches `station-photos.json` on boot and swaps in real photos wherever a match exists.

### Running the Script

Set up a `.env` file in the project root:

```
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
DRIVE_FOLDER_ID=...
FIREBASE_BUCKET=monarch-cafe.firebasestorage.app
```

Place your Firebase service account key at `scripts/serviceAccount.json`, then run:

```bash
npm run match-photos
firebase deploy --only hosting
```

Re-run whenever you add new photos to the Drive folder.

---

## New Dependencies

| Package | Purpose |
|---|---|
| `openai` | GPT-4o-mini vision for food → station matching |
| `firebase-admin` | Upload photos to Firebase Storage |
| `dotenv` | Load API keys from `.env` |

HEIC conversion uses macOS's built-in `sips` — no extra package needed.

---

## Matched Stations (v1.1)

| Station | Photo Source |
|---|---|
| Viva Italia | ✓ Real photo |
| Global Adventures | ✓ Real photo |
| Kitchen Table | ✓ Real photo |
| Platillos Latinos | ✓ Real photo |
| Chef Special Bowl | ✓ Real photo |
| Stone Hearth Oven | ✓ Real photo |
| Breakfast Bistro | Gradient placeholder |
| Breakfast Booster | Gradient placeholder |
| Soup of the Day | Gradient placeholder |
| Sandwich Favorite | Gradient placeholder |

Add breakfast, soup, and sandwich photos to the Drive folder and re-run `npm run match-photos` to fill the remaining stations.

---

## Everything Else

All other features — PDF parsing, day tabs, station detail view, live status indicator, holiday support, Firebase deployment — are unchanged from v1.0. See the [v1.0 README](https://github.com/sidcoder1010-creator/monarch_cafe/tree/1.0_original) for full documentation.
