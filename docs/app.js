// ====== CONFIG: point this to your repo if you keep settings.json outside /docs ======
const SETTINGS_URL = "https://raw.githubusercontent.com/katpally123/attendance-dashboard/main/config/settings.json";

// ========== Load settings ==========
let SETTINGS = null;
fetch(SETTINGS_URL)
  .then(r => { if(!r.ok) throw new Error("settings.json fetch failed"); return r.json(); })
  .then(cfg => { SETTINGS = cfg; renderShiftCodes(); })
  .catch(e => { console.error(e); alert("Couldn't load settings.json"); });

// ========== Elements ==========
const dateEl   = document.getElementById("dateInput");
const shiftEl  = document.getElementById("shiftInput");
const newHireEl= document.getElementById("excludeNewHires");
const rosterEl = document.getElementById("rosterFile");
const mytimeEl = document.getElementById("mytimeFile");
const codesEl  = document.getElementById("shiftCodes");
const fileStatus = document.getElementById("fileStatus");
const processBtn = document.getElementById("processBtn");
const expectedTable = document.getElementById("expectedTable");
const presentTable  = document.getElementById("presentTable");
const summaryChips  = document.getElementById("summaryChips");

// Defaults: today + Day
(function initDefaults(){
  const today = new Date();
  dateEl.value = today.toISOString().slice(0,10);
  shiftEl.value = "Day";
  renderShiftCodes();
})();
dateEl.addEventListener("change", renderShiftCodes);
shiftEl.addEventListener("change", renderShiftCodes);

// ========== Helpers ==========
function toDayName(isoDate){
  if (!isoDate) return "Monday";
  return new Date(isoDate+"T00:00:00").toLocaleDateString("en-US",{weekday:"long"});
}
function first2(s){ return (s||"").slice(0,2); }
function firstAndThird(s){ return (s?.length>=3) ? s[0]+s[2] : ""; }
function canon(s){ return String(s||"").trim().toLowerCase().replace(/\s+/g," ").replace(/[^\w? ]/g,""); }
function normalizeId(v){
  const t = String(v??"").trim();
  const digits = t.replace(/\D/g,"");               // keep digits
  const noLead = digits.replace(/^0+/,"");          // drop leading zeros
  return noLead || t;                                // fallback to original if no digits
}
function parseDateLoose(s){
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function classifyEmpType(v){
  const x = canon(v);
  if (!x) return "UNKNOWN";
  // AMZN synonyms
  if (/(amzn|amazon|blue badge|bb|fte|full time|part time|pt)\b/.test(x)) return "AMZN";
  // TEMP/vendor synonyms
  if (/(temp|temporary|seasonal|agency|vendor|contract|white badge|wb|csg|adecco|randstad)/.test(x)) return "TEMP";
  // Fallback: keep raw if it literally equals "temp" or "amzn"
  if (x === "temp") return "TEMP";
  if (x === "amzn") return "AMZN";
  return "UNKNOWN";
}
function parseCSVFile(file, opts={header:true, skipFirstLine:false}){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error("Failed to read file"));
    reader.onload = () => {
      let text = reader.result;
      if (opts.skipFirstLine){
        const i = text.indexOf("\n");
        text = i>=0 ? text.slice(i+1) : text;
      }
      Papa.parse(text, {
        header: opts.header,
        skipEmptyLines: true,
        transformHeader: h => h.trim(),
        complete: res => resolve(res.data)
      });
    };
    reader.readAsText(file);
  });
}

// flexible header resolver
function findKey(row, candidates){
  const keys = Object.keys(row);
  const wanted = candidates.map(canon);
  for (const k of keys){
    const ck = canon(k);
    if (wanted.includes(ck)) return k;
  }
  // also allow slight variations like "on premises?" -> "on premises"
  for (const k of keys){
    const ck = canon(k).replace(/\?/g,"");
    if (wanted.includes(ck)) return k;
  }
  return null;
}

// small view helpers
function renderShiftCodes(){
  if (!SETTINGS) return;
  const dayName = toDayName(dateEl.value);
  const shift = shiftEl.value;
  const codes = (SETTINGS.shift_schedule?.[shift]?.[dayName]) || [];
  codesEl.innerHTML = `Shifts for <b>${dayName}</b> — <b>${shift}</b>: ${codes.map(c=>`<code>${c}</code>`).join(" ")}`;
}
function sumBlock(block){
  const acc = {AMZN:0, TEMP:0, TOTAL:0};
  for (const k of Object.keys(block)){
    acc.AMZN += block[k].AMZN;
    acc.TEMP += block[k].TEMP;
    acc.TOTAL+= block[k].TOTAL;
  }
  return acc;
}
function renderTables(expected, present){
  const header = `
    <thead><tr>
      <th>Department</th><th class="right">AMZN</th><th class="right">TEMP</th><th class="right">TOTAL</th>
    </tr></thead>`;
  const row = v => `<tr><td>${v[0]}</td><td class="right">${v[1].AMZN}</td><td class="right">${v[1].TEMP}</td><td class="right">${v[1].TOTAL}</td></tr>`;

  const rowsExp = Object.entries(expected).map(row).join("");
  const totalsExp = sumBlock(expected);
  expectedTable.innerHTML = header + `<tbody>${rowsExp}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${totalsExp.AMZN}</td><td class="right">${totalsExp.TEMP}</td><td class="right">${totalsExp.TOTAL}</td></tr></tfoot>`;

  const rowsPre = Object.entries(present).map(row).join("");
  const totalsPre = sumBlock(present);
  presentTable.innerHTML = header + `<tbody>${rowsPre}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${totalsPre.AMZN}</td><td class="right">${totalsPre.TEMP}</td><td class="right">${totalsPre.TOTAL}</td></tr></tfoot>`;
}
function renderChips(expected, present, dayName, shift, codes){
  const exp = sumBlock(expected).TOTAL;
  const pre = sumBlock(present).TOTAL;
  const pct = exp ? ((pre/exp)*100).toFixed(1) : "0.0";
  summaryChips.innerHTML = `
    <span class="chip">Day: <b>${dayName}</b></span>
    <span class="chip">Shift: <b>${shift}</b></span>
    <span class="chip">Corners: ${codes.map(c=>`<code>${c}</code>`).join(" ")}</span>
    <span class="chip">Expected Total: <b>${exp}</b></span>
    <span class="chip ${pre>=exp?'ok':'warn'}">Present Total: <b>${pre}</b> (${pct}%)</span>
  `;
}

// ====== AUDIT PANEL (builds confidence) ======
function vc(arr, key){
  const m = new Map();
  for (const x of arr){ const k = x[key] || ""; m.set(k, (m.get(k)||0)+1); }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
}
function renderAuditPanel(html){
  const el = document.getElementById("audit");   // only renders if you added <div id="audit"></div> in index.html
  if (!el) return;
  el.innerHTML = `<details open class="card"><summary><b>Audit & Validation</b></summary>${html}</details>`;
}

// ========== Main click ==========
processBtn.addEventListener("click", async ()=>{
  if (!SETTINGS){ alert("Settings not loaded yet. Try again."); return; }
  const dayName = toDayName(dateEl.value);
  if (!dateEl.value){ alert("Pick a date."); return; }
  if (!rosterEl.files[0] || !mytimeEl.files[0]){
    alert("Upload both Roster CSV and MyTime CSV."); return;
  }
  const shift = shiftEl.value;
  const codes = SETTINGS.shift_schedule?.[shift]?.[dayName] || [];
  if (!codes.length){ alert("No shift codes configured for that selection."); return; }

  fileStatus.textContent = "Parsing files…";

  try {
    // Parse files (skip first row for MyTime)
    const [rosterRaw, mytimeRaw] = await Promise.all([
      parseCSVFile(rosterEl.files[0], {header:true}),
      parseCSVFile(mytimeEl.files[0], {header:true, skipFirstLine:true})
    ]);

    // --- Resolve roster headers (robust) ---
    const r0 = rosterRaw[0] || {};
    const R_EMP   = findKey(r0, ["Employee ID","Person Number","Person ID","Badge ID"]);
    const R_DEPT  = findKey(r0, ["Department ID","Home Department ID","Dept ID"]);
    const R_AREA  = findKey(r0, ["Management Area ID","Mgmt Area ID","Area ID","Area"]);
    const R_TYPE  = findKey(r0, ["Employment Type","Associate Type","Worker Type","Badge Type","Company"]);
    const R_SP    = findKey(r0, ["Shift Pattern","Schedule Pattern","Shift"]);
    const R_CORNER= findKey(r0, ["Corner","Corner Code"]); // optional direct corner column
    const R_START = findKey(r0, ["Employment Start Date","Hire Date","Start Date"]);
    if (!R_EMP || !R_DEPT || !(R_SP || R_CORNER)) {
      throw new Error("Missing required roster columns (Employee ID, Department ID, Shift Pattern/Corner).");
    }

    // --- Resolve MyTime headers (robust) ---
    const m0 = mytimeRaw[0] || {};
    const M_PERSON = findKey(m0, ["Person ID","Employee ID","Person Number","ID"]);
    const M_ONPREM = findKey(m0, ["On Premises","On Premises?","OnPremises"]);
    if (!M_PERSON || !M_ONPREM) {
      throw new Error("Missing MyTime columns (Person ID / On Premises).");
    }

    // --- Build On-Prem map (dedupe by Person ID; TRUE if present at least once) ---
    const presentMarkers = {};
    const onPremMap = new Map();
    for (const row of mytimeRaw){
      const pid = normalizeId(row[M_PERSON]);
      const val = String(row[M_ONPREM] ?? "").trim().toUpperCase();
      presentMarkers[val] = (presentMarkers[val]||0)+1;
      const isOnPrem = SETTINGS.present_markers.includes(val);
      if (pid) onPremMap.set(pid, (onPremMap.get(pid) || false) || isOnPrem);
    }

    // --- Enrich roster ---
    const rosterEnriched = rosterRaw.map(r => {
      const empId  = normalizeId(r[R_EMP]);
      const deptId = String(r[R_DEPT] ?? "").trim();
      const areaId = String((R_AREA? r[R_AREA] : "") ?? "").trim();
      const empTypeRaw = r[R_TYPE];
      const empType = classifyEmpType(empTypeRaw);
      const sp     = String((R_SP? r[R_SP] : "") ?? "");
      const corner = R_CORNER ? String(r[R_CORNER] ?? "").trim() : first2(sp);
      const met    = firstAndThird(sp);
      const start  = R_START ? parseDateLoose(r[R_START]) : null;
      const onPrem = onPremMap.get(empId) === true;
      return { empId, deptId, areaId, empType, sp, corner, met, start, onPrem };
    });

    // --- Filter by Corner codes for selected day/shift ---
    let filtered = rosterEnriched.filter(x => codes.includes(x.corner));

    // --- Exclude new hires (<3 days) if toggled ---
    if (newHireEl.checked){
      const dayStart = new Date(dateEl.value+"T00:00:00");
      filtered = filtered.filter(x => {
        if (!x.start) return true;
        const diffDays = Math.floor((dayStart - x.start)/(1000*60*60*24));
        return diffDays >= 3;
      });
    }

    // --- Department groups (using IDs + area for ICQA/CRETs) ---
    const cfg = SETTINGS.departments;
    const groups = {
      Inbound: filtered.filter(x => cfg.Inbound.dept_ids.includes(x.deptId)),
      ICQA:    filtered.filter(x => cfg.ICQA.dept_ids.includes(x.deptId) && x.areaId === cfg.ICQA.management_area_id),
      CRETs:   filtered.filter(x => cfg.CRETs.dept_ids.includes(x.deptId) && x.areaId === cfg.CRETs.management_area_id)
    };

    // --- Count helper (by AMZN/TEMP, optional present filter) ---
    const countByType = (rows, present=false) => {
      const base = present ? rows.filter(x=>x.onPrem) : rows;
      const amzn = base.filter(x => x.empType === "AMZN").length;
      const temp = base.filter(x => x.empType === "TEMP").length;
      return { AMZN: amzn, TEMP: temp, TOTAL: amzn+temp };
    };

    const expected = {
      Inbound: countByType(groups.Inbound, false),
      ICQA:    countByType(groups.ICQA, false),
      CRETs:   countByType(groups.CRETs, false)
    };
    const present = {
      Inbound: countByType(groups.Inbound, true),
      ICQA:    countByType(groups.ICQA, true),
      CRETs:   countByType(groups.CRETs, true)
    };

    renderTables(expected, present);
    renderChips(expected, present, dayName, shift, codes);
    fileStatus.textContent = "Done.";

    // ====== AUDIT OUTPUT (helps confirm correctness) ======
    const uploadedRosterName = rosterEl.files[0]?.name || "";
    const uploadedMyTimeName = mytimeEl.files[0]?.name || "";
    const matchedIds = rosterEnriched.filter(x => x.empId && onPremMap.has(x.empId)).length;

    const auditHtml = `
      <div class="chips">
        <span class="chip">Roster: <b>${uploadedRosterName}</b></span>
        <span class="chip">MyTime: <b>${uploadedMyTimeName}</b></span>
        <span class="chip">Roster rows: <b>${rosterRaw.length}</b></span>
        <span class="chip">MyTime rows: <b>${mytimeRaw.length}</b></span>
        <span class="chip">ID matches: <b>${matchedIds}</b> / ${rosterEnriched.length}</span>
      </div>

      <h4>Filter pipeline (row counts)</h4>
      <table class="table">
        <thead><tr><th>Stage</th><th class="right">Rows</th></tr></thead>
        <tbody>
          <tr><td>Roster loaded</td><td class="right">${rosterEnriched.length}</td></tr>
          <tr><td>After Corner filter (${codes.map(c=>`<code>${c}</code>`).join(" ")})</td><td class="right">${filtered.length}</td></tr>
          <tr><td>Inbound (dept in ${cfg.Inbound.dept_ids.join(", ")})</td><td class="right">${groups.Inbound.length}</td></tr>
          <tr><td>ICQA (dept in ${cfg.ICQA.dept_ids.join(", ")}, area=${cfg.ICQA.management_area_id})</td><td class="right">${groups.ICQA.length}</td></tr>
          <tr><td>CRETs (dept in ${cfg.CRETs.dept_ids.join(", ")}, area=${cfg.CRETs.management_area_id})</td><td class="right">${groups.CRETs.length}</td></tr>
          <tr><td>Present (On Premises ∈ ${SETTINGS.present_markers.join("/")})</td><td class="right">${present.Inbound.TOTAL + present.ICQA.TOTAL + present.CRETs.TOTAL}</td></tr>
        </tbody>
      </table>

      <h4>Quick distributions (top 10)</h4>
      <div class="grid-2">
        <div>
          <b>Corner</b>
          <ul>${vc(rosterEnriched,"corner").map(([k,v])=>`<li><code>${k||"(blank)"}</code> — ${v}</li>`).join("")}</ul>
        </div>
        <div>
          <b>Department ID</b>
          <ul>${vc(filtered,"deptId").map(([k,v])=>`<li>${k||"(blank)"} — ${v}</li>`).join("")}</ul>
        </div>
        <div>
          <b>Management Area ID</b>
          <ul>${vc(filtered,"areaId").map(([k,v])=>`<li>${k||"(blank)"} — ${v}</li>`).join("")}</ul>
        </div>
        <div>
          <b>Employment Type</b>
          <ul>${vc(filtered,"empType").map(([k,v])=>`<li>${k||"(blank)"} — ${v}</li>`).join("")}</ul>
        </div>
      </div>

      <h4>MyTime “On Premises” values seen</h4>
      <ul>${Object.entries(presentMarkers).map(([k,v])=>`<li><code>${k||"(blank)"}</code> — ${v}</li>`).join("")}</ul>
    `;
    renderAuditPanel(auditHtml);

    // ====== sanity warnings ======
    const unknownTypes = filtered.filter(x=>x.empType==="UNKNOWN").length;
    if (unknownTypes>0){
      console.warn(`Found ${unknownTypes} rows with UNKNOWN employment type — update the classifier if needed.`);
    }

  } catch (err){
    console.error(err);
    fileStatus.textContent = "Error processing files. Check CSV headers and try again.";
    alert(err.message || "Error processing files.");
  }
});
