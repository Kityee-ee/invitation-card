(() => {
  "use strict";

  const EVENT = {
    title: "BKT Friyay night",
    address: "139 Boundary Road, North Melbourne VIC 3051",
    location: "Game room (ground floor), 139 Boundary Road, North Melbourne VIC 3051",
    details: "Bak Kut Teh and rice. Come whenever from 6:00pm! Ring intercom 221, game room door code 9218.",
    startUtc: "20261016T070000Z", // 6:00pm AEDT
    endUtc: "20261016T120000Z",   // 11:00pm AEDT
  };

  const CATEGORIES = [
    { id: "drinks", title: "Drinks", color: "#f7cdd2" },
    { id: "fruits", title: "Fruits", color: "#f8e7a6" },
    { id: "dessert", title: "Dessert", color: "#d2e8cc" },
  ];

  const AVATAR_COLORS = ["#f4cfb8", "#f7cdd2", "#f8e7a6", "#d2e8cc", "#e8c9a6", "#cddff0", "#ddd2f0", "#f2bfa6"];

  const SEED_ITEMS = [
    ["drinks", "Soft drinks or juice"],
    ["drinks", "Beer, wine or something fun"],
    ["fruits", "A fruit platter"],
    ["fruits", "Any fruit in season"],
    ["dessert", "Something sweet"],
    ["dessert", "Kuih, cake or ice cream"],
  ];

  // ---------- small helpers ----------

  const $ = (sel) => document.querySelector(sel);

  const local = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  };

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  let memoryToken = null;
  function myToken() {
    let token = local.get("bkt.token");
    if (!token) {
      token = memoryToken || randomId();
      memoryToken = token;
      local.set("bkt.token", token);
    }
    return token;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const first = Array.from(parts[0])[0] || "";
    const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] || "" : "";
    return (first + last).toUpperCase();
  }

  function colorFor(name) {
    let h = 0;
    for (const ch of String(name).toLowerCase().trim()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function avatarHtml(name, { me = false, plus = 0 } = {}) {
    return `<span class="avatar${me ? " is-me" : ""}" style="--c:${colorFor(name)}" aria-hidden="true">${escapeHtml(initials(name))}${
      plus > 0 ? `<span class="plus-badge">+${plus}</span>` : ""
    }</span>`;
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  const FRIENDLY_ERRORS = {
    already_claimed: "Oops, someone just claimed that one!",
    not_yours: "That claim belongs to someone else.",
    too_many_items: "That's plenty from you, thank you! 😄",
    board_full: "The potluck board is full.",
    guest_list_full: "The guest list is full.",
    bad_token: "Something went wrong. Please refresh and try again.",
  };
  function friendly(err) {
    const msg = String((err && (err.message || err)) || "");
    for (const key of Object.keys(FRIENDLY_ERRORS)) if (msg.includes(key)) return FRIENDLY_ERRORS[key];
    return "Couldn't save. Check your connection and try again.";
  }

  // ---------- backends ----------

  function supabaseBackend(cfg) {
    const loadLib = () =>
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Couldn't load Supabase"));
        document.head.appendChild(s);
      });

    let sb;
    const ready = loadLib().then(() => {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: false },
      });
    });

    const must = ({ data, error }) => {
      if (error) throw error;
      return data;
    };

    return {
      async load() {
        await ready;
        const [rsvps, items] = await Promise.all([
          sb.from("rsvps").select("id,name,status,plus_ones,created_at").order("created_at"),
          sb.from("potluck_items").select("id,category,label,note,claimed_by,is_seed,created_at").order("created_at"),
        ]);
        return { rsvps: must(rsvps), items: must(items) };
      },
      async whoami() {
        await ready;
        return must(await sb.rpc("whoami", { p_token: myToken() }));
      },
      async saveRsvp(name, status, plusOnes) {
        await ready;
        must(await sb.rpc("save_rsvp", { p_token: myToken(), p_name: name, p_status: status, p_plus_ones: plusOnes }));
      },
      async claim(itemId, name, note) {
        await ready;
        must(await sb.rpc("claim_item", { p_token: myToken(), p_name: name, p_item_id: itemId, p_note: note }));
      },
      async add(category, label, name) {
        await ready;
        must(await sb.rpc("add_item", { p_token: myToken(), p_name: name, p_category: category, p_label: label }));
      },
      async unclaim(itemId) {
        await ready;
        must(await sb.rpc("unclaim_item", { p_token: myToken(), p_item_id: itemId }));
      },
      subscribe(onChange) {
        ready.then(() => {
          sb.channel("bkt-board")
            .on("postgres_changes", { event: "*", schema: "public", table: "rsvps" }, onChange)
            .on("postgres_changes", { event: "*", schema: "public", table: "potluck_items" }, onChange)
            .subscribe();
        });
      },
    };
  }

  // Same behaviour as the database functions, kept in this browser only.
  function demoBackend() {
    const KEY = "bkt.demo";
    let memory = null;
    const read = () => {
      let db = memory;
      try { db = JSON.parse(localStorage.getItem(KEY)) || memory; } catch { /* use memory */ }
      if (!db) {
        db = {
          rsvps: [],
          items: SEED_ITEMS.map(([category, label], i) => ({
            id: "seed-" + i, category, label, note: null, claimed_by: null, is_seed: true, created_at: i,
          })),
          rsvpOwners: {},
          itemOwners: {},
        };
      }
      return db;
    };
    const write = (db) => {
      memory = db;
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* memory only */ }
    };
    const fail = (code) => { throw new Error(code); };
    const pause = () => new Promise((r) => setTimeout(r, 250));

    return {
      async load() {
        const db = read();
        return { rsvps: db.rsvps, items: db.items };
      },
      async whoami() {
        const db = read(), t = myToken();
        return {
          rsvp_id: db.rsvpOwners[t] || null,
          item_ids: Object.keys(db.itemOwners).filter((id) => db.itemOwners[id] === t),
        };
      },
      async saveRsvp(name, status, plusOnes) {
        await pause();
        const db = read(), t = myToken();
        let row = db.rsvps.find((r) => r.id === db.rsvpOwners[t]);
        if (!row) {
          row = { id: randomId(), created_at: Date.now() };
          db.rsvps.push(row);
          db.rsvpOwners[t] = row.id;
        }
        Object.assign(row, { name, status, plus_ones: plusOnes });
        db.items.forEach((it) => { if (db.itemOwners[it.id] === t) it.claimed_by = name; });
        write(db);
      },
      async claim(itemId, name, note) {
        await pause();
        const db = read();
        const it = db.items.find((x) => x.id === itemId);
        if (!it || it.claimed_by) fail("already_claimed");
        it.claimed_by = name;
        it.note = note || null;
        db.itemOwners[itemId] = myToken();
        write(db);
      },
      async add(category, label, name) {
        await pause();
        const db = read(), t = myToken();
        if (Object.values(db.itemOwners).filter((x) => x === t).length >= 8) fail("too_many_items");
        const id = randomId();
        db.items.push({ id, category, label, note: null, claimed_by: name, is_seed: false, created_at: Date.now() });
        db.itemOwners[id] = t;
        write(db);
      },
      async unclaim(itemId) {
        await pause();
        const db = read();
        if (db.itemOwners[itemId] !== myToken()) fail("not_yours");
        delete db.itemOwners[itemId];
        const it = db.items.find((x) => x.id === itemId);
        if (it && !it.is_seed) db.items = db.items.filter((x) => x.id !== itemId);
        else if (it) { it.claimed_by = null; it.note = null; }
        write(db);
      },
      subscribe(onChange) {
        window.addEventListener("storage", (e) => { if (e.key === KEY) onChange(); });
      },
    };
  }

  const cfg = window.BKT_CONFIG || {};
  const isLive = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const api = isLive ? supabaseBackend(cfg) : demoBackend();
  if (!isLive) $("#demo-banner").hidden = false;

  // ---------- state + rendering ----------

  const state = {
    loaded: false,
    rsvps: [],
    items: [],
    myRsvpId: null,
    myItemIds: new Set(),
  };

  const myRsvp = () => state.rsvps.find((r) => r.id === state.myRsvpId) || null;
  const knownName = () => (myRsvp() && myRsvp().name) || local.get("bkt.name") || "";

  function renderGuests() {
    const yes = state.rsvps.filter((r) => r.status === "yes");
    const maybe = state.rsvps.filter((r) => r.status === "maybe");
    const no = state.rsvps.filter((r) => r.status === "no");
    const heads = yes.reduce((n, r) => n + 1 + (r.plus_ones || 0), 0);

    const guestLi = (r) => `
      <li class="guest">
        ${avatarHtml(r.name, { me: r.id === state.myRsvpId, plus: r.plus_ones })}
        <span class="guest-name">${escapeHtml(r.name)}${r.id === state.myRsvpId ? " (you)" : ""}</span>
      </li>`;

    $("#guest-count").textContent = !state.loaded
      ? "Loading the guest list…"
      : heads
        ? `${heads} ${heads === 1 ? "person" : "people"} coming so far 🎉`
        : "No RSVPs yet. Be the first!";
    $("#guest-list").innerHTML = yes.map(guestLi).join("");

    $("#maybe-wrap").hidden = !maybe.length;
    $("#maybe-list").innerHTML = maybe.map(guestLi).join("");

    const cant = $("#cant-line");
    cant.hidden = !no.length;
    cant.textContent = no.length ? `Can't make it this time: ${no.map((r) => r.name).join(", ")}. We'll save you some soup!` : "";

    const me = myRsvp();
    const statusLine = {
      yes: `You're in, ${me && me.name}! 🍲`,
      maybe: `You're a maybe, ${me && me.name}. Hope you can make it!`,
      no: `Sorry you can't make it, ${me && me.name}.`,
    };
    $("#rsvp-status").textContent = me ? statusLine[me.status] : "";
    $("#rsvp-submit").firstChild.textContent = me ? "Update my RSVP " : "RSVP now ";
    fillRsvpForm();
  }

  const TICK = '<svg viewBox="0 0 24 24"><path d="M4 13l5 5L20 5"/></svg>';

  function renderPotluck() {
    const html = CATEGORIES.map((cat) => {
      const items = state.items.filter((it) => it.category === cat.id);
      const rows = items.map((it) => {
        const mine = state.myItemIds.has(it.id);
        if (!it.claimed_by) {
          return `
            <li class="note-item">
              <span class="tick" aria-hidden="true"></span>
              <span>
                <span class="note-label">${escapeHtml(it.label)}</span>
                <button class="note-claim" type="button" data-claim="${escapeHtml(it.id)}">I'll bring this</button>
              </span>
            </li>`;
        }
        const what = it.note ? `${escapeHtml(it.label)}: <em>${escapeHtml(it.note)}</em>` : escapeHtml(it.label);
        return `
          <li class="note-item">
            <span class="tick" aria-hidden="true">${TICK}</span>
            <span>
              <span class="note-label">${what}</span>
              <span class="note-who">– ${mine ? "you ♥" : escapeHtml(it.claimed_by)}${
                mine ? ` · <button class="link-btn" type="button" data-unclaim="${escapeHtml(it.id)}">unclaim</button>` : ""
              }</span>
            </span>
          </li>`;
      });
      return `
        <article class="note" style="--note:${cat.color}">
          <span class="pin" aria-hidden="true"></span>
          <h3 class="note-title">${cat.title}<svg class="note-ic" aria-hidden="true"><use href="#ic-${cat.id}"/></svg></h3>
          <ul class="note-items">${rows.join("")}</ul>
          <button class="note-add" type="button" data-add="${cat.id}">Add yours…</button>
        </article>`;
    }).join("");
    $("#potluck").innerHTML = html;
  }

  function render() {
    renderGuests();
    renderPotluck();
  }

  let refreshing = null;
  let refreshQueued = false;
  async function refresh() {
    if (refreshing) { refreshQueued = true; return refreshing; }
    refreshing = (async () => {
      try {
        const [data, who] = await Promise.all([api.load(), api.whoami()]);
        state.rsvps = data.rsvps;
        state.items = data.items;
        state.myRsvpId = who.rsvp_id;
        state.myItemIds = new Set(who.item_ids || []);
        state.loaded = true;
        render();
      } catch (err) {
        console.error(err);
        if (!state.loaded) $("#guest-count").textContent = "Couldn't load the guest list. Pull down to refresh.";
      } finally {
        refreshing = null;
        if (refreshQueued) { refreshQueued = false; refresh(); }
      }
    })();
    return refreshing;
  }

  let changeTimer;
  const onRemoteChange = () => { clearTimeout(changeTimer); changeTimer = setTimeout(refresh, 300); };

  // ---------- RSVP form ----------

  const rsvpForm = $("#rsvp-form");
  let plusOnes = 0;
  let rsvpEdited = false; // don't overwrite what the guest is typing on refresh

  function setPlus(n) {
    plusOnes = Math.max(0, Math.min(5, n));
    $("#plus-out").textContent = plusOnes;
    rsvpForm.querySelector('[data-step="-1"]').disabled = plusOnes === 0;
    rsvpForm.querySelector('[data-step="1"]').disabled = plusOnes === 5;
  }

  function syncPlusVisibility() {
    const status = rsvpForm.status.value;
    $("#plus-field").hidden = status === "no";
  }

  function fillRsvpForm() {
    if (rsvpEdited) return;
    const me = myRsvp();
    rsvpForm.name.value = knownName();
    rsvpForm.querySelectorAll('input[name="status"]').forEach((r) => { r.checked = Boolean(me) && r.value === me.status; });
    setPlus(me ? me.plus_ones : 0);
    syncPlusVisibility();
  }

  rsvpForm.addEventListener("input", () => { rsvpEdited = true; });
  rsvpForm.addEventListener("change", () => { rsvpEdited = true; syncPlusVisibility(); });
  rsvpForm.querySelectorAll("[data-step]").forEach((b) =>
    b.addEventListener("click", () => { rsvpEdited = true; setPlus(plusOnes + Number(b.dataset.step)); })
  );

  rsvpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = rsvpForm.name.value.trim();
    const status = rsvpForm.status.value;
    const err = $("#rsvp-error");
    if (!name) { err.textContent = "Please add your name."; rsvpForm.name.focus(); return; }
    if (!status) { err.textContent = "Are you coming? Pick one."; return; }
    const submit = rsvpForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api.saveRsvp(name, status, status === "no" ? 0 : plusOnes);
      local.set("bkt.name", name);
      rsvpEdited = false;
      err.textContent = "";
      toast(status === "yes" ? "Yay! See you Friday 🎉" : status === "maybe" ? "Got it. Hope to see you!" : "Thanks for letting us know 💛");
      await refresh();
    } catch (ex) {
      err.textContent = friendly(ex);
    } finally {
      submit.disabled = false;
    }
  });

  // ---------- Potluck dialog ----------

  const potDialog = $("#pot-dialog");
  const potForm = $("#pot-form");
  let potMode = null; // { kind: "claim", item } | { kind: "add", category }

  function openPot(mode) {
    potMode = mode;
    potForm.reset();
    $("#pot-error").textContent = "";
    potForm.name.value = knownName();
    if (mode.kind === "claim") {
      $("#pot-title").textContent = `You're bringing: ${mode.item.label}`;
      $("#pot-what-label").textContent = "What exactly? (optional)";
      potForm.what.placeholder = mode.item.category === "drinks" ? "e.g. Coke Zero + Sprite" : "e.g. mango and grapes";
      $("#pot-submit").textContent = "Claim it";
    } else {
      const cat = CATEGORIES.find((c) => c.id === mode.category);
      $("#pot-title").textContent = `Add to ${cat.title}`;
      $("#pot-what-label").textContent = "What are you bringing?";
      potForm.what.placeholder = { drinks: "e.g. Teh tarik", fruits: "e.g. Watermelon", dessert: "e.g. Pandan cake" }[cat.id];
      $("#pot-submit").textContent = "Add it";
    }
    potDialog.showModal();
    (potForm.name.value ? potForm.what : potForm.name).focus();
  }

  $("#potluck").addEventListener("click", async (e) => {
    const claimBtn = e.target.closest("[data-claim]");
    const addBtn = e.target.closest("[data-add]");
    const unclaimBtn = e.target.closest("[data-unclaim]");
    if (claimBtn) {
      const item = state.items.find((it) => it.id === claimBtn.dataset.claim);
      if (item) openPot({ kind: "claim", item });
    } else if (addBtn) {
      openPot({ kind: "add", category: addBtn.dataset.add });
    } else if (unclaimBtn) {
      unclaimBtn.disabled = true;
      try {
        await api.unclaim(unclaimBtn.dataset.unclaim);
        toast("Unclaimed. It's up for grabs again.");
        await refresh();
      } catch (ex) {
        toast(friendly(ex));
        unclaimBtn.disabled = false;
      }
    }
  });

  potForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = potForm.name.value.trim();
    const what = potForm.what.value.trim();
    const err = $("#pot-error");
    if (!name) { err.textContent = "Please add your name."; potForm.name.focus(); return; }
    if (potMode.kind === "add" && !what) { err.textContent = "What are you bringing?"; potForm.what.focus(); return; }
    const submit = $("#pot-submit");
    submit.disabled = true;
    try {
      if (potMode.kind === "claim") await api.claim(potMode.item.id, name, what);
      else await api.add(potMode.category, what, name);
      local.set("bkt.name", name);
      potDialog.close();
      toast("Thank you! Noted on the board 🙌");
      await refresh();
    } catch (ex) {
      err.textContent = friendly(ex);
      if (String(ex && ex.message).includes("already_claimed")) refresh();
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelectorAll("dialog [data-close]").forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close())
  );
  document.querySelectorAll("dialog").forEach((d) =>
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); })
  );

  // ---------- details buttons ----------

  $("#maps-link").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(EVENT.address);
  $("#gcal-link").href =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    "&text=" + encodeURIComponent(EVENT.title) +
    "&dates=" + EVENT.startUtc + "/" + EVENT.endUtc +
    "&details=" + encodeURIComponent(EVENT.details + "\n" + location.href.split("#")[0]) +
    "&location=" + encodeURIComponent(EVENT.location);

  $("#ics-btn").addEventListener("click", () => {
    const esc = (s) => s.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BKT Friyay//EN", "BEGIN:VEVENT",
      "UID:bkt-friyay-20261016@invitation",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""),
      "DTSTART:" + EVENT.startUtc, "DTEND:" + EVENT.endUtc,
      "SUMMARY:" + esc(EVENT.title), "LOCATION:" + esc(EVENT.location), "DESCRIPTION:" + esc(EVENT.details),
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "bkt-friyay-night.ics" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  $("#door-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("9218");
      toast("Door code copied: 9218");
    } catch {
      toast("Door code: 9218");
    }
  });

  // ---------- envelope intro ----------

  function openEnvelope() {
    const intro = $("#intro");
    if (intro.classList.contains("open")) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    intro.classList.add("open");
    setTimeout(() => {
      intro.classList.add("done");
      document.body.classList.remove("intro-active");
      $("#main").focus({ preventScroll: true });
      setTimeout(() => intro.remove(), 700);
    }, reduced ? 150 : 1900);
  }
  $("#envelope").addEventListener("click", openEnvelope);
  $("#intro").addEventListener("click", openEnvelope);

  // ---------- start ----------

  render();
  refresh();
  api.subscribe(onRemoteChange);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
})();
