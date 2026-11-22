# Live Demo Script & Plan B Video

[← back to README](../README.md)

## Before the presentation (checklist)

- [ ] Laptop charged, Docker Desktop running, `docker compose up -d` done **15 min before**
- [ ] `docker compose ps` shows 3 services *running/healthy*
- [ ] Gemini key valid: run `./scripts/run-acceptance-test.sh --reset` once, then **Reset demo data** in the panel
- [ ] Browser tabs open, in this order: **HR Panel** (localhost:3000) · **n8n workflow** (localhost:5678) · **Mailbox** (localhost:8025)
- [ ] n8n owner account created and logged in; workflow canvas zoomed to fit
- [ ] `samples/` folder open in Finder/Explorer for drag & drop
- [ ] Plan B video on the desktop **and** on a USB stick; plays offline
- [ ] Phone hotspot ready as backup internet

## 3-minute live demo

| Time | Screen | Speaker | What to do / say |
|---|---|---|---|
| 0:00 | n8n canvas | Member 2 | "This is our TO-BE process as an n8n workflow: intake → AI scoring → decision by code → record → human approval → mail. 15 nodes." Point at the sticky notes 1-4. |
| 0:25 | HR Panel · Upload | Member 3 | Drag **candidate-A, B, C, D and E-corrupted** onto the upload area. "Five CVs, one of them broken on purpose." |
| 0:40 | HR Panel · Candidates | Member 3 | Rows switch from *Processing* to results within seconds. Read out: B ≈ 88 interview, A ≈ 80 interview, C ≈ 28 not a fit, D borderline, E manual review. "The broken file did not stop anything." |
| 1:10 | Candidate drawer (B) | Member 3 | Open Mehmet Kaya: score breakdown, strengths/gaps, **5 questions tailored to his CV** (point out SQL/Python/Trendyol). |
| 1:35 | Mailbox | Member 4 | Show the **[Approval needed]** mail HR received. "No mail has gone to the candidate yet." |
| 1:50 | Candidate drawer (B) | Member 4 | Edit one sentence of the invitation, click **Approve & send**. Row → *Approved · Sent*. |
| 2:05 | Mailbox | Member 4 | The invitation arrives at the **test inbox** (test mode). |
| 2:15 | n8n · Executions | Member 2 | Open B's execution: every node green, show *Validate & Decide* output (model score vs. recomputed score) and duration. |
| 2:35 | HR Panel · Performance | Member 5 | "One CV: ~7.5 min by hand → a few seconds. For 50 CVs, HR time −84 %, cost −84 %." |
| 2:55 | – | Member 5 | "The AI proposes, code decides, HR approves." |

**If something fails live:** say "this is exactly why we have the error path / Plan B",
show the *manual review* row if it is an API error, then switch to the video.

## Plan B video (max 3 minutes)

Record the same script as above in one take (macOS: `Cmd + Shift + 5`; Windows: `Win + Alt + R`
or OBS Studio). Requirements from the assignment: **max 3 minutes**, shows the application
**actually working** (input → processing → output).

Tips:
* 1920×1080, browser zoom 110-125 % so the text is readable on a projector.
* Close notifications (Do Not Disturb).
* Start from a reset panel and an empty mailbox (Mailpit → *Delete all*).
* Keep the mouse movements slow; pause one second on each result.
* Export as MP4 (H.264). Check it plays without internet.
* Name: `ekomino-cv-screening-demo.mp4`.
