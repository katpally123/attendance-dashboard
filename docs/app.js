// --- Load settings (dept IDs, shift schedule) ---
let SETTINGS = null;
fetch("../config/settings.json")
  .then(r => r.json())
  .then(cfg => SETTINGS = cfg);

// --- Elements ---
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

function renderShiftCodes(){
  if (!SETTINGS) return;
  const dayName = toDayName(dateEl.value);
  const shift = shiftEl.value;
  const codes = (SETTINGS.shift_schedule?.[shift]?.[dayName]) || [];
  codesEl.innerHTML = `Shifts for <b>${dayName}</b> — <b>${shift}</b>: ${codes.map(c=>`<code>${c}</code>`).join(" ")}`;
}

// --- Helpers ---
function toDayName(isoDate){
  if (!isoDate) return "Monday";
  return new Date(isoDate+"T00:00:00").toLocaleDateString("en-US",{weekday:"long"});
}
function first2(s){ return (s||"").slice(0,2); }
function firstAndThird(s){ return (s?.length>=3) ? s[0]+s[2] : ""; }

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

function normalizePresent(val){
  if (val == null) return false;
  const s = String(val).trim().toUpperCase();
  return SETTINGS.present_markers.includes(s);
}

function parseRosterDatestr(s){
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// --- Main processing ---
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
    const [roster, mytimeRaw] = await Promise.all([
      parseCSVFile(rosterEl.files[0], {header:true}),
      parseCSVFile(mytimeEl.files[0], {header:true, skipFirstLine:true})
    ]);

    const canon = s => (s||"").toString().trim().toLowerCase();
    const mt = mytimeRaw.map(r => {
      let person = r["Person ID"] ?? r[Object.keys(r).find(k=>canon(k)==="person id")];
      let onPrem = r["On Premises"] ?? r[Object.keys(r).find(k=>canon(k)==="on premises")];
      return { person: String(person||"").trim(), onPrem: normalizePresent(onPrem) };
    }).filter(x => x.person);

    const onPremMap = new Map(mt.map(x => [x.person, x.onPrem]));

    const rosterEnriched = roster.map(r => {
      const empId  = String(r["Employee ID"] ?? "").trim();
      const deptId = String(r["Department ID"] ?? "").trim();
      const areaId = String(r["Management Area ID"] ?? "").trim();
      const empType= String(r["Employment Type"] ?? "").trim().toUpperCase();
      const sp     = String(r["Shift Pattern"] ?? "");
      const corner = first2(sp);
      const met    = firstAndThird(sp);
      const start  = parseRosterDatestr(r["Employment Start Date"]);
      const onPrem = onPremMap.get(empId) === true;
      return { empId, deptId, areaId, empType, sp, corner, met, start, onPrem };
    });

    let filtered = rosterEnriched.filter(x => codes.includes(x.corner));

    if (newHireEl.checked){
      const dayStart = new Date(dateEl.value+"T00:00:00");
      filtered = filtered.filter(x => {
        if (!x.start) return true;
        const diffDays = Math.floor((dayStart - x.start)/(1000*60*60*24));
        return diffDays >= 3;
      });
    }

    const cfg = SETTINGS.departments;
    const groups = {
      Inbound: filtered.filter(x => cfg.Inbound.dept_ids.includes(x.deptId)),
      ICQA:    filtered.filter(x => cfg.ICQA.dept_ids.includes(x.deptId) && x.areaId === cfg.ICQA.management_area_id),
      CRETs:   filtered.filter(x => cfg.CRETs.dept_ids.includes(x.deptId) && x.areaId === cfg.CRETs.management_area_id)
    };

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
  } catch (err){
    console.error(err);
    fileStatus.textContent = "Error processing files. Check CSV headers and try again.";
    alert(err.message || "Error processing files.");
  }
});

function renderTables(expected, present){
  const header = `
    <thead><tr>
      <th>Department</th><th class="right">AMZN</th><th class="right">TEMP</th><th class="right">TOTAL</th>
    </tr></thead>`;

  const rowsExp = Object.entries(expected).map(([dept,vals]) => `
    <tr><td>${dept}</td><td class="right">${vals.AMZN}</td><td class="right">${vals.TEMP}</td><td class="right">${vals.TOTAL}</td></tr>
  `).join("");
  const totalsExp = sumBlock(expected);
  expectedTable.innerHTML = header + `<tbody>${rowsExp}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${totalsExp.AMZN}</td><td class="right">${totalsExp.TEMP}</td><td class="right">${totalsExp.TOTAL}</td></tr></tfoot>`;

  const rowsPre = Object.entries(present).map(([dept,vals]) => `
    <tr><td>${dept}</td><td class="right">${vals.AMZN}</td><td class="right">${vals.TEMP}</td><td class="right">${vals.TOTAL}</td></tr>
  `).join("");
  const totalsPre = sumBlock(present);
  presentTable.innerHTML = header + `<tbody>${rowsPre}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${totalsPre.AMZN}</td><td class="right">${totalsPre.TEMP}</td><td class="right">${totalsPre.TOTAL}</td></tr></tfoot>`;
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

