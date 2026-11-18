// O'Connorpalooza RSVP
//
//   POST /api/rsvp            public. Guests submit yes/no from /christmas2026.
//   GET  /watersedge/rsvps    private. Brendan's list (behind the Waters Edge password,
//                             enforced in index.ts before this handler runs).
//
// Storage: one small JSON object per reply in the existing R2 bucket under
// rsvp/christmas2026/. A guest who answers twice shows up twice; the list page
// counts only each name's most recent answer.

const PREFIX = "rsvp/christmas2026/";

export interface RsvpEnv {
    PHOTOS_BUCKET: R2Bucket;
}

interface Rsvp {
    name: string;
    attending: "yes" | "no";
    guests: number;
    contact: string;
    note: string;
    at: string;
}

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function clean(v: unknown, max: number): string {
    return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    });
}

export async function handleRsvpSubmit(request: Request, env: RsvpEnv): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body: Record<string, unknown>;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        return json({ error: "Please try again." }, 400);
    }

    // Honeypot: real guests never fill this hidden field.
    if (clean(body.website, 200)) return json({ ok: true });

    const name = clean(body.name, 80);
    const attending = body.attending === "yes" ? "yes" : body.attending === "no" ? "no" : "";
    if (!name) return json({ error: "Please add your name." }, 400);
    if (!attending) return json({ error: "Please choose yes or no." }, 400);

    let guests = Math.round(Number(body.guests) || 0);
    if (attending === "no") guests = 0;
    else guests = Math.min(Math.max(guests, 1), 20);

    const rsvp: Rsvp = {
        name,
        attending,
        guests,
        contact: clean(body.contact, 120),
        note: clean(body.note, 500),
        at: new Date().toISOString(),
    };

    const key = `${PREFIX}${rsvp.at.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.json`;
    await env.PHOTOS_BUCKET.put(key, JSON.stringify(rsvp), {
        httpMetadata: { contentType: "application/json" },
    });

    return json({ ok: true, attending });
}

async function loadAll(env: RsvpEnv): Promise<Rsvp[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
        const page = await env.PHOTOS_BUCKET.list({ prefix: PREFIX, cursor, limit: 1000 });
        for (const o of page.objects) keys.push(o.key);
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const items = await Promise.all(
        keys.map(async (k) => {
            const obj = await env.PHOTOS_BUCKET.get(k);
            if (!obj) return null;
            try {
                return (await obj.json()) as Rsvp;
            } catch {
                return null;
            }
        })
    );
    return (items.filter(Boolean) as Rsvp[]).sort((a, b) => b.at.localeCompare(a.at));
}

function fmtTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

export async function handleRsvpList(request: Request, env: RsvpEnv): Promise<Response> {
    const all = await loadAll(env);
    const url = new URL(request.url);

    if (url.searchParams.get("format") === "csv") {
        const rows = [["Received (ET)", "Name", "Attending", "Party size", "Contact", "Note"]];
        for (const r of all) rows.push([fmtTime(r.at), r.name, r.attending, String(r.guests), r.contact, r.note]);
        const csv = rows.map((row) => row.map((c) => `"${(/^[=+\-@]/.test(c) ? "'" + c : c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
        return new Response(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": 'attachment; filename="oconnorpalooza-rsvps.csv"',
                "Cache-Control": "private, no-store",
            },
        });
    }

    // Latest answer per name counts toward the totals.
    const latest = new Map<string, Rsvp>();
    for (const r of all) {
        const k = r.name.toLowerCase().replace(/\s+/g, " ");
        if (!latest.has(k)) latest.set(k, r);
    }
    const current = [...latest.values()];
    const yes = current.filter((r) => r.attending === "yes");
    const no = current.filter((r) => r.attending === "no");
    const heads = yes.reduce((n, r) => n + r.guests, 0);

    const row = (r: Rsvp, superseded: boolean) => `
      <tr${superseded ? ' class="old"' : ""}>
        <td><b>${esc(r.name)}</b>${superseded ? '<span class="tag">updated later</span>' : ""}</td>
        <td><span class="pill ${r.attending}">${r.attending === "yes" ? "Yes" : "No"}</span></td>
        <td>${r.attending === "yes" ? r.guests : ""}</td>
        <td>${esc(r.contact)}</td>
        <td>${esc(r.note)}</td>
        <td class="when">${esc(fmtTime(r.at))}</td>
      </tr>`;

    const seen = new Set<string>();
    const rows = all
        .map((r) => {
            const k = r.name.toLowerCase().replace(/\s+/g, " ");
            const superseded = seen.has(k);
            seen.add(k);
            return row(r, superseded);
        })
        .join("");

    const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>O'Connorpalooza RSVPs</title>
<meta name="robots" content="noindex, nofollow, noarchive">
<link rel="icon" href="/christmas2026/favicon-xmas-32.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#0b2a1f;color:#f6efe0;padding:24px 16px 60px}
main{max-width:980px;margin:0 auto}
h1{font-family:Georgia,serif;font-style:italic;font-size:1.9rem;margin:8px 0 4px}
.sub{color:#cbbf9f;margin-bottom:20px;font-size:.95rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:22px}
.stat{background:rgba(255,255,255,.05);border:1px solid rgba(214,178,94,.35);border-radius:12px;padding:14px 16px}
.stat b{display:block;font-size:1.8rem;color:#d6b25e}
.stat span{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:#cbbf9f}
.tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.tools a{color:#0b2a1f;background:#d6b25e;padding:9px 14px;border-radius:999px;text-decoration:none;font-weight:600;font-size:.9rem}
.tools a.ghost{background:transparent;color:#f6efe0;border:1px solid #d6b25e}
.wrap{overflow-x:auto;border-radius:12px;border:1px solid rgba(214,178,94,.25)}
table{width:100%;border-collapse:collapse;font-size:.92rem;min-width:640px}
th,td{text-align:left;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}
th{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#cbbf9f;background:rgba(0,0,0,.2)}
tr.old td{opacity:.5}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;font-size:.8rem}
.pill.yes{background:#2f7d4f;color:#fff}.pill.no{background:#8c2f2f;color:#fff}
.tag{display:inline-block;margin-left:8px;font-size:.7rem;color:#cbbf9f}
.when{white-space:nowrap;color:#cbbf9f}
.empty{padding:28px;text-align:center;color:#cbbf9f}
</style></head><body><main>
<h1>O'Connorpalooza RSVPs</h1>
<p class="sub">Friday, December 18, 5 to 9 PM. Totals count each guest's most recent answer.</p>
<div class="stats">
  <div class="stat"><b>${yes.length}</b><span>Yes replies</span></div>
  <div class="stat"><b>${heads}</b><span>People coming</span></div>
  <div class="stat"><b>${no.length}</b><span>Can't make it</span></div>
  <div class="stat"><b>${all.length}</b><span>Total submissions</span></div>
</div>
<div class="tools">
  <a href="/watersedge/rsvps?format=csv">Download CSV</a>
  <a class="ghost" href="/christmas2026">Party page</a>
</div>
<div class="wrap"><table>
<thead><tr><th>Name</th><th>Coming?</th><th>Party size</th><th>Contact</th><th>Note</th><th>Received</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="empty">No RSVPs yet.</td></tr>'}</tbody>
</table></div>
</main></body></html>`;

    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
}
