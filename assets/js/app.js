"use strict";
/* =========================================================================
   Shelem scoreboard
   state  ->  derive()  ->  render() (structure) / paint() (numbers only)
   paint() never touches input values, so typing never loses the caret.
   ========================================================================= */

const KEY = "shelem.v2";
const LEGACY_KEY = "shelemScoreTable";
// Two house variants. A joker deck carries more card points, so the contract
// range AND the points available in one hand both change with the mode.
const MODES = {
  noJoker: { label: "بدون جوکر", min: 100, max: 165, total: 165 },
  joker:   { label: "با جوکر",   min: 120, max: 200, total: 200 }
};
const DEFAULT_MODE = "noJoker";
const rules = m => MODES[m] || MODES[DEFAULT_MODE];
function contracts(m) {
  const r = rules(m), out = [];
  for (let c = r.min; c <= r.max; c += 5) out.push(c);
  return out;
}

/* ---------- helpers ---------- */
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
// A minus sign is bidi-neutral, so inside an RTL run it drifts to the right of
// the digits ("۱۲۰−"). Wrapping a negative number in an LTR isolate pins the
// sign on the left where it belongs, in the DOM and in copied text alike.
const LRI = "\u2066", PDI = "\u2069";
const fa = n => {
  const s = String(n).replace(/[-\u2212]/g, "\u2212").replace(/\d/g, d => FA_DIGITS[+d]);
  return s.indexOf("\u2212") === 0 ? LRI + s + PDI : s;
};
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// accepts Persian/Arabic digits and a leading minus
function normalizeDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[−–—]/g, "-")
    .replace(/[^\d-]/g, "")
    .replace(/(?!^)-/g, "");
}
const num = v => {
  const n = parseInt(normalizeDigits(v), 10);
  return Number.isFinite(n) ? n : 0;
};
const filled = v => normalizeDigits(v).replace("-", "") !== "";

/* ---------- state ---------- */
const newHand = m => ({ id: uid(), d: "", c: rules(m).min, a: "", b: "" });

const blankState = () => ({
  v: 2,
  nameA: "تیم آ",
  nameB: "تیم ب",
  target: 1200,
  rule: "contract",          // "contract" | "actual"
  mode: DEFAULT_MODE,          // "noJoker" | "joker"
  hands: [newHand(DEFAULT_MODE)]
});

let state = blankState();
let undoStack = [];
let openCalc = null;         // id of the hand whose assist calculator is open

function snapshot() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 40) undoStack.shift();
  syncUndoBtn();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  state = JSON.parse(prev);
  openCalc = null;
  save(); render(); syncUndoBtn();
  toast("برگردانده شد");
}
const syncUndoBtn = () => { $("btnUndo").disabled = undoStack.length === 0; };

/* ---------- persistence ---------- */
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.hands)) return migrate(d);
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy);
      const s = blankState();
      if (old.targetScore) s.target = num(old.targetScore) || s.target;
      if (Array.isArray(old.rows) && old.rows.length) {
        s.hands = old.rows.map(r => ({
          id: uid(),
          d: r.ruler === "A" || r.ruler === "B" ? r.ruler : "",
          c: clamp(num(r.commit) || 100, MODES.noJoker.min, MODES.noJoker.max),
          a: legacyNum(r.scoreA),
          b: legacyNum(r.scoreB)
        }));
      }
      return s;
    }
  } catch (e) {}
  return blankState();
}
// the old table stored free-form numbers; keep blanks blank, round the rest
function legacyNum(v) {
  if (v === undefined || v === null || String(v).trim() === "") return "";
  const n = parseFloat(String(v).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  return Number.isFinite(n) ? String(Math.round(n)) : "";
}
function migrate(d) {
  const s = blankState();
  s.nameA = d.nameA || s.nameA;
  s.nameB = d.nameB || s.nameB;
  s.target = num(d.target) || s.target;
  s.rule = d.rule === "actual" ? "actual" : "contract";
  s.mode = d.mode === "joker" ? "joker" : DEFAULT_MODE;
  const mr = rules(s.mode);
  s.hands = d.hands.length
    ? d.hands.map(h => ({
        id: h.id || uid(),
        d: h.d === "A" || h.d === "B" ? h.d : "",
        c: clamp(num(h.c) || mr.min, mr.min, mr.max),
        a: normalizeDigits(h.a ?? ""),
        b: normalizeDigits(h.b ?? "")
      }))
    : [newHand(s.mode)];
  return s;
}

/* ---------- derived values ---------- */
function derive() {
  let ra = 0, rb = 0, winner = null, winAt = -1;
  const rows = state.hands.map((h, i) => {
    const a = num(h.a), b = num(h.b);
    ra += a; rb += b;
    const row = { h, i, a, b, ra, rb, played: filled(h.a) || filled(h.b), note: noteFor(h, a, b) };
    if (winner === null && (ra >= state.target || rb >= state.target) && ra !== rb) {
      winner = ra > rb ? "A" : "B";
      winAt = i;
    }
    return row;
  });
  return { rows, ra, rb, diff: ra - rb, winner, winAt };
}

// Non-blocking sanity check on a hand's two numbers.
function noteFor(h, a, b) {
  if (!filled(h.a) && !filled(h.b)) return null;
  if (!h.d) return { t: "warn", m: "حاکم این دست انتخاب نشده" };
  const dScore = h.d === "A" ? a : b;
  const oScore = h.d === "A" ? b : a;
  if (dScore > 0 && dScore < h.c && state.rule === "contract")
    return { t: "warn", m: `امتیاز حاکم از تعهد (${fa(h.c)}) کمتر است، یعنی سوخته و باید منفی باشد` };
  if (dScore === -h.c) return { t: "bad", m: "تعهد سوخت" };
  if (dScore >= h.c) return { t: "ok", m: "تعهد انجام شد" };
  if (oScore > rules(state.mode).total)
    return { t: "warn", m: `امتیاز یک دست بیشتر از ${fa(rules(state.mode).total)} نمی‌شود` };
  return null;
}

// The assist calculator: declarer's collected card points -> both hand scores.
function computeHand(h, collected) {
  const total = rules(state.mode).total;
  const p = clamp(collected, 0, total);
  const made = p >= h.c;
  const declarer = made ? (state.rule === "actual" ? p : h.c) : -h.c;
  const opponent = total - p;
  return h.d === "A" ? { a: declarer, b: opponent } : { a: opponent, b: declarer };
}

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const handsEl = $("hands");

const ICON = {
  calc: '<svg viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="12" y1="16" x2="12" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
};

const PIPS = ["♠", "♥", "♦", "♣"];

function render() {
  handsEl.innerHTML = "";

  if (!state.hands.length) {
    handsEl.innerHTML =
      '<div class="empty"><span class="glyph">♠ ♥ ♦ ♣</span>هنوز دستی ثبت نشده است.<br>با دکمه «دست جدید» شروع کنید.</div>';
    paint();
    return;
  }

  const frag = document.createDocumentFragment();
  state.hands.forEach((h, i) => frag.appendChild(handCard(h, i)));
  handsEl.appendChild(frag);
  paint();
}

function handCard(h, i) {
  const el = document.createElement("article");
  el.className = "hand";
  el.dataset.id = h.id;

  const r = rules(state.mode);
  const opts = contracts(state.mode)
    .map(c => `<option value="${c}"${c === h.c ? " selected" : ""}>${fa(c)}${c === r.max ? " (شلم)" : ""}</option>`)
    .join("");

  el.innerHTML = `
    <div class="index" aria-hidden="true">
      <span class="n">${fa(i + 1)}</span>
      <span class="pip">${PIPS[i % 4]}</span>
    </div>
    <div class="hand-body">
      <div class="hand-top">
        <div class="field">
          <span class="lbl">حاکم</span>
          <div class="seg" role="group" aria-label="حاکم دست ${fa(i + 1)}">
            <button type="button" data-d="A" aria-pressed="${h.d === "A"}">${escapeHtml(state.nameA)}</button>
            <button type="button" data-d="B" aria-pressed="${h.d === "B"}">${escapeHtml(state.nameB)}</button>
          </div>
        </div>
        <div class="field">
          <span class="lbl">تعهد</span>
          <select class="contract" aria-label="تعهد دست ${fa(i + 1)}">${opts}</select>
        </div>
        <span class="spacer"></span>
        <button type="button" class="mini" data-act="calc" aria-pressed="${openCalc === h.id}" aria-label="محاسبه‌گر امتیاز">${ICON.calc}</button>
        <button type="button" class="mini danger" data-act="del" aria-label="حذف دست ${fa(i + 1)}">${ICON.trash}</button>
      </div>

      <div class="scores">
        <div class="score a">
          <span class="cap">${escapeHtml(state.nameA)}</span>
          <input type="text" inputmode="numeric" data-t="a" value="${escapeHtml(h.a)}" placeholder="۰" aria-label="امتیاز ${escapeHtml(state.nameA)} در دست ${fa(i + 1)}" />
          <span class="run">جمع: <b class="run-a">۰</b></span>
        </div>
        <div class="score b">
          <span class="cap">${escapeHtml(state.nameB)}</span>
          <input type="text" inputmode="numeric" data-t="b" value="${escapeHtml(h.b)}" placeholder="۰" aria-label="امتیاز ${escapeHtml(state.nameB)} در دست ${fa(i + 1)}" />
          <span class="run">جمع: <b class="run-b">۰</b></span>
        </div>
      </div>

      <div class="slot-calc"></div>
      <div class="slot-note"></div>
    </div>`;

  if (openCalc === h.id) el.querySelector(".slot-calc").appendChild(calcPanel(h));
  return el;
}

function calcPanel(h) {
  const box = document.createElement("div");
  box.className = "calc";
  const who = h.d === "A" ? state.nameA : h.d === "B" ? state.nameB : "حاکم";
  box.innerHTML = `
    <span class="lbl">امتیاز جمع‌شده‌ی ${escapeHtml(who)}:</span>
    <input type="text" inputmode="numeric" data-act="calc-in" value="" placeholder="۰" aria-label="امتیاز جمع‌شده حاکم" />
    <button type="button" class="apply" data-act="calc-go">پر کن</button>
    <span class="hint">${
      h.d
        ? `تعهد ${fa(h.c)}: ${state.rule === "actual"
            ? "در صورت بردن، امتیاز واقعی ثبت می‌شود"
            : "در صورت بردن، به اندازه‌ی تعهد ثبت می‌شود"}؛ در صورت سوختن ${fa(-h.c)}. سهم حریف: ${fa(rules(state.mode).total)} منهای امتیاز حاکم.`
        : "اول حاکم این دست را انتخاب کنید."
    }</span>`;
  return box;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- paint: numbers, states, banner (no input rewrites) ---------- */
function paint() {
  const d = derive();
  const cards = handsEl.querySelectorAll(".hand");

  d.rows.forEach((row, i) => {
    const card = cards[i];
    if (!card) return;
    card.querySelector(".run-a").textContent = fa(row.ra);
    card.querySelector(".run-b").textContent = fa(row.rb);
    card.classList.toggle("win", d.winAt === i);
    card.classList.toggle("past", d.winAt !== -1 && i > d.winAt);

    const slot = card.querySelector(".slot-note");
    if (row.note) {
      slot.innerHTML = `<div class="note ${row.note.t === "ok" ? "ok" : row.note.t === "bad" ? "bad" : ""}">${escapeHtml(row.note.m)}</div>`;
    } else slot.innerHTML = "";
  });

  $("totalA").textContent = fa(d.ra);
  $("totalB").textContent = fa(d.rb);
  $("diff").textContent = fa(Math.abs(d.diff));
  $("diff").className = "diff num " + (d.diff > 0 ? "pos" : d.diff < 0 ? "neg" : "");
  $("targetLabel").textContent = fa(state.target);

  $("sideA").classList.toggle("lead", d.diff > 0);
  $("sideB").classList.toggle("lead", d.diff < 0);

  const togo = (v, el) => {
    const left = state.target - v;
    el.textContent = left > 0 ? `${fa(left)} امتیاز تا هدف` : "به هدف رسید";
  };
  togo(d.ra, $("togoA"));
  togo(d.rb, $("togoB"));

  $("barA").style.width = clamp((d.ra / state.target) * 100, 0, 100) + "%";
  $("barB").style.width = clamp((d.rb / state.target) * 100, 0, 100) + "%";

  const slot = $("bannerSlot");
  if (d.winner) {
    const name = d.winner === "A" ? state.nameA : state.nameB;
    const score = d.winner === "A" ? d.ra : d.rb;
    slot.innerHTML = `<div class="banner"><span class="crown">♛</span><div class="txt">
      <strong>${escapeHtml(name)} برنده شد</strong>
      <span>در دست ${fa(d.winAt + 1)} با ${fa(score)} امتیاز از ${fa(state.target)}</span>
    </div></div>`;
  } else slot.innerHTML = "";
}

/* ---------- actions ---------- */
function addHand() {
  snapshot();
  const last = state.hands[state.hands.length - 1];
  const h = newHand(state.mode);
  if (last) h.c = last.c;                       // contracts usually stay in the same range
  state.hands.push(h);
  save(); render();
  const card = handsEl.lastElementChild;
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.querySelector('.seg button[data-d="A"]').focus();
  }
}

function deleteHand(id) {
  snapshot();
  state.hands = state.hands.filter(h => h.id !== id);
  if (openCalc === id) openCalc = null;
  save(); render();
  toast("دست حذف شد، قابل بازگردانی است");
}

function resetGame() {
  snapshot();
  const keep = {
    nameA: state.nameA, nameB: state.nameB,
    target: state.target, rule: state.rule, mode: state.mode
  };
  state = Object.assign(blankState(), keep);
  state.hands = [newHand(state.mode)];
  openCalc = null;
  save(); render();
  toast("بازی پاک شد، قابل بازگردانی است");
}

// Switching mode changes the legal contract range, so clamp what is already
// on the table into the new range instead of leaving impossible bids behind.
function setMode(m) {
  if (!MODES[m] || state.mode === m) return;
  snapshot();
  state.mode = m;
  const r = rules(m);
  let moved = 0;
  state.hands.forEach(h => {
    const c = clamp(h.c, r.min, r.max);
    if (c !== h.c) { h.c = c; moved++; }
  });
  save(); render(); syncModeUI();
  toast(moved ? `حالت ${r.label}: ${fa(moved)} تعهد اصلاح شد` : `حالت ${r.label}`);
}

function syncModeUI() {
  const r = rules(state.mode);
  $("modeChipText").textContent = `${r.label} · تعهد ${fa(r.min)} تا ${fa(r.max)}`;
  const hint = $("modeHint");
  if (hint) hint.textContent = `تعهد از ${fa(r.min)} تا ${fa(r.max)}، مجموع امتیاز هر دست ${fa(r.total)}`;
  document.querySelectorAll("[data-mode]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
}

function summary() {
  const d = derive();
  const lines = [
    "جدول امتیاز شلم",
    `${state.nameA} ${fa(d.ra)} : ${fa(d.rb)} ${state.nameB}`,
    `بازی تا ${fa(state.target)} امتیاز، حالت ${rules(state.mode).label}`,
    ""
  ];
  d.rows.forEach(r => {
    const who = r.h.d === "A" ? state.nameA : r.h.d === "B" ? state.nameB : "نامشخص";
    lines.push(`دست ${fa(r.i + 1)} | حاکم: ${who} (${fa(r.h.c)}) | ${fa(r.a)} : ${fa(r.b)} | جمع ${fa(r.ra)} : ${fa(r.rb)}`);
  });
  if (d.winner) lines.push("", `برنده: ${d.winner === "A" ? state.nameA : state.nameB}`);
  return lines.join("\n");
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.firstElementChild.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}

/* ---------- events: one delegated listener per type ---------- */
let saveTimer;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); };

const handOf = e => {
  const card = e.target.closest(".hand");
  return card ? state.hands.find(h => h.id === card.dataset.id) : null;
};

handsEl.addEventListener("input", e => {
  const h = handOf(e);
  if (!h) return;
  const t = e.target.dataset.t;
  if (t === "a" || t === "b") {
    const clean = normalizeDigits(e.target.value);
    if (clean !== e.target.value) {
      const pos = e.target.selectionStart - (e.target.value.length - clean.length);
      e.target.value = clean;
      try { e.target.setSelectionRange(pos, pos); } catch (err) {}
    }
    h[t] = clean;
    paint();
    saveSoon();
  }
});

handsEl.addEventListener("change", e => {
  const h = handOf(e);
  if (!h) return;
  if (e.target.classList.contains("contract")) {
    h.c = num(e.target.value);
    if (openCalc === h.id) render(); else paint();
    save();
  }
});

handsEl.addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const h = handOf(e);
  if (!h) return;

  if (btn.dataset.d) {
    h.d = h.d === btn.dataset.d ? "" : btn.dataset.d;
    btn.closest(".seg").querySelectorAll("button")
      .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.d === h.d)));
    if (openCalc === h.id) render(); else paint();
    save();
    return;
  }

  const act = btn.dataset.act;
  if (act === "del") { deleteHand(h.id); return; }

  if (act === "calc") {
    openCalc = openCalc === h.id ? null : h.id;
    render();
    if (openCalc === h.id) {
      const card = handsEl.querySelector(`.hand[data-id="${h.id}"]`);
      card && card.querySelector('[data-act="calc-in"]').focus();
    }
    return;
  }

  if (act === "calc-go") {
    const card = handsEl.querySelector(`.hand[data-id="${h.id}"]`);
    const input = card.querySelector('[data-act="calc-in"]');
    if (!h.d) { toast("اول حاکم این دست را انتخاب کنید"); return; }
    if (!filled(input.value)) { toast("امتیاز جمع‌شده‌ی حاکم را وارد کنید"); return; }
    snapshot();
    const res = computeHand(h, num(input.value));
    h.a = String(res.a); h.b = String(res.b);
    openCalc = null;
    save(); render();
    toast("امتیازهای دست پر شد");
  }
});

handsEl.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.dataset.act === "calc-in") {
    e.preventDefault();
    e.target.closest(".calc").querySelector('[data-act="calc-go"]').click();
  }
});

/* team names: inline on the board and in settings, kept in sync */
function setName(which, value) {
  const v = value.trim() || (which === "A" ? "تیم آ" : "تیم ب");
  state[which === "A" ? "nameA" : "nameB"] = v;
  save();
  render();
  $("nameA").value = state.nameA;
  $("nameB").value = state.nameB;
  $("setNameA").value = state.nameA;
  $("setNameB").value = state.nameB;
}
$("nameA").addEventListener("change", e => setName("A", e.target.value));
$("nameB").addEventListener("change", e => setName("B", e.target.value));
$("nameA").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
$("nameB").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });

/* dock */
$("btnAdd").addEventListener("click", addHand);
$("btnUndo").addEventListener("click", undo);
$("btnCopy").addEventListener("click", async () => {
  const text = summary();
  try {
    await navigator.clipboard.writeText(text);
    toast("خلاصه بازی کپی شد");
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("خلاصه بازی کپی شد"); }
    catch (e2) { toast("کپی ممکن نشد"); }
    ta.remove();
  }
});

/* settings sheet */
const sheet = $("sheet");
$("btnSettings").addEventListener("click", () => {
  $("setTarget").value = state.target;
  $("setNameA").value = state.nameA;
  $("setNameB").value = state.nameB;
  sheet.querySelectorAll("[data-rule]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.rule === state.rule)));
  syncModeUI();
  sheet.showModal();
});
$("btnClose").addEventListener("click", () => sheet.close());
sheet.querySelectorAll("[data-mode]").forEach(b =>
  b.addEventListener("click", () => setMode(b.dataset.mode)));
sheet.addEventListener("click", e => { if (e.target === sheet) sheet.close(); });

$("setTarget").addEventListener("change", e => {
  const v = num(e.target.value);
  state.target = v >= 100 ? v : 1200;
  e.target.value = state.target;
  save(); paint();
});
$("setNameA").addEventListener("change", e => setName("A", e.target.value));
$("setNameB").addEventListener("change", e => setName("B", e.target.value));
sheet.querySelectorAll("[data-rule]").forEach(b =>
  b.addEventListener("click", () => {
    state.rule = b.dataset.rule;
    sheet.querySelectorAll("[data-rule]").forEach(x =>
      x.setAttribute("aria-pressed", String(x.dataset.rule === state.rule)));
    save();
    if (openCalc) render(); else paint();
  }));
/* clearing the board is destructive, so the click only opens a confirmation.
   Nothing is wiped until the user accepts a second time, and Cancel holds
   focus so a stray Enter can never clear the table. */
const confirmSheet = $("confirmSheet");
function askReset() {
  if (sheet.open) sheet.close();
  confirmSheet.showModal();
  $("btnConfirmNo").focus();
}
$("btnResetDock").addEventListener("click", askReset);
$("btnReset").addEventListener("click", askReset);
$("btnConfirmNo").addEventListener("click", () => confirmSheet.close());
$("btnConfirmYes").addEventListener("click", () => {
  confirmSheet.close();
  resetGame();
});
confirmSheet.addEventListener("click", e => { if (e.target === confirmSheet) confirmSheet.close(); });

/* keyboard */
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addHand(); }
});

/* ---------- boot ---------- */
state = load();
$("nameA").value = state.nameA;
$("nameB").value = state.nameB;
render();
syncModeUI();
syncUndoBtn();
