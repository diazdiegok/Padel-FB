import { DISP_PATH, fold, pairLabel } from "../lib/disponibilidad.js";
import { weekNumber } from "../lib/liga.js";
import { downloadCsv } from "./csv.js";
import { $, confirmModal, escAttr as esc, setBusy, setMsg, toast } from "./ui.js";

const sentAt = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
};

const daysText = (e) =>
  e.bye
    ? "No juega esta semana"
    : Object.entries(e.days || {})
        .map(([d, h]) => `${d} ${h}`)
        .join(" · ");

export function createFecha(ctx, api, shell) {
  let term = "";

  function renderSummary(list) {
    const box = $("disp-summary");
    if (!box) return;
    const cats = [...new Set(list.map((e) => e.cat || "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));
    box.innerHTML = cats
      .map((cat) => {
        const rows = list.filter((e) => (e.cat || "Sin categoría") === cat);
        const playing = rows.filter((e) => !e.bye).length;
        const recover = rows.filter((e) => e.recover && !e.bye).length;
        return `<div class="disp-sum-card">
          <span>${esc(cat)}</span>
          <strong>${playing}</strong>
          <small>juegan${rows.length - playing ? ` · ${rows.length - playing} no` : ""}${recover ? ` · ${recover} recupera${recover === 1 ? "" : "n"}` : ""}</small>
        </div>`;
      })
      .join("");
  }

  function fill() {
    $("disp-week").value = ctx.disp.week || "Fecha 1";
    $("disp-deadline").value = ctx.disp.deadline || "";
    $("disp-open").checked = ctx.disp.open !== false;
    const list = ctx.disp.entries || [];
    const playing = list.filter((e) => !e.bye).length;
    $("disp-count").textContent =
      list.length + (list.length === 1 ? " pareja anotada" : " parejas anotadas") + (list.length !== playing ? ` · ${playing} juegan` : "");
    const status = $("disp-status");
    if (status) {
      status.textContent = ctx.disp.open !== false ? "Carga abierta" : "Carga cerrada";
      status.className = "admin-status-pill" + (ctx.disp.open !== false ? " open" : " closed");
    }
    renderSummary(list);
    const q = fold(term);
    const shown = q ? list.filter((e) => fold([e.p1, e.p2, e.note].join(" ")).includes(q)) : list;
    const groups = [...new Set(shown.map((e) => e.cat || "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));
    $("disp-list").innerHTML = groups.length
      ? groups
          .map((cat) => {
            const rows = shown
              .filter((e) => (e.cat || "Sin categoría") === cat)
              .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
            return `<section class="admin-disp-group">
              <h3>${esc(cat)} · ${rows.length}</h3>
              <div class="admin-disp-rows">
                ${rows
                  .map((e) => {
                    const when = daysText(e);
                    const sent = sentAt(e.createdAt);
                    return `<article class="admin-disp-card${e.bye ? " is-bye" : ""}" data-disp="${esc(e.id)}">
                      <div class="admin-result-meta">
                        <span>${e.bye ? "No juega" : e.recover ? "Recupera · 2 partidos" : "Juega"}</span>
                        <span>${esc(when || "Sin horario")}</span>
                        ${sent ? `<span class="disp-sent">Enviado ${esc(sent)}</span>` : ""}
                      </div>
                      <strong>${esc(pairLabel(e))}</strong>
                      ${e.note ? `<p class="admin-help">${esc(e.note)}</p>` : ""}
                      <button class="admin-del" type="button" data-disp-del="${esc(e.id)}" aria-label="Eliminar">×</button>
                    </article>`;
                  })
                  .join("")}
              </div>
            </section>`;
          })
          .join("")
      : `<div class="admin-empty" id="disp-empty"><p>${
          list.length ? "Nadie coincide con la búsqueda." : `Todavía no se anotó nadie en ${esc(ctx.disp.week || "esta fecha")}. Compartí el link /fecha/ de la web.`
        }</p></div>`;
  }

  async function readLatest() {
    const file = await api.api(`/repos/${ctx.owner}/${ctx.repo}/contents/${DISP_PATH}?ref=main`);
    return JSON.parse(api.fromB64(String(file.content || "").replace(/\n/g, "")));
  }

  async function reload({ quiet = false } = {}) {
    if (!ctx.token) {
      fill();
      return;
    }
    try {
      ctx.disp = await readLatest();
      fill();
      if (!quiet) {
        toast("Disponibilidades actualizadas", "ok");
        setMsg($("disp-msg"), "Disponibilidades actualizadas.", "ok");
      }
    } catch (err) {
      fill();
      setMsg($("disp-msg"), err.message, "err");
      if (!quiet) toast(err.message, "err");
    }
  }

  async function save(latest, message, done) {
    setMsg($("disp-msg"), "Guardando fecha…");
    try {
      await api.publishFile(DISP_PATH, JSON.stringify(latest, null, 2) + "\n", message);
      ctx.disp = latest;
      shell.clearDirty("fecha");
      fill();
      setMsg($("disp-msg"), done, "ok");
      toast("Fecha guardada", "ok");
      return true;
    } catch (err) {
      setMsg($("disp-msg"), err.message, "err");
      toast(err.message, "err");
      return false;
    }
  }

  function bind() {
    ["disp-week", "disp-deadline", "disp-open"].forEach((id) => {
      $(id)?.addEventListener("change", () => shell.markDirty("fecha"));
      $(id)?.addEventListener("input", () => shell.markDirty("fecha"));
    });

    $("disp-reload")?.addEventListener("click", () => reload());
    $("disp-search")?.addEventListener("input", (e) => {
      term = e.target.value;
      fill();
    });
    $("disp-export")?.addEventListener("click", () => {
      const list = ctx.disp.entries || [];
      if (!list.length) {
        toast("No hay inscripciones para exportar", "err");
        return;
      }
      const cols = ["categoria", "jugador1", "jugador2", "juega", "recupera", "dias", "nota", "enviado"];
      downloadCsv(
        `inscripciones-${fold(ctx.disp.week || "fecha").replace(/\s+/g, "-")}.csv`,
        cols,
        list.map((e) => ({
          categoria: e.cat,
          jugador1: e.p1,
          jugador2: e.p2,
          juega: e.bye ? "No" : "Sí",
          recupera: e.recover ? "Sí" : "No",
          dias: daysText(e),
          nota: e.note,
          enviado: sentAt(e.createdAt),
        }))
      );
      toast("Inscripciones exportadas", "ok");
    });
    $("disp-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-disp-del]");
      if (!btn) return;
      const ok = await confirmModal({
        title: "Quitar pareja",
        body: "Se elimina de la lista local. Guardá la fecha para publicar el cambio.",
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      ctx.disp.entries = (ctx.disp.entries || []).filter((row) => row.id !== btn.dataset.dispDel);
      shell.markDirty("fecha");
      fill();
    });

    $("disp-publish")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      ctx.disp.week = $("disp-week").value.trim() || "Fecha 1";
      ctx.disp.deadline = $("disp-deadline").value.trim();
      ctx.disp.open = $("disp-open").checked;
      ctx.disp.temp = ctx.siteData.currentSeason || "T4";
      setBusy($("disp-publish"), true, "Guardando…");
      try {
        const latest = await readLatest();
        const keepIds = new Set((ctx.disp.entries || []).map((e) => e.id));
        latest.week = ctx.disp.week;
        latest.deadline = ctx.disp.deadline;
        latest.open = ctx.disp.open;
        latest.temp = ctx.disp.temp;
        latest.entries = (latest.entries || []).filter((e) => keepIds.has(e.id));
        await save(
          latest,
          latest.open ? `Abre carga de ${latest.week}.` : `Cierra carga de ${latest.week}.`,
          "Fecha guardada. El sitio se actualiza en ~1 minuto."
        );
      } catch (err) {
        setMsg($("disp-msg"), err.message, "err");
        toast(err.message, "err");
      } finally {
        setBusy($("disp-publish"), false);
      }
    });

    $("disp-next")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const season = ctx.siteData.currentSeason || "T4";
      const sameSeason = (ctx.disp.temp || season) === season;
      const current = ctx.disp.week || "Fecha 0";
      const nextWeek = sameSeason ? `Fecha ${(weekNumber(current) || 0) + 1}` : "Fecha 1";
      const entries = ctx.disp.entries || [];
      const built = ctx.fixture.some((m) => m.week === current);
      const ok = await confirmModal({
        title: `Abrir ${nextWeek}`,
        body:
          (entries.length && !built
            ? `Ojo: todavía no armaste el fixture de ${current}. Las ${entries.length} inscripciones se borran al abrir la próxima. `
            : entries.length
              ? `Se vacía la lista de ${current} (el fixture ya está armado). `
              : "") + `Las parejas pueden anotarse para ${nextWeek} en /fecha/.`,
        confirmLabel: `Abrir ${nextWeek}`,
        danger: entries.length > 0 && !built,
      });
      if (!ok) return;
      setBusy($("disp-next"), true, "Abriendo…");
      try {
        const latest = await readLatest();
        await save(
          { ...latest, week: nextWeek, temp: season, deadline: "", open: true, entries: [] },
          `Abre carga de ${nextWeek}.`,
          `${nextWeek} abierta. Cargá la fecha límite si querés mostrarla.`
        );
      } catch (err) {
        setMsg($("disp-msg"), err.message, "err");
        toast(err.message, "err");
      } finally {
        setBusy($("disp-next"), false);
      }
    });
  }

  return { bind, fill, reload, readLatest };
}
