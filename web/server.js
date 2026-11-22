// Ekomino HR Panel — the end-user (HR specialist) interface of the CV screening automation.
//
// Division of responsibilities:
//   • This web app is only a thin shell: it receives CVs, hands them to n8n, shows the results
//     and forwards the HR specialist's Approve / Reject decision back to n8n.
//   • All business logic (text extraction, AI scoring, decision rule, mail draft, waiting for
//     approval, sending the mail) lives in the n8n workflow.

const express = require("express");
const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");

// ---------------------------------------------------------------------------
// Settings (override via docker-compose.yml / .env)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
const N8N_INTERNAL_URL = (process.env.N8N_INTERNAL_URL || "http://localhost:5678").replace(/\/$/, "");
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || `${N8N_INTERNAL_URL}/webhook/cv-screening`;
const N8N_PUBLIC_URL = process.env.N8N_PUBLIC_URL || "http://localhost:5678";
const MAILPIT_PUBLIC_URL = process.env.MAILPIT_PUBLIC_URL || "http://localhost:8025";
const INBOX_DIR = process.env.INBOX_DIR || path.join(__dirname, "..", "inbox", "incoming");
const PROCESSING_TIMEOUT_MS = Number(process.env.PROCESSING_TIMEOUT_MS || 180000);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));

// AS-IS (manual process) assumptions used by the performance & gain analysis.
// Defaults are typical-case estimates from .env. HR users can overwrite them on the Performance
// page with their own stopwatch measurements; those values are stored in the database.
const BASELINE_DEFAULTS = {
  asis_read_cv_min: Number(process.env.ASIS_READ_CV_MIN || 6),
  asis_record_min: Number(process.env.ASIS_RECORD_MIN || 1.5),
  asis_questions_min: Number(process.env.ASIS_QUESTIONS_MIN || 12),
  asis_mail_min: Number(process.env.ASIS_MAIL_MIN || 4),
  asis_error_rate: Number(process.env.ASIS_ERROR_RATE || 0.12),
  tobe_review_min: Number(process.env.TOBE_REVIEW_MIN || 1.5),
  hr_hourly_cost_try: Number(process.env.HR_HOURLY_COST_TRY || 350),
  ai_cost_per_cv_try: Number(process.env.AI_COST_PER_CV_TRY || 0.25),
};
// Allowed range per setting (protects the calculations from typos)
const BASELINE_LIMITS = {
  asis_read_cv_min: [0.1, 240],
  asis_record_min: [0, 240],
  asis_questions_min: [0, 480],
  asis_mail_min: [0, 240],
  asis_error_rate: [0, 1],
  tobe_review_min: [0, 240],
  hr_hourly_cost_try: [0, 100000],
  ai_cost_per_cv_try: [0, 1000],
};
const baseline = () => ({ ...BASELINE_DEFAULTS, ...db.getSettings() });

// ---------------------------------------------------------------------------
// Processing queue: CVs are sent to n8n one by one (at most CONCURRENCY in parallel),
// so uploading 30 CVs at once does not exceed the Claude API rate limit.
// ---------------------------------------------------------------------------
const queue = [];
let running = 0;
const startTimes = new Map();

function enqueue(id) {
  queue.push(id);
  drain();
}

function drain() {
  while (running < CONCURRENCY && queue.length > 0) {
    const id = queue.shift();
    running++;
    processCv(id)
      .catch((e) => console.error(`[queue] #${id}`, e))
      .finally(() => {
        running--;
        drain();
      });
  }
}

const cvPath = (id) => path.join(db.DATA_DIR, "cv", `${id}.pdf`);

async function processCv(id) {
  const row = db.getCandidate(id);
  if (!row) return;
  const pdf = fs.readFileSync(cvPath(id));

  const form = new FormData();
  form.append("record_id", String(id));
  form.append("file_name", row.file_name);
  form.append("cv", new Blob([pdf], { type: "application/pdf" }), row.file_name);

  startTimes.set(id, Date.now());
  console.log(`[n8n] #${id} ${row.file_name} → sending`);

  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(PROCESSING_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`n8n HTTP ${res.status}: ${text.slice(0, 300)}`);
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "n8n did not answer in time" : e.message;
    console.error(`[n8n] #${id} error: ${msg}`);
    // Fault tolerance: even if the automation is down, the candidate is never lost —
    // it falls into manual review.
    if (db.getCandidate(id)?.decision === "processing") {
      db.updateCandidate(id, {
        decision: "manual_review",
        error: `Automation unreachable: ${msg}`,
        processed_at: db.now(),
        processing_ms: Date.now() - (startTimes.get(id) || Date.now()),
      });
      db.addAlert("web", `#${id} ${row.file_name}: ${msg}`);
    }
    return;
  } finally {
    // If the n8n "record" step never ran, do not leave the candidate stuck in "processing".
    setTimeout(() => {
      if (db.getCandidate(id)?.decision === "processing") {
        db.updateCandidate(id, {
          decision: "manual_review",
          error: "The n8n workflow finished without writing a result",
          processed_at: db.now(),
        });
      }
      startTimes.delete(id);
    }, 5000);
  }
}

// ---------------------------------------------------------------------------
// Folder watcher — the local equivalent of the brief's Google Drive "cv-incoming" trigger.
// Every PDF dropped into inbox/incoming is processed automatically, then moved to inbox/processed.
// ---------------------------------------------------------------------------
const PROCESSED_DIR = path.join(path.dirname(INBOX_DIR), "processed");
fs.mkdirSync(INBOX_DIR, { recursive: true });
fs.mkdirSync(PROCESSED_DIR, { recursive: true });

function scanInbox() {
  let files = [];
  try {
    files = fs.readdirSync(INBOX_DIR);
  } catch {
    return;
  }
  for (const name of files) {
    if (!name.toLowerCase().endsWith(".pdf") || name.startsWith(".")) continue;
    const full = path.join(INBOX_DIR, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs < 2000) continue; // wait until the copy finishes
      const id = db.addCandidate(name, "folder");
      fs.copyFileSync(full, cvPath(id));
      fs.renameSync(full, path.join(PROCESSED_DIR, `${id}-${name}`));
      console.log(`[inbox] ${name} → #${id}`);
      enqueue(id);
    } catch (e) {
      console.error(`[inbox] ${name}`, e.message);
    }
  }
}
setInterval(scanInbox, 3000);

// ---------------------------------------------------------------------------
// HTTP app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
});

// Browsers send multipart file names as UTF-8 but multer decodes them as latin1.
function fixFileName(name) {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

function publicView(row) {
  const { resume_url, ...rest } = row;
  return { ...rest, awaiting_approval: row.approval_status === "Pending" && !!resume_url };
}

// --- Endpoints used by the HR specialist (via the UI) ------------------------

app.post("/api/cv", upload.array("cv"), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: "No PDF file selected" });
  const ids = [];
  const rejected = [];
  for (const f of files) {
    const name = fixFileName(f.originalname);
    if (!name.toLowerCase().endsWith(".pdf")) {
      rejected.push(name);
      continue;
    }
    const id = db.addCandidate(name, "web");
    fs.writeFileSync(cvPath(id), f.buffer);
    ids.push(id);
    enqueue(id);
  }
  res.json({ ids, rejected });
});

app.get("/api/candidates", (_req, res) => {
  res.json(db.listCandidates().map(publicView));
});

app.get("/api/candidates/:id", (req, res) => {
  const row = db.getCandidate(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Candidate not found" });
  res.json(publicView(row));
});

app.get("/api/candidates/:id/cv", (req, res) => {
  const id = Number(req.params.id);
  const row = db.getCandidate(id);
  if (!row || !fs.existsSync(cvPath(id))) return res.status(404).end();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
  fs.createReadStream(cvPath(id)).pipe(res);
});

// The HR specialist's Approve / Reject decision → resumes the waiting n8n execution (Wait node).
app.post("/api/candidates/:id/decision", async (req, res) => {
  const id = Number(req.params.id);
  const row = db.getCandidate(id);
  if (!row) return res.status(404).json({ error: "Candidate not found" });
  if (row.approval_status !== "Pending" || !row.resume_url) {
    return res.status(409).json({ error: "There is no pending approval request for this candidate" });
  }
  const approved = req.body?.action === "approve";
  const mailBody = typeof req.body?.mail_body === "string" ? req.body.mail_body : row.mail_body;

  // n8n builds the resume URL with its public (localhost) address; inside Docker we call the service name.
  const target = row.resume_url.replace(/^https?:\/\/[^/]+/, N8N_INTERNAL_URL);
  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved, mail_body: mailBody, decided_by: "HR specialist (web panel)" }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`n8n HTTP ${r.status}`);
  } catch (e) {
    return res.status(502).json({
      error: `Could not send the decision to n8n (${e.message}). The approval window may have expired or the execution was stopped.`,
    });
  }
  db.updateCandidate(id, {
    approval_status: approved ? "Approved" : "Rejected",
    decided_at: db.now(),
    mail_body: mailBody,
  });
  res.json({ ok: true });
});

app.get("/api/stats", (_req, res) => {
  const rows = db.listCandidates();
  const count = (d) => rows.filter((r) => r.decision === d).length;
  const times = rows.map((r) => r.processing_ms).filter((x) => Number.isFinite(x) && x > 0);
  res.json({
    total: rows.length,
    processing: count("processing"),
    decisions: {
      interview: count("interview"),
      consider: count("consider"),
      reject: count("reject"),
      manual_review: count("manual_review"),
    },
    pending_approval: rows.filter((r) => r.approval_status === "Pending").length,
    mails_sent: rows.filter((r) => r.mail_status === "Sent").length,
    avg_processing_ms: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    max_processing_ms: times.length ? Math.max(...times) : null,
    baseline: baseline(),
    baseline_defaults: BASELINE_DEFAULTS,
    baseline_customized: Object.keys(db.getSettings()).length > 0,
    queue: { waiting: queue.length, running, concurrency: CONCURRENCY },
  });
});

app.get("/api/alerts", (_req, res) => res.json(db.listAlerts()));

// Performance assumptions edited on the Performance page
app.put("/api/settings", (req, res) => {
  const values = {};
  const invalid = [];
  for (const [key, [min, max]] of Object.entries(BASELINE_LIMITS)) {
    if (req.body?.[key] === undefined) continue;
    const v = Number(req.body[key]);
    if (!Number.isFinite(v) || v < min || v > max) invalid.push(key);
    else values[key] = v;
  }
  if (invalid.length) return res.status(400).json({ error: "invalid", fields: invalid });
  db.saveSettings(values);
  res.json({ ok: true, baseline: baseline() });
});

app.post("/api/settings/reset", (_req, res) => {
  db.resetSettings();
  res.json({ ok: true, baseline: baseline() });
});

app.get("/api/links", async (_req, res) => {
  let n8n = false;
  try {
    const r = await fetch(`${N8N_INTERNAL_URL}/healthz`, { signal: AbortSignal.timeout(2000) });
    n8n = r.ok;
  } catch {}
  res.json({ n8n, n8n_url: N8N_PUBLIC_URL, mailpit_url: MAILPIT_PUBLIC_URL });
});

// CSV export — same columns, same order as the results table in the brief.
app.get("/api/export.csv", (_req, res) => {
  const cols = [
    "processed_at", "file_name", "candidate", "email", "score", "education", "technical",
    "experience", "language", "projects", "strengths", "gaps", "decision", "interview_questions",
    "approval_status", "mail_status", "mail_sent_at", "processing_ms", "error",
  ];
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = db.listCandidates().map((r) => cols.map((c) => esc(r[c])).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="cv-results.csv"');
  res.send("﻿" + [cols.join(","), ...lines].join("\n"));
});

// Clean slate before a demo: deletes every record and every uploaded CV.
app.post("/api/reset", (_req, res) => {
  db.clearAll();
  const dir = path.join(db.DATA_DIR, "cv");
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  res.json({ ok: true });
});

// --- Endpoints called by n8n (writing to the results table) ------------------

app.post("/api/n8n/result", (req, res) => {
  const b = req.body || {};
  const id = Number(b.record_id);
  const row = db.getCandidate(id);
  if (!row) return res.status(404).json({ error: `record_id ${b.record_id} not found` });

  const sub = b.sub_scores || {};
  const interview = b.decision === "interview";
  const started = startTimes.get(id);
  db.updateCandidate(id, {
    processed_at: db.now(),
    processing_ms: started ? Date.now() - started : null,
    candidate: b.candidate || null,
    email: b.email || null,
    score: Number.isFinite(b.score) ? b.score : null,
    education: sub.education ?? null,
    technical: sub.technical ?? null,
    experience: sub.experience ?? null,
    language: sub.language ?? null,
    projects: sub.projects ?? null,
    strengths: b.strengths || null,
    gaps: b.gaps || null,
    decision: b.decision || "manual_review",
    interview_questions: b.interview_questions || null,
    mail_subject: interview ? b.mail_subject : null,
    mail_body: interview ? b.mail_body : null,
    approval_status: interview ? "Pending" : null,
    mail_status: interview ? "Draft created" : null,
    resume_url: interview ? b.resume_url : null,
    n8n_execution_id: b.execution_id ? String(b.execution_id) : null,
    error: b.error || null,
  });
  if (b.decision === "manual_review") db.addAlert("n8n", `#${id} ${row.file_name}: ${b.error || "manual review"}`);
  console.log(`[n8n] #${id} result: ${b.decision} (${b.score ?? "-"})`);
  res.json({ ok: true });
});

app.post("/api/n8n/status", (req, res) => {
  const b = req.body || {};
  const id = Number(b.record_id);
  if (!db.getCandidate(id)) return res.status(404).json({ error: "record not found" });
  db.updateCandidate(id, {
    approval_status: b.approval_status,
    mail_status: b.mail_status,
    mail_sent_at: b.mail_sent_at || null,
    mail_recipient: b.mail_recipient || null,
    resume_url: null,
  });
  console.log(`[n8n] #${id} status: ${b.approval_status} / ${b.mail_status}`);
  res.json({ ok: true });
});

app.post("/api/n8n/error", (req, res) => {
  const b = req.body || {};
  // Link the failed execution back to its candidate, so the panel never shows a stale "Pending"
  // approval for an execution that no longer exists.
  const row = b.execution_id
    ? db.listCandidates().find((r) => r.n8n_execution_id === String(b.execution_id))
    : null;
  if (row) {
    db.updateCandidate(row.id, {
      decision: row.decision === "processing" ? "manual_review" : row.decision,
      approval_status: row.approval_status === "Pending" ? null : row.approval_status,
      mail_status: row.mail_status === "Draft created" ? "Not sent" : row.mail_status,
      resume_url: null,
      error: `Automation error at "${b.node || "unknown step"}": ${b.message || "unknown error"}. Please handle this candidate manually.`,
    });
  }
  db.addAlert(
    "n8n-error-workflow",
    `${b.node ? `[${b.node}] ` : ""}${b.message || "Unknown error"}${b.execution_id ? ` (execution #${b.execution_id})` : ""}`
  );
  res.json({ ok: true });
});

// If the app restarts mid-way, put unfinished records back in the queue.
for (const r of db.listCandidates()) {
  if (r.decision === "processing" && fs.existsSync(cvPath(r.id))) enqueue(r.id);
}

app.listen(PORT, () => {
  console.log(`Ekomino HR Panel running on http://localhost:${PORT}`);
  console.log(`n8n webhook: ${N8N_WEBHOOK_URL}`);
  console.log(`Watched folder: ${INBOX_DIR}`);
});
