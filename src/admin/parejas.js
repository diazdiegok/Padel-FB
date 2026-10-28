import { CATS, PAIRS_CONFIG_PATH, PAIRS_PATH, RANK_PATH, SITE_PATH } from "./constants.js";
import {
  DAYS,
  MAIL_DOMAINS,
  buildMail,
  cleanDays,
  fold,
  splitMail,
  validateDays,
} from "../lib/disponibilidad.js";
import {
  addPairsToRanking,
  findPairIndex,
  removePairsFromRanking,
  syncRankingToSeasonPairs,
} from "../lib/scoring.js";
import { seasonLabel } from "../lib/liga.js";
import { downloadCsv } from "./csv.js";
import { $, confirmModal, escAttr as esc, setBusy, setMsg, toast } from "./ui.js";
import { closeStatus, deadlinePassed, validDeadline } from "../lib/cierre.js";

const personKey = (name) => fold(name).split(" ").filter(Boolean).sort().join(" ");
const pairKey = (p) => [personKey(p.p1), personKey(p.p2)].sort().join("|");
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
const cleanPhone = (v) => String(v || "").replace(/\D/g, "").slice(0, 15);

const pad = (n) => String(n).padStart(2, "0");
const HOURS = [];
for (let m = 8 * 60; m <= 24 * 60; m += 30) HOURS.push(`${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`);
const FROM_HOURS = HOURS.slice(0, -3);
const TO_HOURS = HOURS.slice(3);

const COPY = {
  title: "Inscribí tu pareja",
  intro:
    "Se hace una sola vez por temporada. Completá contactos, categoría y los días en los que pueden jugar; con eso se arman las fechas del fixture.",
  hint: "Escriban los nombres completos y bien: así aparecen en el fixture, los resultados y el ranking. WhatsApp y mails solo los ve la organización.",
  cta: "Inscribir pareja",
};

function hoursSelect(name, value, options, label) {
  const [from = "", to = ""] = String(value || "")
    .split(/\s*-\s*/)
    .map((s) => s.trim());
  const current = name === "from" ? from : to;
  return `<select data-day-hours="${esc(label)}" data-hours="${name}" aria-label="${esc(label)} ${name === "from" ? "desde" : "hasta"}">
    <option value="">${name === "from" ? "Desde" : "Hasta"}</option>
    ${options.map((h) => `<option value="${esc(h)}"${h === current ? " selected" : ""}>${esc(h)}</option>`).join("")}
  </select>`;
}

function mailField(prefix, value, label) {
  const { local, domain } = splitMail(value);
  const selected = domain || MAIL_DOMAINS[0];
  const titled = /:$/.test(label) ? label : `${label}:`;
  return `<label class="pairs-mail">${esc(titled)}
    <span class="mail-split">
      <input data-k="${prefix}local" value="${esc(local)}" placeholder="usuario" aria-label="${esc(titled)} usuario" />
      <select data-k="${prefix}domain" aria-label="${esc(titled)} dominio">
        ${MAIL_DOMAINS.map((d) => `<option value="${esc(d)}"${d === selected ? " selected" : ""}>@${esc(d)}</option>`).join("")}
      </select>
    </span>
  </label>`;
}

function dayBox(card, day) {
  return [...card.querySelectorAll("[data-day]")].find((el) => el.dataset.day === day);
}

function dayHourSelects(card, day) {
  return [...card.querySelectorAll("[data-day-hours]")].filter((el) => el.dataset.dayHours === day);
}

function readDayHours(card, day) {
  const on = dayBox(card, day)?.checked;
  if (!on) return null;
  const from = dayHourSelects(card, day).find((el) => el.dataset.hours === "from")?.value || "";
  const to = dayHourSelects(card, day).find((el) => el.dataset.hours === "to")?.value || "";
  return from && to ? `${from} - ${to}` : "";
}

function syncCardDays(card) {
  card.querySelectorAll("[data-day]").forEach((box) => {
    const on = box.checked;
    dayHourSelects(card, box.dataset.day).forEach((sel) => {
      sel.disabled = !on;
      if (!on) sel.value = "";
    });
  });
}

const ORIGINS = [
  { id: "web", label: "Web", hint: "Se anotaron desde /inscribir-pareja/" },
  { id: "admin", label: "Admin", hint: "Las cargaste vos desde el panel" },
  { id: "ranking", label: "Del ranking", hint: "Vinieron del ranking" },
  { id: "dup", label: "Repetida", hint: "Misma pareja cargada más de una vez" },
];

function pairOrigin(p, dupKeys) {
  if (dupKeys.get(pairKey(p)) > 1) return "dup";
  if (p.source === "ranking") return "ranking";
  if (p.source === "admin") return "admin";
  return "web";
}

function originLabel(id) {
  return ORIGINS.find((o) => o.id === id)?.label || id;
}

export function createParejas(ctx, api, shell, { onRankingChanged } = {}) {
  let term = "";
  let filterCat = "";
  let filterOrigin = "";
  let knownIds = new Set((ctx.pairs || []).map((p) => p.id));
  const deleted = new Set();
  const contactsDirty = new Set();
  let loaded = false;
  let closeTimer = 0;
  ctx.payments = ctx.payments || {};

  const season = () => ctx.siteData.currentSeason || "T4";
  const contact = (id) => ctx.contacts[id] || {};
  const payment = (id) => ctx.payments[id] || {};

  function seasonPairs() {
    const temp = season();
    return ctx.pairs.map((p, i) => ({ p, i })).filter(({ p }) => p.temp === temp);
  }

  function dupMap(list) {
    const map = new Map();
    list.forEach(({ p }) => map.set(pairKey(p), (map.get(pairKey(p)) || 0) + 1));
    return map;
  }

  function matchesFilters(p, dupKeys) {
    if (filterCat && p.cat !== filterCat) return false;
    if (filterOrigin && pairOrigin(p, dupKeys) !== filterOrigin) return false;
    return true;
  }

  function renderCats(list, dupKeys) {
    const box = $("pairs-cats");
    if (!box) return;
    const base = filterOrigin ? list.filter(({ p }) => pairOrigin(p, dupKeys) === filterOrigin) : list;
    const used = [...new Set([...CATS, ...base.map(({ p }) => p.cat)].filter(Boolean))];
    if (filterCat && !used.includes(filterCat)) filterCat = "";
    box.innerHTML = [
      `<button class="pill${filterCat === "" ? " on" : ""}" type="button" data-pairs-cat="">Todas <small>${base.length}</small></button>`,
      ...used.map((c) => {
        const n = base.filter(({ p }) => p.cat === c).length;
        return `<button class="pill${filterCat === c ? " on" : ""}" type="button" data-pairs-cat="${esc(c)}">${esc(c)} <small>${n}</small></button>`;
      }),
    ].join("");
  }

  function renderOrigins(list, dupKeys) {
    const box = $("pairs-origins");
    if (!box) return;
    const base = filterCat ? list.filter(({ p }) => p.cat === filterCat) : list;
    const counts = Object.fromEntries(ORIGINS.map((o) => [o.id, 0]));
    base.forEach(({ p }) => {
      counts[pairOrigin(p, dupKeys)] += 1;
    });
    if (filterOrigin && !(filterOrigin in counts)) filterOrigin = "";
    box.innerHTML = [
      `<button class="pill${filterOrigin === "" ? " on" : ""}" type="button" data-pairs-origin="">Todos <small>${base.length}</small></button>`,
      ...ORIGINS.map(
        (o) =>
          `<button class="pill${filterOrigin === o.id ? " on" : ""}" type="button" data-pairs-origin="${o.id}" title="${esc(o.hint)}">${esc(o.label)} <small>${counts[o.id] || 0}</small></button>`
      ),
    ].join("");
  }

  function fillConfig() {
    const cfg = ctx.pairsConfig;
    $("pairs-open").checked = cfg.open !== false;
    $("pairs-deadline").value = validDeadline(cfg.deadline);
    $("pairs-title").value = cfg.title || COPY.title;
    $("pairs-intro").value = cfg.intro || COPY.intro;
    $("pairs-hint").value = cfg.hint || COPY.hint;
    $("pairs-cta").value = cfg.cta || COPY.cta;
    renderStatus();
  }

  function readConfig() {
    const text = (id, max, fallback) => $(id).value.trim().slice(0, max) || fallback;
    return {
      open: $("pairs-open").checked,
      deadline: validDeadline($("pairs-deadline").value),
      title: text("pairs-title", 80, COPY.title),
      intro: text("pairs-intro", 400, COPY.intro),
      hint: text("pairs-hint", 300, COPY.hint),
      cta: text("pairs-cta", 40, COPY.cta),
    };
  }

  function renderStatus({ keepOpen = false } = {}) {
    const deadline = validDeadline($("pairs-deadline").value);
    if (!keepOpen && deadlinePassed(deadline)) $("pairs-open").checked = false;
    const open = $("pairs-open").checked;
    const status = $("pairs-status");
    status.textContent = closeStatus(open, deadline);
    status.className = "admin-status-pill" + (open ? " open" : " closed");
    clearTimeout(closeTimer);
    if (open && deadline) {
      const wait = Date.parse(`${deadline}:00-03:00`) - Date.now();
      if (wait > 0 && wait < 2147000000) closeTimer = setTimeout(renderStatus, wait + 250);
    }
  }

  function renderSeasonBadge() {
    const temp = season();
    const badge = $("pairs-season");
    if (!badge) return;
    badge.textContent = seasonLabel(temp);
    badge.title = `Temporada del sistema (${temp}). Se cambia en Temporadas → Usar esta → Publicar.`;
  }

  function render() {
    const temp = season();
    renderSeasonBadge();
    const list = seasonPairs();
    const dupKeys = dupMap(list);
    renderCats(list, dupKeys);
    renderOrigins(list, dupKeys);
    const q = fold(term);
    let shown = list.filter(({ p }) => matchesFilters(p, dupKeys));
    if (q) {
      shown = shown.filter(({ p }) => {
        const c = contact(p.id);
        return fold(`${p.p1} ${p.p2} ${c.tel1 || ""} ${c.tel2 || ""} ${c.mail1 || ""} ${c.mail2 || ""} ${p.note || ""}`).includes(q);
      });
    }
    const filterTotal = list.filter(({ p }) => matchesFilters(p, dupKeys)).length;
    const parts = [filterCat, filterOrigin ? originLabel(filterOrigin) : ""].filter(Boolean);
    const totalLabel = parts.length ? parts.join(" · ") : seasonLabel(temp);
    $("pairs-count").textContent =
      q && shown.length !== filterTotal
        ? `${shown.length} de ${filterTotal} pareja${filterTotal === 1 ? "" : "s"} en ${totalLabel}`
        : `${filterTotal} pareja${filterTotal === 1 ? "" : "s"} en ${totalLabel}`;
    const cats = filterCat
      ? shown.length
        ? [filterCat]
        : []
      : [...new Set([...CATS, ...shown.map(({ p }) => p.cat)])].filter((c) => shown.some(({ p }) => p.cat === c));
    $("pairs-list").innerHTML = cats.length
      ? cats
          .map((cat) => {
            const rows = shown.filter(({ p }) => p.cat === cat).sort((a, b) => a.p.p1.localeCompare(b.p.p1, "es"));
            return `<section class="admin-disp-group">
              <h3>${esc(cat)} · ${rows.length}</h3>
              <div class="pairs-rows">
                ${rows
                  .map(({ p, i }) => {
                    const c = contact(p.id);
                    const pay = payment(p.id);
                    const days = p.days && typeof p.days === "object" ? p.days : {};
                    const dayCount = Object.keys(days).length;
                    return `<article class="pairs-card${dupKeys.get(pairKey(p)) > 1 ? " is-dup" : ""}${pay.verified ? " is-paid" : ""}" data-i="${i}" data-pair-id="${esc(p.id)}">
                      <div class="pairs-row">
                        <input data-k="p1" value="${esc(p.p1)}" placeholder="Integrante 1" aria-label="Integrante 1" />
                        <input data-k="tel1" value="${esc(c.tel1 || "")}" inputmode="tel" placeholder="WhatsApp" aria-label="WhatsApp integrante 1" />
                        <input data-k="p2" value="${esc(p.p2)}" placeholder="Integrante 2" aria-label="Integrante 2" />
                        <input data-k="tel2" value="${esc(c.tel2 || "")}" inputmode="tel" placeholder="WhatsApp" aria-label="WhatsApp integrante 2" />
                        <select data-k="cat" aria-label="Categoría">
                          ${CATS.map((opt) => `<option${opt === p.cat ? " selected" : ""}>${esc(opt)}</option>`).join("")}
                        </select>
                        <span class="pairs-origin">${esc(originLabel(pairOrigin(p, dupKeys)))}</span>
                        <button class="admin-del" type="button" data-pair-del="${i}" aria-label="Eliminar">×</button>
                      </div>
                      <div class="pairs-mail-row">
                        ${mailField("mail1", c.mail1 || "", "Mail 1")}
                        ${mailField("mail2", c.mail2 || "", "Mail 2")}
                      </div>
                      <div class="pairs-pay">
                        ${
                          pay.hasReceipt
                            ? `<button class="btn btn-ghost pairs-pay-view" type="button" data-pay-view="${esc(p.id)}">Ver comprobante</button>`
                            : `<span class="muted">Sin comprobante (WSP u otro)</span>`
                        }
                        <label class="chk pairs-pay-check">
                          <input type="checkbox" data-pay-verified="${esc(p.id)}" ${pay.verified ? "checked" : ""} />
                          Pago verificado
                        </label>
                      </div>
                      <details class="pairs-avail">
                        <summary>Disponibilidad · ${dayCount ? `${dayCount} día${dayCount === 1 ? "" : "s"}` : "sin días"}</summary>
                        <div class="day-list pairs-day-list">
                          ${DAYS.map((day) => {
                            const on = Object.prototype.hasOwnProperty.call(days, day);
                            return `<div class="day-row">
                              <label class="day-check">
                                <input type="checkbox" data-day="${esc(day)}"${on ? " checked" : ""} />
                                <span>${esc(day)}</span>
                              </label>
                              <span class="day-hours">
                                ${hoursSelect("from", days[day] || "", FROM_HOURS, day)}
                                ${hoursSelect("to", days[day] || "", TO_HOURS, day)}
                              </span>
                            </div>`;
                          }).join("")}
                        </div>
                        <label class="pairs-note">Nota:
                          <textarea data-k="note" rows="2" maxlength="500">${esc(p.note || "")}</textarea>
                        </label>
                      </details>
                    </article>`;
                  })
                  .join("")}
              </div>
            </section>`;
          })
          .join("")
      : `<div class="admin-empty"><p>${
          list.length
            ? filterCat || filterOrigin || q
              ? "Nadie coincide con el filtro o la búsqueda."
              : "Nadie coincide con la búsqueda."
            : `Todavía no hay parejas inscriptas en ${esc(seasonLabel(temp))}. Compartí el link /inscribir-pareja/.`
        }</p></div>`;
    document.querySelectorAll("#pairs-list .pairs-card").forEach(syncCardDays);
  }

  function touchContactMail(card, pair) {
    const local1 = card.querySelector("[data-k=mail1local]")?.value || "";
    const domain1 = card.querySelector("[data-k=mail1domain]")?.value || "";
    const local2 = card.querySelector("[data-k=mail2local]")?.value || "";
    const domain2 = card.querySelector("[data-k=mail2domain]")?.value || "";
    ctx.contacts[pair.id] = {
      ...contact(pair.id),
      mail1: buildMail(local1, domain1),
      mail2: buildMail(local2, domain2),
    };
    contactsDirty.add(pair.id);
  }

  function touchDays(card, pair) {
    const days = {};
    DAYS.forEach((day) => {
      const value = readDayHours(card, day);
      if (value !== null) days[day] = value;
    });
    pair.days = days;
    const summary = card.querySelector("summary");
    const n = Object.keys(days).length;
    if (summary) summary.textContent = `Disponibilidad · ${n ? `${n} día${n === 1 ? "" : "s"}` : "sin días"}`;
  }

  async function loadContacts() {
    const remote = await api.worker("/pairs/contacts");
    const local = Object.fromEntries([...contactsDirty].map((id) => [id, ctx.contacts[id]]));
    ctx.contacts = { ...(remote || {}), ...local };
  }

  async function loadPayments() {
    const remote = await api.worker("/pairs/payments");
    ctx.payments = remote && typeof remote === "object" ? remote : {};
  }

  async function openReceipt(id) {
    const box = $("pay-lightbox");
    const body = $("pay-lightbox-body");
    if (!box || !body) return;
    body.innerHTML = `<p class="muted">Cargando comprobante…</p>`;
    box.showModal();
    try {
      const pay = await api.worker(`/pairs/payment?id=${encodeURIComponent(id)}`);
      const src = `data:${pay.mime || "image/jpeg"};base64,${pay.data}`;
      if (String(pay.mime || "").includes("pdf")) {
        body.innerHTML = `<iframe class="pay-frame" src="${src}#view=FitH" title="Comprobante"></iframe>`;
      } else {
        body.innerHTML = `<img class="pay-img" src="${src}" alt="Comprobante de pago" />`;
      }
    } catch (err) {
      body.innerHTML = `<p class="admin-msg err">${esc(err?.message || "No se pudo abrir el comprobante.")}</p>`;
    }
  }

  async function reload({ quiet = true } = {}) {
    if (!ctx.token || ctx.dirty.has("parejas")) {
      render();
      return;
    }
    try {
      const [remote, config] = await Promise.all([
        api.readRemoteJson(PAIRS_PATH, []),
        api.readRemoteJson(PAIRS_CONFIG_PATH, { open: true, deadline: "" }),
      ]);
      ctx.pairs = Array.isArray(remote) ? remote : [];
      ctx.pairsConfig = { open: true, deadline: "", ...config };
      knownIds = new Set(ctx.pairs.map((p) => p.id));
      deleted.clear();
      contactsDirty.clear();
      await Promise.all([
        loadContacts().catch((err) => setMsg($("pairs-msg"), `No pude leer los contactos: ${err.message}`, "err")),
        loadPayments().catch(() => {
          ctx.payments = {};
        }),
      ]);
      loaded = true;
      fillConfig();
      render();
      if (!quiet) toast("Parejas actualizadas", "ok");
    } catch (err) {
      render();
      if (!quiet || !loaded) setMsg($("pairs-msg"), err.message, "err");
    }
  }

  function exportCsv() {
    const temp = season();
    const list = ctx.pairs.filter((p) => p.temp === temp);
    if (!list.length) {
      toast("No hay parejas para exportar", "err");
      return;
    }
    const cols = ["categoria", "jugador1", "whatsapp1", "mail1", "jugador2", "whatsapp2", "mail2", "disponibilidad", "nota", "origen"];
    const dups = dupMap(list.map((p) => ({ p })));
    downloadCsv(
      `parejas-${temp.toLowerCase()}.csv`,
      cols,
      list
        .slice()
        .sort((a, b) => a.cat.localeCompare(b.cat, "es") || a.p1.localeCompare(b.p1, "es"))
        .map((p) => ({
          categoria: p.cat,
          jugador1: p.p1,
          whatsapp1: contact(p.id).tel1 || "",
          mail1: contact(p.id).mail1 || "",
          jugador2: p.p2,
          whatsapp2: contact(p.id).tel2 || "",
          mail2: contact(p.id).mail2 || "",
          disponibilidad: Object.entries(p.days || {})
            .map(([d, h]) => `${d} ${h}`)
            .join(" | "),
          nota: p.note || "",
          origen: originLabel(pairOrigin(p, dups)),
        }))
    );
    toast("Parejas exportadas", "ok");
  }

  function bind() {
    ["pairs-open", "pairs-deadline", "pairs-title", "pairs-intro", "pairs-hint", "pairs-cta"].forEach((id) => {
      $(id)?.addEventListener("change", () => {
        if (id === "pairs-open" && $(id).checked && deadlinePassed($("pairs-deadline").value)) {
          $("pairs-deadline").value = "";
        }
        shell.markDirty("parejas");
        renderStatus({ keepOpen: id === "pairs-open" && $(id).checked });
      });
    });
    $("pairs-deadline")?.addEventListener("input", renderStatus);
    $("pairs-search")?.addEventListener("input", (e) => {
      term = e.target.value;
      render();
    });
    $("pairs-cats")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pairs-cat]");
      if (!btn) return;
      filterCat = btn.dataset.pairsCat || "";
      render();
    });
    $("pairs-origins")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pairs-origin]");
      if (!btn) return;
      filterOrigin = btn.dataset.pairsOrigin || "";
      render();
    });
    $("pairs-reload")?.addEventListener("click", () => reload({ quiet: false }));
    $("pairs-export")?.addEventListener("click", exportCsv);
    $("pairs-add")?.addEventListener("click", () => {
      const cat = filterCat || CATS[0];
      ctx.pairs.push({
        id: newId(),
        createdAt: new Date().toISOString(),
        temp: season(),
        cat,
        p1: "",
        p2: "",
        days: {},
        note: "",
        source: "admin",
      });
      term = "";
      if ($("pairs-search")) $("pairs-search").value = "";
      shell.markDirty("parejas");
      render();
      const rows = document.querySelectorAll("#pairs-list .pairs-row input[data-k=p1]");
      [...rows].find((el) => !el.value)?.focus();
    });
    $("pairs-list")?.addEventListener("change", async (e) => {
      const payBox = e.target.closest("[data-pay-verified]");
      if (payBox) {
        const id = payBox.dataset.payVerified;
        const verified = payBox.checked;
        try {
          const res = await api.worker("/pairs/payment/verify", { id, verified });
          ctx.payments[id] = {
            ...(ctx.payments[id] || {}),
            hasReceipt: Boolean(res?.hasReceipt ?? ctx.payments[id]?.hasReceipt),
            verified,
          };
          payBox.closest(".pairs-card")?.classList.toggle("is-paid", verified);
          toast(verified ? "Pago verificado" : "Pago sin verificar", "ok");
        } catch (err) {
          payBox.checked = !verified;
          toast(err?.message || "No se pudo guardar la verificación.", "err");
        }
        return;
      }
      const card = e.target.closest(".pairs-card");
      if (!card) return;
      const pair = ctx.pairs[Number(card.dataset.i)];
      if (!pair) return;
      const k = e.target.dataset.k;
      if (e.target.matches("[data-day], [data-day-hours]")) {
        syncCardDays(card);
        touchDays(card, pair);
        shell.markDirty("parejas");
        return;
      }
      if (k === "tel1" || k === "tel2") {
        ctx.contacts[pair.id] = { ...contact(pair.id), [k]: cleanPhone(e.target.value) };
        e.target.value = ctx.contacts[pair.id][k];
        contactsDirty.add(pair.id);
      } else if (k === "mail1local" || k === "mail1domain" || k === "mail2local" || k === "mail2domain") {
        touchContactMail(card, pair);
      } else if (k === "note") {
        pair.note = e.target.value.replace(/\s+/g, " ").trim().slice(0, 500);
      } else if (k) {
        pair[k] = e.target.value.replace(/\s+/g, " ").trim();
      }
      shell.markDirty("parejas");
      if (k === "cat") render();
    });
    $("pay-lightbox-close")?.addEventListener("click", () => $("pay-lightbox")?.close());
    $("pay-lightbox")?.addEventListener("click", (e) => {
      if (e.target === $("pay-lightbox")) $("pay-lightbox")?.close();
    });

    $("pairs-list")?.addEventListener("click", async (e) => {
      const view = e.target.closest("[data-pay-view]");
      if (view) {
        await openReceipt(view.dataset.payView);
        return;
      }
      const btn = e.target.closest("[data-pair-del]");
      if (!btn) return;
      const pair = ctx.pairs[Number(btn.dataset.pairDel)];
      if (!pair) return;
      const label = `${pair.p1 || "?"} / ${pair.p2 || "?"}`;
      const rankIdx =
        pair.p1 && pair.p2 && pair.cat
          ? findPairIndex(ctx.rows || [], `${pair.p1} / ${pair.p2}`, pair.cat, pair.temp || season())
          : -1;
      const rankRow = rankIdx >= 0 ? ctx.rows[rankIdx] : null;
      const hasStats = rankRow && (Number(rankRow.pts) || Number(rankRow.pj));
      const ok = await confirmModal({
        title: "Quitar pareja",
        body: hasStats
          ? `${label} se quita de las inscripciones y del ranking (${Number(rankRow.pts) || 0} pts, ${Number(rankRow.pj) || 0} PJ). Publicá parejas para confirmarlo.`
          : `${label} se quita de las inscripciones y del ranking. Publicá parejas para confirmarlo.`,
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      deleted.add(pair.id);
      delete ctx.contacts[pair.id];
      delete ctx.payments[pair.id];
      contactsDirty.add(pair.id);
      api.worker("/pairs/payment/delete", { id: pair.id }).catch(() => {});
      ctx.pairs.splice(Number(btn.dataset.pairDel), 1);
      if (removePairsFromRanking(ctx.rows || [], [pair]).length) {
        shell.markDirty("ranking");
        onRankingChanged?.();
      }
      shell.markDirty("parejas");
      render();
    });

    $("pairs-publish")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const incomplete = ctx.pairs.find((p) => !p.p1 || !p.p2);
      if (incomplete) {
        setMsg($("pairs-msg"), "Hay una pareja sin los dos integrantes. Completala o quitala.", "err");
        return;
      }
      for (const p of ctx.pairs.filter((row) => row.temp === season())) {
        const days = cleanDays(p.days || {});
        p.days = days;
        if (Object.keys(days).length) {
          const dayErr = validateDays(days);
          if (dayErr) {
            setMsg($("pairs-msg"), `${p.p1} / ${p.p2}: ${dayErr}`, "err");
            return;
          }
        }
      }
      const config = readConfig();
      setBusy($("pairs-publish"), true, "Publicando…");
      try {
        const remote = await api.readRemoteJson(PAIRS_PATH, []);
        const fresh = (Array.isArray(remote) ? remote : []).filter((p) => !knownIds.has(p.id) && !deleted.has(p.id));
        const next = [...ctx.pairs, ...fresh].map((p) => ({
          ...p,
          days: cleanDays(p.days || {}),
          note: String(p.note || "").trim().slice(0, 500),
        }));
        const seasonPairs = next.filter((p) => p.temp === season());
        const ranking = await api.readRemoteJson(RANK_PATH, []);
        const rankRows = Array.isArray(ranking) ? ranking : [];
        const dropped = syncRankingToSeasonPairs(rankRows, seasonPairs, season());
        const toRanking = addPairsToRanking(rankRows, seasonPairs);
        const rankingChanged = dropped.length > 0 || toRanking.length > 0;
        const closing = config.open === false;
        const goLive = closing && String(ctx.siteData.seasonPhase || "").toLowerCase() !== "live";
        const files = [
          { path: PAIRS_PATH, content: JSON.stringify(next, null, 2) + "\n" },
          { path: PAIRS_CONFIG_PATH, content: JSON.stringify(config, null, 2) + "\n" },
          ...(rankingChanged ? [{ path: RANK_PATH, content: JSON.stringify(rankRows, null, 2) + "\n" }] : []),
        ];
        if (goLive) {
          const siteRemote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
          const nextSite = { ...siteRemote, ...ctx.siteData, seasonPhase: "live" };
          files.push({ path: SITE_PATH, content: JSON.stringify(nextSite, null, 2) + "\n" });
          Object.assign(ctx.siteData, nextSite);
        }
        await api.publishFiles(
          files,
          closing
            ? goLive
              ? "Cierra la inscripción de parejas y pone la temporada en juego."
              : "Cierra la inscripción de parejas."
            : "Actualiza parejas inscriptas desde el admin."
        );
        const localDropped = syncRankingToSeasonPairs(ctx.rows || [], seasonPairs, season());
        const localAdded = addPairsToRanking(ctx.rows || [], seasonPairs);
        if (localDropped.length || localAdded.length) onRankingChanged?.();
        ctx.pairs = next;
        ctx.pairsConfig = config;
        knownIds = new Set(next.map((p) => p.id));
        deleted.clear();
        if (contactsDirty.size) {
          await api.worker("/pairs/contacts", {
            contacts: Object.fromEntries([...contactsDirty].map((id) => [id, ctx.contacts[id] || null])),
          });
          contactsDirty.clear();
        }
        if (fresh.length) await loadContacts().catch(() => {});
        shell.clearDirty("parejas");
        shell.clearDirty("ranking");
        if (goLive) shell.clearDirty("temporadas");
        render();
        const extra = fresh.length
          ? ` Se ${fresh.length === 1 ? "sumó 1 pareja que se inscribió" : `sumaron ${fresh.length} parejas que se inscribieron`} mientras editabas.`
          : "";
        const ranked = toRanking.length
          ? ` ${toRanking.length === 1 ? "1 pareja nueva quedó" : `${toRanking.length} parejas nuevas quedaron`} en el ranking con 0 puntos.`
          : "";
        const unranked = dropped.length
          ? ` Se ${dropped.length === 1 ? "quitó 1 pareja" : `quitaron ${dropped.length} parejas`} del ranking.`
          : "";
        const liveNote = goLive ? " La temporada pasó a En juego." : "";
        setMsg($("pairs-msg"), "Parejas publicadas." + extra + ranked + unranked + liveNote, "ok");
        toast(goLive ? "Inscripción cerrada · En juego" : "Parejas publicadas", "ok");
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("pairs-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("pairs-publish"), false);
      }
    });
  }

  return { bind, render: () => (fillConfig(), render()), reload };
}
