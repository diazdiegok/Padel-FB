import { CATS, PAIRS_CONFIG_PATH, PAIRS_PATH, RANK_PATH } from "./constants.js";
import {
  DAYS,
  MAIL_DOMAINS,
  buildMail,
  cleanDays,
  fold,
  splitMail,
  validateDays,
} from "../lib/disponibilidad.js";
import { addPairsToRanking } from "../lib/scoring.js";
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

export function createParejas(ctx, api, shell, { onRankingChanged } = {}) {
  let term = "";
  let filterCat = "";
  let knownIds = new Set((ctx.pairs || []).map((p) => p.id));
  const deleted = new Set();
  const contactsDirty = new Set();
  let loaded = false;
  let closeTimer = 0;

  const season = () => ctx.siteData.currentSeason || "T4";
  const contact = (id) => ctx.contacts[id] || {};

  function seasonPairs() {
    const temp = season();
    return ctx.pairs.map((p, i) => ({ p, i })).filter(({ p }) => p.temp === temp);
  }

  function catCount(list, cat) {
    return cat ? list.filter(({ p }) => p.cat === cat).length : list.length;
  }

  function renderCats(list) {
    const box = $("pairs-cats");
    if (!box) return;
    const used = [...new Set([...CATS, ...list.map(({ p }) => p.cat)].filter(Boolean))];
    if (filterCat && !used.includes(filterCat) && filterCat !== "") filterCat = "";
    const total = list.length;
    box.innerHTML = [
      `<button class="pill${filterCat === "" ? " on" : ""}" type="button" data-pairs-cat="">Todas <small>${total}</small></button>`,
      ...used.map((c) => {
        const n = catCount(list, c);
        return `<button class="pill${filterCat === c ? " on" : ""}" type="button" data-pairs-cat="${esc(c)}">${esc(c)} <small>${n}</small></button>`;
      }),
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

  function render() {
    const temp = season();
    const list = seasonPairs();
    renderCats(list);
    const q = fold(term);
    let shown = filterCat ? list.filter(({ p }) => p.cat === filterCat) : list;
    if (q) {
      shown = shown.filter(({ p }) => {
        const c = contact(p.id);
        return fold(`${p.p1} ${p.p2} ${c.tel1 || ""} ${c.tel2 || ""} ${c.mail1 || ""} ${c.mail2 || ""} ${p.note || ""}`).includes(q);
      });
    }
    const filterTotal = catCount(list, filterCat);
    const totalLabel = filterCat || seasonLabel(temp);
    $("pairs-count").textContent =
      q && shown.length !== filterTotal
        ? `${shown.length} de ${filterTotal} pareja${filterTotal === 1 ? "" : "s"} en ${totalLabel}`
        : `${filterTotal} pareja${filterTotal === 1 ? "" : "s"} en ${totalLabel}`;
    const dupKeys = new Map();
    list.forEach(({ p }) => dupKeys.set(pairKey(p), (dupKeys.get(pairKey(p)) || 0) + 1));
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
                    const days = p.days && typeof p.days === "object" ? p.days : {};
                    const dayCount = Object.keys(days).length;
                    return `<article class="pairs-card${dupKeys.get(pairKey(p)) > 1 ? " is-dup" : ""}" data-i="${i}">
                      <div class="pairs-row">
                        <input data-k="p1" value="${esc(p.p1)}" placeholder="Integrante 1" aria-label="Integrante 1" />
                        <input data-k="tel1" value="${esc(c.tel1 || "")}" inputmode="tel" placeholder="WhatsApp" aria-label="WhatsApp integrante 1" />
                        <input data-k="p2" value="${esc(p.p2)}" placeholder="Integrante 2" aria-label="Integrante 2" />
                        <input data-k="tel2" value="${esc(c.tel2 || "")}" inputmode="tel" placeholder="WhatsApp" aria-label="WhatsApp integrante 2" />
                        <select data-k="cat" aria-label="Categoría">
                          ${CATS.map((opt) => `<option${opt === p.cat ? " selected" : ""}>${esc(opt)}</option>`).join("")}
                        </select>
                        <span class="pairs-origin">${dupKeys.get(pairKey(p)) > 1 ? "Repetida" : p.source === "ranking" ? "Del ranking" : p.source === "admin" ? "Admin" : "Web"}</span>
                        <button class="admin-del" type="button" data-pair-del="${i}" aria-label="Eliminar">×</button>
                      </div>
                      <div class="pairs-mail-row">
                        ${mailField("mail1", c.mail1 || "", "Mail 1")}
                        ${mailField("mail2", c.mail2 || "", "Mail 2")}
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
            ? filterCat || q
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
      await loadContacts().catch((err) => setMsg($("pairs-msg"), `No pude leer los contactos: ${err.message}`, "err"));
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
          origen: p.source === "ranking" ? "Ranking" : p.source === "admin" ? "Admin" : "Web",
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
    $("pairs-list")?.addEventListener("change", (e) => {
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
    $("pairs-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-pair-del]");
      if (!btn) return;
      const pair = ctx.pairs[Number(btn.dataset.pairDel)];
      const ok = await confirmModal({
        title: "Quitar pareja",
        body: `${pair.p1 || "?"} / ${pair.p2 || "?"} deja de aparecer en las inscripciones. Publicá para confirmarlo.`,
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      deleted.add(pair.id);
      delete ctx.contacts[pair.id];
      contactsDirty.add(pair.id);
      ctx.pairs.splice(Number(btn.dataset.pairDel), 1);
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
        const toRanking = Array.isArray(ranking) ? addPairsToRanking(ranking, seasonPairs) : [];
        await api.publishFiles(
          [
            { path: PAIRS_PATH, content: JSON.stringify(next, null, 2) + "\n" },
            { path: PAIRS_CONFIG_PATH, content: JSON.stringify(config, null, 2) + "\n" },
            ...(toRanking.length ? [{ path: RANK_PATH, content: JSON.stringify(ranking, null, 2) + "\n" }] : []),
          ],
          config.open ? "Actualiza parejas inscriptas desde el admin." : "Cierra la inscripción de parejas."
        );
        if (addPairsToRanking(ctx.rows, seasonPairs).length) onRankingChanged?.();
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
        render();
        const extra = fresh.length
          ? ` Se ${fresh.length === 1 ? "sumó 1 pareja que se inscribió" : `sumaron ${fresh.length} parejas que se inscribieron`} mientras editabas.`
          : "";
        const ranked = toRanking.length
          ? ` ${toRanking.length === 1 ? "1 pareja nueva quedó" : `${toRanking.length} parejas nuevas quedaron`} en el ranking con 0 puntos.`
          : "";
        setMsg($("pairs-msg"), "Parejas publicadas." + extra + ranked, "ok");
        toast("Parejas publicadas", "ok");
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
