# Monarch Café

**A better way to see the Archbishop Mitty High School lunch menu.**

Monarch Café fetches the weekly lunch PDF from the school portal, parses it into structured station data, and presents it in a clean day-tabbed layout. Dark, food-forward design with a fixed sidebar and a two-column card grid.

---

## Features

- **Live menu parsing** — pulls the weekly PDF from the Mitty portal on every request, no manual updates needed
- **Day tabs** — Mon–Fri navigation, auto-selects today
- **Station cards** — each dining station gets its own card with description, category, and price
- **Station detail view** — click any card to see the full menu, always-available items, and service hours
- **Live status indicator** — sidebar pill shows whether Breakfast, Lunch, or Snack Bar is currently open
- **Holiday support** — days flagged in `config.json` show a holiday screen instead of a menu
- **Gradient placeholders** — each station has a unique color-coded gradient when no photo is available
- **Skeleton loading state** — pulsing placeholder shown while the menu loads

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, inline CSS (no build step) |
| Fonts | Playfair Display + DM Sans (Google Fonts) |
| Backend | Node.js + Express |
| PDF parsing | `pdf-parse` |
| Hosting | Firebase Hosting |
| API | Firebase Cloud Functions |

---

## Project Structure

```
monarch_cafe/
├── public/
│   └── index.html        # Full single-page frontend app
├── functions/
│   └── index.js          # Firebase Cloud Function (PDF fetch + parse)
├── server.js             # Local Express server (same logic as the function)
├── config.json           # Holiday dates in YYYY-MM-DD format
├── firebase.json         # Firebase Hosting + Functions config
└── package.json
```

---

## Running Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3001`. The server fetches and parses the live PDF on each `/api/menu` request.

---

## Holiday Configuration

Add dates to `config.json` to show a holiday screen instead of a menu:

```json
{
  "holidays": ["2026-03-06", "2026-04-18"]
}
```

Dates must be in `YYYY-MM-DD` format. Changes take effect immediately — no restart needed.

---

## Deploying

```bash
firebase deploy
```

This deploys both the static frontend (`public/`) and the Cloud Function that serves `/api/menu`.

---

## Dining Stations

| Station | Emoji | Category |
|---|---|---|
| Breakfast Bistro | 🍳 | Breakfast |
| Breakfast Booster | 🥞 | Breakfast |
| Soup of the Day | 🥣 | Soup |
| Platillos Latinos | 🌮 | Main |
| Viva Italia | 🍝 | Main |
| Global Adventures | 🌏 | Main |
| Kitchen Table | 🍽️ | Main |
| Sandwich Favorite | 🥪 | Sandwich |
| Stone Hearth Oven | 🍕 | Pizza |
| Chef Special Bowl | 🫙 | Bowl |

---

## Service Hours

| Service | Hours |
|---|---|
| Breakfast | 7:15 AM – 10:40 AM |
| Lunch | 11:00 AM – 1:30 PM |
| Faculty Lunch | 10:45 AM – 1:30 PM |
| Snack Bar | 1:30 PM – 3:30 PM |
