# Performance & Gain Analysis

[← back to README](../README.md)

## 1. Indicators

| Indicator | Definition | AS-IS source | TO-BE source |
|---|---|---|---|
| **Cycle time per CV** | From "CV available" to "result recorded" | Stopwatch (§2) | `processing_ms` in the results table / n8n Executions |
| **HR effort** | HR minutes spent per position | Activity times × volume | Approvals + borderline/manual reviews |
| **Cost** | HR effort × hourly cost + tool cost | `HR_HOURLY_COST_TRY` | + Claude API cost per CV |
| **Capacity** | CVs that can be screened per hour | 60 / minutes per CV | 3600 / seconds per CV × parallel runs |
| **Consistency** | Same CV → same result? | Two readers / two times | Same CV processed repeatedly, spread of the score |
| **Error rate** | Records with wrong/missing data | Excel audit | System-written fields |

## 2. How to measure the AS-IS times

Each group member screens the sample CVs **by hand**, as the HR specialist would today:

1. Start a stopwatch, open `samples/candidate-X.pdf`.
2. Read it and decide a score using the job ad → **lap** (= *read & evaluate*).
3. Type name, e-mail, score and a note into a spreadsheet → **lap** (= *record*).
4. For a good candidate, write 5 tailored interview questions → **lap** (= *questions*).
5. Write the invitation e-mail → **stop** (= *mail*).

Average the results across members and CVs and put them into `.env`
(`ASIS_READ_CV_MIN`, `ASIS_RECORD_MIN`, `ASIS_QUESTIONS_MIN`, `ASIS_MAIL_MIN`).
The panel's **Performance** tab and the table below then use your numbers.

| Member | CV | Read & evaluate (min) | Record (min) | Questions (min) | Mail (min) |
|---|---|---|---|---|---|
| _Member 1_ | A | | | | |
| _Member 2_ | B | | | | |
| _..._ | | | | | |
| **Average** | | | | | |

Default values used until you measure your own: read 6 · record 1.5 · questions 12 · mail 4 minutes.

## 3. Calculation model

Scenario: one position, **N = 50** applications → 10 *interview*, 10 *consider*, 2 *manual review*, 28 *not a fit*.

**AS-IS HR time**

```
N × (read + record) + interviews × (questions + mail)
= 50 × (6 + 1.5) + 10 × (12 + 4)
= 375 + 160 = 535 min ≈ 8.9 h
```

**TO-BE HR time** (the agent does the first pass; HR approves drafts and reads only borderline/problem CVs)

```
interviews × review + (consider + manual_review) × read
= 10 × 1.5 + (10 + 2) × 6
= 15 + 72 = 87 min ≈ 1.45 h
```

**Cost** (HR ₺350/h, Claude ≈ $0.006 ≈ ₺0.25 per CV; exchange rate is an assumption)

```
AS-IS : 8.92 h × 350           ≈ ₺3,120
TO-BE : 1.45 h × 350 + 50×0.25 ≈ ₺508 + ₺12.5 ≈ ₺521
```

| Indicator | AS-IS | TO-BE | Change |
|---|---|---|---|
| HR time / 50 CVs | 8.9 h | 1.45 h | **−84 %** |
| Cost / 50 CVs | ₺3,120 | ₺521 | **−83 %** |
| Cycle time / CV | 7.5 min | 2-5 s (§4) | ≈ 100-200× faster |
| Capacity | ≈ 8 CVs / hour / person | hundreds / hour (2 in parallel) | no longer bound to HR hours |
| Waiting time for candidates | days (queue behind one person) | minutes | candidates contacted while still available |
| Data-entry error rate | ≈ 12 % (assumption) | 0 % (system-written) | eliminated |
| Consistency | reader-dependent | fixed rubric + schema + deterministic rule (§4) | ✔ |

**Annual view (example):** 12 positions × 50 CVs = 600 CVs/year →
AS-IS ≈ 107 h, TO-BE ≈ 17 h → **≈ 90 HR hours (≈ 11 working days) freed per year**, ≈ ₺31,000 saved,
for an API cost of ≈ $3.6 (≈ ₺150).

> Note: The conservative part of this model is that HR still reads all *consider* and
> *manual review* CVs by hand. The gain comes mostly from not reading the clear *not a fit*
> CVs and from not writing questions/mails from scratch.

## 4. Measured results (TO-BE)

Measured with `./scripts/run-acceptance-test.sh --reset` on a MacBook (Apple Silicon, 16 GB),
n8n 2.48.7, `claude-sonnet-5-5` (effort `medium`), 2 CVs in parallel, 22 Nov 2026.

| File | Expected | Actual score | Actual decision | Seconds | Result |
|---|---|---|---|---|---|
| candidate-A.pdf | ≈ 80 · interview | 88 (19/29/21/9/10) | interview | 5.2 | ✔ |
| candidate-B.pdf | ≈ 88 · interview | 94 (20/35/20/10/9) | interview | 4.9 | ✔ |
| candidate-C.pdf | ≈ 28 · reject | 14 (2/3/4/3/2) | reject | 3.0 | ✔ |
| candidate-D.pdf | ≈ 55-65 · reject/consider | 57 (18/15/12/8/4) | reject | 2.1 | ✔ |
| candidate-E-corrupted.pdf | manual_review | – | manual_review | 0.1 | ✔ |

**5/5 decisions correct.** Scores are within the brief's expected bands for B and D; A scored a bit
higher (88 vs ≈ 80) and C lower (14 vs ≈ 28), but both stay well inside their decision category,
which is what the acceptance criteria require.

**Token use and cost:** 1,424-1,776 input tokens and 162-436 output tokens per CV (interview
candidates are longer because of the 5 questions) → **$0.0045-0.008 per CV, ≈ $0.006 on average**
at Claude Sonnet 5.5 prices ($2 / $10 per million tokens). The whole acceptance test cost ≈ $0.025.

**Consistency test:** process candidate-A five times and record the spread of the total score
(the brief expects at most a few points).

| Run | 1 | 2 | 3 | 4 | 5 | Spread |
|---|---|---|---|---|---|---|
| candidate-A score | 88 | 87 | 87 | 88 | 88 | **1 point** |

Sub-scores were identical except experience (21 or 22) and projects (9 or 10). The decision
(*interview*) was the same in every run. Claude Sonnet 5.5 does not accept a custom temperature,
so this stability comes from the fixed rubric, the JSON schema and the code-side rule.

## 5. Qualitative gains

* **Faster response to candidates** → better candidate experience and less loss of good applicants.
* **Explainability:** every decision comes with 5 sub-scores, strengths and gaps.
* **Fairness:** protected attributes excluded by design; same rubric for everyone.
* **HR focus shifts** from reading to interviewing and decision making.
* **Auditability:** who approved what and when, how long each step took.
