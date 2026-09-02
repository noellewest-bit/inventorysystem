// ============================================================
// NOELLE WEST INVENTORY TRACKER — Google Apps Script Backend
// v5 — corrected column mapping + new Order Summary format
// ============================================================

const SS = {
  transactions:    "1tm1kPbOUnlR14Y3AFFAWvTvuYHG8znKuuI-Rv7tlv0s",
  masterInventory: "1-QD9UJ99Rjl1JPlBdKPo7hz5MBOiJKkMyD-qWlD520s",
  handwash:        "1k5iMFK0FY3VXQ3GXdYWMxuQoWpryYxSw1j_AhMU64FE",
  sendToLaundry:   "1emd6pGjBr3OJVHYdlIFGjNS2v-sdsn3hGq0VfwXrI4E"
};

const DRIVE_ROOT_ID = "16L4sNbVS0IwR-en51goyyV4dRgpzWaK0";

const TRACKED_SHEETS  = ["BGI","BGS","PGI","PGS","PGC","FIL","MG","CD","MS","CS","PET-#","S-UPPER"];
const COLOR_TRACKED   = ["MOH","BMG","FGG"];
const QTY_SHEETS      = ["PET","BCPO","BOY","BPSC","BPO","BPOL","BPS","COAT BARONG","BCC","BPOC","VST","POLO","ACC","PEN","PANTS"];
const PERMANENT_OUT   = ["SOLD OUT","MISSING","DAMAGE","SLIGHTLY DAMAGE","SEVERANCE","DIP SEVERANCE","NOT RETURNED BY CUSTOMER","R-YAM","NOT AVAILABLE","STOLEN"];

// COLUMN INDICES (0-based)
// A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10, L=11, M=12
// N=13, O=14, P=15, Q=16, R=17, S=18, T=19, U=20, V=21, W=22, X=23
// AF = 31
const COL = {
  txnNum:      4,  // E - Unique ID
  firstName:   5,  // F
  lastName:    6,  // G
  branch:      10, // K
  txnType:     11, // L - "Rental" or "Retail"
  orderSummary:12, // M - ALL items now in here
  pickupDate:  21, // V
  returnDate:  22, // W
};

// Row limits (0-indexed)
const ROW_START = 1; // read all rows for transaction metadata
const ROW_ITEMS = 13860; // row 13861 — new format starts here

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

function isTrackedCode(code) {
  const upper = (code||"").toUpperCase();
  for (const cat of TRACKED_SHEETS) {
    if (cat === "PET-#") {
      if (/^PET-\d/i.test(upper)) return true;
      continue;
    }
    if (cat === "S-UPPER") {
      if (upper.startsWith("S UPPER-") || upper.startsWith("S-UPPER-")) return true;
      continue;
    }
    if (upper === cat || upper.startsWith(cat+"-")) return true;
  }
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
  const inventory = {};

  for (const shName of TRACKED_SHEETS) {
    const sh = ss.getSheetByName(shName);
    if (!sh) continue;
    const vals = sh.getDataRange().getValues();
    if (vals.length < 2) continue;
    const header = vals[0].map(h => (h||"").toString().toUpperCase().trim());
    const statusIdx    = header.lastIndexOf("STATUS");
    const firstUserIdx = header.indexOf("FIRST USER");
    const rentalIdx    = header.indexOf("RENTAL RATE");
    const retailIdx    = header.indexOf("RETAIL PRICE");
    // Weight: find first KG/KILO column
    const weightIdx    = header.findIndex(h => h.includes("KILO") || h.includes("KG") || h === "KILOGRAM/S");
    const displayCat   = shName === "PET-#" ? "PET" : shName;

    for (let r = 1; r < vals.length; r++) {
      const row = vals[r];
      const code = normCode(row[0]);
      if (!code) continue;
      const branch       = (row[1]||"").toString().trim().toUpperCase();
      const masterStatus = statusIdx    >= 0 ? (row[statusIdx]||"").toString().trim().toUpperCase() : "";
      const firstUser    = firstUserIdx >= 0 ? (row[firstUserIdx]||"").toString().trim() : "";
      const rentalRate   = rentalIdx    >= 0 ? (row[rentalIdx]||"").toString().trim() : "";
      const retailPrice  = retailIdx    >= 0 ? (row[retailIdx]||"").toString().trim() : "";
      const sheetWeight  = weightIdx    >= 0 && row[weightIdx] ? parseFloat(row[weightIdx]) : null;
      inventory[code] = { category: displayCat, branch, masterStatus, weight: sheetWeight, colorTracked: false, firstUser, rentalRate, retailPrice };
    }
  }

  // Color-tracked: MOH, BMG, FGG
  const colorQty = { MOH:1, BMG:5, FGG:5 };
  for (const shName of COLOR_TRACKED) {
    const sh = ss.getSheetByName(shName);
    if (!sh) continue;
    const vals = sh.getDataRange().getValues();
    for (let r = 1; r < vals.length; r++) {
      const color = (vals[r][0]||"").toString().trim();
      if (!color) continue;
      const code = shName+"-"+color.toUpperCase();
      inventory[code] = { category: shName, branch:"", masterStatus:"AVAILABLE", weight:null, colorTracked:true, qty:colorQty[shName], color };
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

// ── Order Summary Extraction (Column M) ───────────────────────
// Handles both old format (Product Name: X) and new format

function extractFromOrderSummary(text, txnType) {
  const tracked  = [];
  const qty      = {};
  let packageColor = null;
  let packageType  = null;
  let isRetail     = false;

  if (!text || !text.trim()) return { tracked, qty, packageColor, packageType, isRetail };

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // ── RETAIL ──
  if ((txnType||"").toLowerCase() === "retail") {
    for (const line of lines) {
      // Old format: "Product Name: MG-3183-1, Amount: 2995"
      const oldMatch = line.match(/Product Name:\s*([^,\n]+)/i);
      if (oldMatch) { tracked.push(normCode(oldMatch[1])); continue; }

      // New format: "MG-3177-2 ₱2,995.00"
      if (/^PURCHASED ITEMS/i.test(line)) continue;
      if (/^PURCHASE TOTAL/i.test(line)) continue;
      if (/^GRAND TOTAL/i.test(line)) continue;
      if (/^PAYMENT SUMMARY/i.test(line)) continue;
      if (/^Amount Paid/i.test(line)) continue;
      if (/^Remaining Balance/i.test(line)) continue;
      if (/^-{5,}/.test(line)) continue;

      // Line with ₱ price — extract code before the ₱
      const newMatch = line.match(/^([A-Z0-9][A-Z0-9\-\.\s]+?)\s+₱/i);
      if (newMatch) {
        const code = normCode(newMatch[1]);
        if (code) tracked.push(code);
      }
    }
    return { tracked, qty, packageColor, packageType, isRetail: true };
  }

  // ── Detect format type ──
  const isPackage = /WEDDING ENTOURAGE PACKAGE|PACKAGE TIER/i.test(text);
  const isNewRental = /RENTAL ITEMS/i.test(text);
  const isOldRental = /Product Name:/i.test(text);

  // ── OLD RENTAL FORMAT: "Product Name: X, Amount: Y" ──
  if (isOldRental && !isPackage) {
    for (const line of lines) {
      const m = line.match(/Product Name:\s*([^,\n]+)/i);
      if (m) {
        const code = normCode(m[1]);
        if (isTrackedCode(code)) tracked.push(code);
        else {
          const qm = line.match(/x\s*(\d+)/i);
          qty[code] = (qty[code]||0) + (qm ? parseInt(qm[1]) : 1);
        }
      }
    }
    return { tracked, qty, packageColor, packageType, isRetail: false };
  }

  // ── NEW RENTAL FORMAT: "ITEM xN ₱price" ──
  if (isNewRental && !isPackage) {
    for (const line of lines) {
      if (/^RENTAL ITEMS/i.test(line)) continue;
      if (/^RENTAL TOTAL/i.test(line)) continue;
      if (/^GRAND TOTAL/i.test(line)) continue;
      if (/^PAYMENT SUMMARY/i.test(line)) continue;
      if (/^Amount Paid/i.test(line)) continue;
      if (/^Remaining Balance/i.test(line)) continue;
      if (/^-{5,}/.test(line)) continue;

      // Has "/" = tracked add-on: "BGI/BGI-9343 x1 ₱price"
      if (line.includes("/")) {
        const slashIdx = line.indexOf("/");
        const afterSlash = line.substring(slashIdx+1);
        const cm = afterSlash.match(/^([^\s₱]+)/);
        if (cm) {
          const code = normCode(cm[1]);
          if (isTrackedCode(code)) {
            tracked.push(code);
          } else {
            const qm = afterSlash.match(/x(\d+)/i);
            qty[code] = (qty[code]||0) + (qm ? parseInt(qm[1]) : 1);
          }
        }
        continue;
      }

      // "COAT BARONG - M x1 ₱900.00"
      // Extract: everything before the last "x\d" pattern
      const qm = line.match(/^(.+?)\s+x(\d+)\s*₱/i);
      if (qm) {
        const name = qm[1].trim().toUpperCase();
        const count = parseInt(qm[2]) || 1;
        if (isTrackedCode(name)) {
          for (let i=0;i<count;i++) tracked.push(name);
        } else {
          qty[name] = (qty[name]||0) + count;
        }
      }
    }
    return { tracked, qty, packageColor, packageType, isRetail: false };
  }

  // ── PACKAGE FORMAT ──
  if (isPackage) {
    // Extract package type and color
    for (const line of lines) {
      const tierMatch = line.match(/Package Tier:\s*Package\s+(\w+)/i);
      if (tierMatch) packageType = "PACKAGE " + tierMatch[1].toUpperCase();

      const colorMatch = line.match(/^Color:\s*(.+)$/i);
      if (colorMatch) packageColor = colorMatch[1].trim().toUpperCase();
    }

    let pendingRole = null; // role waiting for its Item Code line

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip metadata
      if (/^WEDDING ENTOURAGE PACKAGE/i.test(line)) continue;
      if (/^Package Tier:/i.test(line)) continue;
      if (/^Fabric:/i.test(line)) continue;
      if (/^Men's:/i.test(line)) continue;
      if (/^Color:/i.test(line)) continue;
      if (/^Add-On Items/i.test(line)) continue;
      if (/^Package Subtotal/i.test(line)) continue;
      if (/^Add-On Subtotal/i.test(line)) continue;
      if (/^PACKAGE TOTAL/i.test(line)) continue;
      if (/^GRAND TOTAL/i.test(line)) continue;
      if (/^PAYMENT SUMMARY/i.test(line)) continue;
      if (/^Amount Paid/i.test(line)) continue;
      if (/^Remaining Balance/i.test(line)) continue;
      if (/^-{5,}/.test(line)) continue;

      // Item Code line: "Item Code: #1: BGI/BGI-9343" or "Item Code: #1: (not selected)"
      if (/^Item Code:/i.test(line)) {
        const slots = line.replace(/^Item Code:\s*/i,"").split(",");
        for (const slot of slots) {
          if (/not selected/i.test(slot)) continue;
          if (slot.includes("/")) {
            const slashIdx = slot.indexOf("/");
            const code = normCode(slot.substring(slashIdx+1).trim().split(/\s+/)[0]);
            if (code && isTrackedCode(code)) tracked.push(code);
          }
        }
        pendingRole = null;
        continue;
      }

      // Add-on lines with "/": "BMG/TULLE RUST BROWN x3 ₱480.00"
      if (line.includes("/") && !/^Item Code/i.test(line)) {
        const slashIdx = line.indexOf("/");
        const prefix   = line.substring(0, slashIdx).trim().toUpperCase();
        const afterSlash = line.substring(slashIdx+1).trim();
        // Extract code before "x\d" or "₱"
        const cm = afterSlash.match(/^(.+?)\s+x(\d+)/i) || afterSlash.match(/^([^\s₱]+)/);
        if (cm) {
          const rawCode = cm[1].trim().toUpperCase();
          const count = cm[2] ? parseInt(cm[2]) : 1;
          // Build full code: PREFIX/RAWCODE → use rawcode if it already has prefix
          const fullCode = rawCode.startsWith(prefix+"-") || rawCode.startsWith(prefix+" ") ? rawCode : prefix+"-"+rawCode;
          if (isTrackedCode(fullCode)) {
            tracked.push(fullCode);
          } else if (isTrackedCode(prefix)) {
            // prefix is tracked category (MOH, BMG, FGG)
            const colorCode = prefix+"-"+rawCode;
            tracked.push(colorCode);
          } else {
            qty[fullCode] = (qty[fullCode]||0) + count;
          }
        }
        continue;
      }

      // Role lines: "Bridal Gown x1 ₱600.00", "Bridesmaid x5 ₱278.85"
      const roleMatch = line.match(/^(.+?)\s+x(\d+)\s*₱/i);
      if (roleMatch) {
        const roleName = roleMatch[1].trim();
        const count    = parseInt(roleMatch[2]) || 1;
        const roleUp   = roleName.toUpperCase();

        if (/bridal gown/i.test(roleName)) {
          // Tracked — item code comes on next "Item Code:" line
          pendingRole = "BRIDAL";
        } else if (/mother'?s gown/i.test(roleName)) {
          pendingRole = "MOTHER";
          qty["MOTHER'S GOWN"] = (qty["MOTHER'S GOWN"]||0) + count;
        } else if (/maid of honor/i.test(roleName) && packageColor) {
          tracked.push("MOH-"+packageColor);
        } else if (/bridesmaid/i.test(roleName) && packageColor) {
          tracked.push("BMG-"+packageColor);
        } else if (/flower girl/i.test(roleName) && packageColor) {
          tracked.push("FGG-"+packageColor);
        } else if (/groom/i.test(roleName)) {
          const is3C4C = packageType && (packageType.includes("C") && !packageType.includes("1C") && !packageType.includes("2C"));
          qty[is3C4C ? "S-UPPER" : "BPS/BPOL"] = (qty[is3C4C ? "S-UPPER" : "BPS/BPOL"]||0) + count;
        } else if (/men'?s/i.test(roleName)) {
          const is3C4C = packageType && !(/1C|2C/i.test(packageType));
          if (is3C4C) {
            qty["VST"]   = (qty["VST"]||0)   + count;
            qty["POLO"]  = (qty["POLO"]||0)  + count;
            qty["PANTS"] = (qty["PANTS"]||0) + count;
          } else {
            qty["BPO"] = (qty["BPO"]||0) + count;
          }
        } else if (/child|bearer|bpo child/i.test(roleName)) {
          const is3C4C = packageType && !(/1C|2C/i.test(packageType));
          if (is3C4C) {
            qty["VST"]   = (qty["VST"]||0)   + count;
            qty["POLO"]  = (qty["POLO"]||0)  + count;
            qty["PANTS"] = (qty["PANTS"]||0) + count;
          } else {
            qty["BCPO"] = (qty["BCPO"]||0) + count;
          }
        } else if (/father/i.test(roleName)) {
          qty["BPS/BPOL"] = (qty["BPS/BPOL"]||0) + count;
        } else {
          qty[roleUp] = (qty[roleUp]||0) + count;
        }
        continue;
      }
    }
  }

  return { tracked, qty, packageColor, packageType, isRetail };
}

// ── Laundry Parsing ───────────────────────────────────────────

function parseLaundrySheet(ssId, shName) {
  const trackedAvailable = {};
  const qtyAvailable     = {};
  const vals = sheetVals(ssId, shName);
  const fullText = vals.map(row => row.join("\t")).join("\n");
  const lines = fullText.split(/\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^TOTAL (ITEMS|WEIGHT|BAGS)/i.test(line)) continue;
    if (/^BAG WEIGHT/i.test(line)) continue;
    if (/^BAG \d+/i.test(line)) continue;
    if (/^---/.test(line)) continue;

    const catMatch = line.match(/^([A-Z][A-Z0-9\s\-]*?):\s+(.+)$/i);
    if (!catMatch) continue;

    const category = catMatch[1].trim().toUpperCase();
    const itemsStr = catMatch[2].trim();
    const itemParts = itemsStr.split(",").map(s => s.trim()).filter(Boolean);

    for (const part of itemParts) {
      const weightMatch = part.match(/\((\d+\.?\d*)kg\)/i);
      const weight = weightMatch ? parseFloat(weightMatch[1]) : null;
      let itemStr = part.replace(/\(\d+\.?\d*kg\)/gi,"").trim();
      const qtyMatch = itemStr.match(/[×x]\s*(\d+)\s*$/i);
      const count = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      itemStr = itemStr.replace(/[×x]\s*\d+\s*$/i,"").trim();

      const isColorCat   = COLOR_TRACKED.includes(category);
      const isTrackedCat = TRACKED_SHEETS.includes(category) || category === "PET-#" || category === "S-UPPER";

      if (isColorCat) {
        const code = category+"-"+itemStr.toUpperCase();
        trackedAvailable[code] = weight;
      } else if (isTrackedCat) {
        let code = itemStr.toUpperCase();
        const portionMatch = code.match(/^(.+?)\s+-\s+(SKIRT|BLOUSE|SUIT|PANTS|VEST|JACKET)$/i);
        if (portionMatch) {
          const baseCode = portionMatch[1].trim();
          trackedAvailable[baseCode] = (trackedAvailable[baseCode]||0) + (weight||0);
        } else {
          trackedAvailable[code] = weight !== null
            ? (trackedAvailable[code]||0) + weight
            : (trackedAvailable[code] !== undefined ? trackedAvailable[code] : null);
        }
      } else {
        const cleanName = itemStr.toUpperCase().replace(/\(([^)]+)\)/g,"$1").trim();
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
    const row    = rows[r];
    const txnNum = (row[COL.txnNum]||"").toString().trim();
    if (!txnNum) continue;

    const firstName  = (row[COL.firstName]||"").toString().trim();
    const lastName   = (row[COL.lastName]||"").toString().trim();
    const branch     = (row[COL.branch]||"").toString().trim().toUpperCase();
    const txnType    = (row[COL.txnType]||"").toString().trim();
    const orderSummary = (row[COL.orderSummary]||"").toString().trim();
    const pickupDate = parseDate(row[COL.pickupDate]);
    const returnDate = parseDate(row[COL.returnDate]);
    const customer   = [firstName, lastName].filter(Boolean).join(" ").trim();

    // Only extract items from row 13861 onwards
    let trackedItems = [], qtyItems = {}, packageColor = null, packageType = null, isRetail = false;

    if (r >= ROW_ITEMS && orderSummary) {
      const result = extractFromOrderSummary(orderSummary, txnType);
      trackedItems  = [...new Set(result.tracked || [])];
      qtyItems      = result.qty || {};
      packageColor  = result.packageColor;
      packageType   = result.packageType;
      isRetail      = result.isRetail || false;
    }

    txns.push({
      txnNum, customer, branch, txnType, isRetail,
      pickupDate: pickupDate ? pickupDate.toISOString() : null,
      returnDate: returnDate ? returnDate.toISOString() : null,
      trackedItems, qtyItems, packageColor, packageType,
      orderSummary // include raw text for display
    });
  }
  // Sort most recent first (by pickup date descending)
  txns.sort((a, b) => {
    const da = a.pickupDate ? new Date(a.pickupDate) : new Date(0);
    const db = b.pickupDate ? new Date(b.pickupDate) : new Date(0);
    return db - da;
  });
  return txns;
}

// ── Status Engine ─────────────────────────────────────────────

function buildAll() {
  const masterInventory = getMasterInventory();
  const packageColors   = getPackageColors();
  const now             = today();

  const hw  = parseLaundrySheet(SS.handwash,      "Handwash");
  const stl = parseLaundrySheet(SS.sendToLaundry, "Send To Laundry");

  const laundryTracked = { ...hw.trackedAvailable };
  for (const [code, w] of Object.entries(stl.trackedAvailable)) {
    laundryTracked[code] = w !== null
      ? (laundryTracked[code]||0) + w
      : (laundryTracked[code] !== undefined ? laundryTracked[code] : null);
  }

  const laundryQty = { ...hw.qtyAvailable };
  for (const [name, count] of Object.entries(stl.qtyAvailable)) {
    laundryQty[name] = (laundryQty[name]||0) + count;
  }

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

  // ── Inventory status ──────────────────────────────────────
  const inventoryResults = {};

  for (const [code, meta] of Object.entries(masterInventory)) {
    let status="AVAILABLE", branch=meta.branch, customer="", txnNum="", pickupDate=null, returnDate=null;
    let weight = meta.weight;

    if (laundryTracked[code] !== undefined) weight = laundryTracked[code];

    if (!meta.colorTracked && isPermanentOut(meta.masterStatus)) {
      status = meta.masterStatus === "SOLD OUT" ? "SOLD" : meta.masterStatus;
    } else {
      const txn = itemLatest[code];
      if (txn) {
        const pDate = txn.pickupDate ? new Date(txn.pickupDate) : null;
        const rDate = txn.returnDate ? new Date(txn.returnDate) : null;
        if (txn.isRetail) {
          status="SOLD"; branch=txn.branch||branch; customer=txn.customer;
          txnNum=txn.txnNum; pickupDate=txn.pickupDate; returnDate=txn.returnDate;
        } else if (laundryTracked.hasOwnProperty(code)) {
          status="AVAILABLE";
          if (laundryTracked[code]!==null) weight=laundryTracked[code];
        } else if (rDate && rDate < now) {
          status="FOR LAUNDRY"; branch=txn.branch||branch; customer=txn.customer;
          txnNum=txn.txnNum; pickupDate=txn.pickupDate; returnDate=txn.returnDate;
        } else if (pDate && pDate <= now) {
          status="RELEASED"; branch=txn.branch||branch; customer=txn.customer;
          txnNum=txn.txnNum; pickupDate=txn.pickupDate; returnDate=txn.returnDate;
        }
      }
    }

    inventoryResults[code] = {
      code, category:meta.category, status, branch,
      customer, txnNum, pickupDate, returnDate, weight,
      colorTracked:meta.colorTracked||false, qty:meta.qty||null,
      firstUser:  meta.firstUser  ||"",
      rentalRate: meta.rentalRate ||"",
      retailPrice:meta.retailPrice||""
    };
  }

  // ── Package status ────────────────────────────────────────
  const packageResults = {};
  for (const color of packageColors) {
    const colorUp = color.toUpperCase();
    const txn = pkgLatest[colorUp]||pkgLatest[color];
    let status="AVAILABLE", branch="", customer="", txnNum="", txnType="";
    const mohCode="MOH-"+colorUp, bmgCode="BMG-"+colorUp, fggCode="FGG-"+colorUp;
    const mohStatus = inventoryResults[mohCode] ? inventoryResults[mohCode].status : "AVAILABLE";
    status = mohStatus;
    if (txn) { branch=txn.branch; customer=txn.customer; txnNum=txn.txnNum; txnType=txn.txnType; }
    packageResults[colorUp] = {
      packageColor:color, status, branch, customer, txnNum, txnType,
      moh:inventoryResults[mohCode]||null,
      bmg:inventoryResults[bmgCode]||null,
      fgg:inventoryResults[fggCode]||null
    };
  }

  // ── Quantity counts ───────────────────────────────────────
  const qtyRented={}, qtyLaundry={};
  for (const txn of transactions) {
    const pDate = txn.pickupDate ? new Date(txn.pickupDate) : null;
    const rDate = txn.returnDate ? new Date(txn.returnDate) : null;
    if (!pDate||pDate>now) continue;
    for (const [name,count] of Object.entries(txn.qtyItems||{})) {
      if (rDate && rDate < now) {
        const inLaundry = laundryQty[name]||0;
        const remaining = Math.max(0, count-inLaundry);
        if (remaining>0) qtyLaundry[name]=(qtyLaundry[name]||0)+remaining;
      } else {
        qtyRented[name]=(qtyRented[name]||0)+count;
      }
    }
  }
  const allQtyNames = new Set([...Object.keys(qtyRented),...Object.keys(qtyLaundry)]);
  const quantityResults = [];
  for (const name of allQtyNames) {
    quantityResults.push({ name, rented:qtyRented[name]||0, laundry:qtyLaundry[name]||0 });
  }
  quantityResults.sort((a,b)=>a.name.localeCompare(b.name));

  // ── Transaction statuses ──────────────────────────────────
  const finalTxns = transactions.map(txn => {
    const pDate = txn.pickupDate ? new Date(txn.pickupDate) : null;
    const rDate = txn.returnDate ? new Date(txn.returnDate) : null;
    let txnStatus = "FOR PICKUP";

    if (txn.isRetail) {
      // Retail: completed once pickup date passed or no pickup date
      txnStatus = (!pDate || pDate <= now) ? "COMPLETED" : "FOR PICKUP";
    } else if (!pDate || pDate > now) {
      txnStatus = "FOR PICKUP";
    } else if (pDate <= now && (!rDate || rDate >= now)) {
      txnStatus = "PENDING";
    } else if (rDate && rDate < now) {
      txnStatus = "COMPLETED";
    }
    return { ...txn, txnStatus };
  });

  // ── Rental history per item ───────────────────────────────
  const rentalHistory={};
  for (const txn of finalTxns) {
    for (const code of txn.trackedItems) {
      if (!rentalHistory[code]) rentalHistory[code]=[];
      rentalHistory[code].push({
        txnNum:txn.txnNum, customer:txn.customer, branch:txn.branch,
        pickupDate:txn.pickupDate, returnDate:txn.returnDate,
        txnType:txn.txnType, txnStatus:txn.txnStatus
      });
    }
  }

  return { inventoryResults, packageResults, quantityResults, transactions:finalTxns, rentalHistory };
}

// ── Dashboard ─────────────────────────────────────────────────

function getDashboard(inventoryResults, transactions) {
  const inv = Object.values(inventoryResults);
  const counts = { total:0, available:0, released:0, forLaundry:0, sold:0, other:0 };
  const BRANCHES = ["GORORDO","MANDAUE","TALISAY","ORMOC","TACLOBAN"];
  const byBranch = {};
  for (const b of BRANCHES) byBranch[b]={ available:0, released:0, forLaundry:0, activeTxns:0 };

  for (const item of inv) {
    counts.total++;
    if      (item.status==="AVAILABLE")   counts.available++;
    else if (item.status==="RELEASED")    counts.released++;
    else if (item.status==="FOR LAUNDRY") counts.forLaundry++;
    else if (item.status==="SOLD"||item.status==="SOLD OUT") counts.sold++;
    else counts.other++;
    if (item.branch && byBranch[item.branch]) {
      if      (item.status==="AVAILABLE")   byBranch[item.branch].available++;
      else if (item.status==="RELEASED")    byBranch[item.branch].released++;
      else if (item.status==="FOR LAUNDRY") byBranch[item.branch].forLaundry++;
    }
  }
  const now = today();
  for (const txn of transactions) {
    if (txn.txnStatus==="ONGOING" && txn.branch && byBranch[txn.branch]) {
      byBranch[txn.branch].activeTxns++;
    }
  }
  return { counts, byBranch };
}

// ── Photo Map ─────────────────────────────────────────────────

function buildPhotoMap() {
  const map = {}; // UPPER_FILENAME_NO_EXT → [{ name, id }]

  function addFile(file) {
    const fullName = file.getName();
    const baseName = fullName.replace(/\.[^/.]+$/, "");
    const upperBase = baseName.toUpperCase().trim();
    if (!upperBase) return;
    // Only add image files
    const mime = file.getMimeType();
    if (!mime.startsWith("image/")) return;
    if (!map[upperBase]) map[upperBase] = [];
    map[upperBase].push({ name: baseName, id: file.getId() });
  }

  function scanFolder(folder, depth) {
    if (depth > 20) return; // safety limit — 20 levels deep is more than enough
    const name = folder.getName().toLowerCase();
    if (name === "group") return; // skip group folder

    // Scan files in this folder
    const files = folder.getFiles();
    while (files.hasNext()) addFile(files.next());

    // Recurse into subfolders
    const subs = folder.getFolders();
    while (subs.hasNext()) scanFolder(subs.next(), depth + 1);
  }

  try {
    const root = DriveApp.getFolderById(DRIVE_ROOT_ID);
    scanFolder(root, 0);
  } catch(e) {
    Logger.log("Photo scan error: " + e);
  }
  return map;
}

// ── Web App ───────────────────────────────────────────────────

function doGet(e) {
  const path     = (e.parameter && e.parameter.path)     || "dashboard";
  const code     = (e.parameter && e.parameter.code)     || null;
  const callback = (e.parameter && e.parameter.callback) || null;
  let data;

  try {
    if (path==="photos") {
      data = buildPhotoMap();
    } else {
      const built = buildAll();
      if      (path==="inventory")    data = Object.values(built.inventoryResults);
      else if (path==="transactions") data = built.transactions;
      else if (path==="packages")     data = Object.values(built.packageResults);
      else if (path==="quantity")     data = built.quantityResults;
      else if (path==="item" && code) {
        const upperCode = code.toUpperCase();
        const item = built.inventoryResults[upperCode];
        const history = built.rentalHistory[upperCode]||[];
        data = item ? { ...item, history } : null;
      } else {
        data = getDashboard(built.inventoryResults, built.transactions);
      }
    }
  } catch(err) {
    const errOut = JSON.stringify({ ok:false, error:err.toString() });
    if (callback) {
      return ContentService.createTextOutput(callback+"("+errOut+")")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(errOut)
      .setMimeType(ContentService.MimeType.JSON);
  }

  const output = JSON.stringify({ ok:true, data });
  if (callback) {
    return ContentService.createTextOutput(callback+"("+output+")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}
