import { CATS, PAIRS_CONFIG_PATH, PAIRS_PATH, RANK_PATH } from "./constants.js";
import { fold } from "../lib/disponibilidad.js";
import { addPairsToRanking } from "../lib/scoring.js";
import { seasonLabel } from "../lib/liga.js";
import { downloadCsv } from "./csv.js";
import { $, confirmModal, escAttr as esc, setBusy, setMsg, toast } from "./ui.js";

const personKey = (name) => fold(name).split(" ").filter(Boolean).sort().join(" ");
const pairKey = (p) => [personKey(p.p1), personKey(p.p2)].sort().join("|");
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
const cleanPhone = (v) => String(v || "").replace(/\D/g, "").slice(0, 15);
import { deadlinePassed, deadlineText, validDeadline } from "../lib/cierre.js";

const COPY = {
  title: "Inscribí tu pareja",
  intro: "Se hace una sola vez por temporada. Después, cada semana solo entran a Fecha, buscan su pareja y marcan los días que pueden jugar.",
  hint: "Escriban los nombres completos y bien: así aparecen en el fixture, los resultados y el ranking. Los WhatsApp solo los ve la organización.",
  cta: "Inscribir pareja",
};

export function createParejas(ctx, api, shell, { onRankingChanged } = {}) {
  let term = "";
  let knownIds = new Set((ctx.pairs || []).map((p) => p.id));
  const deleted = new Set();
  const contactsDirty = new Set();
  let loaded = false;
  let closeTimer = 0;

  const season = () => ctx.siteData.currentSeason || "T4";
  const contact = (id) => ctx.contacts[id] || {};

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

  function renderStatus() {
    const deadline = validDeadline($("pairs-deadline").value);
    if (deadlinePassed(deadline)) $("pairs-open").checked = false;
    const open = $("pairs-open").checked;
    const status = $("pairs-status");
    const closed = !open;
    status.textContent = closed
      ? deadline
        ? `Cerrada · cerró el ${deadlineText(deadline)}`
        : "Inscripción cerrada"
      : deadline
        ? `Abierta hasta el ${deadlineText(deadline)}`
        : "Inscripción abierta";
    status.className = "admin-status-pill" + (closed ? " closed" : " open");
    clearTimeout(closeTimer);
    if (open && deadline) {
      const wait = Date.parse(`${deadline}:00-03:00`) - Date.now();
      if (wait > 0 && wait < 2147000000) closeTimer = setTimeout(renderStatus, wait + 250);
    }
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
            : `Todavía no hay parejas inscriptas en ${esc(seasonLabel(temp))}. Compartí el link /inscribir-pareja/.`
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
    ["pairs-open", "pairs-deadline", "pairs-title", "pairs-intro", "pairs-hint", "pairs-cta"].forEach((id) => {
      $(id)?.addEventListener("change", () => {
        shell.markDirty("parejas");
        renderStatus();
      });
    });
    $("pairs-deadline")?.addEventListener("input", renderStatus);
    $("pairs-search")?.addEventListener("input", (e) => {
      term = e.target.value;
      render();
    });
    $("pairs-reload")?.addEventListener("click", () => reload({ quiet: false }));
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
      const config = readConfig();
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
