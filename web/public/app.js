// Ekomino HR Panel — front end (vanilla JS, no build step). Texts come from i18n.js via t().
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const SUB_SCORES = [
  ["education", 20],
  ["technical", 35],
  ["experience", 25],
  ["language", 10],
  ["projects", 10],
];

let candidates = [];
let stats = null;
let openId = null;
let drawerDirty = false;

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const locale = () => (LANG === "tr" ? "tr-TR" : "en-GB");
const secs = (ms) => {
  if (ms == null) return "–";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`;
};
const time = (iso) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
const money = (n) => `₺${n.toLocaleString(locale(), { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
const fmtMin = (m) =>
  m >= 60
    ? `${(m / 60).toLocaleString(locale(), { maximumFractionDigits: 1 })} ${t("hour")}`
    : `${m.toLocaleString(locale(), { maximumFractionDigits: m < 10 ? 1 : 0 })} ${t("min")}`;
const status = (s) => t(`s_${s}`);

function chip(decision) {
  if (decision === "processing") return `<span class="chip processing"><span class="spinner"></span>${t("d_processing")}</span>`;
  return `<span class="chip ${decision}">${esc(t(`d_${decision}`))}</span>`;
}
function approvalChip(c) {
  if (!c.approval_status) return `<span class="muted">—</span>`;
  const cls = { Pending: "pending", Approved: "ok", Rejected: "no", "Timed out": "no" }[c.approval_status] || "";
  return `<span class="chip ${cls}">${esc(status(c.approval_status))}</span>`;
}
function mailChip(c) {
  if (!c.mail_status) return `<span class="muted">—</span>`;
  const cls = { Sent: "ok", "Not sent": "no", "Draft created": "pending" }[c.mail_status] || "";
  return `<span class="chip ${cls}">${esc(status(c.mail_status))}</span>`;
}
function scoreColor(score) {
  if (score == null) return "var(--gray-soft)";
  if (score >= 75) return "var(--green-soft)";
  if (score >= 60) return "var(--blue-soft)";
  return "var(--gray-soft)";
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function confirmDialog(text) {
  return new Promise((resolve) => {
    $("#confirmText").textContent = text;
    $("#confirm").classList.remove("hidden");
    const done = (v) => {
      $("#confirm").classList.add("hidden");
      $("#confirmYes").onclick = $("#confirmNo").onclick = null;
      resolve(v);
    };
    $("#confirmYes").onclick = () => done(true);
    $("#confirmNo").onclick = () => done(false);
  });
}

// ---------- navigation & language ----------
function show(view) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  try { localStorage.setItem("ekomino-tab", view); } catch {}
}
$$(".tab").forEach((b) => (b.onclick = () => show(b.dataset.view)));
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) {
    e.preventDefault();
    show(g.dataset.goto);
  }
  const l = e.target.closest("[data-lang]");
  if (l) setLang(l.dataset.lang);
});
document.addEventListener("langchange", () => {
  renderAll();
  refreshSlow();
});

// ---------- data ----------
async function refresh() {
  try {
    const [c, s] = await Promise.all([fetch("/api/candidates").then((r) => r.json()), fetch("/api/stats").then((r) => r.json())]);
    candidates = c;
    stats = s;
    renderAll();
  } catch (e) {
    console.error(e);
  }
}

function renderAll() {
  if (!stats) return;
  renderDashboard();
  renderTable();
  renderPerformance();
  if (openId && !drawerDirty) renderDrawer(openId);
}

async function refreshSlow() {
  try {
    const [links, alerts] = await Promise.all([fetch("/api/links").then((r) => r.json()), fetch("/api/alerts").then((r) => r.json())]);
    $("#n8nStatus").className = `dot ${links.n8n ? "ok" : "down"}`;
    $("#n8nStatus").title = links.n8n ? t("n8nUp") : t("n8nDown");
    $("#n8nLink").href = links.n8n_url;
    $("#mailLink").href = links.mailpit_url;
    $("#alerts").innerHTML = alerts.length
      ? alerts.map((a) => `<div>${time(a.created_at)} · <b>${esc(a.source)}</b> · ${esc(a.message)}</div>`).join("")
      : `<div>${t("noAlerts")}</div>`;
  } catch {}
}

// ---------- dashboard ----------
function renderDashboard() {
  const d = stats.decisions;
  $("#kTotal").textContent = stats.total - stats.processing;
  $("#kProcessing").textContent = stats.processing ? t("inProgress", { n: stats.processing }) : t("allDone");
  $("#kInterview").textContent = d.interview;
  $("#kConsider").textContent = d.consider;
  $("#kReject").textContent = d.reject;
  $("#kManual").textContent = d.manual_review;
  $("#kAvg").textContent = secs(stats.avg_processing_ms);

  const pending = candidates.filter((c) => c.awaiting_approval);
  $("#pendingBadge").textContent = pending.length;
  $("#pendingBadge").classList.toggle("hidden", pending.length === 0);
  $("#pendingList").innerHTML = pending.length
    ? pending
        .map(
          (c) => `
      <div class="list-item" data-open="${c.id}">
        <span class="score" style="background:${scoreColor(c.score)}">${c.score ?? "–"}</span>
        <div class="grow"><b>${esc(c.candidate || c.file_name)}</b><small>${esc(c.strengths || "")}</small></div>
        <span class="chip pending">${t("review")}</span>
      </div>`
        )
        .join("")
    : `<div class="empty">${t("noPending")}</div>`;
}

// ---------- table ----------
function renderTable() {
  const f = $("#filter").value;
  const rows = candidates.filter((c) => !f || (f === "pending" ? c.awaiting_approval : c.decision === f));
  $("#emptyRows").classList.toggle("hidden", candidates.length > 0);
  $("#rows").innerHTML = rows
    .map(
      (c) => `
    <tr data-open="${c.id}">
      <td class="muted">${c.id}</td>
      <td><b>${esc(c.candidate || "—")}</b><small>${esc(c.file_name)}${c.source === "folder" ? ` · ${t("folder")}` : ""}</small></td>
      <td><span class="score" style="background:${scoreColor(c.score)}">${c.score ?? "–"}</span></td>
      <td>${chip(c.decision)}</td>
      <td>${approvalChip(c)}</td>
      <td>${mailChip(c)}</td>
      <td class="muted">${secs(c.processing_ms)}</td>
      <td class="muted">${time(c.uploaded_at)}</td>
    </tr>`
    )
    .join("");
}
$("#filter").onchange = renderTable;

document.addEventListener("click", (e) => {
  const row = e.target.closest("[data-open]");
  if (row) openDrawer(Number(row.dataset.open));
});

$("#resetBtn").onclick = async () => {
  if (!(await confirmDialog(t("resetConfirm")))) return;
  await fetch("/api/reset", { method: "POST" });
  toast(t("resetDone"));
  refresh();
};

// ---------- drawer ----------
function openDrawer(id) {
  openId = id;
  drawerDirty = false;
  renderDrawer(id);
  $("#drawer").classList.remove("hidden");
  $("#drawerBackdrop").classList.remove("hidden");
}
function closeDrawer() {
  openId = null;
  $("#drawer").classList.add("hidden");
  $("#drawerBackdrop").classList.add("hidden");
}
$("#drawerClose").onclick = closeDrawer;
$("#drawerBackdrop").onclick = closeDrawer;
document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

function renderDrawer(id) {
  const c = candidates.find((x) => x.id === id);
  if (!c) return;
  const done = c.decision !== "processing";
  const subs = SUB_SCORES.map(
    ([k, max]) => `
      <div class="sub"><span>${t(`sub_${k}`)}</span>
        <div class="track"><div class="fill" style="width:${Math.round(((c[k] ?? 0) / max) * 100)}%"></div></div>
        <span>${c[k] ?? "–"} / ${max}</span></div>`
  ).join("");

  let approval = "";
  if (c.awaiting_approval) {
    approval = `
      <div class="d-section approve-box">
        <h3 style="color:var(--brand)">${t("approvalNeeded")}</h3>
        <p class="meta">${t("approvalText", { to: esc(c.email || t("theCandidate")) })}</p>
        <div class="meta"><b>${t("subject")}</b> ${esc(c.mail_subject)}</div>
        <textarea id="mailBody">${esc(c.mail_body)}</textarea>
        <div class="approve-actions">
          <button class="btn success" id="approveBtn">${t("approveBtn")}</button>
          <button class="btn danger" id="rejectBtn">${t("rejectBtn")}</button>
        </div>
      </div>`;
  } else if (c.mail_body) {
    approval = `
      <div class="d-section">
        <h3>${t("invitationMail")}</h3>
        <div class="meta">${approvalChip(c)} ${mailChip(c)} ${c.mail_recipient ? `→ ${esc(c.mail_recipient)}` : ""} ${c.mail_sent_at ? `· ${time(c.mail_sent_at)}` : ""}</div>
        <div class="questions" style="margin-top:8px"><b>${esc(c.mail_subject)}</b>\n\n${esc(c.mail_body)}</div>
      </div>`;
  }

  const hasAiText = c.strengths || c.gaps || c.interview_questions;
  $("#drawerBody").innerHTML = `
    <div class="d-head">
      <div class="big-score" style="background:${scoreColor(c.score)}">${c.score ?? "–"}</div>
      <div>
        <h1 style="font-size:20px">${esc(c.candidate || c.file_name)}</h1>
        <div class="meta">${esc(c.email || t("noEmail"))} · ${chip(c.decision)}</div>
        <div class="meta">${esc(c.file_name)} · <a href="/api/candidates/${c.id}/cv" target="_blank" rel="noopener">${t("openCv")}</a></div>
      </div>
    </div>
    ${c.error ? `<div class="error-box"><b>${t("needsManual")}</b> ${esc(c.error)}</div>` : ""}
    ${!done ? `<p class="muted"><span class="spinner"></span> ${t("reading")}</p>` : ""}
    ${done && c.score != null ? `<div class="d-section"><h3>${t("scoreBreakdown")}</h3>${subs}</div>` : ""}
    ${c.strengths || c.gaps ? `<div class="d-section pairs">
        <div class="pair"><b>${t("strengths")}</b>${esc(c.strengths || "–")}</div>
        <div class="pair"><b>${t("gaps")}</b>${esc(c.gaps || "–")}</div></div>` : ""}
    ${c.interview_questions ? `<div class="d-section"><h3>${t("questions")}</h3><div class="questions">${esc(c.interview_questions)}</div></div>` : ""}
    ${approval}
    <div class="d-section meta">
      ${t("metaLine", { received: time(c.uploaded_at), processed: time(c.processed_at), time: secs(c.processing_ms) })}
      ${c.n8n_execution_id ? ` · ${t("execution", { id: esc(c.n8n_execution_id) })}` : ""}
      ${hasAiText && LANG !== "en" ? `<br>${t("aiNote")}` : ""}
    </div>`;

  const body = $("#mailBody");
  if (body) body.oninput = () => (drawerDirty = true);
  const send = async (action) => {
    $("#approveBtn").disabled = $("#rejectBtn").disabled = true;
    const r = await fetch(`/api/candidates/${c.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, mail_body: $("#mailBody").value }),
    });
    drawerDirty = false;
    if (!r.ok) {
      toast(r.status === 409 ? t("err409") : r.status === 502 ? t("err502") : t("errGeneric"));
      $("#approveBtn").disabled = $("#rejectBtn").disabled = false;
      return;
    }
    toast(action === "approve" ? t("toastApproved") : t("toastRejected"));
    setTimeout(refresh, 600);
    setTimeout(refresh, 2500);
  };
  if ($("#approveBtn")) {
    $("#approveBtn").onclick = () => send("approve");
    $("#rejectBtn").onclick = () => send("reject");
  }
}

// ---------- performance ----------
function renderPerformance() {
  const b = stats.baseline;
  const d = stats.decisions;
  const n = stats.total - stats.processing;
  const avgS = stats.avg_processing_ms ? stats.avg_processing_ms / 1000 : null;

  // AS-IS: an HR specialist reads every CV, types it into a spreadsheet, and for interview
  // candidates prepares questions and writes the invitation by hand.
  const asisPerCv = b.asis_read_cv_min + b.asis_record_min;
  const asisTotal = n * asisPerCv + d.interview * (b.asis_questions_min + b.asis_mail_min);
  // TO-BE: HR only reviews interview drafts (approve/edit) and still reads "consider" and
  // "manual review" CVs by hand. Everything else is done by the workflow.
  const tobeTotal = d.interview * b.tobe_review_min + (d.consider + d.manual_review) * b.asis_read_cv_min;
  const asisCost = (asisTotal / 60) * b.hr_hourly_cost_try;
  const tobeCost = (tobeTotal / 60) * b.hr_hourly_cost_try + n * b.ai_cost_per_cv_try;
  const asisThroughput = 60 / asisPerCv;
  const tobeThroughput = avgS ? Math.round((3600 / avgS) * (stats.queue?.concurrency || 1)) : null;
  const pct = (a, c) => (a > 0 ? Math.round((1 - c / a) * 100) : 0);

  $("#compare").innerHTML = n
    ? `
    <div class="cmp"><span>${t("cmpTime")}</span><div class="before">${t("cmpManual", { v: fmtMin(asisPerCv) })}</div>
      <strong>${secs(stats.avg_processing_ms)}</strong><div class="gain">${avgS ? t("cmpFaster", { n: Math.round((asisPerCv * 60) / avgS) }) : ""}</div></div>
    <div class="cmp"><span>${t("cmpHr", { n })}</span><div class="before">${fmtMin(asisTotal)}</div>
      <strong>${fmtMin(tobeTotal)}</strong><div class="gain">−${pct(asisTotal, tobeTotal)}%</div></div>
    <div class="cmp"><span>${t("cmpCost", { n })}</span><div class="before">${money(asisCost)}</div>
      <strong>${money(tobeCost)}</strong><div class="gain">−${pct(asisCost, tobeCost)}%</div></div>
    <div class="cmp"><span>${t("cmpCap")}</span><div class="before">${t("cmpCapBefore", { n: asisThroughput.toFixed(0) })}</div>
      <strong>${tobeThroughput ?? "–"}</strong><div class="gain">${t("cmpErrors", { n: Math.round(b.asis_error_rate * 100) })}</div></div>`
    : `<p class="empty">${t("cmpEmpty")}</p>`;

  const maxT = Math.max(asisPerCv * 60, avgS || 0);
  $("#timeBars").innerHTML = `
    <div class="bar-row"><span>${t("barManual")}</span><div class="track"><div class="fill gray" style="width:100%"></div></div><span>${fmtMin(asisPerCv)}</span></div>
    <div class="bar-row"><span>${t("barAuto")}</span><div class="track"><div class="fill green" style="width:${avgS ? Math.max(1, (avgS / maxT) * 100) : 0}%"></div></div><span>${secs(stats.avg_processing_ms)}</span></div>
    <p class="meta">${t("timeNote")}</p>`;

  const dist = [
    ["d_interview", d.interview, "green"],
    ["d_consider", d.consider, "blue"],
    ["d_reject", d.reject, "gray"],
    ["d_manual_review", d.manual_review, "amber"],
  ];
  const maxD = Math.max(1, ...dist.map((x) => x[1]));
  $("#distBars").innerHTML = dist
    .map(([k, v, c]) => `<div class="bar-row"><span>${t(k)}</span><div class="track"><div class="fill ${c}" style="width:${(v / maxD) * 100}%"></div></div><span>${v}</span></div>`)
    .join("");

  // --- step-by-step explanation with the live numbers ---
  const num = (v) => v.toLocaleString(locale(), { maximumFractionDigits: 2 });
  const step = (title, text, formula, result) => `
    <div class="calc-step"><b class="t">${title}</b>${text}
      <code>${esc(formula)}</code>
      ${result ? `<div class="res">${t("calcResult", { r: result })}</div>` : ""}</div>`;
  if (!n) {
    $("#explainCalc").innerHTML = `<p class="empty">${t("calcEmpty")}</p>`;
  } else {
    const k = stats.queue?.concurrency || 1;
    $("#explainCalc").innerHTML = [
      step(t("calc1Title", { n }), t("calc1Text"),
        t("calc1Formula", { n, a: num(b.asis_read_cv_min), b: num(b.asis_record_min), i: d.interview, c: num(b.asis_questions_min), d: num(b.asis_mail_min), x: fmtMin(asisTotal) })),
      step(t("calc2Title"), t("calc2Text"),
        t("calc2Formula", { i: d.interview, e: num(b.tobe_review_min), c: d.consider, m: d.manual_review, a: num(b.asis_read_cv_min), y: fmtMin(tobeTotal) }),
        `${fmtMin(asisTotal)} → ${fmtMin(tobeTotal)} (−${pct(asisTotal, tobeTotal)}%)`),
      step(t("calc3Title"), t("calc3Text"),
        t("calc3Formula", { x: fmtMin(asisTotal), y: fmtMin(tobeTotal), h: money(b.hr_hourly_cost_try), n, ai: money(b.ai_cost_per_cv_try), cx: money(asisCost), cy: money(tobeCost) }),
        `${money(asisCost)} → ${money(tobeCost)} (−${pct(asisCost, tobeCost)}%)`),
      avgS
        ? step(t("calc4Title"), t("calc4Text"),
            t("calc4Formula", { a: num(b.asis_read_cv_min), b: num(b.asis_record_min), p: asisThroughput.toFixed(0), s: num(avgS), k, q: tobeThroughput }))
        : "",
      step(t("calc5Title"), t("calc5Text"), t("calc5Formula", { e: t("pct", { n: Math.round(b.asis_error_rate * 100) }) })),
    ].join("");
  }

  renderAssumptionForm();
}

// ---------- editable assumptions ----------
const FIELDS = [
  ["asis_read_cv_min", "asis", "min"],
  ["asis_record_min", "asis", "min"],
  ["asis_questions_min", "asis", "min"],
  ["asis_mail_min", "asis", "min"],
  ["asis_error_rate", "asis", "pct"],
  ["tobe_review_min", "tobe", "min"],
  ["hr_hourly_cost_try", "cost", "try"],
  ["ai_cost_per_cv_try", "cost", "try"],
];
let formDirty = false;
const toInput = (key, v) => (key === "asis_error_rate" ? Math.round(v * 1000) / 10 : v);
const fromInput = (key, v) => (key === "asis_error_rate" ? Number(v) / 100 : Number(v));
const unitLabel = (u) => (u === "min" ? t("min") : u === "pct" ? "%" : "₺");

function renderAssumptionForm() {
  const badge = $("#assumpBadge");
  badge.textContent = stats.baseline_customized ? t("badgeCustom") : t("badgeDefault");
  badge.className = `chip ${stats.baseline_customized ? "ok" : "reject"}`;
  if (formDirty) return; // never overwrite what the user is typing
  const b = stats.baseline;
  const def = stats.baseline_defaults;
  $("#assumpForm").innerHTML = FIELDS.map(
    ([key, tag, unit]) => `
    <div class="field" data-key="${key}">
      <span class="tag">${t(`tag_${tag}`)}</span>
      <label for="f-${key}">${t(`f_${key}`)}</label>
      <div class="row">
        <input id="f-${key}" type="number" inputmode="decimal" min="0" step="any" value="${toInput(key, b[key])}" />
        <span class="unit">${unitLabel(unit)}</span>
        <span class="def">${t("defaultVal", { v: `${toInput(key, def[key])} ${unitLabel(unit)}` })}</span>
      </div>
      <p>${t(`h_${key}`)}</p>
    </div>`
  ).join("");
}

$("#assumpForm").addEventListener("input", (e) => {
  formDirty = true;
  const field = e.target.closest(".field");
  if (field) field.classList.add("changed");
  $("#assumpMsg").textContent = t("assumpUnsaved");
});

$("#assumpSave").onclick = async () => {
  const body = {};
  let bad = false;
  $$("#assumpForm .field").forEach((f) => {
    const key = f.dataset.key;
    const raw = f.querySelector("input").value.replace(",", ".");
    const v = fromInput(key, raw);
    const ok = raw !== "" && Number.isFinite(v) && v >= 0 && (key !== "asis_error_rate" || v <= 1) && (key !== "asis_read_cv_min" || v > 0);
    f.classList.toggle("invalid", !ok);
    if (ok) body[key] = v;
    else bad = true;
  });
  if (bad) return ($("#assumpMsg").textContent = t("assumpInvalid"));
  const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    (j.fields || []).forEach((k) => $(`.field[data-key="${k}"]`)?.classList.add("invalid"));
    return ($("#assumpMsg").textContent = t("assumpInvalid"));
  }
  formDirty = false;
  $("#assumpMsg").textContent = t("assumpSaved");
  await refresh();
};

$("#assumpReset").onclick = async () => {
  await fetch("/api/settings/reset", { method: "POST" });
  formDirty = false;
  $("#assumpMsg").textContent = t("assumpResetDone");
  await refresh();
};

document.addEventListener("langchange", () => {
  formDirty = false;
  $("#assumpMsg").textContent = "";
});

// ---------- upload ----------
async function uploadFiles(files) {
  const pdfs = Array.from(files);
  if (!pdfs.length) return;
  const fd = new FormData();
  pdfs.forEach((f) => fd.append("cv", f));
  $("#uploadResult").innerHTML = `<span class="spinner"></span> ${t("uploading", { n: pdfs.length })}`;
  const r = await fetch("/api/cv", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    $("#uploadResult").innerHTML = `<div class="error-box">${t("uploadFailed")}</div>`;
    return;
  }
  $("#uploadResult").innerHTML = `${t("uploadOk", { n: j.ids.length })} ${
    j.rejected.length ? t("skipped", { files: esc(j.rejected.join(", ")) }) + " " : ""
  }<a href="#" data-goto="candidates">${t("watchResults")}</a>`;
  toast(t("toastSent", { n: j.ids.length }));
  refresh();
}
const drop = $("#drop");
$("#fileInput").onchange = (e) => {
  uploadFiles(e.target.files);
  e.target.value = "";
};
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));

// ---------- boot ----------
applyStaticTexts();
try {
  const saved = localStorage.getItem("ekomino-tab");
  if (saved && $(`#view-${saved}`)) show(saved);
} catch {}

// Deep link from the HR approval e-mail: http://localhost:3000/#candidate-12
// Also #tab-candidates, #tab-performance … to open a tab directly.
async function openFromHash() {
  const tab = location.hash.match(/^#tab-(\w+)$/);
  if (tab && $(`#view-${tab[1]}`)) return show(tab[1]);
  const m = location.hash.match(/^#candidate-(\d+)$/);
  if (!m) return;
  await refresh();
  show("candidates");
  openDrawer(Number(m[1]));
}
window.addEventListener("hashchange", openFromHash);

refresh().then(openFromHash);
refreshSlow();
setInterval(refresh, 2500);
setInterval(refreshSlow, 8000);
