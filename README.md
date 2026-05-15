# Monarch Café — v2.2

A lunch menu viewer for Archbishop Mitty High School. Students can browse the weekly menu, see food photos, rate items, and check what's being served at the outdoor windows — all updated live whenever the admin makes changes.

**Live site:** [monarch-cafe.web.app](https://monarch-cafe.web.app)

---

## Features

### Student-Facing Menu Viewer
- Weekly lunch menu parsed automatically from the school's PDF every hour
- Day tabs (Mon–Fri) with the current day selected by default
- Food photo cards with swipeable photo galleries per dish
- Star ratings — tap to rate any item; average rating badge shown on each card and the hero banner
- Today's Special hero banner highlighted at the top of the menu
- Light/dark mode toggle (scrolls with the menu, not pinned to the screen)
- Live open/closed status based on café hours

### Outdoor Window Menus (Sidebar)
Three sections pulled from the PDF weekly:
- **Window · Lunch** — hot items (cheeseburger, burrito, pizza, crispy wings, daily sandwich & bowl)
- **Window · All Day** — cold items (salads, sandwiches, protein packs)
- **Window · After School** — snack menu (smoothies, chips, cookies, etc.)

### Admin Portal (`/admin`)
Requires Google sign-in with an authorized school email.
- Upload and assign food photos to menu items (drag & drop)
- Photos auto-renamed using dish description and numbered gallery format (`_1`, `_2`, …)
- Mark any day as a holiday — immediately clears the menu cache and shows "No Lunch Service Today" (works for café-closed days even when school is in session)
- Set a "Today's Special" featured item that appears as a hero banner on the main page
- View and delete student star ratings
- Manual menu description overrides
- One-click menu and photo cache refresh

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Firebase Hosting |
| Backend | Firebase Cloud Functions (2nd Gen, Node 22, Express) |
| Database | Firestore |
| File storage | Firebase Storage |
| Auth | Firebase Auth — Google OAuth, email allowlist |
| PDF parsing | `pdf-parse` |
| Frontend | Vanilla JS, single-file HTML (no build step) |

---

## How It Works

### Menu Parsing
The backend fetches the weekly PDF from the school's AWS bucket and parses it with `pdf-parse`. Station names act as anchors to extract each day's dishes and prices. Results are cached for 1 hour.

Firestore is checked for admin-set holidays and description overrides before the menu is returned to the client.

### Photo Matching
Photos are uploaded via the admin panel and stored in Firebase Storage. The filename is used to match a photo to a dish — either automatically (fuzzy name match) or manually via the admin's drag-and-drop assignment UI. Multiple photos per dish are supported as numbered galleries.

### Live Updates
The backend writes a timestamp to `config/version` in Firestore whenever an admin makes a change. The frontend subscribes to this document and silently reloads content in the background — no page refresh, no flash.

---

## Deployment

```bash
firebase deploy --only functions,hosting
```

Always deploy both together — deploying only one will leave the frontend and backend out of sync.

---

## What Changed in v2.2

- **Mass delete reviews** — admin Reviews tab now has a checkbox on every row, a select-all header checkbox, and a "Delete Selected (N)" button that appears when rows are checked. Deletions run in parallel and the table updates instantly.

---

## What Changed in v2.1

- **Star rating display** — each menu card and the Today's Special hero banner now show the average star rating (e.g. `★ 4.2 · 5`) in the top-right corner. Previously you could only submit a rating, not see the running average.
- **Holiday override fix** — marking a day as a holiday in the admin Config tab now immediately clears the menu cache and triggers a real-time update across all open browser tabs. Before this fix, the holiday wouldn't show up until the cache expired (~1 hour). Also works correctly for café-closed days when school is still in session.
- **Holiday messaging** — changed from "No School Today 🎉" to "No Lunch Service Today 🍽️" to cover both no-school days and school days where the café isn't open.
- **Theme toggle UX** — the dark/light mode toggle is now part of the scrollable menu content (top-right of the "Today's Menu" header) instead of being pinned to the screen. It scrolls away when you scroll down and comes back when you scroll to the top.

---

## Version History

| Branch | Description |
|---|---|
| `1.0_original` | Initial release — PDF parsing, day tabs, basic UI |
| `1.1_foodphotos` | Real food photography, full-bleed card design |
| `1.3_googlesignin` | Google OAuth for admin, replaced email/password |
| `2.0_adminfixed` | Outdoor window menus, hero banner, star ratings, admin overhaul |
| `2.1_uifix` | Star rating display on cards, holiday override fix, theme toggle UX |
| `2.2_reviewupdate` | Live star rating updates, mass delete reviews in admin |
