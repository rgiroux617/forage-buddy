// ForageBuddy app.js — baseline v2026-02-19-01

// ============================================================
// State (party + defaults)
// ============================================================

let party = [
  { name: "Ingvar",   con: 12 },
  { name: "Hackon the Maimed",   con: 14 },
  { name: "Lambort",  con: 11 },
  { name: "Rabiésman",con:  8 },
  { name: "Freya",    con:  5 },
  { name: "Astrid",   con: 12 },
  { name: "Inga",     con: 10 },
  { name: "Helga",    con: 17 },
  { name: "Magnus",   con:  6 },
  { name: "Knud",     con:  8 },
];

// Optional: pre-check some members (by name)
let defaultSelected = new Set(["Ingvar","Hackon the Maimed","Lambort","Rabiésman"]);

// Setting for Oracle "misuse" trigger (double pressing without changing states)
let hasChanged = true;     // start true so first press is normal
let repeatCount = 0;       // how many times pressed without changes
let isPremium = false;

// ============================================================
// Dice + randomness
// ============================================================

// --- Dice helpers ---
const d = (sides) => (Math.floor(Math.random() * sides) + 1);
const rollNd6 = (n) => { let s=0; for(let i=0;i<n;i++) s += d(6); return s; };
const roll1d4 = () => d(4);

// ============================================================
// Members table rendering
// ============================================================

// --- Build member rows ---
function renderMembersTable() {
  const membersTbody = document.querySelector("#membersTable tbody");
  membersTbody.innerHTML = "";

  party.forEach((m, idx) => {
    const tr = document.createElement("tr");

    if (idx < 4) {
      tr.classList.add("mainChar");
    }

    if (idx === 3) {
      tr.classList.add("mainDivider");
    }


    const tdPick = document.createElement("td");
    tdPick.className = "chk";
    const pick = document.createElement("input");
    pick.type = "checkbox";
    pick.checked = defaultSelected.has(m.name);
    pick.dataset.idx = idx;
    tdPick.appendChild(pick);

    const tdName = document.createElement("td");
    tdName.className = "name";
    tdName.textContent = m.name;

    const tdCon = document.createElement("td");
    tdCon.className = "con";
    tdCon.textContent = m.con;

    const tdSnare = document.createElement("td");
    tdSnare.className = "chk";
    const sn = document.createElement("input");
    sn.type = "checkbox";
    sn.dataset.snareIdx = idx;
    tdSnare.appendChild(sn);

    tr.append(tdPick, tdName, tdCon, tdSnare);

    if (membersTbody.children.length % 2 === 0) {
      tr.classList.add("band");
    }

    membersTbody.appendChild(tr);

  });
}

// ============================================================
// Small utilities
// ============================================================

function haptic(pattern = 20) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmt(x, digits = 2) {
  return (typeof x === "number") ? x.toFixed(digits) : "—";
}

function setStat(id, text) {
  const el = document.getElementById(id);
  if (!el) return;       // ← guard
  el.textContent = text;
}


function fitOracleText(spanEl, { maxPx = 24, minPx = 12 } = {}) {
  spanEl.style.setProperty("--oracleFont", `${maxPx}px`);

  if (!spanEl) return;

  // Clear any previous sizing so measurements are real
  spanEl.style.removeProperty("--oracleFont");

  // We rely on the span's own box: width:70%, max-height:80%, overflow:hidden (CSS)
  const fits = () =>
    spanEl.scrollWidth <= spanEl.clientWidth &&
    spanEl.scrollHeight <= spanEl.clientHeight;

  // Start at max
  spanEl.style.setProperty("--oracleFont", `${maxPx}px`);

  // If it already fits, done
  if (fits()) return;

  // Walk down (simple + reliable for small ranges)
  for (let px = maxPx - 1; px >= minPx; px--) {
    spanEl.style.setProperty("--oracleFont", `${px}px`);
    if (fits()) break;
  }
}

function setMonteCarloVisible(show) {
  // Your MC card is the one that contains the histogram canvas
  const canvas = document.getElementById("hist");
  const card = canvas?.closest(".sectionCard");
  if (!card) return;

  card.style.display = show ? "" : "none";
}


// ============================================================
// Selection + input helpers
// ============================================================

function getDifficultyDice() {
  const v = document.querySelector('input[name="difficulty"]:checked')?.value || "medium";
  if (v === "easy") return 2;
  if (v === "hard") return 4;
  return 3; // medium
}

function getDifficultyValue() {
  return document.querySelector('input[name="difficulty"]:checked')?.value || "medium";
}

function isHalfDay() {
  return (document.querySelector('input[name="day"]:checked')?.value || "full") === "half";
}

function hasSnare(idx) {
  return !!document.querySelector(`#membersTable input[type="checkbox"][data-snare-idx="${idx}"]`)?.checked;
}

function getSelectedTeam() {
  const picks = [...document.querySelectorAll('#membersTable input[type="checkbox"][data-idx]')];
  const selectedIdx = picks.filter(cb => cb.checked).map(cb => Number(cb.dataset.idx));
  const team = selectedIdx.map(idx => ({
    name: party[idx].name,
    con: party[idx].con,
    snare: hasSnare(idx)
  }));
  return { team, selectedIdx };
}

function updateNetActionButtons() {
  const net = Number(document.getElementById("netVal")?.textContent ?? NaN);

  const row = document.getElementById("netActionRow");
  const posBtn = document.getElementById("netPosBtn");
  const negBtn = document.getElementById("netNegBtn");
  if (!row || !posBtn || !negBtn) return;

  // Before a forage run (or invalid net): hide everything
  if (!Number.isFinite(net)) {
    row.hidden = true;
    posBtn.hidden = true;
    negBtn.hidden = true;
    return;
  }

  // After a forage run: show row and only the correct button
  row.hidden = false;
  if (net >= 0) {
    posBtn.hidden = false;
    negBtn.hidden = true;
  } else {
    posBtn.hidden = true;
    negBtn.hidden = false;
  }
}



// ============================================================
// Ported from Python: simulate_forager / simulate_day / run_monte_carlo
// ============================================================

function simulateForager(
  con,
  nd6,
  has_snare = false,
  half_day = false,
  item_as_ration = false,
  captureRolls = false
) {
  const con_eff = con + (has_snare ? 1 : 0);

  const total = rollNd6(nd6);
  const success = (total < con_eff);

  let cost_item = false;
  let cost_hp = false;

  const rolls = captureRolls ? [total] : null;

  const rollRations = () => (half_day ? Math.floor(roll1d4() / 2) : roll1d4());

  if (success) {
    const r = rollRations();
    return captureRolls
      ? { r, cost_item, cost_hp, success, rolls }
      : { r, cost_item, cost_hp };
  }

  const fail_roll = d(6);
  if (captureRolls) rolls.push(fail_roll);

  if (fail_roll <= 2) {
    const r = 0;
    return captureRolls
      ? { r, cost_item, cost_hp, success, rolls }
      : { r, cost_item, cost_hp };
  } else if (fail_roll <= 4) {
    cost_item = true;
    let r = rollRations();

    if (item_as_ration) {
      r = Math.max(0, r - 1);
      cost_item = false;
    }

    return captureRolls
      ? { r, cost_item, cost_hp, success, rolls }
      : { r, cost_item, cost_hp };
  } else {
    cost_hp = true;
    const r = rollRations();
    return captureRolls
      ? { r, cost_item, cost_hp, success, rolls }
      : { r, cost_item, cost_hp };
  }
}

function simulateDay(team, difficulty="medium", half_day=false, total_party_size=10, item_as_ration=false) {
  const nd6_by_diff = { easy: 2, medium: 3, hard: 4 };
  const nd6 = nd6_by_diff[difficulty] ?? 3;

  let gross = 0;
  let item_costs = 0;
  let hp_costs = 0;

  for (const member of team) {
    const out = simulateForager(member.con, nd6, !!member.snare, half_day, item_as_ration);
    gross += out.r;
    if (!item_as_ration) item_costs += out.cost_item ? 1 : 0;
    hp_costs += out.cost_hp ? 1 : 0;
  }

  const net = gross - total_party_size;
  return { gross, net, item_costs, hp_costs };
}

function percentile(sortedVals, p) {
  if (!sortedVals.length) return 0;
  const idx = Math.floor(p * (sortedVals.length - 1));
  return sortedVals[idx];
}

function runMonteCarlo(team, runs=20000, difficulty="medium", half_day=false, total_party_size=10, item_as_ration=false) {
  const gross_vals = new Array(runs);
  const net_vals   = new Array(runs);
  const hp_vals    = new Array(runs);
  const item_vals  = item_as_ration ? null : new Array(runs);

  for (let i=0;i<runs;i++) {
    const out = simulateDay(team, difficulty, half_day, total_party_size, item_as_ration);
    gross_vals[i] = out.gross;
    net_vals[i]   = out.net;
    hp_vals[i]    = out.hp_costs;
    if (item_vals) item_vals[i] = out.item_costs;
  }

  const sum = (arr) => arr.reduce((a,b)=>a+b,0);
  const avg = (arr) => sum(arr) / arr.length;

  const net_sorted = [...net_vals].sort((a,b)=>a-b);

  const res = {
    runs,
    avg_gross: avg(gross_vals),
    avg_net: avg(net_vals),
    p_break_even: net_vals.filter(x => x >= 0).length / runs,
    net_p10: percentile(net_sorted, 0.10),
    net_p50: percentile(net_sorted, 0.50),
    net_p90: percentile(net_sorted, 0.90),
    avg_hp_costs: avg(hp_vals),
    avg_item_costs: item_vals ? avg(item_vals) : null,
    net_vals
  };
  return res;
}

// ============================================================
// One-day UI (existing behavior)
// ============================================================

function clearOutput() {
  document.getElementById("outputBody").innerHTML = "";
  document.getElementById("grossVal").textContent = "0";
  document.getElementById("netVal").textContent = "0";
  updateNetActionButtons();
}

function addOutputRow({name, rollTag, result, rations, cost}) {
  const tr = document.createElement("tr");

  const tdRes = document.createElement("td");
  tdRes.className = "res";
  tdRes.innerHTML = result === "✓"
    ? '<span class="ok">✓</span>'
    : '<span class="bad">✗</span>';

  const tdName = document.createElement("td");
  tdName.innerHTML = `
    <div class="outName">${name}</div>
    <div class="outRolls">${rollTag}</div>
  `;


  const tdRat = document.createElement("td");
  tdRat.className = "rat";
  tdRat.textContent = rations;

  const tdCost = document.createElement("td");
  tdCost.className = "cost";
  tdCost.textContent = cost;

  tr.append(tdRes, tdName, tdRat, tdCost);

  const body = document.getElementById("outputBody");
  if (body.children.length % 2 === 0) {
    tr.classList.add("band");
  }
  body.appendChild(tr);

}

function runOneDayForageUI(team) {
  const diceCount = getDifficultyDice();
  const half = isHalfDay();
  const itemAsRation = document.getElementById("itemAsRation").checked;

  const rows = [];
  let gross = 0;

  for (const m of team) {
    const out = simulateForager(m.con, diceCount, !!m.snare, half, itemAsRation, true);

    const resultMark = out.success ? "✓" : "✗";

    let cost = "";
    if (out.cost_hp) cost = "-1HP";
    else if (out.cost_item && !itemAsRation) cost = "-1 item";
    // if itemAsRation is true, cost stays blank by design

    gross += out.r;

    rows.push({
      name: m.name,
      rollTag: `[${out.rolls.join(", ")}]`,
      result: resultMark,
      rations: out.r,
      cost
    });
  }

  const net = gross - party.length;
  return { rows, gross, net };
}

function runAndRenderMonteCarlo(team, opts = {}) {
  const highlightValue = Number.isFinite(opts.highlightValue) ? opts.highlightValue : null;
  const dayNet = Number.isFinite(opts.dayNet) ? opts.dayNet : null; // for sDayMood
  const animateOracle = !!opts.animateOracle;
  const suppressDisplay = !!opts.suppressDisplay;


  const runs = Math.max(
    100,
    Math.min(500000, Number(document.getElementById("mcRuns").value || 20000))
  );
  document.getElementById("mcRuns").value = String(runs);

  const difficulty = getDifficultyValue();
  const half = isHalfDay();
  const itemAsRation = document.getElementById("itemAsRation").checked;
  const totalPartySize = party.length;

  if (!team.length) {
    drawHistogramInt([], "hist");
    setStat("sBE", "—");
    setStat("sGN", "—");
    setStat("sIH", "—");
    document.getElementById("sDayMood").textContent = "";
    return null;
  }

  const res = runMonteCarlo(team, runs, difficulty, half, totalPartySize, itemAsRation);

  // If we're suppressing display, don't draw/update the MC UI.
  // (We still computed res so Oracle can use probabilities.)
  if (!suppressDisplay) {
    // Histogram (optional highlight)
    if (highlightValue !== null) {
      drawHistogramInt(res.net_vals, "hist", { highlightValue });
    } else {
      drawHistogramInt(res.net_vals, "hist");
    }

  // Stats
  setStat("sBE", (res.p_break_even * 100).toFixed(1) + "%");
  setStat("sGN", `${fmt(res.avg_gross, 2)} / ${fmt(res.avg_net, 2)}`);
  setStat(
    "sIH",
    `${(res.avg_item_costs == null ? "—" : fmt(res.avg_item_costs, 1))} / ${fmt(res.avg_hp_costs, 1)}`
  );
  }

  // Mood (and optional oracle animation)
  const mood = moodFromBank(res.p_break_even, repeatCount);
  setMood(mood.text, mood.color);
  styleBreakEven(mood.color);
  if (animateOracle) animateOracleButton(mood.text);

  // Optional “single-day” mood line (only when called from Forage)
  if (dayNet !== null) {
    const { mean, sd } = meanAndSD(res.net_vals);
    document.getElementById("sDayMood").textContent = dayOutcomeStmt(dayNet, mean, sd);
  } else {
    document.getElementById("sDayMood").textContent = "";
  }

  return res;
}

// ============================================================
// Histogram + stats UI
// ============================================================

function meanAndSD(vals) {
  if (!vals || !vals.length) return { mean: 0, sd: 0 };
  let sum = 0;
  for (const v of vals) sum += v;
  const mean = sum / vals.length;

  let ss = 0;
  for (const v of vals) {
    const d = v - mean;
    ss += d * d;
  }
  const sd = Math.sqrt(ss / vals.length); // population SD (matches your histogram)
  return { mean, sd };
}

function dayOutcomeStmt(net, mean, sd) {
  // Guard: if sd is 0 (all outcomes identical), treat as "within 1 SD"
  if (!Number.isFinite(sd) || sd <= 0) {
    return (net < mean) ? "stmt 2" : "stmt 3";
  }
  if (net < mean - sd) return "Y'all SHAT the bed";
  if (net < mean) return "The boys came up small";
  if (net <= mean + sd) return "Karvi crew got it done";
  return "Forage Beasts!";
}

function breakEvenMood(pct) {
  const p = pct * 100;
  if (p < 20) return { text: "Starvation Bros", color: "#b00020" };
  if (p < 40) return { text: "A few desperate souls", color: "#c2410c" };
  if (p < 50) return { text: "An overly optimistic bunch ", color: "#a16207" };
  if (p < 60) return { text: "A bare minimum group", color: "#0f766e" };
  if (p < 80) return { text: "Grinders", color: "#1f8f3a" };
  return { text: "Proper Dawgs", color: "#2563eb" };
}

// ============================================================
// Mood phrase bank (7 categories x 10 phrases)
// Categories 0-5 = your normal break-even buckets
// Category 6 = "insult mode" (used after repeat presses with no changes)
// ============================================================

const MOOD_BANK = [
  // 0: <20%
  [
    "Starvation Bros",
    "The hunger has hobbies now",
    "let me be clear: YOU ARE FUCKED",
    "Absolute famine behavior",
    "Calories? Never met her",
    "Straight Piss-babies",
    "Eventually your 'crew' will thin out",
    "I smell TPK",
    "Berries: 0, vibes: 0",
    "just walk out to sea"
  ],

  // 1: <40%
  [
    "Have you considered giving up?",
    "Barely keeping it together",
    "Ceasar's has you at +12000",
    "The bag is mostly air",
    "How about witness protection",
    "just walk out to sea",
    "RalphsinDanger.jpg",
    "you be illin",
    "some sorry ass shit, this.",
    "whatever, go die"
  ],

  // 2: <50%
  [
    "Ive seen worse but you suck",
    "Y'all an inch from the deep end",
    "You vs The Village People is close",
    "you havin a laugh?",
    "i won't laugh, but c'mon",
    "Might want to get yourself a real team",
    "Funky Cold Medina?",
    "Unlikely you even break even kid",
    "You must have no choice",
    "You draggin around invalids?"
  ],

  // 3: <60%
  [
    "Congrats on the bare minimum",
    "Just enough to avoid shame",
    "The floor is holding",
    "Sustained by spite",
    "Budget survival achieved",
    "Scavenger Energy",
    "Feels like a business decision",
    "The math says you ain't healthy",
    "Minimum viable foraging",
    "I hope this isn't everyone"
  ],

  // 4: <80%
  [
    "Grinders",
    "it might be enough",
    "realistic, but unimpressive",
    "Grab another 1HP dude (for luck)",
    "I see overperformers",
    "if you can't call the A Team...",
    "Not quite circling the drain",
    "Your Ad Here",
    "The party eats tonight, and maybe tomorrow",
    "Not bad for some pussy bitches"
  ],

  // 5: >=80%
  [
    "Proper Dawgs",
    "Elite bushcraft energy",
    "The forest is yours",
    "Absolute professionals",
    "A serious effort",
    "Pull the Trigger",
    "Worthy Crew",
    "Punch your Ticket",
    "Big rations Opportunity",
    "MAXIMUM RATIONS"
  ],

  // 6: insult mode (repeat presses w/ no changes)
  [
    "Back in 5 min...",
    "You really just pushing the button?",
    "Eat. A. Dick.",
    "Change something dipshit",
    "still fucked, same as before",
    "Sack up and Forage",
    "The button isn’t a strategy.",
    "I was wrong before, you're all set.",
    "Guzzle Bleach",
    "Buy Forage Buddy Premium!"
  ]
];

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function breakEvenCategory(pct) {
  const p = pct * 100;
  if (p < 20) return 0;
  if (p < 40) return 1;
  if (p < 50) return 2;
  if (p < 60) return 3;
  if (p < 80) return 4;
  return 5;
}

function moodFromBank(pct, repeatCount) {
  if (isPremium) {
    const base = breakEvenMood(pct);
    return { text: "see the Monte Carlo, mouthbreather", color: base.color };
  }

  const base = breakEvenMood(pct); // keep your existing color thresholds

  // 2nd click (no changes): fixed response
  if (repeatCount === 1) {
    return { text: "asked and answered SHITHEAD", color: base.color };
  }

  // 3rd+ click (no changes): random insults
  if (repeatCount >= 2) {
    return { text: pickOne(MOOD_BANK[6]), color: base.color };
  }

  // 1st click after a change: normal random phrase in the correct bucket
  const baseCat = breakEvenCategory(pct);
  return { text: pickOne(MOOD_BANK[baseCat]), color: base.color };
}


function setMood(text, color) {
  const el = document.getElementById("sMood");
  if (!el) return; // guard so removing #sMood doesn't break MC/Oracle
  el.textContent = text;
  el.style.color = color;
  el.style.fontWeight = "800";
  el.style.textAlign = "right";
}

function styleBreakEven(color) {
  const el = document.getElementById("sBE");
  if (!el) return;
  el.style.color = color;
  el.style.fontWeight = "800";
}

function drawHistogramInt(values, canvasId, opts = {}) {
  const highlightValue = Number.isFinite(opts.highlightValue) ? opts.highlightValue : null;
  const highlightFill = opts.highlightFill ?? "rgba(218,165,32,0.95)"; // gold
  const highlightStroke = opts.highlightStroke ?? "rgba(120,90,10,0.95)";

  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // Clear
  ctx.clearRect(0, 0, W, H);

  if (!values.length) return;

  // Count integer occurrences
  let min = values[0], max = values[0];
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }

  const span = (max - min + 1);
  const counts = new Array(span).fill(0);
  for (const v of values) counts[v - min]++;

  const maxCount = Math.max(...counts);

  // Mean + standard deviation (population)
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;

  let ss = 0;
  for (const v of values) {
    const d = v - mean;
    ss += d * d;
  }
  const sd = Math.sqrt(ss / values.length);

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpRGB(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
    ];
  }
  function rgbStr(rgb, alpha = 1) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }

  // Tune these three anchors
  const RED = [176, 0, 32];
  const WHITE = [245, 245, 245];
  const GREEN = [31, 143, 58];

  function colorForNet(netVal) {
    if (netVal === 0) return rgbStr(WHITE, 0.85);

    if (netVal < 0) {
      const denom = (0 - min) || 1;
      const t = (netVal - min) / denom;
      const rgb = lerpRGB(RED, WHITE, t);
      return rgbStr(rgb, 0.85);
    } else {
      const denom = (max - 0) || 1;
      const t = (netVal - 0) / denom;
      const rgb = lerpRGB(WHITE, GREEN, t);
      return rgbStr(rgb, 0.85);
    }
  }

  // Padding
  const padL = 44, padR = 14, padT = 14, padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Fill plot area background (white)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(padL, padT, plotW, plotH);

  // Axes
  ctx.strokeStyle = "rgba(11,34,57,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // Bars
  const barW = plotW / span;
  ctx.strokeStyle = "rgba(11,34,57,0.45)";
  ctx.lineWidth = 1;

  for (let i = 0; i < span; i++) {
    const c = counts[i];
    const h = (c / maxCount) * plotH;
    const x = padL + i * barW;
    const y = padT + plotH - h;

    const netVal = min + i;
    ctx.fillStyle = colorForNet(netVal);

    ctx.fillRect(x, y, Math.max(1, barW - 1), h);
    ctx.strokeRect(x, y, Math.max(1, barW - 1), h);
  }

  // Optional highlight overlay
  if (highlightValue !== null && highlightValue >= min && highlightValue <= max) {
    const hi = highlightValue - min;
    const c = counts[hi] ?? 0;
    const h = (c / maxCount) * plotH;
    const x = padL + hi * barW;
    const y = padT + plotH - h;

    ctx.save();
    ctx.fillStyle = highlightFill;
    ctx.strokeStyle = highlightStroke;
    ctx.lineWidth = 2;

    const w = Math.max(2, barW - 1);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  // Labels
  ctx.fillStyle = "rgba(11,34,57,0.75)";
  ctx.font = "600 28px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const yLab = padT + plotH + 6;

  const labelAt = (val) => {
    const i = val - min;
    if (i < 0 || i >= span) return;
    const x = padL + (i + 0.5) * barW;
    ctx.fillText(String(val), x, yLab);
  };

  labelAt(min);
  if (min <= 0 && 0 <= max) labelAt(0);
  labelAt(max);

  const sdMinus = Math.max(min, Math.min(max, Math.round(mean - sd)));
  const sdPlus  = Math.max(min, Math.min(max, Math.round(mean + sd)));

  ctx.fillStyle = "#b00020";
  labelAt(sdMinus);
  labelAt(sdPlus);

  ctx.fillStyle = "rgba(11,34,57,0.75)";
}

// ============================================================
// Member editor
// ============================================================

const memberEditor = document.getElementById("memberEditor");
const editTbody = document.getElementById("editTbody");

function openEditor() {
  const currentSelected = new Set(
    [...document.querySelectorAll('#membersTable input[type="checkbox"][data-idx]')]
      .filter(cb => cb.checked)
      .map(cb => party[Number(cb.dataset.idx)]?.name)
      .filter(Boolean)
  );

  editTbody.innerHTML = "";

  for (let i = 0; i < 15; i++) {
    const m = party[i] ?? { name: "", con: 10 };
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><input type="text" placeholder="Name" value="${escapeHtml(m.name)}" data-field="name"></td>
      <td class="center"><input type="number" min="1" max="25" value="${Number(m.con) || 10}" data-field="con"></td>
      <td class="center"><input type="checkbox" data-field="def"></td>
      <td class="center"><input type="checkbox" data-field="del"></td>
    `;

    const defCb = tr.querySelector('input[data-field="def"]');
    const nm = (m.name || "").trim();
    defCb.checked = nm ? (currentSelected.has(nm) || defaultSelected.has(nm)) : false;

    editTbody.appendChild(tr);
  }

  memberEditor.classList.add("open");
  memberEditor.setAttribute("aria-hidden", "false");
}

function closeEditor() {
  memberEditor.classList.remove("open");
  memberEditor.setAttribute("aria-hidden", "true");
}

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("open");
  modalEl.setAttribute("aria-hidden", "false");
}

function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove("open");
  modalEl.setAttribute("aria-hidden", "true");
}


function readEditorRows() {
  const rows = [...editTbody.querySelectorAll("tr")];

  return rows.map(row => ({
    name: row.querySelector('input[data-field="name"]').value.trim(),
    conRaw: row.querySelector('input[data-field="con"]').value,
    def: row.querySelector('input[data-field="def"]').checked,
    del: row.querySelector('input[data-field="del"]').checked
  }));
}

function buildPartyFromEditorRows(editorRows) {
  const newParty = [];
  const newDefault = new Set();

  for (const r of editorRows) {
    if (!r.name || r.del) continue;

    let con = Number(r.conRaw);
    if (!Number.isFinite(con)) con = 10;
    con = Math.max(1, Math.min(25, Math.round(con)));

    // de-dupe case-insensitively
    const nameLower = r.name.toLowerCase();
    if (newParty.some(x => x.name.toLowerCase() === nameLower)) continue;

    newParty.push({ name: r.name, con });

    if (r.def) newDefault.add(r.name);
  }

  return {
    party: newParty.slice(0, 15),
    defaultSelected: newDefault
  };
}

function applyEditor() {
  const editorRows = readEditorRows();
  const built = buildPartyFromEditorRows(editorRows);

  party = built.party;
  defaultSelected = built.defaultSelected;

  renderMembersTable();
  hasChanged = true;
  closeEditor();
}

// ============================================================
// Oracle animation
// ============================================================

function animateOracleButton(finalText) {
  const mcBtn = document.getElementById("mcBtn");
  const oracleSpan = mcBtn.querySelector(".btnOracle");

  // Guard (extra safety): if already running, do nothing
  if (mcBtn.dataset.busy === "1") return;

  // --- timings (match your 2s CSS transitions + your 3s hold) ---
  const CAST_MS = 3500;   // label dissolves out, runes dissolve in
  const REVEAL_MS = 3000; // hold final result
  const RETURN_MS = 2000; // dissolve back to label

  // --- rune scramble settings ---
  const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛋᛏᛒᛖᛗᛚᛜᛟᛞ";
  const SCRAMBLE_INTERVAL_MS = 120;

  // Lock button
  mcBtn.dataset.busy = "1";
  mcBtn.disabled = true;

  // Start casting state
  mcBtn.classList.remove("reveal");
  mcBtn.classList.add("casting");

  // Seed with rune-ish text immediately so something appears
  const targetLen = Math.max(8, Math.min(32, String(finalText).length));
  oracleSpan.textContent = makeRuneString(RUNES, targetLen);

  // Scramble runes during the casting phase
  const scrambleTimer = setInterval(() => {
    oracleSpan.textContent = makeRuneString(RUNES, targetLen);
  }, SCRAMBLE_INTERVAL_MS);

  // After CAST_MS, reveal the final text (crisp)
  setTimeout(() => {
    clearInterval(scrambleTimer);

    mcBtn.classList.remove("casting");
    mcBtn.classList.add("reveal");

    oracleSpan.textContent = String(finalText);
    fitOracleText(oracleSpan, { maxPx: 30, minPx: 12 });
  }, CAST_MS);

  // After hold, start return dissolve (hide result)
  setTimeout(() => {
    mcBtn.classList.remove("reveal");
    mcBtn.classList.add("casting"); // use casting to blur/fade the oracle layer out
  }, CAST_MS + REVEAL_MS);

  // After return dissolve, reset to idle
  setTimeout(() => {
    mcBtn.classList.remove("casting");
    oracleSpan.textContent = ""; // base CSS has opacity:0 for .btnOracle

    mcBtn.disabled = false;
    mcBtn.dataset.busy = "0";
  }, CAST_MS + REVEAL_MS + RETURN_MS);
}

function makeRuneString(runes, n) {
  let s = "";
  for (let i = 0; i < n; i++) {
    s += runes[Math.floor(Math.random() * runes.length)];
    if (i % 4 === 3 && i !== n - 1) s += " ";
  }
  return s;
}


// ============================================================
// Controllers (named event handlers)
// ============================================================

function onForageClick() {
  clearOutput();
  haptic(30);

  const { team } = getSelectedTeam();
  if (!team.length) return;

  const { rows, gross, net } = runOneDayForageUI(team);

  for (const row of rows) addOutputRow(row);

  document.getElementById("grossVal").textContent = String(gross);
  document.getElementById("netVal").textContent = String(net);

  updateNetActionButtons();



  // Scroll so the pressed button sits at the top
  const forageBtn = document.getElementById("forageBtn");
  const buttonTop = forageBtn.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: buttonTop, behavior: "smooth" });

  // Re-run MC and highlight today's net
  setMonteCarloVisible(true);
  runAndRenderMonteCarlo(team, { highlightValue: net, dayNet: net, animateOracle: false });
}

function onMcClick() {
  if (hasChanged) {
    repeatCount = 0;      // reset insult counter
    hasChanged = false;   // now system is "clean"
  } else {
    repeatCount++;        // user pressed again without changes
  }
  
  // Hide MC card unless premium
  setMonteCarloVisible(isPremium);

  const { team } = getSelectedTeam();
  runAndRenderMonteCarlo(team, { animateOracle: true });
}

function onEditMembersClick() {
  openEditor();
}

function onCloseEditorClick() {
  closeEditor();
}

function onCancelEditorClick() {
  closeEditor();
}

function onApplyEditorClick() {
  applyEditor();
}

function onEditorBackdropClick(e) {
  if (e.target === memberEditor) {
    closeEditor();
  }
}

function onNetInfoClick() {
  const net = Number(document.getElementById("netVal")?.textContent ?? NaN);
  if (!Number.isFinite(net)) return;

  const pos = document.getElementById("netModalPos");
  const neg = document.getElementById("netModalNeg");

  openModal(net >= 0 ? pos : neg);
}

function onNetAcceptClick() {

isPremium = true;

setMonteCarloVisible(true);

  // Play cash sound
  const cash = document.getElementById("cashSound");
  if (cash) {
    cash.currentTime = 0;  // rewind in case reused
    cash.play();
  }

  // Swap title block graphic
  const img = document.getElementById("titleBlockImg");
  if (img) img.src = "TitleBlockPremium.png";

  // Swap end block graphic
  const img2 = document.getElementById("endBlockImg");
  if (img2) img2.src = "EndBlockPremium.png";

  // Brighten the background (body uses var(--pageBg))
  document.documentElement.style.setProperty("--pageBg", "#5a4f0d"); // yellow-green

  // Close the positive modal
  closeModal(document.getElementById("netModalPos"));
}

function onNetPosBtnClick() {
  openModal(document.getElementById("netModalPos"));
}

function onNetNegBtnClick() {
  openModal(document.getElementById("netModalNeg"));
}



// ============================================================
// Wiring (event listeners)
// ============================================================

function wireUI() {
  document.getElementById("forageBtn").addEventListener("click", onForageClick);
  document.getElementById("mcBtn").addEventListener("click", onMcClick);

  document.getElementById("editMembersBtn").addEventListener("click", onEditMembersClick);
  document.getElementById("closeEditorBtn").addEventListener("click", onCloseEditorClick);
  document.getElementById("cancelEditorBtn").addEventListener("click", onCancelEditorClick);
  document.getElementById("applyEditorBtn").addEventListener("click", onApplyEditorClick);

  document.getElementById("netPosBtn")?.addEventListener("click", onNetPosBtnClick);
  document.getElementById("netNegBtn")?.addEventListener("click", onNetNegBtnClick);



  memberEditor.addEventListener("click", onEditorBackdropClick);

  // Any settings change resets the "misuse" trigger
  document.querySelectorAll('input[name="difficulty"]').forEach(r =>
    r.addEventListener("change", () => { hasChanged = true; })
  );

  document.querySelectorAll('input[name="day"]').forEach(r =>
    r.addEventListener("change", () => { hasChanged = true; })
  );

  //member selection or snare changes
  document
    .querySelector("#membersTable tbody")
    .addEventListener("change", (e) => {
      if (
        e.target.matches('input[type="checkbox"][data-idx]') ||
        e.target.matches('input[type="checkbox"][data-snare-idx]')
      ) {
        hasChanged = true;
      }
    });

  // Net modals: close buttons
  document.querySelectorAll(".netModalClose").forEach(btn => {
    btn.addEventListener("click", () => {
      closeModal(document.getElementById("netModalPos"));
      closeModal(document.getElementById("netModalNeg"));
    });
  });

  // Net modals: click outside closes
  ["netModalPos", "netModalNeg"].forEach(id => {
    const modal = document.getElementById(id);
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  document.getElementById("netAcceptBtn")?.addEventListener("click", onNetAcceptClick);

}

// ============================================================
// Startup
// ============================================================

renderMembersTable();
wireUI();


