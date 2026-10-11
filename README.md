# Trades Book

A simple shared directory of housing tradespeople (plumbers, tilers, cleaners and more) for landlords.

- Contacts are grouped by category and searchable.
- The **phone number is the unique key** of each contact. Adding a number that already exists shows an alert.
- Anyone can recommend (with name and optional comment) or leave a negative review.
- One recommendation per device/connection (best effort, not tamper-proof).

It is a static site: `index.html`, `style.css` and `script.js`. Data is stored in a free Firebase Realtime Database.

## Setup

1. Create a project at https://console.firebase.google.com (free Spark plan).
2. **Build → Realtime Database → Create Database**, then open the **Rules** tab.
3. Paste the contents of `database.rules.json` and click **Publish**.
4. On the **Data** tab, copy the database URL (`https://...firebasedatabase.app` or `...firebaseio.com`).
5. Open `script.js` and paste it into `const DB_URL = "";` near the top.

Leave `DB_URL` empty to try the site in preview mode (data stays in your own browser only).

## Deploy to GitHub Pages

1. Push `index.html`, `style.css`, `script.js` (and this README) to the top level of a repository.
2. **Settings → Pages → Deploy from a branch → main / (root)**.
3. Open the link GitHub gives you.

## Notes

- Anyone with the link can add, edit or delete contacts. The database rules only check that data has the right shape and size.
- Back up regularly: Firebase console → Realtime Database → Data → ⋮ → Export JSON.
- Only recommendations and reviews made through the page are supported; to remove one, delete it in the Firebase console.
- Negative reviews are public. Keep them factual.
