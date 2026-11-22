#!/bin/sh
# Acceptance test from section 7 of the project brief.
# Uploads the sample CVs (A–D + a corrupted PDF), waits for the results and prints them
# next to the expected decisions.
#
#   ./scripts/run-acceptance-test.sh          # keeps existing data
#   ./scripts/run-acceptance-test.sh --reset  # clears the panel first (clean demo)
set -e
cd "$(dirname "$0")/.."
PANEL=${PANEL:-http://localhost:3000}

if ! curl -sf "$PANEL/api/stats" >/dev/null; then
  echo "The HR panel is not reachable at $PANEL. Start the system first: docker compose up -d"
  exit 1
fi

[ "$1" = "--reset" ] && curl -sf -X POST "$PANEL/api/reset" >/dev/null && echo "Panel data cleared."

echo "Uploading sample CVs..."
curl -sf \
  -F "cv=@samples/candidate-A.pdf" -F "cv=@samples/candidate-B.pdf" \
  -F "cv=@samples/candidate-C.pdf" -F "cv=@samples/candidate-D.pdf" \
  -F "cv=@samples/candidate-E-corrupted.pdf" \
  "$PANEL/api/cv" >/dev/null

printf "Waiting for the AI agent"
for i in $(seq 1 60); do
  sleep 2
  left=$(curl -sf "$PANEL/api/stats" | sed -n 's/.*"processing":\([0-9]*\).*/\1/p')
  printf "."
  [ "$left" = "0" ] && break
done
echo

curl -sf "$PANEL/api/candidates" | node -e '
const expected = {
  "candidate-A.pdf": ["≈ 80", "interview"],
  "candidate-B.pdf": ["≈ 88", "interview"],
  "candidate-C.pdf": ["≈ 28", "reject"],
  "candidate-D.pdf": ["≈ 55–65", "reject or consider"],
  "candidate-E-corrupted.pdf": ["–", "manual_review"],
};
const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
const seen = new Set();
const out = [];
for (const r of rows) {
  if (!expected[r.file_name] || seen.has(r.file_name)) continue;
  seen.add(r.file_name);
  const [es, ed] = expected[r.file_name];
  const ok = ed.split(" or ").includes(r.decision);
  out.push({
    file: r.file_name, candidate: r.candidate || "–", score: r.score ?? "–", expected_score: es,
    decision: r.decision, expected: ed, pass: ok ? "PASS" : "CHECK", seconds: r.processing_ms ? (r.processing_ms / 1000).toFixed(1) : "–",
  });
}
out.sort((a, b) => a.file.localeCompare(b.file));
console.table(out);
const passed = out.filter((o) => o.pass === "PASS").length;
console.log(`${passed}/${out.length} decisions as expected. Open ${process.env.PANEL || "http://localhost:3000"} to review, and http://localhost:8025 for the mails.`);
'
