# Q&A / Defence Notes

[← back to README](../README.md)

Questions we expect in the Q&A part (15 % of the grade), with short answers.

### Process & business value

**Why this process?**
High volume, repetitive, rule-describable, digital input, measurable, and it has a clear
bottleneck (reading every CV). Those are the classic signs that a process is a good fit for automation.

**What exactly is the bottleneck?**
Reading and judging every CV (≈ 6 min each) plus writing tailored questions (≈ 12 min) for good
candidates, all done by one person in sequence. Volume grows linearly; capacity does not.

**Where does the value come from?**
≈ 84 % less HR time and cost per position (see the performance analysis), candidates answered in
minutes instead of days, consistent and explainable scoring, zero transcription errors, and full measurability.

**Isn't HR still needed?**
Yes, on purpose. HR approves every invitation and decides the *consider* and *manual review*
cases. The system removes the repetitive reading, not the decision.

### Technology choice

**Why not RPA (UiPath / Power Automate)?**
RPA automates clicks on structured screens. Our bottleneck is understanding unstructured CVs in
different layouts and languages, which needs judgement, so a language model is the right tool. n8n
covers the "RPA-like" parts (moving files, calling APIs, sending mail).

**Why n8n and not Make/Zapier?**
Self-hosted (CVs do not sit in a third-party automation cloud), free, visual, has a built-in
"wait for approval" step and PDF extraction, and every run's data and duration are inspectable.

**Why Claude?**
It reads Turkish and English CVs well, follows a detailed rubric and fairness rules, and its
structured outputs guarantee the JSON shape our workflow parses. Sonnet 5.5 answers in 2-5 s for
≈ $0.006 per CV. We started with Google Gemini, but the model we targeted was closed to new keys
and the newer ones were overloaded during testing. A local model (Ollama) would give the best
privacy but is much slower on a laptop and weaker in Turkish.

**What is an "AI agent" in your project?**
An LLM that gets a role, a goal (screen against this job ad), rules and an output contract,
and whose output drives the next actions of a workflow (record, branch, draft questions and mails).
It is deliberately a *single, controlled* agent step, because the brief asks for a lean solution.

### AI reliability

**What if the AI gives a wrong score?**
(1) a fixed rubric and a strict JSON schema for repeatability; (2) the code clamps every sub-score
and recomputes the total, so the **rule is never decided by the AI**; (3) borderline candidates
(60-74) go to HR; (4) nothing reaches a candidate without HR approval; (5) every score is explained
by 5 sub-scores + strengths/gaps.

**What if the AI hallucinates?**
The prompt says "do not invent; if unsure, score lower". Hallucinated *positive* facts would only
lead to an approval request, and HR sees the CV link and the questions before approving.

**What if the AI returns broken JSON or the API is down?**
Schema-constrained output makes that rare; if it happens, the code catches it and the candidate is recorded as
`manual_review` with the reason. API errors are retried 3× first. The flow never stops (we can demo it
with the corrupted PDF).

**Is it consistent?**
We measured it: the same CV processed several times stays within a few points (see the consistency test in the performance analysis). Sonnet 5.5 does not let you set temperature, so consistency comes from the rubric, the schema and the code-side rule.

### Ethics, law, security

**Bias?**
The prompt forbids using name, gender, age, photo, marital status, and forbids non-job questions
(age, marital status, family plans, religion). The rubric is the same for everyone. Future work:
monitor score distributions on anonymised data.

**KVKK / personal data?**
CVs and results stay on our machine; only the CV text is sent to the Claude API (Anthropic does not train on API data by default). In production: a KVKK privacy notice that mentions automated pre-screening,
a retention period, access only for HR. Also, under KVKK Art. 11, candidates may object to a decision based
solely on automated processing, which is another reason the final decision stays with a human.

**Where is the API key?**
Only in `.env` (not on GitHub) → imported as an encrypted n8n credential. Not in the workflow JSON.

### Technical details

**How does "wait for HR approval" work?**
The n8n **Wait** node pauses the execution and exposes a unique *resume URL*. The panel stores it;
when HR clicks Approve/Reject, the panel POSTs the decision to that URL and the same execution continues.
After 48 h without an answer it continues as *Timed out*.

**Why a web panel if the assignment is not about coding?**
The brief's version uses Google Drive/Sheets/Gmail as the user interface. To run everything locally
for the demo we needed a simple screen for HR. All logic is still in n8n; the panel only uploads,
shows and forwards the approval.

**How would you put this into production at Ekomino?**
Swap the intake/output nodes to Google Drive + Sheets + Gmail (or the company's ATS), turn off test mode,
use a paid API key, add authentication, write the KVKK notice. The core logic stays the same.

**How many CVs can it handle?**
It is limited by the API rate limit, not by people: with 2 parallel runs and a few seconds per CV,
hundreds of CVs per hour.
