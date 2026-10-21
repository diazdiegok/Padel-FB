import { CATS, PAIRS_CONFIG_PATH, PAIRS_PATH, RANK_PATH } from "./constants.js";
import { fold } from "../lib/disponibilidad.js";
import { addPairsToRanking } from "../lib/scoring.js";
import { seasonLabel, seasonNumber } from "../lib/liga.js";
import { downloadCsv } from "./csv.js";
import { $, confirmModal, escAttr as esc, setBusy, setMsg, toast } from "./ui.js";

const personKey = (name) => fold(name).split(" ").filter(Boolean).sort().join(" ");
const pairKey = (p) => [personKey(p.p1), personKey(p.p2)].sort().join("|");
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
const cleanPhone = (v) => String(v || "").replace(/\D/g, "").slice(0, 15);
const validDeadline = (v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || "") ? v : "");
const deadlinePassed = (v) => Boolean(v) && Date.now() > Date.parse(`${v}:00-03:00`);

function deadlineText(v) {
  const [date, time] = v.split("T");
  const [, month, day] = date.split("-");
  return `${Number(day)}/${Number(month)} ${time}`;
}

export function createParejas(ctx, api, shell, { onRankingChanged } = {}) {
  let term = "";
  let knownIds = new Set((ctx.pairs || []).map((p) => p.id));
  const deleted = new Set();
  const contactsDirty = new Set();
  let loaded = false;

  const season = () => ctx.siteData.currentSeason || "T4";
  const contact = (id) => ctx.contacts[id] || {};

  function fillConfig() {
    const cfg = ctx.pairsConfig;
    $("pairs-open").checked = cfg.open !== false;
    $("pairs-deadline").value = validDeadline(cfg.deadline);
    renderStatus();
  }

  function renderStatus() {
    const open = $("pairs-open").checked;
    const deadline = validDeadline($("pairs-deadline").value);
    const status = $("pairs-status");
    const closed = !open || deadlinePassed(deadline);
    status.textContent = !open
      ? "Inscripción cerrada"
      : closed
        ? `Cerrada · cerró el ${deadlineText(deadline)}`
        : deadline
          ? `Abierta hasta el ${deadlineText(deadline)}`
          : "Inscripción abierta";
    status.className = "admin-status-pill" + (closed ? " closed" : " open");
  }

  function render() {
    const temp = season();
    const list = ctx.pairs.map((p, i) => ({ p, i })).filter(({ p }) => p.temp === temp);
    const q = fold(term);
    const shown = q
      ? list.filter(({ p }) => fold(`${p.p1} ${p.p2} ${contact(p.id).tel1 || ""} ${contact(p.id).tel2 || ""}`).includes(q))
      : list;
    $("pairs-count").textContent = `${list.length} pareja${list.length === 1 ? "" : "s"} en ${seasonLabel(temp)}`;
    const dupKeys = new Map();
    list.forEach(({ p }) => dupKeys.set(pairKey(p), (dupKeys.get(pairKey(p)) || 0) + 1));
    const cats = [...new Set([...CATS, ...shown.map(({ p }) => p.cat)])].filter((c) => shown.some(({ p }) => p.cat === c));
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
                    return `<div class="pairs-row${dupKeys.get(pairKey(p)) > 1 ? " is-dup" : ""}" data-i="${i}">
                      <input data-k="p1" value="${esc(p.p1)}" placeholder="Integrante 1" aria-label="Integrante 1" />
                      <input data-k="tel1" value="${esc(c.tel1 || "")}" inputmode="tel" placeholder="WhatsApp" aria-label="WhatsApp integrante 1" />
                      <input data-k="p2" value="${esc(p.p2)}" placeholder="Integrante 2" aria-label="Integrante 2" />
                      <input data-k="tel2" value="${esc(c.tel2 || "")}" inputmode="tel" placeholder="WhatsApp" aria-label="WhatsApp integrante 2" />
                      <select data-k="cat" aria-label="Categoría">
                        ${CATS.map((c) => `<option${c === p.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}
                      </select>
                      <span class="pairs-origin">${dupKeys.get(pairKey(p)) > 1 ? "Repetida" : p.source === "ranking" ? "Del ranking" : p.source === "admin" ? "Admin" : "Web"}</span>
                      <button class="admin-del" type="button" data-pair-del="${i}" aria-label="Eliminar">×</button>
                    </div>`;
                  })
                  .join("")}
              </div>
            </section>`;
          })
          .join("")
      : `<div class="admin-empty"><p>${
          list.length
            ? "Nadie coincide con la búsqueda."
            : `Todavía no hay parejas inscriptas en ${esc(seasonLabel(temp))}. Compartí el link /inscribir-pareja/ o traé las del ranking.`
        }</p></div>`;
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
      await loadContacts().catch((err) => setMsg($("pairs-msg"), `No pude leer los WhatsApp: ${err.message}`, "err"));
      loaded = true;
      fillConfig();
      render();
      if (!quiet) toast("Parejas actualizadas", "ok");
    } catch (err) {
      render();
      if (!quiet || !loaded) setMsg($("pairs-msg"), err.message, "err");
    }
  }

  function importFromRanking() {
    const current = season();
    let temp = current;
    let rows = ctx.rows.filter((r) => r.temp === temp && String(r.name || "").includes("/"));
    if (!rows.length) {
      const prev = [...new Set(ctx.rows.map((r) => r.temp))]
        .filter((t) => seasonNumber(t) < seasonNumber(current))
        .sort((a, b) => seasonNumber(b) - seasonNumber(a))[0];
      if (prev) {
        temp = prev;
        rows = ctx.rows.filter((r) => r.temp === temp && String(r.name || "").includes("/"));
      }
    }
    if (!rows.length) {
      toast("No hay parejas en el ranking para traer", "err");
      return;
    }
    const have = new Set(ctx.pairs.filter((p) => p.temp === current).map(pairKey));
    let added = 0;
    for (const r of rows) {
      if (!CATS.includes(r.cat)) continue;
      const [p1, p2] = String(r.name).split("/").map((s) => s.trim());
      if (!p1 || !p2) continue;
      const pair = { id: newId() + added, createdAt: new Date().toISOString(), temp: current, cat: r.cat, p1, p2, source: "ranking" };
      if (have.has(pairKey(pair))) continue;
      have.add(pairKey(pair));
      ctx.pairs.push(pair);
      added += 1;
    }
    shell.markDirty("parejas");
    render();
    const from = temp === current ? "" : ` (tomadas de ${seasonLabel(temp)})`;
    setMsg($("pairs-msg"), added ? `Sumé ${added} parejas del ranking${from}. Revisá y guardá.` : "Todas las parejas del ranking ya estaban inscriptas.", "ok");
  }

  function exportCsv() {
    const temp = season();
    const list = ctx.pairs.filter((p) => p.temp === temp);
    if (!list.length) {
      toast("No hay parejas para exportar", "err");
      return;
    }
    const cols = ["categoria", "jugador1", "whatsapp1", "jugador2", "whatsapp2", "origen"];
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
          jugador2: p.p2,
          whatsapp2: contact(p.id).tel2 || "",
          origen: p.source === "ranking" ? "Ranking" : p.source === "admin" ? "Admin" : "Web",
        }))
    );
    toast("Parejas exportadas", "ok");
  }

  function bind() {
    ["pairs-open", "pairs-deadline"].forEach((id) => {
      $(id)?.addEventListener("change", () => {
        shell.markDirty("parejas");
        renderStatus();
      });
    });
    $("pairs-search")?.addEventListener("input", (e) => {
      term = e.target.value;
      render();
    });
    $("pairs-reload")?.addEventListener("click", () => reload({ quiet: false }));
    $("pairs-import")?.addEventListener("click", importFromRanking);
    $("pairs-export")?.addEventListener("click", exportCsv);
    $("pairs-add")?.addEventListener("click", () => {
      ctx.pairs.push({ id: newId(), createdAt: new Date().toISOString(), temp: season(), cat: CATS[0], p1: "", p2: "", source: "admin" });
      term = "";
      if ($("pairs-search")) $("pairs-search").value = "";
      shell.markDirty("parejas");
      render();
      const rows = document.querySelectorAll("#pairs-list .pairs-row input[data-k=p1]");
      [...rows].find((el) => !el.value)?.focus();
    });
    $("pairs-list")?.addEventListener("change", (e) => {
      const row = e.target.closest(".pairs-row");
      const k = e.target.dataset.k;
      if (!row || !k) return;
      const pair = ctx.pairs[Number(row.dataset.i)];
      if (k === "tel1" || k === "tel2") {
        ctx.contacts[pair.id] = { ...contact(pair.id), [k]: cleanPhone(e.target.value) };
        e.target.value = ctx.contacts[pair.id][k];
        contactsDirty.add(pair.id);
      } else {
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
        body: `${pair.p1 || "?"} / ${pair.p2 || "?"} deja de aparecer en el buscador de Fecha. Guardá para publicarlo.`,
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
      const config = { open: $("pairs-open").checked, deadline: validDeadline($("pairs-deadline").value) };
      setBusy($("pairs-publish"), true, "Guardando…");
      try {
        const remote = await api.readRemoteJson(PAIRS_PATH, []);
        const fresh = (Array.isArray(remote) ? remote : []).filter((p) => !knownIds.has(p.id) && !deleted.has(p.id));
        const next = [...ctx.pairs, ...fresh];
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
        setMsg($("pairs-msg"), "Parejas guardadas. El buscador de Fecha ya las usa." + extra + ranked, "ok");
        toast("Parejas guardadas", "ok");
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
