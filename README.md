# Noelle West Inventory Tracker v4

A complete operations tracker for Noelle West rental branches. Reads live from Google Sheets and Google Drive.

---

## Files

```
index.html          Dashboard
inventory.html      All tracked inventory
transactions.html   All transactions
packages.html       Package colors (MOH/BMG/FGG)
quantity.html       Quantity-based items (POLO, PANTS, VST, etc.)
search.html         Item lookup — photos, history, weight
styles.css          All styles
app.js              All frontend logic
Code.gs             Google Apps Script backend
netlify.toml        Netlify config
```

---

## Step 1 — Deploy Google Apps Script

1. Go to [script.google.com](https://script.google.com)
2. New project → name it `NW Inventory API`
3. Paste contents of `Code.gs` into the editor
4. **Deploy → New deployment**
   - Type: Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Authorize permissions
6. Copy the `/exec` URL

---

## Step 2 — Set the URL in all HTML files

Open each HTML file and find:
```html
<script>window.NW_GAS_URL = "";</script>
```

Replace with your URL:
```html
<script>window.NW_GAS_URL = "https://script.google.com/macros/s/YOUR_ID/exec";</script>
```

Do this in all 6 HTML files.

---

## Step 3 — Share your Google Sheets

Share these spreadsheets with the Google account that owns the Apps Script, as **Viewer**:
- TransactionForms: `1tm1kPbOUnlR14Y3AFFAWvTvuYHG8znKuuI-Rv7tlv0s`
- Master Inventory: `1-QD9UJ99Rjl1JPlBdKPo7hz5MBOiJKkMyD-qWlD520s`
- Handwash: `1k5iMFK0FY3VXQ3GXdYWMxuQoWpryYxSw1j_AhMU64FE`
- Send To Laundry: `1emd6pGjBr3OJVHYdlIFGjNS2v-sdsn3hGq0VfwXrI4E`

---

## Step 4 — Share Google Drive photo folder

Make the `NW INVENTORY` Drive folder public:
- Right-click → Share → Anyone with the link → Viewer

---

## Step 5 — Deploy to GitHub Pages

1. Upload all files to your GitHub repo: `noellewest-bit/noelle-west-inventory`
2. Settings → Pages → Branch: main, folder: / (root)
3. Your URL: `https://noellewest-bit.github.io/noelle-west-inventory/`

---

## API Endpoints

```
?path=dashboard      Counts + branch breakdown
?path=inventory      All tracked items + status + weight
?path=transactions   All transactions + items
?path=packages       All package colors + MOH/BMG/FGG status
?path=quantity       Quantity-based item counts
?path=item&code=X    Single item detail + rental history
?path=photos         Drive photo map (item code → file IDs)
```

---

## Tracked Categories
BGI, BGS, PGI, PGS, PGC, FIL, MG, CD, MS, CS, PET-#, S-UPPER, MOH, BMG, FGG

## Quantity-Based Categories
PET, BCPO, BOY, BPSC, BPO, BPOL, BPS, COAT BARONG, BCC, BPOC, VST, POLO, ACC, PEN, PANTS

## Branches
GORORDO, MANDAUE, TALISAY, ORMOC, TACLOBAN

## Row Limits (TransactionForms)
- Column AF (packages): row 11658 onwards
- Column N (rental/retail items): row 13861 onwards
