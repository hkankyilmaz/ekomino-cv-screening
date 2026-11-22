// Ekomino HR Panel — front end (vanilla JS, no build step).
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const DECISION_LABEL = {
  interview: "Interview",
  consider: "Consider",
  reject: "Not a fit",
  manual_review: "Manual review",
  processing: "Processing",
};
const SUB_SCORES = [
  ["education", "Education", 20],
  ["technical", "Technical", 35],
  ["experience", "Experience", 25],
  ["language", "Language", 10],
  ["projects", "Projects", 10],
];

let candidates = [];
let stats = null;
let openId = null;
let drawerDirty = false;

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const secs = (ms) => (ms == null ? "–" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const time = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");
const money = (n) => `₺${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
const fmtMin = (m) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(m < 10 ? 1 : 0)} min`);

function chip(decision) {
  if (decision === "processing") return `<span class="chip processing"><span class="spinner"></span>Processing</span>`;
  return `<span class="chip ${decision}">${DECISION_LABEL[decision] || esc(decision)}</span>`;
}
function approvalChip(c) {
  if (!c.approval_status) return `<span class="muted">—</span>`;
  const cls = { Pending: "pending", Approved: "ok", Rejected: "no", "Timed out": "no" }[c.approval_status] || "";
  return `<span class="chip ${cls}">${esc(c.approval_status)}</span>`;
}
function mailChip(c) {
  if (!c.mail_status) return `<span class="muted">—</span>`;
  const cls = { Sent: "ok", "Not sent": "no", "Draft created": "pending" }[c.mail_status] || "";
  return `<span class="chip ${cls}">${esc(c.mail_status)}</span>`;
}
function scoreColor(score) {
  if (score == null) return "var(--gray-soft)";
  if (score >= 75) return "var(--green-soft)";
  if (score >= 60) return "var(--blue-soft)";
  return "var(--gray-soft)";
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 3200);
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

// ---------- navigation ----------
function show(view) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  try { localStorage.setItem("ekomino-tab", view); } catch {}
}
$$(".tab").forEach((t) => (t.onclick = () => show(t.dataset.view)));
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) show(g.dataset.goto);
});

// ---------- data ----------
async function refresh() {
  try {
    const [c, s] = await Promise.all([fetch("/api/candidates").then((r) => r.json()), fetch("/api/stats").then((r) => r.json())]);
    candidates = c;
    stats = s;
    renderDashboard();
    renderTable();
    renderPerformance();
    if (openId && !drawerDirty) renderDrawer(openId);
  } catch (e) {
    console.error(e);
  }
}

async function refreshSlow() {
  try {
    const [links, alerts] = await Promise.all([fetch("/api/links").then((r) => r.json()), fetch("/api/alerts").then((r) => r.json())]);
    $("#n8nStatus").className = `dot ${links.n8n ? "ok" : "down"}`;
    $("#n8nStatus").title = links.n8n ? "n8n is running" : "n8n is not reachable";
    $("#n8nLink").href = links.n8n_url;
    $("#mailLink").href = links.mailpit_url;
    $("#alerts").innerHTML = alerts.length
      ? alerts.map((a) => `<div>${time(a.created_at)} · <b>${esc(a.source)}</b> · ${esc(a.message)}</div>`).join("")
      : `<div>No alerts. Everything is running normally.</div>`;
  } catch {}
}

// ---------- dashboard ----------
function renderDashboard() {
  const d = stats.decisions;
  $("#kTotal").textContent = stats.total - stats.processing;
  $("#kProcessing").textContent = stats.processing ? `${stats.processing} in progress…` : "all done";
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
        <span class="chip pending">Review</span>
      </div>`
        )
        .join("")
    : `<div class="empty">No approvals waiting. Interview invitations will show up here.</div>`;
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
      <td><b>${esc(c.candidate || "—")}</b><small>${esc(c.file_name)}${c.source === "folder" ? " · folder" : ""}</small></td>
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
  if (!(await confirmDialog("Delete all candidates and uploaded CVs? Use this to start a clean demo."))) return;
  await fetch("/api/reset", { method: "POST" });
  toast("Demo data cleared");
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
    ([k, label, max]) => `
      <div class="sub"><span>${label}</span>
        <div class="track"><div class="fill" style="width:${Math.round(((c[k] ?? 0) / max) * 100)}%"></div></div>
        <span>${c[k] ?? "–"} / ${max}</span></div>`
  ).join("");

  let approval = "";
  if (c.awaiting_approval) {
    approval = `
      <div class="d-section approve-box">
        <h3 style="color:var(--brand)">Your approval is needed</h3>
        <p class="meta">This invitation will be e-mailed to <b>${esc(c.email || "the candidate")}</b> only after you approve it. You can edit the text first.
        In test mode the mail goes to the test inbox instead.</p>
        <div class="meta"><b>Subject:</b> ${esc(c.mail_subject)}</div>
        <textarea id="mailBody">${esc(c.mail_body)}</textarea>
        <div class="approve-actions">
          <button class="btn success" id="approveBtn">✓ Approve &amp; send invitation</button>
          <button class="btn danger" id="rejectBtn">✕ Reject (do not send)</button>
        </div>
      </div>`;
  } else if (c.mail_body) {
    approval = `
      <div class="d-section">
        <h3>Invitation mail</h3>
        <div class="meta">${approvalChip(c)} ${mailChip(c)} ${c.mail_recipient ? `→ ${esc(c.mail_recipient)}` : ""} ${c.mail_sent_at ? `· ${time(c.mail_sent_at)}` : ""}</div>
        <div class="questions" style="margin-top:8px"><b>${esc(c.mail_subject)}</b>\n\n${esc(c.mail_body)}</div>
      </div>`;
  }

  $("#drawerBody").innerHTML = `
    <div class="d-head">
      <div class="big-score" style="background:${scoreColor(c.score)}">${c.score ?? "–"}</div>
      <div>
        <h1 style="font-size:20px">${esc(c.candidate || c.file_name)}</h1>
        <div class="meta">${esc(c.email || "no e-mail found")} · ${chip(c.decision)}</div>
        <div class="meta">${esc(c.file_name)} · <a href="/api/candidates/${c.id}/cv" target="_blank" rel="noopener">Open CV (PDF)</a></div>
      </div>
    </div>
    ${c.error ? `<div class="error-box"><b>Needs manual review:</b> ${esc(c.error)}</div>` : ""}
    ${!done ? `<p class="muted"><span class="spinner"></span> The AI agent is reading this CV…</p>` : ""}
    ${done && c.score != null ? `<div class="d-section"><h3>Score breakdown</h3>${subs}</div>` : ""}
    ${c.strengths || c.gaps ? `<div class="d-section pairs">
        <div class="pair"><b>Strengths</b>${esc(c.strengths || "–")}</div>
        <div class="pair"><b>Gaps</b>${esc(c.gaps || "–")}</div></div>` : ""}
    ${c.interview_questions ? `<div class="d-section"><h3>Tailored interview questions</h3><div class="questions">${esc(c.interview_questions)}</div></div>` : ""}
    ${approval}
    <div class="d-section meta">
      Received ${time(c.uploaded_at)} · processed ${time(c.processed_at)} in ${secs(c.processing_ms)}
      ${c.n8n_execution_id ? ` · n8n execution #${esc(c.n8n_execution_id)}` : ""}
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
    const j = await r.json().catch(() => ({}));
    drawerDirty = false;
    if (!r.ok) {
      toast(j.error || "Something went wrong");
      $("#approveBtn").disabled = $("#rejectBtn").disabled = false;
      return;
    }
    toast(action === "approve" ? "Approved, n8n is sending the invitation" : "Rejected, no mail will be sent");
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

  // AS-IS: an HR specialist reads every CV, types it into Excel, and for interview candidates
  // prepares questions and writes the invitation by hand.
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
    <div class="cmp"><span>Time to screen one CV</span><div class="before">${fmtMin(asisPerCv)} manual</div>
      <strong>${secs(stats.avg_processing_ms)}</strong><div class="gain">${avgS ? `${Math.round((asisPerCv * 60) / avgS)}× faster` : ""}</div></div>
    <div class="cmp"><span>HR time for these ${n} CVs</span><div class="before">${fmtMin(asisTotal)}</div>
      <strong>${fmtMin(tobeTotal)}</strong><div class="gain">−${pct(asisTotal, tobeTotal)}%</div></div>
    <div class="cmp"><span>Cost for these ${n} CVs</span><div class="before">${money(asisCost)}</div>
      <strong>${money(tobeCost)}</strong><div class="gain">−${pct(asisCost, tobeCost)}%</div></div>
    <div class="cmp"><span>Capacity (CVs / hour)</span><div class="before">${asisThroughput.toFixed(0)} by one person</div>
      <strong>${tobeThroughput ?? "–"}</strong><div class="gain">data-entry errors ${Math.round(b.asis_error_rate * 100)}% → 0%</div></div>`
    : `<p class="empty">Process a few CVs to see the comparison.</p>`;

  const maxT = Math.max(asisPerCv * 60, avgS || 0);
  $("#timeBars").innerHTML = `
    <div class="bar-row"><span>Manual (AS-IS)</span><div class="track"><div class="fill gray" style="width:100%"></div></div><span>${fmtMin(asisPerCv)}</span></div>
    <div class="bar-row"><span>Automated (TO-BE)</span><div class="track"><div class="fill green" style="width:${avgS ? Math.max(1, (avgS / maxT) * 100) : 0}%"></div></div><span>${secs(stats.avg_processing_ms)}</span></div>
    <p class="meta">Manual = reading + typing into the spreadsheet. Automated = upload → result written, measured live.</p>`;

  const dist = [
    ["Interview", d.interview, "green"],
    ["Consider", d.consider, "blue"],
    ["Not a fit", d.reject, "gray"],
    ["Manual review", d.manual_review, "amber"],
  ];
  const maxD = Math.max(1, ...dist.map((x) => x[1]));
  $("#distBars").innerHTML = dist
    .map(([l, v, c]) => `<div class="bar-row"><span>${l}</span><div class="track"><div class="fill ${c}" style="width:${(v / maxD) * 100}%"></div></div><span>${v}</span></div>`)
    .join("");

  $("#assumptions").innerHTML = [
    ["Read & evaluate a CV (manual)", `${b.asis_read_cv_min} min`],
    ["Type result into sheet (manual)", `${b.asis_record_min} min`],
    ["Prepare interview questions (manual)", `${b.asis_questions_min} min`],
    ["Write invitation mail (manual)", `${b.asis_mail_min} min`],
    ["Review & approve a draft (TO-BE)", `${b.tobe_review_min} min`],
    ["HR specialist hourly cost", money(b.hr_hourly_cost_try)],
    ["Gemini API cost per CV", money(b.ai_cost_per_cv_try)],
    ["Manual data-entry error rate", `${Math.round(b.asis_error_rate * 100)}%`],
  ]
    .map(([k, v]) => `<div><b>${k}</b>${v}</div>`)
    .join("");
}

// ---------- upload ----------
async function uploadFiles(files) {
  const pdfs = Array.from(files);
  if (!pdfs.length) return;
  const fd = new FormData();
  pdfs.forEach((f) => fd.append("cv", f));
  $("#uploadResult").innerHTML = `<span class="spinner"></span> Uploading ${pdfs.length} file(s)…`;
  const r = await fetch("/api/cv", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    $("#uploadResult").innerHTML = `<div class="error-box">${esc(j.error || "Upload failed")}</div>`;
    return;
  }
  $("#uploadResult").innerHTML = `✓ ${j.ids.length} CV(s) queued for screening. ${
    j.rejected.length ? `Skipped (not PDF): ${esc(j.rejected.join(", "))}. ` : ""
  }<a href="#" data-goto="candidates">Watch the results →</a>`;
  toast(`${j.ids.length} CV(s) sent to the AI agent`);
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
try {
  const t = localStorage.getItem("ekomino-tab");
  if (t && $(`#view-${t}`)) show(t);
} catch {}
// Deep link from the HR approval e-mail: http://localhost:3000/#candidate-12
async function openFromHash() {
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
