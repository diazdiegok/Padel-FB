import { DISP_PATH, pairLabel } from "../lib/disponibilidad.js";
import { weekNumber } from "../lib/liga.js";
import { $, confirmModal, escAttr as esc, setBusy, setMsg, toast } from "./ui.js";

export function createFecha(ctx, api, shell, { onBuildFixture } = {}) {
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
    const groups = [...new Set(list.map((e) => e.cat || "Sin categoría"))];
    $("disp-list").innerHTML = groups.length
      ? groups
          .map((cat) => {
            const rows = list.filter((e) => (e.cat || "Sin categoría") === cat);
            return `<section class="admin-disp-group">
              <h3>${esc(cat)} · ${rows.length}</h3>
              <div class="admin-disp-rows">
                ${rows
                  .map((e) => {
                    const when = e.bye
                      ? "No juega esta semana"
                      : Object.entries(e.days || {})
                          .map(([d, h]) => `${d} ${h}`)
                          .join(" · ");
                    return `<article class="admin-disp-card" data-disp="${esc(e.id)}">
                      <div class="admin-result-meta">
                        <span>${e.bye ? "No juega" : e.recover ? "Recupera" : "Fecha"}</span>
                        <span>${esc(when || "Sin horario")}</span>
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
      : `<div class="admin-empty" id="disp-empty"><p>Todavía no hay disponibilidades en ${esc(ctx.disp.week || "esta fecha")}.</p></div>`;
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
    $("disp-build")?.addEventListener("click", () => onBuildFixture?.());

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
