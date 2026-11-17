/* Home Projects: room-by-room decorating tracker.
   Plain JavaScript, no build step. Data lives on the server (/api/home/*),
   so nothing is kept in browser storage and every device sees the same thing. */
(() => {
  "use strict";

  const API = String(window.HOME_API_BASE || "").replace(/\/$/, "") + "/api/home";
  const STATUSES = ["Considering", "Ordered", "Arrived", "Installed", "Passed"];
  const CATEGORIES = ["Artwork", "Framing", "Furniture", "Lighting", "Accessories"];
  const BOUGHT = ["Ordered", "Arrived", "Installed"];
  const STATUS_HELP = {
    Considering: "Still deciding",
    Ordered: "Bought, not here yet",
    Arrived: "In the house, ready to install",
    Installed: "In place",
    Passed: "Decided against",
  };
  const MEAS_KINDS = { wall: "Walls and room", furniture: "Furniture and art", opening: "Doors and windows", other: "Other" };

  const $ = (sel, root = document) => root.querySelector(sel);
  const main = $("#main");
  const sheet = $("#sheet");
  const lightbox = $("#lightbox");
  const fileInput = $("#file");

  let S = null; // { room, measurement, project, decision, item, photo }
  let fileCtx = null; // what the next chosen photo is for
  let draftPhoto = null; // photo picked for an item that is not saved yet
  let lastRoute = "";

  // ---------- small helpers ----------

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  };
  const byId = (kind, id) => (id ? S[kind].find((r) => r.id === id) : undefined);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

  const money = (n) => {
    if (n === null || n === undefined || n === "") return "";
    const whole = Math.abs(n - Math.round(n)) < 0.005;
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  };
  const itemTotal = (i) => (i.price === null || i.price === undefined ? null : i.price * (i.qty || 1));
  const spentOn = (i) => (BOUGHT.includes(i.status) ? itemTotal(i) || 0 : 0);

  const FRACTIONS = { 0.125: "\u215B", 0.25: "\u00BC", 0.375: "\u215C", 0.5: "\u00BD", 0.625: "\u215D", 0.75: "\u00BE", 0.875: "\u215E" };
  function len(n) {
    if (n === null || n === undefined) return "";
    const whole = Math.floor(n);
    const frac = n - whole;
    const eighth = Math.round(frac * 8) / 8;
    if (Math.abs(frac - eighth) > 0.004) return String(Math.round(n * 100) / 100);
    if (eighth === 1) return String(whole + 1);
    if (eighth === 0) return String(whole);
    return (whole ? whole : "") + FRACTIONS[eighth];
  }
  function dims(o) {
    const parts = [];
    if (o.w != null) parts.push(len(o.w) + " W");
    if (o.h != null) parts.push(len(o.h) + " H");
    if (o.d != null) parts.push(len(o.d) + " D");
    return parts.length ? parts.join(" \u00D7 ") + " in" : "";
  }
  function feet(n) {
    if (n == null || n < 72) return "";
    const ft = Math.floor(n / 12);
    const inch = n - ft * 12;
    return ft + " ft" + (inch ? " " + len(inch) + " in" : "");
  }
  // Accepts 76.75, 76 3/4, 13' 4", 13 ft 4 in. Returns inches, null (blank) or NaN (unreadable).
  function parseLen(raw) {
    let v = String(raw || "").trim().toLowerCase();
    if (!v) return null;
    let ft = 0;
    const m = v.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet)\s*(.*)$/);
    if (m) {
      ft = parseFloat(m[1]);
      v = m[2];
    }
    v = v.replace(/\s*(inches|inch|in\.?|")\s*$/, "").trim();
    if (!v) return m ? ft * 12 : NaN;
    const fr = v.match(/^(?:(\d+)[\s-]+)?(\d+)\s*\/\s*(\d+)$/);
    const n = fr ? parseInt(fr[1] || "0", 10) + parseInt(fr[2], 10) / parseInt(fr[3], 10) : Number(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? ft * 12 + n : NaN;
  }
  function parseMoney(raw) {
    const v = String(raw || "").replace(/[$,\s]/g, "");
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  const ICON = {
    plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---------- talking to the server ----------

  async function call(path, opts = {}) {
    let res;
    try {
      res = await fetch(API + path, { credentials: "same-origin", ...opts });
    } catch {
      throw new Error("No connection. Your change was not saved.");
    }
    if (res.status === 401) {
      location.href = "/watersedge-login?next=" + encodeURIComponent(location.pathname + location.hash);
      throw new Error("Please sign in again.");
    }
    // The site's security layer sometimes asks the browser to prove it is real.
    // Only a full page load can answer that, so say so instead of a vague failure.
    if (res.status === 403 && res.headers.get("cf-mitigated") === "challenge") {
      throw new Error("The site needs a quick security check. Reload the page and try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "That did not save. Please try again.");
    return data;
  }

  // Changes show on screen at once, then go to the server one at a time. The
  // server copy is adopted when the queue is empty, so quick taps never flicker back.
  let chain = Promise.resolve();
  let pending = 0;

  function adopt(state) {
    const changed = JSON.stringify(state) !== JSON.stringify(S);
    S = state;
    if (changed) render();
  }

  function save(ops, applyLocal) {
    if (applyLocal) applyLocal();
    render();
    pending++;
    chain = chain
      .then(() => call("/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }) }))
      .then((d) => {
        pending--;
        if (pending === 0) adopt(d.state);
      })
      .catch(async (err) => {
        pending--;
        toast(err.message, true);
        try {
          const d = await call("/state");
          S = d.state;
          render();
        } catch {
          /* already reported */
        }
      });
    return chain;
  }

  const putLocal = (kind, rec) => {
    const i = S[kind].findIndex((r) => r.id === rec.id);
    if (i >= 0) S[kind][i] = { ...S[kind][i], ...rec };
    else S[kind].push({ sort: Date.now(), created: Date.now(), ...rec });
  };
  const delLocal = (kind, id) => {
    S[kind] = S[kind].filter((r) => r.id !== id);
  };
  const put = (kind, rec) => ({ op: "put", kind, id: rec.id, data: rec });

  let toastTimer = 0;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), isError ? 6000 : 2600);
  }

  // ---------- photos ----------

  const photoUrl = (p) => (p.src ? p.src : API + "/photo/" + p.id);
  const itemPhoto = (i) => byId("photo", i.photoId) || S.photo.find((p) => p.itemId === i.id);
  const roomPhotos = (roomId) => S.photo.filter((p) => p.roomId === roomId && p.kind !== "item");

  async function toJpeg(file) {
    let src;
    try {
      src = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That photo format could not be read. Try a JPEG or PNG.")); };
        img.src = url;
      });
    }
    const sw = src.width || src.naturalWidth;
    const sh = src.height || src.naturalHeight;
    if (!sw || !sh) throw new Error("That photo could not be read.");
    const scale = Math.min(1, 2000 / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (!blob) throw new Error("That photo could not be prepared for upload.");
    return { blob, w, h };
  }

  async function uploadPhoto(prepared, ctx) {
    const q = new URLSearchParams({ roomId: ctx.roomId || "", kind: ctx.kind || "room", w: String(prepared.w), h: String(prepared.h) });
    if (ctx.itemId) q.set("itemId", ctx.itemId);
    if (ctx.setItemPhoto) q.set("setItemPhoto", "1");
    if (ctx.setCover) q.set("setCover", "1");
    return call("/photos?" + q.toString(), { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: prepared.blob });
  }

  function choosePhotos(ctx) {
    fileCtx = ctx;
    fileInput.multiple = !ctx.single;
    fileInput.value = "";
    fileInput.click();
  }

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    const ctx = fileCtx;
    fileCtx = null;
    if (!files.length || !ctx) return;

    if (ctx.draft) {
      // New item that has not been saved yet: keep the photo until Save.
      try {
        const prepared = await toJpeg(files[0]);
        if (draftPhoto) URL.revokeObjectURL(draftPhoto.url);
        draftPhoto = { ...prepared, url: URL.createObjectURL(prepared.blob) };
        const slot = $("[data-photo-slot]", sheet);
        if (slot) slot.innerHTML = `<img src="${draftPhoto.url}" alt="Chosen photo" />`;
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    let done = 0;
    let lastState = null;
    for (const f of files) {
      toast(files.length > 1 ? `Uploading ${done + 1} of ${files.length}\u2026` : "Uploading photo\u2026");
      try {
        const prepared = await toJpeg(f);
        // The first photo in a room with no cover becomes the cover.
        const room = byId("room", ctx.roomId);
        const needsCover = ctx.kind !== "item" && room && !room.coverPhotoId && done === 0;
        const d = await uploadPhoto(prepared, { ...ctx, setCover: ctx.setCover || needsCover });
        lastState = d.state;
        S = d.state;
        done++;
      } catch (err) {
        toast(err.message, true);
        break;
      }
    }
    if (lastState) {
      render();
      if (done === files.length) toast(done > 1 ? `${done} photos added` : "Photo added");
      if (ctx.itemId && sheet.open) openItem(ctx.itemId);
    }
  });

  // ---------- shared pieces ----------

  function pill(i, opts = {}) {
    const cls = "pill s-" + i.status.toLowerCase();
    if (opts.readonly) return `<span class="${cls}">${esc(i.status)}</span>`;
    return `<button type="button" class="${cls}" data-act="status" data-id="${i.id}" aria-label="Status: ${esc(i.status)}. Change status for ${esc(i.name)}">${esc(i.status)}${ICON.chev}</button>`;
  }

  function thumb(i, cls = "") {
    const p = itemPhoto(i);
    return p
      ? `<img class="${cls}" src="${esc(photoUrl(p))}" alt="" loading="lazy" decoding="async" />`
      : `<span class="nophoto ${cls}" aria-hidden="true">${ICON.image}</span>`;
  }

  function priceLine(i) {
    const t = itemTotal(i);
    if (t === null) return `<span class="price none">No price yet</span>`;
    const each = (i.qty || 1) > 1 ? `<span class="each">${i.qty} at ${money(i.price)}</span>` : "";
    return `<span class="price">${money(t)}</span>${each}`;
  }

  // One row in a dashboard list.
  function itemRow(i, quick) {
    const room = byId("room", i.roomId);
    const meta = [room ? room.name : "", i.category, i.vendor].filter(Boolean).join(" \u00B7 ");
    const q = quick
      ? `<button type="button" class="btn small" data-act="set-status" data-id="${i.id}" data-status="${quick.status}">${ICON.check}${quick.label}</button>`
      : "";
    return `<li class="row">
      <button type="button" class="row-main" data-act="item" data-id="${i.id}">
        <span class="row-thumb">${thumb(i)}</span>
        <span class="row-text">
          <span class="row-name">${esc(i.name)}</span>
          <span class="row-meta">${esc(meta)}</span>
          <span class="row-price">${priceLine(i)}</span>
        </span>
      </button>
      <span class="row-side">${pill(i)}${q}</span>
    </li>`;
  }

  // One card in a room grid.
  function itemCard(i) {
    const d = dims(i);
    return `<li class="card item">
      <button type="button" class="item-open" data-act="item" data-id="${i.id}" aria-label="Open ${esc(i.name)}">
        <span class="item-photo">${thumb(i)}</span>
        <span class="item-name">${esc(i.name)}</span>
        <span class="item-meta">${esc([i.category, i.vendor].filter(Boolean).join(" \u00B7 "))}</span>
        ${d ? `<span class="item-dims">${esc(d)}</span>` : ""}
      </button>
      <div class="item-foot">${priceLine(i)}${pill(i)}</div>
    </li>`;
  }

  function optionsOf(decisionId) {
    return S.item.filter((i) => i.decisionId === decisionId);
  }

  function decisionCard(d) {
    const opts = optionsOf(d.id);
    const room = byId("room", d.roomId);
    const picked = byId("item", d.pickedItemId);
    const thumbs = opts.slice(0, 4).map((o) => `<span class="dec-thumb${o.id === d.pickedItemId ? " picked" : ""}">${thumb(o)}<span class="dec-thumb-name">${esc(o.name)}</span></span>`).join("");
    return `<li class="card decision">
      <div class="dec-head">
        <div>
          <h3 class="dec-name">${esc(d.name)}</h3>
          <p class="dec-meta">${esc(room ? room.name : "")}${room ? " \u00B7 " : ""}${picked ? "Chosen: " + esc(picked.name) : opts.length + (opts.length === 1 ? " option" : " options")}</p>
        </div>
        <a class="btn primary" href="#/compare/${d.id}">${picked ? "Review" : "Compare"}</a>
      </div>
      ${thumbs ? `<a class="dec-thumbs n${Math.min(opts.length, 4)}" href="#/compare/${d.id}" aria-label="Compare options for ${esc(d.name)}">${thumbs}</a>` : `<p class="empty-line">No options yet. Open it to add the first one.</p>`}
    </li>`;
  }

  // Things waiting on a decision: open comparisons, loose items still under
  // consideration, and picks that are chosen but not ordered yet.
  function needList(roomId) {
    const inRoom = (r) => !roomId || r.roomId === roomId;
    const decisions = S.decision.filter((d) => inRoom(d) && !d.pickedItemId);
    const openIds = new Set(decisions.map((d) => d.id));
    const loose = S.item.filter((i) => inRoom(i) && i.status === "Considering" && !openIds.has(i.decisionId));
    return { decisions, loose, count: decisions.length + loose.length };
  }

  function emptyLine(text) {
    return `<p class="empty-line">${text}</p>`;
  }

  // ---------- views ----------

  function renderNav(activeRoom) {
    const chips = [`<a class="chip${activeRoom ? "" : " on"}" href="#/"${activeRoom ? "" : ' aria-current="page"'}>Dashboard</a>`]
      .concat(S.room.map((r) => `<a class="chip${activeRoom === r.id ? " on" : ""}" href="#/room/${r.id}"${activeRoom === r.id ? ' aria-current="page"' : ""}>${esc(r.name)}</a>`));
    $("#roomnav").innerHTML = `<div class="hp-rooms-in">${chips.join("")}</div>`;
    const on = $("#roomnav .on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function viewDashboard() {
    const need = needList();
    const ordered = S.item.filter((i) => i.status === "Ordered");
    const arrived = S.item.filter((i) => i.status === "Arrived");
    const total = S.item.reduce((a, i) => a + spentOn(i), 0);

    const perRoom = S.room.map((r) => {
      const items = S.item.filter((i) => i.roomId === r.id);
      return {
        room: r,
        spent: items.reduce((a, i) => a + spentOn(i), 0),
        weighing: items.filter((i) => i.status === "Considering").reduce((a, i) => a + (itemTotal(i) || 0), 0),
        unpriced: items.filter((i) => BOUGHT.includes(i.status) && i.price == null).length,
      };
    });
    const max = Math.max(1, ...perRoom.map((p) => p.spent));

    const kpi = (target, n, label, sub) => `<button type="button" class="kpi" data-act="jump" data-target="${target}">
        <span class="kpi-n">${n}</span><span class="kpi-l">${label}</span><span class="kpi-s">${sub}</span></button>`;

    const spendRows = perRoom.map((p) => `<li class="spend-row">
        <a class="spend-room" href="#/room/${p.room.id}">${esc(p.room.name)}</a>
        <span class="spend-amt">${money(p.spent)}</span>
        <span class="spend-bar" aria-hidden="true"><span style="width:${p.spent ? Math.max(2, (p.spent / max) * 100) : 0}%"></span></span>
        ${p.weighing || p.unpriced ? `<span class="spend-note">${[p.weighing ? money(p.weighing) + " more under consideration" : "", p.unpriced ? p.unpriced + (p.unpriced === 1 ? " bought item has" : " bought items have") + " no price" : ""].filter(Boolean).join(". ")}</span>` : ""}
      </li>`).join("");

    const roomCards = S.room.map((r) => {
      // No room photo yet: borrow a product shot, preferring what is already in the room.
      const rank = { Installed: 0, Arrived: 1, Ordered: 2, Considering: 3, Passed: 4 };
      const firstShot = S.item.filter((i) => i.roomId === r.id).sort((a, b) => (a.decisionId ? 1 : 0) - (b.decisionId ? 1 : 0) || rank[a.status] - rank[b.status]).map(itemPhoto).find(Boolean);
      const cover = byId("photo", r.coverPhotoId) || roomPhotos(r.id)[0] || firstShot;
      const n = needList(r.id).count;
      const o = S.item.filter((i) => i.roomId === r.id && i.status === "Ordered").length;
      const a = S.item.filter((i) => i.roomId === r.id && i.status === "Arrived").length;
      const bits = [n ? n + " to decide" : "", o ? o + " on order" : "", a ? a + " to install" : ""].filter(Boolean).join(" \u00B7 ") || "Nothing open";
      return `<li><a class="room-card" href="#/room/${r.id}">
          <span class="room-card-photo">${cover ? `<img src="${esc(photoUrl(cover))}" alt="" loading="lazy" decoding="async" />` : `<span class="nophoto" aria-hidden="true">${ICON.image}</span>`}</span>
          <span class="room-card-name">${esc(r.name)}</span>
          <span class="room-card-meta">${esc(bits)}</span>
        </a></li>`;
    }).join("");

    return `
      <section class="kpis" aria-label="Summary">
        ${kpi("sec-need", need.count, "Need a decision", "Still weighing")}
        ${kpi("sec-order", ordered.length, "On order", "Bought, not here yet")}
        ${kpi("sec-install", arrived.length, "Ready to install", "In the house")}
        ${kpi("sec-spend", money(total), "Spent so far", "Ordered, arrived, installed")}
      </section>

      <div class="dash">
        <div class="dash-main">
          <section id="sec-need" class="block">
            <h2>Needs a decision</h2>
            ${need.decisions.length ? `<ul class="dec-list">${need.decisions.map(decisionCard).join("")}</ul>` : ""}
            ${need.loose.length ? `<ul class="rows">${need.loose.map((i) => itemRow(i)).join("")}</ul>` : ""}
            ${need.count ? "" : emptyLine("Nothing is waiting on you. Add an item you are considering to start a list.")}
          </section>

          <section id="sec-install" class="block">
            <h2>Ready to install</h2>
            ${arrived.length ? `<ul class="rows">${arrived.map((i) => itemRow(i, { status: "Installed", label: "Installed" })).join("")}</ul>` : emptyLine("Nothing is waiting to go up or be placed.")}
          </section>

          <section id="sec-order" class="block">
            <h2>On order</h2>
            ${ordered.length ? `<ul class="rows">${ordered.map((i) => itemRow(i, { status: "Arrived", label: "Arrived" })).join("")}</ul>` : emptyLine("Nothing is on order.")}
          </section>
        </div>

        <aside class="dash-side">
          <section id="sec-spend" class="block">
            <h2>Spent by room</h2>
            <ul class="spend">${spendRows}</ul>
            <p class="spend-total"><span>Total</span><span>${money(total)}</span></p>
            <p class="fine">Counts items marked Ordered, Arrived, or Installed. Uses the price on each item, so add tax and shipping there if you want them included.</p>
          </section>

          <section class="block">
            <div class="block-head"><h2>Rooms</h2><button type="button" class="btn small" data-act="new-room">${ICON.plus}Add room</button></div>
            <ul class="room-grid">${roomCards}</ul>
          </section>
        </aside>
      </div>`;
  }

  function projectCard(p) {
    const done = p.steps.filter((s) => s.done).length;
    const pct = p.steps.length ? Math.round((done / p.steps.length) * 100) : 0;
    const decs = S.decision.filter((d) => d.projectId === p.id);
    const count = S.item.filter((i) => i.projectId === p.id && i.status !== "Passed").length;
    return `<li class="card project">
      <div class="proj-head">
        <h3>${esc(p.name)}</h3>
        <span class="tag t-${slug(p.status)}">${esc(p.status)}</span>
        <button type="button" class="btn small ghost" data-act="edit-project" data-id="${p.id}">Edit</button>
      </div>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}
      ${decs.map((d) => `<a class="btn" href="#/compare/${d.id}">${d.pickedItemId ? "Review" : "Compare"}: ${esc(d.name)}</a>`).join("")}
      ${p.steps.length ? `
        <div class="progress" role="img" aria-label="${done} of ${p.steps.length} steps done"><span style="width:${pct}%"></span></div>
        <p class="fine">${done} of ${p.steps.length} steps done${count ? " \u00B7 " + count + (count === 1 ? " item" : " items") + " linked" : ""}</p>
        <ul class="steps">${p.steps.map((s) => `<li><label class="step${s.done ? " done" : ""}"><input type="checkbox" data-change="toggle-step" data-id="${p.id}" data-step="${s.id}"${s.done ? " checked" : ""} /><span>${esc(s.text)}</span></label></li>`).join("")}</ul>` : ""}
      <form class="inline-add" data-form="add-step" data-id="${p.id}">
        <label class="sr" for="step-${p.id}">Add a step to ${esc(p.name)}</label>
        <input id="step-${p.id}" name="text" type="text" placeholder="Add a step" autocomplete="off" maxlength="300" />
        <button type="submit" class="btn small">Add</button>
      </form>
    </li>`;
  }

  function viewRoom(room) {
    const items = S.item.filter((i) => i.roomId === room.id);
    const photos = roomPhotos(room.id);
    const cover = byId("photo", room.coverPhotoId) || photos[0];
    const need = needList(room.id);
    const by = (s) => items.filter((i) => i.status === s);
    const inPlace = by("Installed"), ordered = by("Ordered"), arrived = by("Arrived"), passed = by("Passed");
    const spent = items.reduce((a, i) => a + spentOn(i), 0);
    const meas = S.measurement.filter((m) => m.roomId === room.id);
    const projects = S.project.filter((p) => p.roomId === room.id);

    const group = (title, list, hint) => (list.length ? `<h3 class="group-h">${title}<span>${list.length}</span></h3>${hint ? `<p class="fine">${hint}</p>` : ""}<ul class="item-grid">${list.map(itemCard).join("")}</ul>` : "");

    const measGroups = Object.keys(MEAS_KINDS).map((k) => {
      const list = meas.filter((m) => m.kind === k);
      if (!list.length) return "";
      return `<h3 class="group-h">${MEAS_KINDS[k]}</h3><ul class="meas">${list.map((m) => `<li>
          <button type="button" class="meas-row" data-act="meas" data-id="${m.id}" aria-label="Edit ${esc(m.label)}">
            <span class="meas-label">${esc(m.label)}</span>
            <span class="meas-val">${esc(dims(m) || "No size yet")}${m.w != null && feet(m.w) ? `<span class="meas-ft">${esc(feet(m.w))} wide</span>` : ""}</span>
            ${m.note ? `<span class="meas-note">${esc(m.note)}</span>` : ""}
          </button></li>`).join("")}</ul>`;
    }).join("");

    return `
      <section class="room-hero${cover ? "" : " empty"}">
        ${cover ? `<button type="button" class="room-hero-photo${cover.kind === "mockup" ? " mockup" : ""}" data-act="photo" data-id="${cover.id}" aria-label="Open cover photo"><img src="${esc(photoUrl(cover))}" alt="${esc(cover.caption || room.name)}" /></button>` : ""}
        <div class="room-hero-text">
          <div>
            <h2 class="room-name">${esc(room.name)}</h2>
            ${room.note ? `<p class="room-note">${esc(room.note)}</p>` : ""}
            <p class="room-stats">${inPlace.length} in place \u00B7 ${ordered.length + arrived.length} on the way or ready \u00B7 ${need.count} to decide \u00B7 ${money(spent)} spent</p>
          </div>
          <div class="room-actions">
            <button type="button" class="btn primary" data-act="add-photos" data-room="${room.id}">${ICON.camera}Add photos</button>
            <button type="button" class="btn" data-act="new-item" data-room="${room.id}">${ICON.plus}Add item</button>
            <button type="button" class="btn ghost" data-act="edit-room" data-id="${room.id}">Edit room</button>
          </div>
        </div>
      </section>

      <nav class="jump" aria-label="Sections in this room">
        <button type="button" data-act="jump" data-target="r-photos">Photos</button>
        <button type="button" data-act="jump" data-target="r-items">Items</button>
        <button type="button" data-act="jump" data-target="r-meas">Measurements</button>
        <button type="button" data-act="jump" data-target="r-projects">Projects</button>
      </nav>

      <section id="r-photos" class="block">
        <div class="block-head"><h2>Photos and mockups</h2><button type="button" class="btn" data-act="add-photos" data-room="${room.id}">${ICON.camera}Add</button></div>
        ${photos.length ? `<ul class="photo-grid">${photos.map((p) => `<li><button type="button" class="photo-tile" data-act="photo" data-id="${p.id}" aria-label="Open photo${p.caption ? ": " + esc(p.caption) : ""}">
            <img src="${esc(photoUrl(p))}" alt="${esc(p.caption || "")}" loading="lazy" decoding="async"${p.w && p.h ? ` width="${p.w}" height="${p.h}"` : ""} />
            <span class="photo-cap">${p.kind === "mockup" ? '<span class="tag">Mockup</span>' : ""}${esc(p.caption || "")}</span>
          </button></li>`).join("")}</ul>` : emptyLine("No photos yet. Take one of each wall so you can plan against it later.")}
      </section>

      <section id="r-items" class="block">
        <div class="block-head"><h2>Items</h2><button type="button" class="btn" data-act="new-item" data-room="${room.id}">${ICON.plus}Add</button></div>
        ${items.length || need.decisions.length ? "" : emptyLine("Nothing here yet. Add what is already in the room and what you are considering.")}
        ${need.count ? `<h3 class="group-h">Considering<span>${need.count}</span></h3>` : ""}
        ${need.decisions.length ? `<ul class="dec-list">${need.decisions.map(decisionCard).join("")}</ul>` : ""}
        ${need.loose.length ? `<ul class="item-grid">${need.loose.map(itemCard).join("")}</ul>` : ""}
        ${need.loose.length > 1 ? `<p class="fine">Weighing two or more of these against each other? <button type="button" class="linkish" data-act="new-decision" data-room="${room.id}">Start a comparison</button></p>` : ""}
        ${group("Ready to install", arrived)}
        ${group("On order", ordered)}
        ${group("In place", inPlace)}
        ${S.decision.filter((d) => d.roomId === room.id && d.pickedItemId).length ? `<h3 class="group-h">Decided</h3><ul class="dec-list">${S.decision.filter((d) => d.roomId === room.id && d.pickedItemId).map(decisionCard).join("")}</ul>` : ""}
        ${passed.length ? `<details class="passed"><summary>Passed on (${passed.length})</summary><ul class="item-grid">${passed.map(itemCard).join("")}</ul></details>` : ""}
      </section>

      <section id="r-meas" class="block">
        <div class="block-head"><h2>Measurements</h2><button type="button" class="btn" data-act="new-meas" data-room="${room.id}">${ICON.plus}Add</button></div>
        ${meas.length ? measGroups : emptyLine("No measurements yet. Start with each wall, then the big furniture.")}
      </section>

      <section id="r-projects" class="block">
        <div class="block-head"><h2>Projects</h2><button type="button" class="btn" data-act="new-project" data-room="${room.id}">${ICON.plus}Add</button></div>
        ${projects.length ? `<ul class="proj-list">${projects.map(projectCard).join("")}</ul>` : emptyLine("No projects in this room yet.")}
      </section>`;
  }

  function viewCompare(d) {
    const opts = optionsOf(d.id);
    const room = byId("room", d.roomId);
    const priced = opts.filter((o) => o.status !== "Passed" && itemTotal(o) !== null);
    const low = priced.length > 1 ? Math.min(...priced.map((o) => itemTotal(o))) : null;
    const n = opts.length;

    const cell = (o, html, cls = "") => `<div class="cmp-cell ${cls}${o.id === d.pickedItemId ? " is-pick" : ""}${d.pickedItemId && o.id !== d.pickedItemId ? " is-out" : ""}">${html}</div>`;
    // Cells in one row share a height, so the same fact sits at the same level in every column.
    const row = (label, fn, cls) => opts.map((o) => cell(o, (label ? `<span class="cmp-k">${label}</span>` : "") + fn(o), cls)).join("");

    const grid = n ? `
      <div class="cmp-scroll" tabindex="0" role="group" aria-label="Options side by side. Scroll sideways to see all.">
        <div class="cmp" style="--n:${n}">
          ${row("", (o) => `<button type="button" class="cmp-photo" data-act="item" data-id="${o.id}" aria-label="Open ${esc(o.name)}">${thumb(o)}</button>`, "c-photo")}
          ${row("", (o) => `<h3 class="cmp-name">${esc(o.name)}</h3>${o.id === d.pickedItemId ? '<span class="tag t-pick">Chosen</span>' : pill(o)}`, "c-name")}
          ${row("Price", (o) => `<span>${priceLine(o)}</span>${low !== null && itemTotal(o) === low ? '<span class="tag t-low">Lowest</span>' : ""}`, "c-price")}
          ${row("Size", (o) => (dims(o) ? `<span>${esc(dims(o))}</span>` : '<span class="muted">Not entered</span>'))}
          ${row("From", (o) => (o.vendor ? `<span>${esc(o.vendor)}</span>` : '<span class="muted">Not entered</span>') + (o.link ? `<a class="ext" href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">${ICON.link}View listing</a>` : ""))}
          ${row("Notes", (o) => (o.note ? `<span>${esc(o.note)}</span>` : '<span class="muted">No notes</span>'), "c-note")}
          ${row("", (o) => (d.pickedItemId
            ? (o.id === d.pickedItemId ? `<button type="button" class="btn" data-act="reopen" data-id="${d.id}">Undo choice</button>` : "")
            : `<button type="button" class="btn primary" data-act="pick" data-id="${d.id}" data-item="${o.id}">${ICON.check}Pick this one</button>`) + `<button type="button" class="btn ghost" data-act="item" data-id="${o.id}">Edit</button>`, "c-act")}
        </div>
      </div>` : emptyLine("No options yet. Add two or three and they will line up here side by side.");

    return `
      <section class="block cmp-head">
        <p class="crumb">${room ? `<a href="#/room/${room.id}">${esc(room.name)}</a> \u00B7 ` : ""}Comparison</p>
        <div class="block-head">
          <h2>${esc(d.name)}</h2>
          <div class="room-actions">
            <button type="button" class="btn primary" data-act="new-item" data-room="${d.roomId}" data-decision="${d.id}" data-project="${d.projectId || ""}">${ICON.plus}Add option</button>
            <button type="button" class="btn ghost" data-act="edit-decision" data-id="${d.id}">Edit</button>
          </div>
        </div>
        ${d.note ? `<p class="note">${esc(d.note)}</p>` : ""}
        ${n > 4 ? `<p class="fine">Tip: this reads best with four options or fewer. Mark the weakest ones Passed to narrow it down.</p>` : ""}
        ${d.pickedItemId ? `<p class="picked-line">${ICON.check} You chose ${esc((byId("item", d.pickedItemId) || {}).name || "an option")}. Mark it Ordered once you buy it.</p>` : ""}
      </section>
      ${grid}`;
  }

  function render() {
    if (!S) return;
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    let html, activeRoom = "";
    if (parts[0] === "room" && byId("room", parts[1])) {
      activeRoom = parts[1];
      html = viewRoom(byId("room", parts[1]));
    } else if (parts[0] === "compare" && byId("decision", parts[1])) {
      const d = byId("decision", parts[1]);
      activeRoom = d.roomId;
      html = viewCompare(d);
    } else {
      html = viewDashboard();
    }
    renderNav(activeRoom);
    const y = window.scrollY;
    const opened = Array.from(main.querySelectorAll("details[open]")).map((el) => el.className);
    main.innerHTML = html;
    opened.forEach((c) => { const el = main.querySelector("details." + c.split(" ")[0]); if (el) el.open = true; });
    const route = parts.join("/");
    if (route !== lastRoute) {
      lastRoute = route;
      window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, y);
    }
    document.title = (activeRoom && byId("room", activeRoom) ? byId("room", activeRoom).name + " | " : "") + "Home Projects | Waters Edge";
  }

  // ---------- sheets (forms) ----------

  function openSheet(title, body) {
    sheet.innerHTML = `<div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">${ICON.close}</button></div>${body}`;
    sheet.setAttribute("aria-label", title);
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
  }
  function closeSheet() {
    if (sheet.open) sheet.close();
  }
  sheet.addEventListener("close", () => {
    if (draftPhoto) {
      URL.revokeObjectURL(draftPhoto.url);
      draftPhoto = null;
    }
  });

  const field = (label, control, hint) => `<label class="f"><span class="f-l">${label}</span>${control}${hint ? `<span class="f-h">${hint}</span>` : ""}</label>`;
  const options = (list, current) => list.map(([v, t]) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(t)}</option>`).join("");
  const dangerBtn = (act, id, label) => `<button type="button" class="btn danger" data-act="${act}" data-id="${id}" data-confirm="${esc(label)}">Delete</button>`;

  function openItem(id, preset = {}) {
    const existing = byId("item", id);
    const i = existing || {
      id: "", name: "", category: "Furniture", status: "Considering", price: null, qty: 1, w: null, h: null, d: null,
      link: "", vendor: "", note: "", roomId: preset.roomId || (S.room[0] || {}).id || "", projectId: preset.projectId || "", decisionId: preset.decisionId || "", photoId: "",
    };
    const p = existing ? itemPhoto(i) : null;
    const projects = S.project.filter((x) => x.roomId === i.roomId);
    const decisions = S.decision.filter((x) => x.roomId === i.roomId);
    const extra = existing ? S.photo.filter((x) => x.itemId === i.id && (!p || x.id !== p.id)) : [];

    openSheet(existing ? "Edit item" : "Add item", `
      <form data-form="item" data-id="${esc(i.id)}" novalidate>
        <div class="photo-edit">
          <button type="button" class="photo-slot" data-photo-slot data-act="${p ? "photo" : "item-photo"}" data-id="${p ? p.id : esc(i.id)}" aria-label="${p ? "Open photo" : "Add a photo"}">
            ${p ? `<img src="${esc(photoUrl(p))}" alt="${esc(i.name)}" />` : `<span class="nophoto">${ICON.camera}<span>Add a photo</span></span>`}
          </button>
          <button type="button" class="btn" data-act="item-photo" data-id="${esc(i.id)}">${ICON.camera}${p ? "Add or replace photo" : "Take or choose photo"}</button>
          ${extra.length ? `<div class="mini-photos">${extra.map((x) => `<button type="button" data-act="photo" data-id="${x.id}" aria-label="Open photo"><img src="${esc(photoUrl(x))}" alt="" /></button>`).join("")}</div>` : ""}
        </div>

        ${field("Name", `<input name="name" type="text" required maxlength="160" value="${esc(i.name)}" autocomplete="off" />`)}

        <fieldset class="f seg">
          <legend class="f-l">Status</legend>
          <div class="seg-row">${STATUSES.map((s) => `<label class="seg-opt s-${s.toLowerCase()}"><input type="radio" name="status" value="${s}"${s === i.status ? " checked" : ""} /><span>${s}</span></label>`).join("")}</div>
        </fieldset>

        <div class="f-row">
          ${field("Type", `<select name="category">${options(CATEGORIES.map((c) => [c, c]), i.category)}</select>`)}
          ${field("Room", `<select name="roomId">${options(S.room.map((r) => [r.id, r.name]), i.roomId)}</select>`)}
        </div>
        <div class="f-row">
          ${field("Price each", `<input name="price" type="text" inputmode="decimal" placeholder="$" value="${i.price == null ? "" : esc(i.price)}" autocomplete="off" />`)}
          ${field("Quantity", `<input name="qty" type="text" inputmode="numeric" value="${esc(i.qty || 1)}" autocomplete="off" />`)}
        </div>
        <fieldset class="f">
          <legend class="f-l">Dimensions, in inches</legend>
          <div class="f-row three">
            <label><span class="sr">Width</span><input name="w" type="text" inputmode="decimal" placeholder="W" value="${i.w == null ? "" : esc(i.w)}" autocomplete="off" /></label>
            <label><span class="sr">Height</span><input name="h" type="text" inputmode="decimal" placeholder="H" value="${i.h == null ? "" : esc(i.h)}" autocomplete="off" /></label>
            <label><span class="sr">Depth</span><input name="d" type="text" inputmode="decimal" placeholder="D" value="${i.d == null ? "" : esc(i.d)}" autocomplete="off" /></label>
          </div>
        </fieldset>
        ${field("Link", `<input name="link" type="url" inputmode="url" placeholder="Paste the product page" value="${esc(i.link)}" autocomplete="off" autocapitalize="off" />`)}
        ${field("Store or maker", `<input name="vendor" type="text" maxlength="160" value="${esc(i.vendor)}" autocomplete="off" />`)}
        ${field("Notes", `<textarea name="note" rows="4" maxlength="4000">${esc(i.note)}</textarea>`)}
        <div class="f-row">
          ${field("Project", `<select name="projectId">${options([["", "None"]].concat(projects.map((x) => [x.id, x.name])), i.projectId)}</select>`)}
          ${field("Compare with", `<select name="decisionId">${options([["", "Not in a comparison"]].concat(decisions.map((x) => [x.id, x.name])).concat([["__new", "New comparison\u2026"]]), i.decisionId)}</select>`)}
        </div>
        <label class="f" data-new-decision hidden><span class="f-l">Name the comparison</span><input name="decisionName" type="text" maxlength="120" placeholder="Desk options" autocomplete="off" /></label>

        <p class="form-error" role="alert" hidden></p>
        <div class="sheet-foot">
          ${existing ? dangerBtn("delete-item", i.id, "Delete this item") : ""}
          <span class="grow"></span>
          <button type="button" class="btn ghost" data-act="close">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`);
    if (!existing) $("input[name=name]", sheet).focus();
  }

  function openStatus(id) {
    const i = byId("item", id);
    if (!i) return;
    openSheet(i.name, `
      <p class="fine sheet-lede">Where does this stand?</p>
      <div class="status-list">${STATUSES.map((s) => `<button type="button" class="status-opt${s === i.status ? " on" : ""}" data-act="set-status" data-id="${i.id}" data-status="${s}">
          <span class="pill s-${s.toLowerCase()}">${s}</span><span class="status-help">${STATUS_HELP[s]}</span>${s === i.status ? ICON.check : ""}</button>`).join("")}</div>
      <div class="sheet-foot"><button type="button" class="btn ghost" data-act="item" data-id="${i.id}">Open full details</button><span class="grow"></span><button type="button" class="btn" data-act="close">Done</button></div>`);
  }

  function openMeasurement(id, roomId) {
    const existing = byId("measurement", id);
    const m = existing || { id: "", roomId, label: "", kind: "wall", w: null, h: null, d: null, note: "" };
    openSheet(existing ? "Edit measurement" : "Add measurement", `
      <form data-form="meas" data-id="${esc(m.id)}" data-room="${esc(m.roomId)}" novalidate>
        ${field("What is it", `<input name="label" type="text" required maxlength="120" placeholder="North wall, sofa, window" value="${esc(m.label)}" autocomplete="off" />`)}
        ${field("Type", `<select name="kind">${options(Object.entries(MEAS_KINDS), m.kind)}</select>`)}
        <fieldset class="f">
          <legend class="f-l">Size, in inches</legend>
          <div class="f-row three">
            <label><span class="sr">Width</span><input name="w" type="text" inputmode="decimal" placeholder="W" value="${m.w == null ? "" : esc(m.w)}" autocomplete="off" /></label>
            <label><span class="sr">Height</span><input name="h" type="text" inputmode="decimal" placeholder="H" value="${m.h == null ? "" : esc(m.h)}" autocomplete="off" /></label>
            <label><span class="sr">Depth</span><input name="d" type="text" inputmode="decimal" placeholder="D" value="${m.d == null ? "" : esc(m.d)}" autocomplete="off" /></label>
          </div>
          <span class="f-h">Decimals, fractions like 76 3/4, or feet and inches like 13' 4" all work.</span>
        </fieldset>
        ${field("Notes", `<textarea name="note" rows="3" maxlength="500" placeholder="Where you measured from, outlets, anything in the way">${esc(m.note)}</textarea>`)}
        <p class="form-error" role="alert" hidden></p>
        <div class="sheet-foot">
          ${existing ? dangerBtn("delete-meas", m.id, "Delete this measurement") : ""}
          <span class="grow"></span>
          <button type="button" class="btn ghost" data-act="close">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`);
    if (!existing) $("input[name=label]", sheet).focus();
  }

  function openProject(id, roomId) {
    const existing = byId("project", id);
    const p = existing || { id: "", roomId, name: "", status: "Planning", note: "", steps: [] };
    openSheet(existing ? "Edit project" : "Add project", `
      <form data-form="project" data-id="${esc(p.id)}" data-room="${esc(p.roomId)}" novalidate>
        ${field("Project name", `<input name="name" type="text" required maxlength="120" value="${esc(p.name)}" autocomplete="off" />`)}
        ${field("Stage", `<select name="status">${options(["Planning", "In progress", "Done"].map((s) => [s, s]), p.status)}</select>`)}
        ${field("Notes", `<textarea name="note" rows="5" maxlength="4000">${esc(p.note)}</textarea>`)}
        ${field("Steps", `<textarea name="steps" rows="7" placeholder="One step per line">${esc(p.steps.map((s) => s.text).join("\n"))}</textarea>`, "One step per line. Checked steps stay checked as long as their wording is unchanged.")}
        <p class="form-error" role="alert" hidden></p>
        <div class="sheet-foot">
          ${existing ? dangerBtn("delete-project", p.id, "Delete this project") : ""}
          <span class="grow"></span>
          <button type="button" class="btn ghost" data-act="close">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`);
    if (!existing) $("input[name=name]", sheet).focus();
  }

  function openDecision(id, roomId) {
    const existing = byId("decision", id);
    const d = existing || { id: "", roomId, projectId: "", name: "", note: "", pickedItemId: "" };
    const loose = existing ? [] : S.item.filter((i) => i.roomId === roomId && i.status === "Considering" && !i.decisionId);
    openSheet(existing ? "Edit comparison" : "Start a comparison", `
      <form data-form="decision" data-id="${esc(d.id)}" data-room="${esc(d.roomId)}" novalidate>
        ${field("What are you deciding", `<input name="name" type="text" required maxlength="120" placeholder="Desk options" value="${esc(d.name)}" autocomplete="off" />`)}
        ${field("Notes", `<textarea name="note" rows="3" maxlength="2000" placeholder="Budget, must-haves, deadline">${esc(d.note)}</textarea>`)}
        ${field("Project", `<select name="projectId">${options([["", "None"]].concat(S.project.filter((x) => x.roomId === d.roomId).map((x) => [x.id, x.name])), d.projectId)}</select>`)}
        ${loose.length ? `<fieldset class="f"><legend class="f-l">Include these options</legend>${loose.map((i) => `<label class="check"><input type="checkbox" name="opt" value="${i.id}" /><span>${esc(i.name)}</span></label>`).join("")}</fieldset>` : ""}
        <p class="form-error" role="alert" hidden></p>
        <div class="sheet-foot">
          ${existing ? dangerBtn("delete-decision", d.id, "Delete this comparison") : ""}
          <span class="grow"></span>
          <button type="button" class="btn ghost" data-act="close">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
        ${existing ? `<p class="fine">Deleting a comparison keeps its items. They just stop being grouped.</p>` : ""}
      </form>`);
    if (!existing) $("input[name=name]", sheet).focus();
  }

  function openRoom(id) {
    const existing = byId("room", id);
    const r = existing || { id: "", name: "", note: "" };
    openSheet(existing ? "Edit room" : "Add room", `
      <form data-form="room" data-id="${esc(r.id)}" novalidate>
        ${field("Room name", `<input name="name" type="text" required maxlength="60" placeholder="Dining room" value="${esc(r.name)}" autocomplete="off" />`)}
        ${field("Notes", `<textarea name="note" rows="3" maxlength="1000" placeholder="The look you are going for, paint color, anything to remember">${esc(r.note)}</textarea>`)}
        <p class="form-error" role="alert" hidden></p>
        <div class="sheet-foot">
          ${existing ? dangerBtn("delete-room", r.id, "Delete this room") : ""}
          <span class="grow"></span>
          <button type="button" class="btn ghost" data-act="close">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`);
    if (!existing) $("input[name=name]", sheet).focus();
  }

  function openQuickAdd() {
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    let roomId = parts[0] === "room" ? parts[1] : "";
    let decisionId = "";
    if (parts[0] === "compare" && byId("decision", parts[1])) {
      decisionId = parts[1];
      roomId = byId("decision", parts[1]).roomId;
    }
    if (!byId("room", roomId)) roomId = (S.room[0] || {}).id || "";
    openSheet("Quick add", `
      <div class="quick">
        ${field("Room", `<select id="quick-room">${options(S.room.map((r) => [r.id, r.name]), roomId)}</select>`)}
        <button type="button" class="quick-btn" data-act="quick-photos">${ICON.camera}<span><strong>Add photos</strong><span>Take one now or pick from your library</span></span></button>
        <button type="button" class="quick-btn" data-act="quick-item" data-decision="${decisionId}">${ICON.plus}<span><strong>Add an item</strong><span>Something in place, on order, or under consideration</span></span></button>
      </div>`);
  }

  // ---------- photo viewer ----------

  function openPhoto(id) {
    const p = byId("photo", id);
    if (!p) return;
    const room = byId("room", p.roomId);
    const item = byId("item", p.itemId);
    const set = item ? S.photo.filter((x) => x.itemId === item.id) : roomPhotos(p.roomId);
    const idx = set.findIndex((x) => x.id === id);
    const prev = idx > 0 ? set[idx - 1] : null;
    const next = idx >= 0 && idx < set.length - 1 ? set[idx + 1] : null;
    const isCover = room && room.coverPhotoId === p.id;
    lightbox.innerHTML = `
      <div class="lb-top">
        <span class="lb-count">${set.length > 1 ? idx + 1 + " of " + set.length : ""}</span>
        <button type="button" class="icon-btn light" data-act="close-photo" aria-label="Close photo">${ICON.close}</button>
      </div>
      <div class="lb-stage">
        ${prev ? `<button type="button" class="lb-nav prev" data-act="photo" data-id="${prev.id}" aria-label="Previous photo">\u2039</button>` : ""}
        <img src="${esc(photoUrl(p))}" alt="${esc(p.caption || "Photo")}" />
        ${next ? `<button type="button" class="lb-nav next" data-act="photo" data-id="${next.id}" aria-label="Next photo">\u203A</button>` : ""}
      </div>
      <form class="lb-form" data-form="photo" data-id="${p.id}">
        <label class="sr" for="lb-cap">Caption</label>
        <input id="lb-cap" name="caption" type="text" maxlength="300" placeholder="Add a caption" value="${esc(p.caption || "")}" autocomplete="off" />
        ${item ? "" : `<label class="sr" for="lb-kind">Photo type</label><select id="lb-kind" name="kind">${options([["room", "Room photo"], ["mockup", "Mockup"]], p.kind)}</select>`}
        <button type="submit" class="btn primary">Save</button>
        ${item
          ? (item.photoId === p.id ? `<span class="lb-flag">Main photo for ${esc(item.name)}</span>` : `<button type="button" class="btn" data-act="photo-main" data-id="${p.id}">Make main photo</button>`)
          : (isCover ? `<span class="lb-flag">Room cover</span>` : `<button type="button" class="btn" data-act="photo-cover" data-id="${p.id}">Use as room cover</button>`)}
        <button type="button" class="btn danger" data-act="photo-delete" data-id="${p.id}" data-confirm="Delete this photo">Delete</button>
      </form>`;
    if (!lightbox.open) lightbox.showModal();
  }

  // ---------- actions ----------

  // Destructive buttons need a second tap, so a slip of the thumb cannot delete anything.
  function confirmed(btn) {
    if (btn.dataset.armed === "1") return true;
    btn.dataset.armed = "1";
    btn.textContent = "Tap again to delete";
    btn.classList.add("armed");
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = "";
      btn.textContent = "Delete";
      btn.classList.remove("armed");
    }, 4000);
    return false;
  }

  function setStatus(id, status) {
    const i = byId("item", id);
    if (!i || i.status === status) return;
    const ops = [put("item", { ...i, status })];
    const locals = [() => putLocal("item", { id, status })];
    let msg = `${i.name}: ${status}`;
    const d = byId("decision", i.decisionId);
    // Buying one option settles the comparison.
    if (d && !d.pickedItemId && BOUGHT.includes(status)) {
      ops.push(put("decision", { ...d, pickedItemId: id }));
      locals.push(() => putLocal("decision", { id: d.id, pickedItemId: id }));
      optionsOf(d.id).filter((o) => o.id !== id && o.status === "Considering").forEach((o) => {
        ops.push(put("item", { ...o, status: "Passed" }));
        locals.push(() => putLocal("item", { id: o.id, status: "Passed" }));
      });
      msg += ". Other options moved to Passed.";
    }
    save(ops, () => locals.forEach((f) => f()));
    toast(msg);
  }

  function pick(decisionId, itemId) {
    const d = byId("decision", decisionId);
    if (!d) return;
    const ops = [put("decision", { ...d, pickedItemId: itemId })];
    const others = optionsOf(d.id).filter((o) => o.id !== itemId && o.status === "Considering");
    others.forEach((o) => ops.push(put("item", { ...o, status: "Passed" })));
    save(ops, () => {
      putLocal("decision", { id: d.id, pickedItemId: itemId });
      others.forEach((o) => putLocal("item", { id: o.id, status: "Passed" }));
    });
    toast("Chosen. The other options moved to Passed.");
  }

  function reopen(decisionId) {
    const d = byId("decision", decisionId);
    if (!d) return;
    const back = optionsOf(d.id).filter((o) => o.status === "Passed");
    const ops = [put("decision", { ...d, pickedItemId: "" })].concat(back.map((o) => put("item", { ...o, status: "Considering" })));
    save(ops, () => {
      putLocal("decision", { id: d.id, pickedItemId: "" });
      back.forEach((o) => putLocal("item", { id: o.id, status: "Considering" }));
    });
    toast("Reopened. All options are back under consideration.");
  }

  async function deletePhoto(id) {
    try {
      const d = await call("/photos/" + id, { method: "DELETE" });
      S = d.state;
      render();
      toast("Photo deleted");
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) {
      // Tapping the dimmed area outside a sheet closes it.
      if (e.target === sheet) closeSheet();
      if (e.target === lightbox) lightbox.close();
      return;
    }
    const { act, id } = el.dataset;
    switch (act) {
      case "jump": {
        const t = document.getElementById(el.dataset.target);
        if (t) t.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        break;
      }
      case "close": closeSheet(); break;
      case "close-photo": lightbox.close(); break;
      case "quick-add": openQuickAdd(); break;
      case "quick-photos": { const roomId = $("#quick-room").value; closeSheet(); choosePhotos({ roomId, kind: "room" }); break; }
      case "quick-item": { const roomId = $("#quick-room").value; const dec = byId("decision", el.dataset.decision); openItem("", { roomId, decisionId: dec && dec.roomId === roomId ? dec.id : "", projectId: dec && dec.roomId === roomId ? dec.projectId : "" }); break; }
      case "item": openItem(id); break;
      case "new-item": openItem("", { roomId: el.dataset.room, decisionId: el.dataset.decision || "", projectId: el.dataset.project || "" }); break;
      case "status": openStatus(id); break;
      case "set-status": setStatus(id, el.dataset.status); if (sheet.open) closeSheet(); break;
      case "item-photo": {
        const item = byId("item", id);
        if (item) choosePhotos({ roomId: item.roomId, kind: "item", itemId: item.id, setItemPhoto: true, single: true });
        else choosePhotos({ draft: true, single: true });
        break;
      }
      case "add-photos": choosePhotos({ roomId: el.dataset.room, kind: "room" }); break;
      case "photo": openPhoto(id); break;
      case "photo-cover": {
        const p = byId("photo", id), room = p && byId("room", p.roomId);
        if (room) { save([put("room", { ...room, coverPhotoId: id })], () => putLocal("room", { id: room.id, coverPhotoId: id })); openPhoto(id); toast("Room cover updated"); }
        break;
      }
      case "photo-main": {
        const p = byId("photo", id), item = p && byId("item", p.itemId);
        if (item) { save([put("item", { ...item, photoId: id })], () => putLocal("item", { id: item.id, photoId: id })); openPhoto(id); toast("Main photo updated"); }
        break;
      }
      case "photo-delete":
        if (confirmed(el)) { const p = byId("photo", id); lightbox.close(); deletePhoto(id).then(() => { if (p && p.itemId && sheet.open) openItem(p.itemId); }); }
        break;
      case "meas": openMeasurement(id); break;
      case "new-meas": openMeasurement("", el.dataset.room); break;
      case "edit-project": openProject(id); break;
      case "new-project": openProject("", el.dataset.room); break;
      case "edit-decision": openDecision(id); break;
      case "new-decision": openDecision("", el.dataset.room); break;
      case "new-room": openRoom(""); break;
      case "edit-room": openRoom(id); break;
      case "pick": pick(id, el.dataset.item); break;
      case "reopen": reopen(id); break;
      case "delete-item":
        if (confirmed(el)) {
          const photos = S.photo.filter((p) => p.itemId === id);
          const d = S.decision.find((x) => x.pickedItemId === id);
          const ops = [{ op: "delete", kind: "item", id }];
          if (d) ops.push(put("decision", { ...d, pickedItemId: "" }));
          closeSheet();
          save(ops, () => { delLocal("item", id); if (d) putLocal("decision", { id: d.id, pickedItemId: "" }); });
          photos.filter((p) => !p.src).forEach((p) => { chain = chain.then(() => call("/photos/" + p.id, { method: "DELETE" }).then((r) => { if (pending === 0) adopt(r.state); }).catch(() => {})); });
          toast("Item deleted");
        }
        break;
      case "delete-meas":
        if (confirmed(el)) { closeSheet(); save([{ op: "delete", kind: "measurement", id }], () => delLocal("measurement", id)); toast("Measurement deleted"); }
        break;
      case "delete-project":
        if (confirmed(el)) {
          const linked = S.item.filter((i) => i.projectId === id), decs = S.decision.filter((d) => d.projectId === id);
          const ops = [{ op: "delete", kind: "project", id }].concat(linked.map((i) => put("item", { ...i, projectId: "" })), decs.map((d) => put("decision", { ...d, projectId: "" })));
          closeSheet();
          save(ops, () => { delLocal("project", id); linked.forEach((i) => putLocal("item", { id: i.id, projectId: "" })); decs.forEach((d) => putLocal("decision", { id: d.id, projectId: "" })); });
          toast("Project deleted. Its items were kept.");
        }
        break;
      case "delete-decision":
        if (confirmed(el)) {
          const opts = optionsOf(id);
          const ops = [{ op: "delete", kind: "decision", id }].concat(opts.map((i) => put("item", { ...i, decisionId: "" })));
          const d = byId("decision", id);
          closeSheet();
          location.hash = d ? "#/room/" + d.roomId : "#/";
          save(ops, () => { delLocal("decision", id); opts.forEach((i) => putLocal("item", { id: i.id, decisionId: "" })); });
          toast("Comparison deleted. Its items were kept.");
        }
        break;
      case "delete-room": {
        const used = ["item", "photo", "measurement", "project", "decision"].some((k) => S[k].some((r) => r.roomId === id));
        if (used) {
          const err = $(".form-error", sheet);
          err.textContent = "This room still has items, photos, measurements, or projects. Move or delete those first.";
          err.hidden = false;
        } else if (confirmed(el)) {
          closeSheet();
          location.hash = "#/";
          save([{ op: "delete", kind: "room", id }], () => delLocal("room", id));
          toast("Room deleted");
        }
        break;
      }
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.change === "toggle-step") {
      const p = byId("project", el.dataset.id);
      if (!p) return;
      const steps = p.steps.map((s) => (s.id === el.dataset.step ? { ...s, done: el.checked } : s));
      save([put("project", { ...p, steps })], () => putLocal("project", { id: p.id, steps }));
      return;
    }
    if (el.name === "decisionId" && el.form) {
      const box = $("[data-new-decision]", el.form);
      if (box) box.hidden = el.value !== "__new";
    }
    if (el.name === "roomId" && el.form && el.form.dataset.form === "item") {
      // Projects and comparisons belong to a room, so refresh those lists when the room changes.
      const roomId = el.value;
      el.form.projectId.innerHTML = options([["", "None"]].concat(S.project.filter((x) => x.roomId === roomId).map((x) => [x.id, x.name])), "");
      el.form.decisionId.innerHTML = options([["", "Not in a comparison"]].concat(S.decision.filter((x) => x.roomId === roomId).map((x) => [x.id, x.name])).concat([["__new", "New comparison\u2026"]]), "");
      $("[data-new-decision]", el.form).hidden = true;
    }
  });

  function fail(form, msg, name) {
    const err = $(".form-error", form);
    if (err) {
      err.textContent = msg;
      err.hidden = false;
    }
    if (name && form[name]) form[name].focus();
    return false;
  }

  function readDims(form) {
    const out = {};
    for (const k of ["w", "h", "d"]) {
      const v = parseLen(form[k].value);
      if (Number.isNaN(v)) {
        fail(form, "Sizes are in inches. Try 76.75, 76 3/4, or 13' 4\".", k);
        return null;
      }
      out[k] = v;
    }
    return out;
  }

  document.addEventListener("submit", async (e) => {
    const form = e.target;
    const kind = form.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const id = form.dataset.id;
    const val = (n) => (form[n] ? form[n].value.trim() : "");

    if (kind === "add-step") {
      const text = val("text");
      const p = byId("project", id);
      if (!text || !p) return;
      const steps = p.steps.concat([{ id: uid(), text, done: false }]);
      save([put("project", { ...p, steps })], () => putLocal("project", { id: p.id, steps }));
      return;
    }

    if (kind === "photo") {
      const p = byId("photo", id);
      if (!p) return;
      const next = { ...p, caption: val("caption"), kind: form.kind ? form.kind.value : p.kind };
      save([put("photo", next)], () => putLocal("photo", next));
      toast("Photo saved");
      lightbox.close();
      return;
    }

    if (!val("name") && kind !== "meas") return fail(form, "Give it a name first.", "name");

    if (kind === "item") {
      const size = readDims(form);
      if (!size) return;
      const price = parseMoney(val("price"));
      if (Number.isNaN(price)) return fail(form, "Price should be a number, like 425 or 1,299.50.", "price");
      const qty = val("qty") ? Number(val("qty")) : 1;
      if (!Number.isInteger(qty) || qty < 1) return fail(form, "Quantity should be a whole number, 1 or more.", "qty");
      const linkVal = val("link");
      if (linkVal && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(linkVal)) return fail(form, "That link does not look right. Paste the full web address.", "link");

      const existing = byId("item", id);
      const ops = [];
      const locals = [];
      let decisionId = form.decisionId.value;
      if (decisionId === "__new") {
        const dn = val("decisionName");
        if (!dn) return fail(form, "Name the comparison, like Desk options.", "decisionName");
        const d = { id: uid(), roomId: form.roomId.value, projectId: form.projectId.value, name: dn, note: "", pickedItemId: "" };
        ops.push(put("decision", d));
        locals.push(() => putLocal("decision", d));
        decisionId = d.id;
      }
      const rec = {
        ...(existing || {}), id: existing ? existing.id : uid(), name: val("name"),
        status: (form.querySelector("input[name=status]:checked") || {}).value || "Considering",
        category: form.category.value, roomId: form.roomId.value, price, qty, ...size,
        link: linkVal ? (/^https?:\/\//i.test(linkVal) ? linkVal : "https://" + linkVal) : "",
        vendor: val("vendor"), note: val("note"), projectId: form.projectId.value, decisionId,
        photoId: existing ? existing.photoId : "",
      };
      ops.push(put("item", rec));
      locals.push(() => putLocal("item", rec));
      // Leaving a comparison clears a pick that pointed at this item.
      const oldDec = existing && existing.decisionId !== decisionId ? S.decision.find((x) => x.pickedItemId === rec.id) : null;
      if (oldDec) {
        ops.push(put("decision", { ...oldDec, pickedItemId: "" }));
        locals.push(() => putLocal("decision", { id: oldDec.id, pickedItemId: "" }));
      }
      const pendingPhoto = draftPhoto;
      draftPhoto = null;
      closeSheet();
      await save(ops, () => locals.forEach((f) => f()));
      toast(existing ? "Saved" : "Item added");
      if (pendingPhoto && byId("item", rec.id)) {
        try {
          const d = await uploadPhoto(pendingPhoto, { roomId: rec.roomId, kind: "item", itemId: rec.id, setItemPhoto: true });
          S = d.state;
          render();
        } catch (err) {
          toast("The item saved, but the photo did not upload. Open it and add the photo again.", true);
        }
        URL.revokeObjectURL(pendingPhoto.url);
      }
      return;
    }

    if (kind === "meas") {
      if (!val("label")) return fail(form, "Say what you measured.", "label");
      const size = readDims(form);
      if (!size) return;
      const existing = byId("measurement", id);
      const rec = { ...(existing || {}), id: existing ? existing.id : uid(), roomId: form.dataset.room, label: val("label"), kind: form.kind.value, ...size, note: val("note") };
      closeSheet();
      save([put("measurement", rec)], () => putLocal("measurement", rec));
      toast("Measurement saved");
      return;
    }

    if (kind === "project") {
      const existing = byId("project", id);
      const old = existing ? existing.steps : [];
      const used = new Set();
      const steps = val("steps").split("\n").map((t) => t.trim()).filter(Boolean).map((text) => {
        const match = old.find((s) => s.text === text && !used.has(s.id));
        if (match) { used.add(match.id); return match; }
        return { id: uid(), text: text.slice(0, 300), done: false };
      });
      const rec = { ...(existing || {}), id: existing ? existing.id : uid(), roomId: form.dataset.room, name: val("name"), status: form.status.value, note: val("note"), steps };
      closeSheet();
      save([put("project", rec)], () => putLocal("project", rec));
      toast("Project saved");
      return;
    }

    if (kind === "decision") {
      const existing = byId("decision", id);
      const rec = { ...(existing || {}), id: existing ? existing.id : uid(), roomId: form.dataset.room, name: val("name"), note: val("note"), projectId: form.projectId.value, pickedItemId: existing ? existing.pickedItemId : "" };
      const chosen = Array.from(form.querySelectorAll("input[name=opt]:checked")).map((c) => byId("item", c.value)).filter(Boolean);
      const ops = [put("decision", rec)].concat(chosen.map((i) => put("item", { ...i, decisionId: rec.id })));
      closeSheet();
      save(ops, () => { putLocal("decision", rec); chosen.forEach((i) => putLocal("item", { id: i.id, decisionId: rec.id })); });
      if (!existing) location.hash = "#/compare/" + rec.id;
      toast("Comparison saved");
      return;
    }

    if (kind === "room") {
      const existing = byId("room", id);
      let newId = existing ? existing.id : slug(val("name")) || uid();
      if (!existing && byId("room", newId)) newId = newId.slice(0, 24) + "-" + uid().slice(0, 4);
      const rec = { ...(existing || {}), id: newId, name: val("name"), note: val("note"), coverPhotoId: existing ? existing.coverPhotoId : "" };
      closeSheet();
      save([put("room", rec)], () => putLocal("room", rec));
      if (!existing) location.hash = "#/room/" + rec.id;
      toast(existing ? "Room saved" : "Room added");
    }
  });

  lightbox.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select")) return;
    const dir = e.key === "ArrowLeft" ? ".prev" : e.key === "ArrowRight" ? ".next" : "";
    const btn = dir && $(".lb-nav" + dir, lightbox);
    if (btn) btn.click();
  });

  window.addEventListener("hashchange", render);

  // Pick up changes made on another device when you come back to the tab.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !S || pending > 0 || sheet.open || lightbox.open) return;
    try {
      const d = await call("/state");
      if (pending === 0) adopt(d.state);
    } catch {
      /* stay on what we have */
    }
  });

  (async function start() {
    try {
      const d = await call("/state");
      S = d.state;
      render();
    } catch (err) {
      main.innerHTML = `<div class="load-fail"><h2>Could not load your rooms</h2><p>${esc(err.message)}</p><button type="button" class="btn primary" onclick="location.reload()">Try again</button></div>`;
    }
  })();
})();
