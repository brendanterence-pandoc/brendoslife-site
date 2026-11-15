// CSV + printable clinician report builders. Pure string functions (portable).
import type { Change, HealthRow, Item, Log, Note } from "../shared/schema";
import { buildReport, healthLabel, HEALTH_LABELS, pct, round1, type Report } from "../shared/analytics";
import { describeItem, fmtDay, fmtTime, isActiveOn, minutesOf } from "../shared/schedule";

export interface ReportInputs {
  items: Item[];
  logs: Log[];
  health: HealthRow[];
  notes: Note[];
  changes: Change[];
  from: string;
  to: string;
  now: string;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** "2026-11-15T08:05" -> "11/15/2026 8:05 AM" (the format Medisafe exports use). */
function medisafeStamp(stamp: string): string {
  const [y, m, d] = stamp.slice(0, 10).split("-").map(Number);
  return `${m}/${d}/${y} ${fmtTime(stamp.slice(11, 16))}`;
}

export function medisafeCsv(inp: ReportInputs): string {
  const byId = new Map(inp.items.map((i) => [i.id, i]));
  const rows: unknown[][] = [["Type", "Name", "Recorded on", "Scheduled for", "Value", "Notes"]];
  for (const l of inp.logs) {
    const item = byId.get(l.itemId);
    if (!item) continue;
    const scheduled = l.slot ? `${l.date}T${l.slot}` : l.at;
    const value =
      item.kind === "tracker"
        ? `${l.value ?? ""} out of ${item.scaleMax}`
        : l.status === "taken" ? "Taken" : l.status === "skipped" ? "Skipped" : "Missed";
    rows.push([item.kind === "tracker" ? "Health Tracker" : "Medication", item.name, medisafeStamp(l.at), medisafeStamp(scheduled), value, l.note]);
  }
  return csv(rows);
}

export function dailyCsv(inp: ReportInputs): string {
  const r = buildReport(inp);
  const tNames = r.trackers.map((t) => t.name);
  const mNames = r.meds.filter((m) => m.expected > 0).map((m) => m.name);
  const pNames = r.meds.filter((m) => m.prnCount > 0).map((m) => m.name);
  const header = [
    "Date", "Doses scheduled", "Doses taken", "Doses skipped", "Doses missed", "Adherence %",
    ...tNames.flatMap((n) => [`${n} avg`, `${n} max`, `${n} entries`]),
    ...mNames.map((n) => `${n} taken/scheduled`),
    ...pNames.map((n) => `${n} as-needed doses`),
    ...r.healthMetrics.map((m) => `${healthLabel(m)}${HEALTH_LABELS[m]?.unit ? ` (${HEALTH_LABELS[m].unit})` : ""}`),
    "Skipped or missed", "Notes",
  ];
  const byId = new Map(inp.items.map((i) => [i.id, i]));
  const perMed = new Map<string, Map<string, { t: number; e: number }>>();
  for (const l of inp.logs) {
    const item = byId.get(l.itemId);
    if (!item || item.kind !== "med" || !l.slot) continue;
    const m = perMed.get(l.date) ?? perMed.set(l.date, new Map()).get(l.date)!;
    const c = m.get(item.name) ?? m.set(item.name, { t: 0, e: 0 }).get(item.name)!;
    c.e++;
    if (l.status === "taken") c.t++;
  }
  const rows: unknown[][] = [header];
  for (const d of r.days) {
    rows.push([
      d.date, d.expected, d.taken, d.skipped, d.missed, d.adherence == null ? "" : Math.round(d.adherence * 100),
      ...tNames.flatMap((n): unknown[] => { const t = d.trackers[n]; return t ? [round1(t.avg), t.max, t.n] : ["", "", ""]; }),
      ...mNames.map((n) => { const c = perMed.get(d.date)?.get(n); return c ? `${c.t}/${c.e}` : ""; }),
      ...pNames.map((n) => d.prn[n] ?? 0),
      ...r.healthMetrics.map((m) => d.health[m] ?? ""),
      [...d.skippedList.map((s) => `${s} skipped`), ...d.missedList.map((s) => `${s} missed`)].join("; "),
      d.notes.join(" | "),
    ]);
  }
  return csv(rows);
}

// ── Medisafe import ─────────────────────────────────────────────────────────
export interface MedisafeRow {
  kind: "med" | "tracker";
  name: string;
  date: string;
  slot: string | null;
  status: "taken" | "skipped" | "recorded" | "missed";
  value: number | null;
  at: string;
  note: string;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
const p2 = (n: number) => String(n).padStart(2, "0");
/** Accepts "M/D/YYYY H:MM AM/PM", "M/D/YY, H:MM:SS PM", and ISO-like stamps. */
export function parseStamp(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (m) {
    let h = Number(m[4]);
    const ap = m[6]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${p2(Number(m[1]))}-${p2(Number(m[2]))}T${p2(h)}:${m[5]}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  return null;
}
export function parseMedisafeCsv(text: string): MedisafeRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const cType = col("type"), cName = col("name"), cRec = col("recorded on"), cSch = col("scheduled for"), cVal = col("value"), cNote = col("notes");
  if (cName < 0 || cVal < 0 || (cRec < 0 && cSch < 0)) return [];
  const out: MedisafeRow[] = [];
  for (const r of rows.slice(1)) {
    const name = (r[cName] ?? "").trim();
    const val = (r[cVal] ?? "").trim();
    if (!name) continue;
    const rec = cRec >= 0 ? parseStamp(r[cRec] ?? "") : null;
    const sch = cSch >= 0 ? parseStamp(r[cSch] ?? "") : null;
    const at = rec ?? sch;
    if (!at) continue;
    const type = (cType >= 0 ? r[cType] ?? "" : "").toLowerCase();
    const score = val.match(/(-?\d+(?:\.\d+)?)\s*out of\s*\d+/i);
    const isTracker = type.includes("tracker") || type.includes("measurement") || !!score;
    const note = (cNote >= 0 ? r[cNote] ?? "" : "").trim().slice(0, 1000);
    if (isTracker) {
      const v = score ? Number(score[1]) : Number(val);
      if (!Number.isFinite(v)) continue;
      out.push({ kind: "tracker", name, date: (sch ?? at).slice(0, 10), slot: sch ? sch.slice(11, 16) : null, status: "recorded", value: v, at, note });
    } else {
      const v = val.toLowerCase();
      const status = v.startsWith("taken") ? "taken" : v.startsWith("skip") ? "skipped" : v.startsWith("miss") || v.startsWith("dismiss") ? "missed" : null;
      if (!status) continue;
      out.push({ kind: "med", name, date: (sch ?? at).slice(0, 10), slot: sch ? sch.slice(11, 16) : null, status, value: null, at, note });
    }
  }
  return out;
}

// ── Clinician report (self-contained HTML, prints to one or two pages) ──────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const NAVY = "#002060", GOLD = "#C4973B";

function lineChartSvg(r: Report): string {
  const W = 760, H = 230, L = 34, R = 12, T = 12, B = 26;
  const n = r.days.length;
  if (!n || !r.trackers.length) return "";
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const maxScale = Math.max(...r.trackers.map((t) => t.scaleMax), 10);
  const y = (v: number) => T + (1 - v / maxScale) * (H - T - B);
  let g = "";
  for (let v = 0; v <= maxScale; v += 2)
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E1DA" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="#666">${v}</text>`;
  const step = Math.max(1, Math.ceil(n / 8));
  r.days.forEach((d, i) => {
    if ((i % step === 0 && n - 1 - i >= step / 2) || i === n - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === n - 1 && n > 1 ? "end" : "middle"}" font-size="10" fill="#666">${esc(fmtDay(d.date))}</text>`;
  });
  const idx = new Map(r.days.map((d, i) => [d.date, i]));
  for (const c of r.changes) {
    const i = idx.get(c.date);
    if (i != null) g += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="${GOLD}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  }
  for (const t of r.trackers) {
    let path = "", pen = false, dots = "";
    r.days.forEach((d, i) => {
      const v = d.trackers[t.name]?.avg;
      if (v == null) { pen = false; return; }
      path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
      dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="${esc(t.color)}"/>`;
    });
    g += `<path d="${path}" fill="none" stroke="${esc(t.color)}" stroke-width="2" stroke-linejoin="round"/>${dots}`;
  }
  const legend = r.trackers.map((t) => `<span><i style="background:${esc(t.color)}"></i>${esc(t.name)} (daily average)</span>`).join("") +
    (r.changes.length ? `<span><i style="background:${GOLD}"></i>Regimen change</span>` : "");
  return `<div class="legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily tracker averages">${g}</svg>`;
}
function adherenceSvg(r: Report): string {
  const W = 760, H = 110, L = 34, R = 12, T = 8, B = 8;
  const n = r.days.length;
  if (!n || !r.totals.expected) return "";
  const bw = (W - L - R) / n;
  let g = `<text x="${L - 6}" y="${T + 8}" text-anchor="end" font-size="10" fill="#666">100%</text><text x="${L - 6}" y="${H - B}" text-anchor="end" font-size="10" fill="#666">0</text>`;
  r.days.forEach((d, i) => {
    if (d.adherence == null) return;
    const h = d.adherence * (H - T - B);
    g += `<rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="${d.adherence >= 0.999 ? "#20808D" : d.adherence >= 0.8 ? "#C4973B" : "#A84B2F"}"/>`;
  });
  const legend = `<div class="legend"><span><i style="background:#20808D"></i>Every scheduled dose taken</span><span><i style="background:#C4973B"></i>80 to 99%</span><span><i style="background:#A84B2F"></i>Below 80%</span></div>`;
  return `${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily dose adherence">${g}</svg>`;
}

export function clinicianReportHtml(inp: ReportInputs, meta: Record<string, string>): string {
  const r = buildReport(inp);
  const active = inp.items.filter((i) => isActiveOn(i, r.to));
  const meds = active.filter((i) => i.kind === "med").sort((a, b) => Number(a.prn) - Number(b.prn) || a.name.localeCompare(b.name));
  const byId = new Map(inp.items.map((i) => [i.id, i]));
  const patient = [meta.patient_name, meta.patient_dob ? `DOB ${meta.patient_dob}` : ""].filter(Boolean).join(" · ");

  const patterns: string[] = [];
  for (const t of r.trackers) {
    if (t.mean == null) continue;
    let s = `<b>${esc(t.name)}</b>: mean ${t.mean}/${t.scaleMax} across ${t.n} entries on ${t.daysLogged} days (range ${t.min} to ${t.max}).`;
    if (t.trend !== "n/a") s += ` First third of the window averaged ${t.firstThird}, last third ${t.lastThird} (${t.trend}).`;
    if (t.highDays.length) s += ` ${t.highDays.length} day${t.highDays.length === 1 ? "" : "s"} reached ${Math.round(t.scaleMax * 0.8)} or higher${t.highDays.length <= 6 ? ` (${t.highDays.map((d) => fmtDay(d.date)).join(", ")})` : ""}.`;
    const slots = t.bySlot.filter((b) => b.slot !== "Extra" && b.n >= 2);
    if (slots.length >= 2) {
      const hi = [...slots].sort((a, b) => b.mean - a.mean)[0], lo = [...slots].sort((a, b) => a.mean - b.mean)[0];
      if (hi.mean - lo.mean >= 0.5) s += ` Highest at the ${fmtTime(hi.slot)} check-in (${hi.mean}), lowest at ${fmtTime(lo.slot)} (${lo.mean}).`;
    }
    patterns.push(s);
    const full = r.days.filter((d) => d.expected > 0 && d.taken === d.expected && d.trackers[t.name]).map((d) => d.trackers[t.name].avg);
    const part = r.days.filter((d) => d.expected > 0 && d.taken < d.expected && d.trackers[t.name]).map((d) => d.trackers[t.name].avg);
    if (full.length >= 3 && part.length >= 3) {
      const mf = round1(full.reduce((a, b) => a + b, 0) / full.length), mp = round1(part.reduce((a, b) => a + b, 0) / part.length);
      patterns.push(`${esc(t.name)} averaged ${mp} on the ${part.length} days with a skipped or missed dose and ${mf} on the ${full.length} full-adherence days.`);
    }
  }
  const late = r.meds.filter((m) => m.avgDelayMin != null && Math.abs(m.avgDelayMin) >= 45 && m.taken >= 5);
  if (late.length) patterns.push(`Dose timing: ${late.map((m) => `${esc(m.name)} logged ${Math.abs(m.avgDelayMin!)} min ${m.avgDelayMin! > 0 ? "after" : "before"} schedule on average`).join("; ")}.`);
  const prnMeds = r.meds.filter((m) => m.prnCount > 0);
  if (prnMeds.length) patterns.push(`As-needed use: ${prnMeds.map((m) => `${esc(m.name)} ${m.prnCount} dose${m.prnCount === 1 ? "" : "s"} on ${m.prnDays} day${m.prnDays === 1 ? "" : "s"}`).join("; ")}.`);
  const strong = r.correlations.filter((c) => Math.abs(c.r) >= 0.3 && c.n >= 10).sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 5);

  const healthRows = r.healthMetrics.map((m) => {
    const xs = r.days.map((d) => d.health[m]).filter((v) => v != null);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const dg = HEALTH_LABELS[m]?.digits ?? 1;
    return `<tr><td>${esc(healthLabel(m))}</td><td class="n">${mean.toFixed(dg)} ${esc(HEALTH_LABELS[m]?.unit ?? "")}</td><td class="n">${Math.min(...xs).toFixed(dg)} to ${Math.max(...xs).toFixed(dg)}</td><td class="n">${xs.length}</td></tr>`;
  }).join("");

  const limits: string[] = [];
  if (r.firstDataDate && r.firstDataDate > r.from) limits.push(`Entries in this window begin ${fmtDay(r.firstDataDate, { year: true })}.`);
  if (r.totals.checkinsExpected) limits.push(`${r.totals.checkinsDone} of ${r.totals.checkinsExpected} scheduled check-ins were recorded (${pct(r.totals.checkinsDone / r.totals.checkinsExpected)}).`);
  const imported = inp.logs.filter((l) => l.source === "medisafe" && l.date >= r.from && l.date <= r.to).map((l) => l.date).sort();
  if (imported.length)
    limits.push(`Entries from ${fmtDay(imported[0])} to ${fmtDay(imported[imported.length - 1], { year: true })} were imported from a Medisafe export. On days with only imported entries, a dose or check-in that was never logged in Medisafe is absent rather than counted as missed.`);
  limits.push("Scores are self-rated. Dose times are the times entered in the app. Correlations are same-day, exploratory, and do not establish cause.");

  const slotNote = (l: Log) => {
    const it = byId.get(l.itemId);
    return it ? `${fmtDay(l.date)}${l.slot ? ` ${fmtTime(l.slot)}` : ` ${fmtTime(l.at.slice(11, 16))}`} · ${it.name}${l.value != null ? ` ${l.value}/${it.scaleMax}` : ""}: ${l.note}` : "";
  };
  const noteLines = [
    ...inp.logs.filter((l) => l.note && l.date >= r.from && l.date <= r.to).map((l) => ({ k: l.at, s: slotNote(l) })),
    ...inp.notes.filter((n) => n.date >= r.from && n.date <= r.to).map((n) => ({ k: n.at, s: `${fmtDay(n.date)} · Diary: ${n.text}` })),
  ].sort((a, b) => a.k.localeCompare(b.k)).slice(-40);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Medication and Mood Report ${esc(r.from)} to ${esc(r.to)}</title>
<style>
*{box-sizing:border-box}body{font:13px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1c2333;margin:0;background:#fff}
main{max-width:820px;margin:0 auto;padding:28px 24px 40px}
h1{font-size:20px;margin:0;color:${NAVY};letter-spacing:-.01em}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:${NAVY};margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid ${GOLD}}
.sub{color:#555;margin-top:4px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}
.kpi{border:1px solid #DEDAD2;border-radius:6px;padding:9px 11px}.kpi b{display:block;font-size:19px;color:${NAVY};font-variant-numeric:tabular-nums}.kpi span{font-size:11px;color:#555}
table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;font-weight:600;color:#444;border-bottom:1px solid #BBB;padding:4px 6px}td{padding:4px 6px;border-bottom:1px solid #ECE9E2;vertical-align:top}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}th.n{text-align:right}
ul{margin:0;padding-left:18px}li{margin:3px 0}svg{width:100%;height:auto;display:block}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:11px;color:#444;margin-bottom:4px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.foot{margin-top:24px;font-size:11px;color:#666;border-top:1px solid #DDD;padding-top:8px}
@media (max-width:560px){.kpis{grid-template-columns:repeat(2,1fr)}main{padding:18px 14px}.wide{overflow-x:auto}td,th{overflow-wrap:anywhere}}
@media print{main{padding:0;max-width:none}h2{break-after:avoid}table,svg,.kpis{break-inside:avoid}}
</style></head><body><main>
<h1>Medication and Mood Report</h1>
<div class="sub">${patient ? `${esc(patient)}<br>` : ""}${esc(fmtDay(r.from, { year: true }))} to ${esc(fmtDay(r.to, { year: true }))} (${r.days.length} days) · Generated ${esc(fmtDay(inp.now.slice(0, 10), { year: true }))}</div>
<div class="kpis">
<div class="kpi"><b>${pct(r.totals.adherence)}</b><span>Scheduled doses taken (${r.totals.taken} of ${r.totals.expected})</span></div>
<div class="kpi"><b>${r.totals.skipped + r.totals.missed}</b><span>Skipped (${r.totals.skipped}) or missed (${r.totals.missed})</span></div>
${r.trackers.slice(0, 2).map((t) => `<div class="kpi"><b>${t.mean ?? "n/a"}<small style="font-size:12px;color:#555"> /${t.scaleMax}</small></b><span>Mean ${esc(t.name.toLowerCase())}${t.trend !== "n/a" ? `, ${t.trend}` : ""}</span></div>`).join("")}
</div>
${r.trackers.length ? `<h2>Symptom scores</h2>${lineChartSvg(r)}` : ""}
${r.totals.expected ? `<h2>Daily dose adherence</h2>${adherenceSvg(r)}` : ""}
<h2>Observations</h2>
${patterns.length ? `<ul>${patterns.map((p) => `<li>${p}</li>`).join("")}</ul>` : "<p>Not enough entries in this window to describe patterns.</p>"}
<h2>Current regimen (as of ${esc(fmtDay(r.to))})</h2>
<div class="wide"><table><tr><th>Medication</th><th>Strength</th><th>Schedule</th><th>Class</th><th>Notes</th></tr>
${meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.strength)}</td><td>${esc(m.prn ? "As needed" : describeItem({ ...m, strength: "" }))}</td><td>${esc(m.category)}</td><td>${esc(m.notes)}</td></tr>`).join("")}</table></div>
${r.changes.length ? `<h2>Regimen changes in window</h2><table>${r.changes.map((c) => `<tr><td class="n" style="text-align:left;width:90px">${esc(fmtDay(c.date))}</td><td>${esc(c.text)}</td></tr>`).join("")}</table>` : ""}
<h2>Adherence by medication</h2>
<div class="wide"><table><tr><th>Medication</th><th class="n">Taken</th><th class="n">Skipped</th><th class="n">Missed</th><th class="n">Adherence</th><th class="n">Avg timing</th><th class="n">As-needed doses</th></tr>
${r.meds.map((m) => `<tr><td>${esc(m.name)}${m.strengths.length ? ` <span style="color:#666">${esc(m.strengths.join(" / "))}</span>` : ""}</td><td class="n">${m.expected ? `${m.taken}/${m.expected}` : ""}</td><td class="n">${m.expected ? m.skipped : ""}</td><td class="n">${m.expected ? m.missed : ""}</td><td class="n">${m.expected ? pct(m.pct) : ""}</td><td class="n">${m.avgDelayMin == null ? "" : `${m.avgDelayMin > 0 ? "+" : ""}${m.avgDelayMin} min`}</td><td class="n">${m.prnCount || ""}</td></tr>`).join("")}</table></div>
${r.trackers.some((t) => t.bySlot.length > 1) ? `<h2>Scores by time of day</h2><div class="wide"><table><tr><th>Tracker</th>${[...new Set(r.trackers.flatMap((t) => t.bySlot.map((b) => b.slot)))].sort().map((s) => `<th class="n">${esc(s === "Extra" ? "Unscheduled" : fmtTime(s))}</th>`).join("")}</tr>
${r.trackers.map((t) => `<tr><td>${esc(t.name)}</td>${[...new Set(r.trackers.flatMap((x) => x.bySlot.map((b) => b.slot)))].sort().map((s) => { const b = t.bySlot.find((x) => x.slot === s); return `<td class="n">${b ? `${b.mean} <span style="color:#777">(${b.n})</span>` : ""}</td>`; }).join("")}</tr>`).join("")}</table></div>` : ""}
${healthRows ? `<h2>Apple Health daily metrics</h2><table><tr><th>Metric</th><th class="n">Daily mean</th><th class="n">Range</th><th class="n">Days</th></tr>${healthRows}</table>` : ""}
${strong.length ? `<h2>Exploratory same-day correlations</h2><table><tr><th>Pair</th><th class="n">r</th><th class="n">Days</th></tr>${strong.map((c) => `<tr><td>${esc(c.a)} vs ${esc(c.b)}</td><td class="n">${c.r > 0 ? "+" : ""}${c.r.toFixed(2)}</td><td class="n">${c.n}</td></tr>`).join("")}</table>` : ""}
${noteLines.length ? `<h2>Notes recorded</h2><ul>${noteLines.map((n) => `<li>${esc(n.s)}</li>`).join("")}</ul>` : ""}
<h2>Data limitations</h2><ul>${limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<div class="foot">Prepared from the patient's own medication and symptom log for discussion with the treating clinician. Descriptive only. No medication change is made without clinician direction.</div>
</main></body></html>`;
}
export { minutesOf };
