/* ============================================================
   NOELLE WEST INVENTORY TRACKER — app.js v4
   ============================================================ */

// Set your GAS Web App URL here after deploying Code.gs
const GAS_URL = window.NW_GAS_URL || "";

// ── State ─────────────────────────────────────────────────────
const State = {
  inventory:    [],
  transactions: [],
  packages:     [],
  quantity:     [],
  dashboard:    {},
  photos:       {}, // upperCode → [{ name, id }]
  lastUpdated:  null,
};

// ── API ───────────────────────────────────────────────────────
async function api(path, extraParams = {}) {
  if (!GAS_URL) throw new Error("GAS_URL not configured. See README.");
  let url = `${GAS_URL}?path=${path}`;
  for (const [k,v] of Object.entries(extraParams)) url += `&${k}=${encodeURIComponent(v)}`;

  // Use JSONP to bypass CORS restrictions with Google Apps Script
  return new Promise((resolve, reject) => {
    const cbName = "nw_cb_" + Math.random().toString(36).slice(2);
    const script  = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Request timed out"));
    }, 30000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function(json) {
      cleanup();
      if (!json.ok) reject(new Error(json.error || "API error"));
      else resolve(json.data);
    };

    script.src = url + "&callback=" + cbName;
    script.onerror = () => { cleanup(); reject(new Error("Script load failed — check GAS URL and deployment")); };
    document.head.appendChild(script);
  });
}

async function refreshAll() {
  setLoading(true);
  try {
    const [inv, txns, pkgs, qty, dash] = await Promise.all([
      api("inventory"),
      api("transactions"),
      api("packages"),
      api("quantity"),
      api("dashboard"),
    ]);
    State.inventory    = inv   || [];
    State.transactions = txns  || [];
    State.packages     = pkgs  || [];
    State.quantity     = qty   || [];
    State.dashboard    = dash  || {};
    State.lastUpdated  = new Date();
    saveCache();
    renderCurrentPage();
    updateLastUpdated();
    showToast("Data refreshed");

    // Load photos in background
    loadPhotos();
  } catch(err) {
    showToast("Error: " + err.message, true);
    loadCache();
    renderCurrentPage();
  } finally {
    setLoading(false);
  }
}

async function loadPhotos() {
  try {
    State.photos = await api("photos");
  } catch(e) {
    console.warn("Could not load photos:", e);
  }
}

// ── Cache ─────────────────────────────────────────────────────
function saveCache() {
  try {
    sessionStorage.setItem("nw_v4", JSON.stringify({
      inventory: State.inventory, transactions: State.transactions,
      packages: State.packages, quantity: State.quantity,
      dashboard: State.dashboard, lastUpdated: State.lastUpdated,
    }));
  } catch(e) {}
}

function loadCache() {
  try {
    const raw = sessionStorage.getItem("nw_v4");
    if (!raw) return false;
    const c = JSON.parse(raw);
    State.inventory    = c.inventory    || [];
    State.transactions = c.transactions || [];
    State.packages     = c.packages     || [];
    State.quantity     = c.quantity     || [];
    State.dashboard    = c.dashboard    || {};
    State.lastUpdated  = c.lastUpdated ? new Date(c.lastUpdated) : null;
    return true;
  } catch(e) { return false; }
}

// ── UI Helpers ────────────────────────────────────────────────
function setLoading(v) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.toggle("visible", v);
  const btn = document.querySelector(".btn-refresh");
  if (btn) btn.classList.toggle("loading", v);
}

function showToast(msg, isErr=false) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.background = isErr ? "#9b2c2c" : "";
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 3200);
}

function updateLastUpdated() {
  const el = document.getElementById("lastUpdated");
  if (el && State.lastUpdated) el.textContent = "Updated " + State.lastUpdated.toLocaleTimeString();
}

function statusBadge(status) {
  const map = {
    "AVAILABLE":                "available",
    "RELEASED":                 "released",
    "FOR LAUNDRY":              "laundry",
    "SOLD":                     "sold",
    "SOLD OUT":                 "sold",
    "ONGOING":                  "ongoing",
    "COMPLETED":                "completed",
    "PENDING":                  "pending",
    "MISSING":                  "missing",
    "DAMAGE":                   "damage",
    "SLIGHTLY DAMAGE":          "damage",
    "SEVERANCE":                "severance",
    "DIP SEVERANCE":            "severance",
    "NOT RETURNED BY CUSTOMER": "missing",
    "R-YAM":                    "damage",
    "NOT AVAILABLE":            "sold",
    "STOLEN":                   "missing",
  };
  const cls = map[(status||"").toUpperCase()] || "pending";
  return `<span class="badge badge-${cls}">${esc(status) || "—"}</span>`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"}); }
  catch(e) { return iso; }
}

function esc(s) {
  return String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtWeight(w) {
  if (w === null || w === undefined) return "—";
  return Number(w).toFixed(3) + " kg";
}

// ── Photos ────────────────────────────────────────────────────
function getPhotosForItem(code) {
  // Find all photos whose filename starts with the item code (case-insensitive)
  const upper = (code||"").toUpperCase();
  const results = [];
  for (const [key, photos] of Object.entries(State.photos)) {
    // key is the uppercased filename (without extension)
    // Match: key starts with upper, followed by end, -, _, or space
    const regex = new RegExp(`^${upper.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&')}(-|_|\\s|$)`, 'i');
    if (regex.test(key)) {
      for (const p of photos) results.push(p);
    }
  }
  return results;
}

function photoGalleryHTML(code) {
  const photos = getPhotosForItem(code);
  if (!photos.length) return '<p style="color:var(--mist);font-size:.8rem">No photos available</p>';
  return `<div class="photo-gallery">${photos.map(p => `
    <div class="photo-item">
      <img src="https://drive.google.com/thumbnail?id=${p.id}&sz=w400" alt="${esc(p.name)}" loading="lazy" onerror="this.parentElement.style.display='none'">
      <div class="photo-name">${esc(p.name)}</div>
    </div>`).join("")}</div>`;
}

// ── Sidebar ───────────────────────────────────────────────────
function initSidebar() {
  const hamburger = document.getElementById("hamburger");
  const sidebar   = document.querySelector(".sidebar");
  const overlay   = document.getElementById("sidebarOverlay");
  if (!hamburger || !sidebar) return;
  const open  = () => { sidebar.classList.add("open"); overlay&&overlay.classList.add("visible"); document.body.style.overflow="hidden"; };
  const close = () => { sidebar.classList.remove("open"); overlay&&overlay.classList.remove("visible"); document.body.style.overflow=""; };
  hamburger.addEventListener("click", open);
  if (overlay) overlay.addEventListener("click", close);
}

// ── Drawer ────────────────────────────────────────────────────
function openDrawer(html, title, sub) {
  const overlay = document.getElementById("drawerOverlay");
  const drawer  = document.getElementById("drawer");
  const dtitle  = document.getElementById("drawerTitle");
  const dsub    = document.getElementById("drawerSub");
  const dbody   = document.getElementById("drawerBody");
  if (!drawer) return;
  if (dtitle) dtitle.textContent = title||"";
  if (dsub)   dsub.textContent   = sub||"";
  if (dbody)  dbody.innerHTML    = html;
  overlay.classList.add("open");
  drawer.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  document.getElementById("drawerOverlay")?.classList.remove("open");
  document.getElementById("drawer")?.classList.remove("open");
  document.body.style.overflow = "";
}

function initDrawer() {
  document.getElementById("drawerOverlay")?.addEventListener("click", closeDrawer);
  document.getElementById("drawerClose")?.addEventListener("click", closeDrawer);
}

// ── Sortable / Paginate ───────────────────────────────────────
function makeSortable(tableId, renderFn) {
  const table = document.getElementById(tableId);
  if (!table) return;
  let sortCol=-1, sortDir=1;
  table.querySelectorAll("thead th").forEach((th,idx) => {
    th.addEventListener("click", () => {
      if (sortCol===idx) sortDir*=-1; else { sortCol=idx; sortDir=1; }
      table.querySelectorAll("thead th").forEach(h => h.classList.remove("sorted-asc","sorted-desc"));
      th.classList.add(sortDir===1?"sorted-asc":"sorted-desc");
      renderFn(sortCol, sortDir);
    });
  });
}

function paginate(items, page, perPage=50) {
  const start = (page-1)*perPage;
  return { items: items.slice(start, start+perPage), total: items.length, pages: Math.ceil(items.length/perPage), page };
}

function renderPagination(id, p, onPage) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = (p.page-1)*50+1, end = Math.min(p.page*50, p.total);
  let btns = "";
  for (let i=1;i<=p.pages;i++) {
    if (p.pages>7 && Math.abs(i-p.page)>2 && i!==1 && i!==p.pages) {
      if (i===2||i===p.pages-1) btns+=`<span style="padding:4px 3px;color:var(--mist)">…</span>`;
      continue;
    }
    btns+=`<button class="btn-page${i===p.page?" active":""}" data-pg="${i}">${i}</button>`;
  }
  el.innerHTML = `
    <span class="pagination-info">${p.total===0?"No results":`${start}–${end} of ${p.total}`}</span>
    <div class="pagination-btns">
      <button class="btn-page" data-pg="${p.page-1}" ${p.page===1?"disabled":""}>←</button>
      ${btns}
      <button class="btn-page" data-pg="${p.page+1}" ${p.page===p.pages?"disabled":""}>→</button>
    </div>`;
  el.querySelectorAll(".btn-page[data-pg]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pg=parseInt(btn.dataset.pg);
      if (pg>=1&&pg<=p.pages) onPage(pg);
    });
  });
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
  const d = State.dashboard;
  const c = d.counts || {};
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v??0;};
  set("statTotal",     c.total);
  set("statAvailable", c.available);
  set("statReleased",  c.released);
  set("statLaundry",   c.forLaundry);
  set("statSold",      c.sold);

  // Branch breakdown
  const branchGrid = document.getElementById("branchGrid");
  if (branchGrid && d.byBranch) {
    branchGrid.innerHTML = Object.entries(d.byBranch).map(([branch,data]) => `
      <div class="branch-card">
        <div class="branch-name">${esc(branch)}</div>
        <div class="branch-stat"><span>Available</span><span>${data.available||0}</span></div>
        <div class="branch-stat"><span>Released</span><span>${data.released||0}</span></div>
        <div class="branch-stat"><span>For Laundry</span><span>${data.forLaundry||0}</span></div>
        <div class="branch-stat"><span>Active Txns</span><span>${data.activeTxns||0}</span></div>
      </div>`).join("");
  }

  // Recent transactions
  const tbody = document.getElementById("recentTxnBody");
  if (tbody) {
    const recent = State.transactions.slice(0,10);
    if (!recent.length) {
      tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><p class="empty-sub">Click Refresh to load data.</p></div></td></tr>`;
    } else {
      tbody.innerHTML = recent.map(t => `
        <tr class="td-clickable" data-txn="${esc(t.txnNum)}">
          <td class="td-txn">${esc(t.txnNum)}</td>
          <td>${esc(t.customer)}</td>
          <td>${esc(t.branch)||"—"}</td>
          <td>${statusBadge(t.txnStatus)}</td>
          <td>${fmtDate(t.pickupDate)}</td>
        </tr>`).join("");
      tbody.querySelectorAll("tr[data-txn]").forEach(r => r.addEventListener("click",()=>showTxnDrawer(r.dataset.txn)));
    }
  }
}

// ── INVENTORY PAGE ────────────────────────────────────────────
const InvSt = { search:"", status:"", branch:"", category:"", sortCol:-1, sortDir:1, page:1 };

function filterInv() {
  let data = State.inventory;
  const q = InvSt.search.toLowerCase().trim();
  if (q) data = data.filter(i =>
    (i.code||"").toLowerCase().includes(q) ||
    (i.category||"").toLowerCase().includes(q) ||
    (i.branch||"").toLowerCase().includes(q) ||
    (i.txnNum||"").toLowerCase().includes(q) ||
    (i.customer||"").toLowerCase().includes(q)
  );
  if (InvSt.status) {
    if (InvSt.status==="SOLD") data=data.filter(i=>i.status==="SOLD"||i.status==="SOLD OUT");
    else data=data.filter(i=>i.status===InvSt.status);
  }
  if (InvSt.branch)   data=data.filter(i=>i.branch===InvSt.branch);
  if (InvSt.category) data=data.filter(i=>i.category===InvSt.category);
  if (InvSt.sortCol>=0) {
    const keys=["code","category","status","branch","txnNum","weight"];
    const key=keys[InvSt.sortCol];
    data=[...data].sort((a,b)=>String(a[key]||"").localeCompare(String(b[key]||""),undefined,{numeric:true})*InvSt.sortDir);
  }
  return data;
}

function renderInventory(sortCol, sortDir) {
  if (sortCol!==undefined){InvSt.sortCol=sortCol;InvSt.sortDir=sortDir;}
  const filtered=filterInv();
  const p=paginate(filtered,InvSt.page);
  const tbody=document.getElementById("invBody");
  if (!tbody) return;
  const cEl=document.getElementById("invCount");
  if (cEl) cEl.textContent=`${p.total} items`;
  if (!p.items.length) {
    tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><p class="empty-title">No items found</p><p class="empty-sub">Try adjusting your filters</p></div></td></tr>`;
  } else {
    tbody.innerHTML=p.items.map(i=>`
      <tr class="td-clickable" data-code="${esc(i.code)}">
        <td class="td-code">${esc(i.code)}</td>
        <td class="td-cat">${esc(i.category)}</td>
        <td>${statusBadge(i.status)}</td>
        <td>${esc(i.branch)||"—"}</td>
        <td class="td-txn">${esc(i.txnNum)||"—"}</td>
        <td style="font-family:var(--ff-mono);font-size:.72rem">${fmtWeight(i.weight)}</td>
      </tr>`).join("");
    tbody.querySelectorAll("tr[data-code]").forEach(r=>r.addEventListener("click",()=>showItemDrawer(r.dataset.code)));
  }
  renderPagination("invPagination",p,pg=>{InvSt.page=pg;renderInventory();});
}

function showItemDrawer(code) {
  const item = State.inventory.find(i=>i.code===code);
  if (!item) return;
  const history = State.transactions
    .filter(t=>(t.trackedItems||[]).includes(code))
    .map(t=>`<tr>
      <td class="td-txn">${esc(t.txnNum)}</td>
      <td>${esc(t.customer)}</td>
      <td>${esc(t.branch)||"—"}</td>
      <td>${fmtDate(t.pickupDate)}</td>
      <td>${fmtDate(t.returnDate)}</td>
      <td>${statusBadge(t.txnStatus)}</td>
    </tr>`).join("");

  const html = `
    <div class="detail-row"><span class="detail-label">Code</span><span class="detail-value td-code">${esc(item.code)}</span></div>
    <div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">${esc(item.category)}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge(item.status)}</span></div>
    <div class="detail-row"><span class="detail-label">Branch</span><span class="detail-value">${esc(item.branch)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Weight</span><span class="detail-value">${fmtWeight(item.weight)}</span></div>
    <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-value">${esc(item.customer)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Transaction</span><span class="detail-value td-txn">${esc(item.txnNum)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Pickup</span><span class="detail-value">${fmtDate(item.pickupDate)}</span></div>
    <div class="detail-row"><span class="detail-label">Return</span><span class="detail-value">${fmtDate(item.returnDate)}</span></div>
    <div style="margin-top:20px">
      <div style="font-family:var(--ff-mono);font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);margin-bottom:10px">Photos</div>
      ${photoGalleryHTML(item.code)}
    </div>
    ${history ? `
    <div style="margin-top:20px">
      <div style="font-family:var(--ff-mono);font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);margin-bottom:10px">Rental History</div>
      <div style="overflow-x:auto">
        <table class="history-table">
          <thead><tr><th>Transaction</th><th>Customer</th><th>Branch</th><th>Pickup</th><th>Return</th><th>Status</th></tr></thead>
          <tbody>${history}</tbody>
        </table>
      </div>
    </div>` : ""}`;
  openDrawer(html, item.code, item.category);
}

function initInventoryPage() {
  document.getElementById("invSearch")?.addEventListener("input",e=>{InvSt.search=e.target.value;InvSt.page=1;renderInventory();});
  document.getElementById("invFilterStatus")?.addEventListener("change",e=>{InvSt.status=e.target.value;InvSt.page=1;renderInventory();});
  document.getElementById("invFilterBranch")?.addEventListener("change",e=>{InvSt.branch=e.target.value;InvSt.page=1;renderInventory();});
  document.getElementById("invFilterCat")?.addEventListener("change",e=>{InvSt.category=e.target.value;InvSt.page=1;renderInventory();});

  // Populate category filter
  const catEl=document.getElementById("invFilterCat");
  if (catEl) {
    const cats=[...new Set(State.inventory.map(i=>i.category).filter(Boolean))].sort();
    cats.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;catEl.appendChild(o);});
  }
  makeSortable("invTable",renderInventory);
  renderInventory();
}

// ── ITEM SEARCH PAGE ──────────────────────────────────────────
function initItemSearchPage() {
  const searchInput = document.getElementById("itemSearchInput");
  const searchBtn   = document.getElementById("itemSearchBtn");
  const filterCat   = document.getElementById("itemFilterCat");
  const filterBranch= document.getElementById("itemFilterBranch");

  if (searchBtn) searchBtn.addEventListener("click", runItemSearch);
  if (searchInput) searchInput.addEventListener("keydown", e=>{ if(e.key==="Enter") runItemSearch(); });
  if (filterCat) filterCat.addEventListener("change", runItemSearch);
  if (filterBranch) filterBranch.addEventListener("change", runItemSearch);

  // Populate category filter
  if (filterCat) {
    const cats=[...new Set(State.inventory.map(i=>i.category).filter(Boolean))].sort();
    cats.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;filterCat.appendChild(o);});
  }
}

function runItemSearch() {
  const q       = (document.getElementById("itemSearchInput")?.value||"").trim().toLowerCase();
  const cat     = document.getElementById("itemFilterCat")?.value||"";
  const branch  = document.getElementById("itemFilterBranch")?.value||"";
  const results = document.getElementById("itemSearchResults");
  if (!results) return;

  let data = State.inventory;
  if (q) data = data.filter(i =>
    (i.code||"").toLowerCase().includes(q) ||
    (i.category||"").toLowerCase().includes(q) ||
    (i.branch||"").toLowerCase().includes(q)
  );
  if (cat)    data = data.filter(i=>i.category===cat);
  if (branch) data = data.filter(i=>i.branch===branch);

  if (!data.length) {
    results.innerHTML=`<div class="empty-state"><p class="empty-title">No items found</p><p class="empty-sub">Try a different search term</p></div>`;
    return;
  }

  // If single item found or exact code match, show full profile
  const exactMatch = data.find(i=>(i.code||"").toLowerCase()===q);
  if (exactMatch || data.length===1) {
    showItemProfile(exactMatch||data[0]);
    return;
  }

  // Show list
  results.innerHTML=`
    <div class="table-card">
      <div class="table-header"><span class="table-title">Search Results</span><span class="table-count">${data.length} items</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Item Code</th><th>Category</th><th>Status</th><th>Branch</th><th>Weight</th></tr></thead>
          <tbody>${data.slice(0,100).map(i=>`
            <tr class="td-clickable" data-code="${esc(i.code)}">
              <td class="td-code">${esc(i.code)}</td>
              <td class="td-cat">${esc(i.category)}</td>
              <td>${statusBadge(i.status)}</td>
              <td>${esc(i.branch)||"—"}</td>
              <td style="font-family:var(--ff-mono);font-size:.72rem">${fmtWeight(i.weight)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  results.querySelectorAll("tr[data-code]").forEach(r=>r.addEventListener("click",()=>{
    showItemProfile(data.find(i=>i.code===r.dataset.code));
  }));
}

function showItemProfile(item) {
  if (!item) return;
  const results = document.getElementById("itemSearchResults");
  if (!results) return;

  const history = State.transactions
    .filter(t=>(t.trackedItems||[]).includes(item.code));

  const histRows = history.map(t=>`
    <tr>
      <td class="td-txn">${esc(t.txnNum)}</td>
      <td>${esc(t.customer)}</td>
      <td>${esc(t.branch)||"—"}</td>
      <td>${fmtDate(t.pickupDate)}</td>
      <td>${fmtDate(t.returnDate)}</td>
      <td>${esc(t.txnType)||"—"}</td>
      <td>${statusBadge(t.txnStatus)}</td>
    </tr>`).join("");

  results.innerHTML=`
    <div class="item-profile">
      <div class="item-profile-header">
        <div>
          <div class="item-profile-code">${esc(item.code)}</div>
          <div class="item-profile-meta">
            <span class="meta-pill">${esc(item.category)}</span>
            ${item.branch?`<span class="meta-pill">${esc(item.branch)}</span>`:""}
            ${item.weight!==null?`<span class="meta-pill">${fmtWeight(item.weight)}</span>`:""}
          </div>
        </div>
        <div>${statusBadge(item.status)}</div>
      </div>
      <div class="item-profile-body">
        <div style="font-family:var(--ff-mono);font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);margin-bottom:12px">Photos</div>
        ${photoGalleryHTML(item.code)}

        <div style="margin-top:28px">
          <div style="font-family:var(--ff-mono);font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);margin-bottom:12px">Current Transaction</div>
          ${item.txnNum ? `
            <div class="detail-row"><span class="detail-label">Transaction</span><span class="detail-value td-txn">${esc(item.txnNum)}</span></div>
            <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-value">${esc(item.customer)||"—"}</span></div>
            <div class="detail-row"><span class="detail-label">Pickup</span><span class="detail-value">${fmtDate(item.pickupDate)}</span></div>
            <div class="detail-row"><span class="detail-label">Return</span><span class="detail-value">${fmtDate(item.returnDate)}</span></div>
          ` : '<p style="font-size:.8rem;color:var(--mist)">No active transaction</p>'}
        </div>

        ${histRows ? `
        <div style="margin-top:28px">
          <div style="font-family:var(--ff-mono);font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);margin-bottom:12px">Rental History (${history.length} transactions)</div>
          <div style="overflow-x:auto">
            <table class="history-table">
              <thead><tr><th>Transaction #</th><th>Customer</th><th>Branch</th><th>Pickup</th><th>Return</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>${histRows}</tbody>
            </table>
          </div>
        </div>` : ""}
      </div>
    </div>`;
}

// ── TRANSACTIONS PAGE ─────────────────────────────────────────
const TxnSt = { search:"", status:"", branch:"", sortCol:-1, sortDir:1, page:1 };

function filterTxns() {
  let data=State.transactions;
  const q=TxnSt.search.toLowerCase().trim();
  if (q) data=data.filter(t=>(t.txnNum||"").toLowerCase().includes(q)||(t.customer||"").toLowerCase().includes(q)||(t.branch||"").toLowerCase().includes(q));
  if (TxnSt.status) data=data.filter(t=>t.txnStatus===TxnSt.status);
  if (TxnSt.branch) data=data.filter(t=>t.branch===TxnSt.branch);
  if (TxnSt.sortCol>=0) {
    const keys=["txnNum","customer","branch","txnType","txnStatus","pickupDate","returnDate"];
    const key=keys[TxnSt.sortCol];
    data=[...data].sort((a,b)=>String(a[key]||"").localeCompare(String(b[key]||""))*TxnSt.sortDir);
  }
  return data;
}

function renderTransactions(sortCol,sortDir) {
  if (sortCol!==undefined){TxnSt.sortCol=sortCol;TxnSt.sortDir=sortDir;}
  const filtered=filterTxns();
  const p=paginate(filtered,TxnSt.page);
  const tbody=document.getElementById("txnBody");
  if (!tbody) return;
  const cEl=document.getElementById("txnCount");
  if (cEl) cEl.textContent=`${p.total} transactions`;
  if (!p.items.length) {
    tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><p class="empty-sub">No transactions found</p></div></td></tr>`;
  } else {
    tbody.innerHTML=p.items.map(t=>`
      <tr class="td-clickable" data-txn="${esc(t.txnNum)}">
        <td class="td-txn">${esc(t.txnNum)}</td>
        <td>${esc(t.customer)}</td>
        <td>${esc(t.branch)||"—"}</td>
        <td>${esc(t.txnType)||"—"}</td>
        <td>${esc(t.packageType)||"—"}</td>
        <td>${statusBadge(t.txnStatus)}</td>
        <td>${fmtDate(t.pickupDate)}</td>
      </tr>`).join("");
    tbody.querySelectorAll("tr[data-txn]").forEach(r=>r.addEventListener("click",()=>showTxnDrawer(r.dataset.txn)));
  }
  renderPagination("txnPagination",p,pg=>{TxnSt.page=pg;renderTransactions();});
}

function showTxnDrawer(txnNum) {
  const t=State.transactions.find(x=>x.txnNum===txnNum);
  if (!t) return;
  const chips=(t.trackedItems||[]).map(i=>`<span class="item-chip">${esc(i)}</span>`).join("");
  const qtyRows=Object.entries(t.qtyItems||{}).map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:.8rem;border-bottom:1px solid var(--cloud)"><span>${esc(k)}</span><span style="font-family:var(--ff-mono)">${v}</span></div>`).join("");
  const html=`
    <div class="detail-row"><span class="detail-label">Transaction</span><span class="detail-value td-txn">${esc(t.txnNum)}</span></div>
    <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-value">${esc(t.customer)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Branch</span><span class="detail-value">${esc(t.branch)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${esc(t.txnType)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Package</span><span class="detail-value">${t.packageColor?esc(t.packageColor)+"  "+esc(t.packageType||""):"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge(t.txnStatus)}</span></div>
    <div class="detail-row"><span class="detail-label">Pickup</span><span class="detail-value">${fmtDate(t.pickupDate)}</span></div>
    <div class="detail-row"><span class="detail-label">Return</span><span class="detail-value">${fmtDate(t.returnDate)}</span></div>
    ${chips?`<div class="detail-row"><span class="detail-label">Tracked Items</span><div class="detail-value"><div class="items-list">${chips}</div></div></div>`:""}
    ${qtyRows?`<div style="margin-top:16px"><div style="font-family:var(--ff-mono);font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);margin-bottom:8px">Quantity Items</div>${qtyRows}</div>`:""}
    ${t.orderSummary?`<div style="margin-top:16px"><div style="font-family:var(--ff-mono);font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);margin-bottom:8px">Order Summary</div><pre style="font-size:.75rem;white-space:pre-wrap;word-break:break-word;color:var(--ink);line-height:1.6;background:var(--paper);padding:12px;border-radius:4px;border:1px solid var(--cloud)">${esc(t.orderSummary)}</pre></div>`:""}`;
  openDrawer(html, t.txnNum, t.customer);
}

function initTransactionsPage() {
  document.getElementById("txnSearch")?.addEventListener("input",e=>{TxnSt.search=e.target.value;TxnSt.page=1;renderTransactions();});
  document.getElementById("txnFilterStatus")?.addEventListener("change",e=>{TxnSt.status=e.target.value;TxnSt.page=1;renderTransactions();});
  document.getElementById("txnFilterBranch")?.addEventListener("change",e=>{TxnSt.branch=e.target.value;TxnSt.page=1;renderTransactions();});
  makeSortable("txnTable",renderTransactions);
  renderTransactions();
}

// ── PACKAGES PAGE ─────────────────────────────────────────────
const PkgSt = { search:"", status:"", branch:"", sortCol:-1, sortDir:1, page:1 };

function filterPkgs() {
  let data=State.packages;
  const q=PkgSt.search.toLowerCase().trim();
  if (q) data=data.filter(p=>(p.packageColor||"").toLowerCase().includes(q)||(p.txnNum||"").toLowerCase().includes(q)||(p.customer||"").toLowerCase().includes(q));
  if (PkgSt.status) data=data.filter(p=>p.status===PkgSt.status);
  if (PkgSt.branch) data=data.filter(p=>p.branch===PkgSt.branch);
  if (PkgSt.sortCol>=0) {
    const keys=["packageColor","txnType","branch","txnNum","status"];
    const key=keys[PkgSt.sortCol];
    data=[...data].sort((a,b)=>String(a[key]||"").localeCompare(String(b[key]||""))*PkgSt.sortDir);
  }
  return data;
}

function renderPackages(sortCol,sortDir) {
  if (sortCol!==undefined){PkgSt.sortCol=sortCol;PkgSt.sortDir=sortDir;}
  const filtered=filterPkgs();
  const p=paginate(filtered,PkgSt.page);
  const tbody=document.getElementById("pkgBody");
  if (!tbody) return;
  const cEl=document.getElementById("pkgCount");
  if (cEl) cEl.textContent=`${p.total} package colors`;
  if (!p.items.length) {
    tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><p class="empty-sub">No packages found</p></div></td></tr>`;
  } else {
    tbody.innerHTML=p.items.map(pk=>`
      <tr class="td-clickable" data-pkg="${esc(pk.packageColor)}">
        <td style="font-family:var(--ff-mono);font-size:.78rem">${esc(pk.packageColor)}</td>
        <td>${esc(pk.txnType)||"—"}</td>
        <td>${esc(pk.branch)||"—"}</td>
        <td class="td-txn">${esc(pk.txnNum)||"—"}</td>
        <td>${statusBadge(pk.status)}</td>
      </tr>`).join("");
    tbody.querySelectorAll("tr[data-pkg]").forEach(r=>r.addEventListener("click",()=>showPkgDrawer(r.dataset.pkg)));
  }
  renderPagination("pkgPagination",p,pg=>{PkgSt.page=pg;renderPackages();});
}

function showPkgDrawer(color) {
  const pk=State.packages.find(p=>p.packageColor===color||p.packageColor.toUpperCase()===color);
  if (!pk) return;
  const mohS=pk.moh?statusBadge(pk.moh.status):"—";
  const bmgS=pk.bmg?statusBadge(pk.bmg.status):"—";
  const fggS=pk.fgg?statusBadge(pk.fgg.status):"—";
  const html=`
    <div class="detail-row"><span class="detail-label">Color</span><span class="detail-value" style="font-family:var(--ff-mono)">${esc(pk.packageColor)}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge(pk.status)}</span></div>
    <div class="detail-row"><span class="detail-label">Branch</span><span class="detail-value">${esc(pk.branch)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-value">${esc(pk.customer)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">Transaction</span><span class="detail-value td-txn">${esc(pk.txnNum)||"—"}</span></div>
    <div class="detail-row"><span class="detail-label">MOH (×1)</span><span class="detail-value">${mohS}</span></div>
    <div class="detail-row"><span class="detail-label">BMG (×5)</span><span class="detail-value">${bmgS}</span></div>
    <div class="detail-row"><span class="detail-label">FGG (×5)</span><span class="detail-value">${fggS}</span></div>`;
  openDrawer(html, pk.packageColor, "Package Color");
}

function initPackagesPage() {
  document.getElementById("pkgSearch")?.addEventListener("input",e=>{PkgSt.search=e.target.value;PkgSt.page=1;renderPackages();});
  document.getElementById("pkgFilterStatus")?.addEventListener("change",e=>{PkgSt.status=e.target.value;PkgSt.page=1;renderPackages();});
  document.getElementById("pkgFilterBranch")?.addEventListener("change",e=>{PkgSt.branch=e.target.value;PkgSt.page=1;renderPackages();});
  makeSortable("pkgTable",renderPackages);
  renderPackages();
}

// ── QUANTITY PAGE ─────────────────────────────────────────────
const QtySt = { search:"", cat:"", sortCol:-1, sortDir:1, page:1 };

function filterQty() {
  let data=State.quantity.filter(q=>q.rented>0||q.laundry>0);
  const q=QtySt.search.toLowerCase().trim();
  if (q) data=data.filter(i=>(i.name||"").toLowerCase().includes(q));
  if (QtySt.cat) data=data.filter(i=>{
    const name=(i.name||"").toUpperCase();
    return name.startsWith(QtySt.cat+"-")||name.startsWith(QtySt.cat+" ")||name===QtySt.cat;
  });
  if (QtySt.sortCol>=0) {
    const keys=["name","rented","laundry"];
    const key=keys[QtySt.sortCol];
    data=[...data].sort((a,b)=>{
      const av=typeof a[key]==="number"?a[key]:String(a[key]||"");
      const bv=typeof b[key]==="number"?b[key]:String(b[key]||"");
      return (av>bv?1:av<bv?-1:0)*QtySt.sortDir;
    });
  }
  return data;
}

function renderQuantity(sortCol,sortDir) {
  if (sortCol!==undefined){QtySt.sortCol=sortCol;QtySt.sortDir=sortDir;}
  const filtered=filterQty();
  const p=paginate(filtered,QtySt.page);
  const tbody=document.getElementById("qtyBody");
  if (!tbody) return;
  const cEl=document.getElementById("qtyCount");
  if (cEl) cEl.textContent=`${p.total} items`;
  if (!p.items.length) {
    tbody.innerHTML=`<tr><td colspan="3"><div class="empty-state"><p class="empty-sub">No quantity items with active rentals</p></div></td></tr>`;
  } else {
    tbody.innerHTML=p.items.map(i=>`
      <tr>
        <td style="font-family:var(--ff-mono);font-size:.78rem">${esc(i.name)}</td>
        <td style="font-family:var(--ff-mono);font-size:.82rem;color:var(--status-released)">${i.rented||0}</td>
        <td style="font-family:var(--ff-mono);font-size:.82rem;color:var(--status-laundry)">${i.laundry||0}</td>
      </tr>`).join("");
  }
  renderPagination("qtyPagination",p,pg=>{QtySt.page=pg;renderQuantity();});
}

function initQuantityPage() {
  document.getElementById("qtySearch")?.addEventListener("input",e=>{QtySt.search=e.target.value;QtySt.page=1;renderQuantity();});
  document.getElementById("qtyFilterCat")?.addEventListener("change",e=>{QtySt.cat=e.target.value;QtySt.page=1;renderQuantity();});
  makeSortable("qtyTable",renderQuantity);
  renderQuantity();
}

// ── Router ────────────────────────────────────────────────────
function renderCurrentPage() {
  const page=document.body.dataset.page;
  if      (page==="dashboard")    renderDashboard();
  else if (page==="inventory")    renderInventory();
  else if (page==="transactions") renderTransactions();
  else if (page==="packages")     renderPackages();
  else if (page==="quantity")     renderQuantity();
  else if (page==="search")       { /* search renders on user action */ }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  initSidebar();
  initDrawer();

  if (!GAS_URL) document.querySelectorAll(".config-banner").forEach(b=>b.style.display="flex");

  document.querySelector(".btn-refresh")?.addEventListener("click", refreshAll);

  const cached=loadCache();
  if (cached) {
    updateLastUpdated();
    const page=document.body.dataset.page;
    if      (page==="inventory")    initInventoryPage();
    else if (page==="transactions") initTransactionsPage();
    else if (page==="packages")     initPackagesPage();
    else if (page==="quantity")     initQuantityPage();
    else if (page==="search")       initItemSearchPage();
    else renderDashboard();
  }

  if (GAS_URL) {
    await refreshAll();
    if (!cached) {
      const page=document.body.dataset.page;
      if      (page==="inventory")    initInventoryPage();
      else if (page==="transactions") initTransactionsPage();
      else if (page==="packages")     initPackagesPage();
      else if (page==="quantity")     initQuantityPage();
      else if (page==="search")       initItemSearchPage();
      else renderDashboard();
    }
  } else {
    renderCurrentPage();
  }
});
