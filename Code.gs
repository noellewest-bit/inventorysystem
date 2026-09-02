// ============================================================
// NOELLE WEST INVENTORY TRACKER — Google Apps Script Backend
// Complete v4
// ============================================================

const SS = {
  transactions:    "1tm1kPbOUnlR14Y3AFFAWvTvuYHG8znKuuI-Rv7tlv0s",
  masterInventory: "1-QD9UJ99Rjl1JPlBdKPo7hz5MBOiJKkMyD-qWlD520s",
  handwash:        "1k5iMFK0FY3VXQ3GXdYWMxuQoWpryYxSw1j_AhMU64FE",
  sendToLaundry:   "1emd6pGjBr3OJVHYdlIFGjNS2v-sdsn3hGq0VfwXrI4E"
};

const DRIVE_ROOT_ID = "16L4sNbVS0IwR-en51goyyV4dRgpzWaK0";

// Individually tracked sheets
const TRACKED_SHEETS = [
  "BGI","BGS","PGI","PGS","PGC","FIL","MG","CD","MS","CS","PET-#","S-UPPER"
];
// Color-coded tracked sheets (derived from package color)
const COLOR_TRACKED = ["MOH","BMG","FGG"];
// Quantity-based sheets
const QTY_SHEETS = [
  "PET","BCPO","BOY","BPSC","BPO","BPOL","BPS","COAT BARONG",
  "BCC","BPOC","VST","POLO","ACC","PEN","PANTS"
];
// Package roles that are quantity-based
const QTY_ROLES = [
  "groom suit","men's set","child suit","father","bearer",
  "groom barong","groom"
];

const PERMANENT_OUT = [
  "SOLD OUT","MISSING","DAMAGE","SLIGHTLY DAMAGE","SEVERANCE",
  "DIP SEVERANCE","NOT RETURNED BY CUSTOMER","R-YAM",
  "NOT AVAILABLE","STOLEN"
];

// Row offsets (1-indexed in Sheets, 0-indexed in array)
const ROW_PACKAGES = 11657; // row 11658
const ROW_ITEMS    = 13860; // row 13861

// ── Utilities ─────────────────────────────────────────────────

function sheetVals(ssId, shName) {
  try {
    const sh = SpreadsheetApp.openById(ssId).getSheetByName(shName);
    if (!sh) return [];
    return sh.getDataRange().getValues();
  } catch(e) {
    Logger.log("sheetVals error ["+shName+"]: "+e);
    return [];
  }
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function today() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}

function isPermanentOut(s) {
  return PERMANENT_OUT.includes((s||"").toUpperCase().trim());
}

function isTrackedCategory(code) {
  const upper = (code||"").toUpperCase();
  for (const cat of TRACKED_SHEETS) {
    const prefix = cat === "PET-#" ? "PET-" : cat+"-";
    const exact  = cat === "PET-#" ? false  : upper === cat;
    if (exact) return true;
    if (upper.startsWith(prefix)) return true;
    // S-UPPER special
    if (cat === "S-UPPER" && upper.startsWith("S UPPER-")) return true;
    if (cat === "S-UPPER" && upper.startsWith("S-UPPER-")) return true;
    // PET-# special: PET-\d or PET-N HOOPS
    if (cat === "PET-#" && /^PET-\d/i.test(upper)) return true;
  }
  // Color tracked
  for (const cat of COLOR_TRACKED) {
    if (upper.startsWith(cat+"-")) return true;
  }
  return false;
}

function normCode(s) {
  return (s||"").trim().toUpperCase();
}

// ── Master Inventory ──────────────────────────────────────────

function getMasterInventory() {
  const ss = SpreadsheetApp.openById(SS.masterInventory);
  const inventory = {}; // code → { category, branch, masterStatus, weight }

  // Tracked sheets
  for (const shName of TRACKED_SHEETS) {
    const sh = ss.getSheetByName(shName);
    if (!sh) continue;
    const vals = sh.getDataRange().getValues();
    if (vals.length < 2) continue;
    const header = vals[0].map(h => (h||"").toString().toUpperCase().trim());
    const statusIdx = header.lastIndexOf("STATUS");
    const displayCat = shName === "PET-#" ? "PET" : shName;

    for (let r = 1; r < vals.length; r++) {
      const row = vals[r];
      const code = normCode(row[0]);
      if (!code) continue;
      const branch = (row[1]||"").toString().trim().toUpperCase();
      const masterStatus = statusIdx >= 0 ? (row[statusIdx]||"").toString().trim().toUpperCase() : "";
      inventory[code] = { category: displayCat, branch, masterStatus, weight: null, colorTracked: false };
    }
  }

  // Color-tracked sheets (MOH, BMG, FGG)
  const colorQty = { MOH: 1, BMG: 5, FGG: 5 };
  for (const shName of COLOR_TRACKED) {
    const sh = ss.getSheetByName(shName);
    if (!sh) continue;
    const vals = sh.getDataRange().getValues();
    for (let r = 1; r < vals.length; r++) {
      const color = (vals[r][0]||"").toString().trim();
      if (!color) continue;
      const code = shName+"-"+color.toUpperCase();
      inventory[code] = {
        category: shName,
        branch: "",
        masterStatus: "AVAILABLE",
        weight: null,
        colorTracked: true,
        qty: colorQty[shName],
        color: color
      };
    }
  }

  return inventory;
}

function getPackageColors() {
  const sh = SpreadsheetApp.openById(SS.masterInventory).getSheetByName("PACKAGE COLORS");
  if (!sh) return [];
  const vals = sh.getDataRange().getValues();
  const colors = [];
  for (let r = 1; r < vals.length; r++) {
    const c = (vals[r][0]||"").toString().trim();
    if (c) colors.push(c);
  }
  return colors;
}

// ── Column N Extraction ───────────────────────────────────────

function extractFromN(cellText, txnType) {
  const tracked = [];
  const qty = {};
  if (!cellText) return { tracked, qty };

  const lines = cellText.split(/\n/).map(l => l.trim()).filter(Boolean);

  if (txnType === "Retail") {
    // Product Name: MG-3183-1, Amount: 2995
    for (const line of lines) {
      const m = line.match(/Product Name:\s*([^,\n]+)/i);
      if (m) tracked.push(normCode(m[1]));
    }
    return { tracked, qty, isRetail: true };
  }

  // Rental format
  for (const line of lines) {
    if (/^RENTAL ITEMS:/i.test(line)) continue;
    if (/^RENTAL TOTAL:/i.test(line)) continue;
    if (!line) continue;

    if (line.includes("|")) {
      // tracked: "PGI-9244 | Rental Rate @ ..."
      const code = normCode(line.split("|")[0]);
      if (code) tracked.push(code);
    } else {
      // quantity: "POLO-L x 2 @ ..." or "POLO-L x2 @..."
      const m = line.match(/^(.+?)\s+x\s*(\d+)\s*@/i);
      if (m) {
        const name = m[1].trim().toUpperCase();
        const count = parseInt(m[2]) || 1;
        qty[name] = (qty[name]||0) + count;
      }
    }
  }
  return { tracked, qty, isRetail: false };
}

// ── Column AF Extraction ──────────────────────────────────────

function extractFromAF(cellText) {
  const tracked  = [];
  const qty      = {};
  let packageColor = null;
  let packageType  = null; // "1C","2C","3C","4C"
  if (!cellText) return { tracked, qty, packageColor, packageType };

  const lines = cellText.split(/\n/).map(l => l.trim()).filter(Boolean);
  let inAddOns = false;

  for (const line of lines) {
    // Ignore lines
    if (/^PACKAGE SUBTOTAL/i.test(line)) continue;
    if (/^ADD-ON SUBTOTAL/i.test(line)) continue;
    if (/^GRAND TOTAL/i.test(line)) continue;

    // Package type
    if (/^PACKAGE:/i.test(line)) {
      const m = line.match(/PACKAGE\s+(\d+C)/i);
      if (m) packageType = m[1].toUpperCase();
      continue;
    }

    // Package color
    if (/^PACKAGE COLOR:/i.test(line)) {
      packageColor = line.replace(/^PACKAGE COLOR:\s*/i,"").trim().toUpperCase();
      continue;
    }

    // ADD-ONS section marker
    if (/^ADD-ONS:/i.test(line)) { inAddOns = true; continue; }

    // Lines with "/" = tracked item
    if (line.includes("/")) {
      // BGI/BGI-6100 x 1 @ ... or BGI/BGI-9929 x 1 | Regular: ...
      // Also: Bridal Gown | #1: BGI/BGI-6100 x 1
      const slashIdx = line.indexOf("/");
      const afterSlash = line.substring(slashIdx+1);
      // extract code before " x " or " |"
      const codeMatch = afterSlash.match(/^([^\s]+(?:\s[^\s]+)*?)\s+x\s+\d+/i) ||
                        afterSlash.match(/^([^\s|]+)/i);
      if (codeMatch) {
        const code = normCode(codeMatch[1]);
        if (code && code !== "(NOT" && !code.startsWith("(NOT")) {
          if (isTrackedCategory(code)) {
            tracked.push(code);
          } else {
            // quantity-based add-on with /
            const qtyMatch = afterSlash.match(/^([^\s|]+)\s+x\s+(\d+)/i);
            const count = qtyMatch ? parseInt(qtyMatch[2])||1 : 1;
            qty[code] = (qty[code]||0) + count;
          }
        }
      }
      continue;
    }

    // Maid of Honor x 1, Bridesmaid x 5, Flower Girl x 5 etc.
    const roleMatch = line.match(/^(.+?)\s+x\s+(\d+)\s*@/i) ||
                      line.match(/^(.+?)\s+x\s+(\d+)\s*$/i);
    if (roleMatch) {
      const roleName = roleMatch[1].trim().toLowerCase();
      const count    = parseInt(roleMatch[2])||1;

      if (roleName === "maid of honor" && packageColor) {
        // tracked as MOH-[COLOR]
        const code = "MOH-"+packageColor;
        tracked.push(code);
      } else if (roleName === "bridesmaid" && packageColor) {
        const code = "BMG-"+packageColor;
        tracked.push(code); // qty 5 by default, stored as one entry
      } else if (roleName === "flower girl" && packageColor) {
        const code = "FGG-"+packageColor;
        tracked.push(code);
      } else if (roleName === "groom suit" || roleName === "groom barong") {
        if (packageType === "3C" || packageType === "4C") {
          qty["S-UPPER"] = (qty["S-UPPER"]||0) + count;
        } else {
          qty["BPS/BPOL"] = (qty["BPS/BPOL"]||0) + count;
        }
      } else if (roleName === "men's set") {
        if (packageType === "3C" || packageType === "4C") {
          qty["VST"]   = (qty["VST"]||0)   + count;
          qty["POLO"]  = (qty["POLO"]||0)  + count;
          qty["PANTS"] = (qty["PANTS"]||0) + count;
        } else {
          qty["BPO"] = (qty["BPO"]||0) + count;
        }
      } else if (roleName === "child suit") {
        if (packageType === "3C" || packageType === "4C") {
          qty["VST"]   = (qty["VST"]||0)   + count;
          qty["POLO"]  = (qty["POLO"]||0)  + count;
          qty["PANTS"] = (qty["PANTS"]||0) + count;
        } else {
          qty["BCPO"] = (qty["BCPO"]||0) + count;
        }
      } else if (roleName === "father") {
        qty["BPS/BPOL"] = (qty["BPS/BPOL"]||0) + count;
      } else {
        // generic quantity role
        qty[roleName.toUpperCase()] = (qty[roleName.toUpperCase()]||0) + count;
      }
      continue;
    }

    // Mother's Gown special: "Mother's Gown | #1: MG/MG-2003 x 1" already handled by / above
    // "Mother's Gown | #1: (not selected)" → quantity only
    if (/mother'?s gown/i.test(line) && /not selected/i.test(line)) {
      const m = line.match(/x\s+(\d+)/i);
      qty["MOTHER'S GOWN"] = (qty["MOTHER'S GOWN"]||0) + (m ? parseInt(m[1]) : 1);
    }
  }

  return { tracked, qty, packageColor, packageType };
}

// ── Laundry Parsing ───────────────────────────────────────────

function parseLaundrySheet(ssId, shName) {
  const trackedAvailable = {}; // code → weight (kg)
  const qtyAvailable     = {}; // name → count

  const vals = sheetVals(ssId, shName);
  const fullText = vals.map(row => row.join("\t")).join("\n");
  const lines = fullText.split(/\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Skip metadata lines
    if (/^TOTAL (ITEMS|WEIGHT|BAGS)/i.test(line)) continue;
    if (/^BAG WEIGHT/i.test(line)) continue;
    if (/^---\s*BAG/i.test(line)) continue;
    if (/^BAG \d+\s*[\(\d]/i.test(line)) continue;

    // Category line: "BGI: BGI-10013 (3.170kg), BGI-10204 ..."
    const catMatch = line.match(/^([A-Z][A-Z0-9\s\-]*?):\s+(.+)$/i);
    if (!catMatch) continue;

    const category = catMatch[1].trim().toUpperCase();
    const itemsStr = catMatch[2].trim();
    const itemParts = itemsStr.split(",").map(s => s.trim()).filter(Boolean);

    for (const part of itemParts) {
      // Strip weight "(3.170kg)"
      const weightMatch = part.match(/\((\d+\.?\d*)kg\)/i);
      const weight = weightMatch ? parseFloat(weightMatch[1]) : null;
      let itemStr = part.replace(/\(\d+\.?\d*kg\)/gi,"").trim();

      // Strip quantity "×16" or "x 16"
      const qtyMatch = itemStr.match(/[×x]\s*(\d+)\s*$/i);
      const count = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      itemStr = itemStr.replace(/[×x]\s*\d+\s*$/i,"").trim();

      // Determine if tracked or qty-based
      const isColorCat = COLOR_TRACKED.includes(category);
      const isTrackedCat = TRACKED_SHEETS.includes(category) || category === "PET-#" || category === "S-UPPER";

      if (isColorCat) {
        // MOH: STARDUST BLUE → MOH-STARDUST BLUE
        const code = category+"-"+itemStr.toUpperCase();
        trackedAvailable[code] = weight;
      } else if (isTrackedCat) {
        // Strip portion suffix: "MG-2053 - SKIRT" → "MG-2053"
        // But keep if full name matches (e.g. PET-6 HOOPS)
        let code = itemStr.toUpperCase();
        const portionMatch = code.match(/^(.+?)\s+-\s+(SKIRT|BLOUSE|SUIT|PANTS|VEST|JACKET)$/i);
        if (portionMatch) {
          const baseCode = portionMatch[1].trim();
          // Sum weight for same item with multiple portions
          if (trackedAvailable[baseCode] !== undefined && weight !== null) {
            trackedAvailable[baseCode] = (trackedAvailable[baseCode]||0) + weight;
          } else {
            trackedAvailable[baseCode] = weight;
          }
        } else {
          if (trackedAvailable[code] !== undefined && weight !== null) {
            trackedAvailable[code] = (trackedAvailable[code]||0) + weight;
          } else {
            trackedAvailable[code] = weight;
          }
        }
      } else {
        // Quantity-based: normalize name
        const name = itemStr.toUpperCase();
        // Strip inner parens like BPOL-CREAM (L) → BPOL-CREAM L
        const cleanName = name.replace(/\(([^)]+)\)/g,"$1").trim();
        qtyAvailable[cleanName] = (qtyAvailable[cleanName]||0) + count;
      }
    }
  }

  return { trackedAvailable, qtyAvailable };
}

// ── Transactions ──────────────────────────────────────────────

function getTransactions() {
  const rows = sheetVals(SS.transactions, "TransactionForms");
  if (!rows.length) return [];
  const txns = [];

  for (let r = 1; r < rows.length; r++) {
    const row     = rows[r];
    const txnNum  = (row[4]||"").toString().trim();
    if (!txnNum) continue;

    const custF   = (row[5]||"").toString().trim();
    const custG   = (row[6]||"").toString().trim();
    const branch  = (row[10]||"").toString().trim().toUpperCase();
    const txnType = (row[11]||"").toString().trim(); // "Rental" or "Retail"
    const itemsN  = (row[13]||"").toString().trim();
    const pickupR = row[22];
    const returnR = row[23];
    const colAF   = (row[31]||"").toString().trim();

    const customer   = [custF,custG].filter(Boolean).join(" ").trim();
    const pickupDate = parseDate(pickupR);
    const returnDate = parseDate(returnR);

    const readPkg   = r >= ROW_PACKAGES;
    const readItems = r >= ROW_ITEMS;

    let trackedItems = [];
    let qtyItems     = {};
    let packageColor = null;
    let packageType  = null;
    let isRetail     = false;

    if (readItems && itemsN) {
      const nResult = extractFromN(itemsN, txnType);
      trackedItems = nResult.tracked || [];
      qtyItems     = nResult.qty || {};
      isRetail     = nResult.isRetail || false;
    }

    if (readPkg && colAF) {
      const afResult = extractFromAF(colAF);
      trackedItems = trackedItems.concat(afResult.tracked || []);
      packageColor = afResult.packageColor;
      packageType  = afResult.packageType;
      // Merge qty
      for (const [k,v] of Object.entries(afResult.qty||{})) {
        qtyItems[k] = (qtyItems[k]||0) + v;
      }
    }

    // Deduplicate tracked items
    trackedItems = [...new Set(trackedItems)];

    txns.push({
      txnNum, customer, branch, txnType, isRetail,
      pickupDate: pickupDate ? pickupDate.toISOString() : null,
      returnDate: returnDate ? returnDate.toISOString() : null,
      trackedItems, qtyItems, packageColor, packageType
    });
  }
  return txns;
}

// ── Status Engine ─────────────────────────────────────────────

function buildAll() {
  const masterInventory = getMasterInventory();
  const packageColors   = getPackageColors();
  const now             = today();

  // Parse both laundry sheets
  const hw  = parseLaundrySheet(SS.handwash,     "Handwash");
  const stl = parseLaundrySheet(SS.sendToLaundry,"Send To Laundry");

  // Merge laundry sets
  const laundryTracked = {}; // code → weight
  const laundryQty     = {}; // name → count

  for (const [code, w] of Object.entries(hw.trackedAvailable)) {
    laundryTracked[code] = w;
  }
  for (const [code, w] of Object.entries(stl.trackedAvailable)) {
    if (laundryTracked[code] !== undefined && w !== null) {
      laundryTracked[code] = (laundryTracked[code]||0) + w;
    } else {
      laundryTracked[code] = w;
    }
  }
  for (const [name, count] of Object.entries(hw.qtyAvailable)) {
    laundryQty[name] = (laundryQty[name]||0) + count;
  }
  for (const [name, count] of Object.entries(stl.qtyAvailable)) {
    laundryQty[name] = (laundryQty[name]||0) + count;
  }

  // Get transactions
  const transactions = getTransactions();

  // Build item → latest transaction
  const itemLatest = {};
  const pkgLatest  = {};

  for (const txn of transactions) {
    const pDate = txn.pickupDate ? new Date(txn.pickupDate) : new Date(0);
    for (const code of txn.trackedItems) {
      const prev = itemLatest[code];
      if (!prev || pDate > new Date(prev.pickupDate||0)) itemLatest[code] = txn;
    }
    if (txn.packageColor) {
      const prev = pkgLatest[txn.packageColor];
      if (!prev || pDate > new Date(prev.pickupDate||0)) pkgLatest[txn.packageColor] = txn;
    }
  }

  // ── Inventory results ────────────────────────────────────
  const inventoryResults = {};

  for (const [code, meta] of Object.entries(masterInventory)) {
    let status     = "AVAILABLE";
    let branch     = meta.branch;
    let customer   = "";
    let txnNum     = "";
    let pickupDate = null;
    let returnDate = null;
    let weight     = meta.weight;

    // Update weight from laundry
    if (laundryTracked[code] !== undefined) {
      weight = laundryTracked[code];
    }

    if (!meta.colorTracked && isPermanentOut(meta.masterStatus)) {
      status = meta.masterStatus === "SOLD OUT" ? "SOLD" : meta.masterStatus;
    } else {
      const txn = itemLatest[code];
      if (txn) {
        const pDate = txn.pickupDate ? new Date(txn.pickupDate) : null;
        const rDate = txn.returnDate ? new Date(txn.returnDate) : null;

        if (txn.isRetail) {
          status = "SOLD"; branch = txn.branch||branch;
          customer = txn.customer; txnNum = txn.txnNum;
          pickupDate = txn.pickupDate; returnDate = txn.returnDate;
        } else if (laundryTracked.hasOwnProperty(code)) {
          status = "AVAILABLE";
          if (laundryTracked[code] !== null) weight = laundryTracked[code];
        } else if (rDate && rDate < now) {
          status = "FOR LAUNDRY"; branch = txn.branch||branch;
          customer = txn.customer; txnNum = txn.txnNum;
          pickupDate = txn.pickupDate; returnDate = txn.returnDate;
        } else if (pDate && pDate <= now) {
          status = "RELEASED"; branch = txn.branch||branch;
          customer = txn.customer; txnNum = txn.txnNum;
          pickupDate = txn.pickupDate; returnDate = txn.returnDate;
        }
      }
    }

    inventoryResults[code] = {
      code, category: meta.category, status, branch,
      customer, txnNum, pickupDate, returnDate, weight,
      colorTracked: meta.colorTracked||false,
      qty: meta.qty||null
    };
  }

  // ── Package results ───────────────────────────────────────
  const packageResults = {};
  for (const color of packageColors) {
    const colorUp = color.toUpperCase();
    const txn = pkgLatest[colorUp] || pkgLatest[color];
    let status = "AVAILABLE", branch="", customer="", txnNum="", txnType="";

    const mohCode = "MOH-"+colorUp;
    const bmgCode = "BMG-"+colorUp;
    const fggCode = "FGG-"+colorUp;

    // Use MOH status as representative (1 unit, easiest to track)
    const mohStatus = inventoryResults[mohCode] ? inventoryResults[mohCode].status : "AVAILABLE";
    status = mohStatus;

    if (txn) {
      branch = txn.branch; customer = txn.customer;
      txnNum = txn.txnNum; txnType = txn.txnType;
    }

    packageResults[colorUp] = {
      packageColor: color,
      status, branch, customer, txnNum, txnType,
      moh: inventoryResults[mohCode]||null,
      bmg: inventoryResults[bmgCode]||null,
      fgg: inventoryResults[fggCode]||null
    };
  }

  // ── Quantity dashboard ────────────────────────────────────
  // Count qty items across all active transactions
  const qtyRented  = {}; // name → count currently rented
  const qtyLaundry = {}; // name → count for laundry

  for (const txn of transactions) {
    const pDate = txn.pickupDate ? new Date(txn.pickupDate) : null;
    const rDate = txn.returnDate ? new Date(txn.returnDate) : null;
    if (!pDate || pDate > now) continue; // pending

    for (const [name, count] of Object.entries(txn.qtyItems||{})) {
      if (rDate && rDate < now) {
        // For laundry — subtract what's already in laundry sheets
        const inLaundry = laundryQty[name] || 0;
        const remaining = Math.max(0, count - inLaundry);
        if (remaining > 0) qtyLaundry[name] = (qtyLaundry[name]||0) + remaining;
      } else {
        qtyRented[name] = (qtyRented[name]||0) + count;
      }
    }
  }

  // Build qty results
  const allQtyNames = new Set([
    ...Object.keys(qtyRented),
    ...Object.keys(qtyLaundry)
  ]);
  const quantityResults = [];
  for (const name of allQtyNames) {
    quantityResults.push({
      name,
      rented:   qtyRented[name]  || 0,
      laundry:  qtyLaundry[name] || 0
    });
  }
  quantityResults.sort((a,b) => a.name.localeCompare(b.name));

  // ── Transaction statuses ──────────────────────────────────
  const finalTxns = transactions.map(txn => {
    const pDate = txn.pickupDate ? new Date(txn.pickupDate) : null;
    let txnStatus = "PENDING";
    if (pDate && pDate <= now) {
      const allDone = txn.trackedItems.every(code => {
        const inv = inventoryResults[code];
        return !inv || inv.status === "AVAILABLE" || inv.status === "SOLD";
      });
      txnStatus = (txn.isRetail || allDone) ? "COMPLETED" : "ONGOING";
    }
    return { ...txn, txnStatus };
  });

  // ── Rental history per item ───────────────────────────────
  const rentalHistory = {}; // code → [{ txnNum, customer, branch, pickupDate, returnDate, txnType }]
  for (const txn of finalTxns) {
    for (const code of txn.trackedItems) {
      if (!rentalHistory[code]) rentalHistory[code] = [];
      rentalHistory[code].push({
        txnNum:     txn.txnNum,
        customer:   txn.customer,
        branch:     txn.branch,
        pickupDate: txn.pickupDate,
        returnDate: txn.returnDate,
        txnType:    txn.txnType,
        txnStatus:  txn.txnStatus
      });
    }
  }

  return { inventoryResults, packageResults, quantityResults, transactions: finalTxns, rentalHistory };
}

// ── Dashboard ─────────────────────────────────────────────────

function getDashboard(inventoryResults, transactions) {
  const inv = Object.values(inventoryResults);
  const counts = { total:0, available:0, released:0, forLaundry:0, sold:0, other:0 };
  const byBranch = {};

  const BRANCHES = ["GORORDO","MANDAUE","TALISAY","ORMOC","TACLOBAN"];
  for (const b of BRANCHES) {
    byBranch[b] = { available:0, released:0, forLaundry:0, activeTxns:0 };
  }

  for (const item of inv) {
    counts.total++;
    if      (item.status === "AVAILABLE")   counts.available++;
    else if (item.status === "RELEASED")    counts.released++;
    else if (item.status === "FOR LAUNDRY") counts.forLaundry++;
    else if (item.status === "SOLD" || item.status === "SOLD OUT") counts.sold++;
    else counts.other++;

    if (item.branch && byBranch[item.branch]) {
      if      (item.status === "AVAILABLE")   byBranch[item.branch].available++;
      else if (item.status === "RELEASED")    byBranch[item.branch].released++;
      else if (item.status === "FOR LAUNDRY") byBranch[item.branch].forLaundry++;
    }
  }

  // Active transactions per branch
  const now = today();
  for (const txn of transactions) {
    if (txn.txnStatus === "ONGOING" && txn.branch && byBranch[txn.branch]) {
      byBranch[txn.branch].activeTxns++;
    }
  }

  return { counts, byBranch };
}

// ── Photo Map ─────────────────────────────────────────────────

function buildPhotoMap() {
  const map = {}; // upperCode → [{ name, id }]

  function scanFolder(folder) {
    const name = folder.getName().toLowerCase();
    if (name === "group" || name === "raw") return;

    // Files in this folder
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const fname = file.getName();
      const fid   = file.getId();
      // Strip extension
      const baseName = fname.replace(/\.[^/.]+$/,"");
      // Try to find item code: match pattern like BGI-10000, PGI-9244, etc.
      // Item code = everything up to and including the base item identifier
      // We store ALL files; matching happens on frontend
      const upperBase = baseName.toUpperCase();
      map[upperBase] = map[upperBase] || [];
      map[upperBase].push({ name: baseName, id: fid });
    }

    // Recurse into subfolders
    const subs = folder.getFolders();
    while (subs.hasNext()) scanFolder(subs.next());
  }

  try {
    const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
    scanFolder(root);
  } catch(e) {
    Logger.log("Photo scan error: "+e);
  }

  return map;
}

// ── Web App ───────────────────────────────────────────────────

function doGet(e) {
  const path = (e.parameter && e.parameter.path) || "dashboard";
  const code = (e.parameter && e.parameter.code) || null;
  let data;

  try {
    if (path === "photos") {
      data = buildPhotoMap();
    } else {
      const built = buildAll();

      if (path === "inventory") {
        data = Object.values(built.inventoryResults);
      } else if (path === "transactions") {
        data = built.transactions;
      } else if (path === "packages") {
        data = Object.values(built.packageResults);
      } else if (path === "quantity") {
        data = built.quantityResults;
      } else if (path === "item" && code) {
        const upperCode = code.toUpperCase();
        const item = built.inventoryResults[upperCode];
        const history = built.rentalHistory[upperCode] || [];
        data = item ? { ...item, history } : null;
      } else {
        // dashboard
        data = getDashboard(built.inventoryResults, built.transactions);
      }
    }
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok:false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok:true, data }))
    .setMimeType(ContentService.MimeType.JSON);
}
