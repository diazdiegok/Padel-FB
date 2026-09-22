import { DISP_PATH, pairLabel } from "../lib/disponibilidad.js";
import { $, confirmModal, setBusy, setMsg, toast } from "./ui.js";

export function createFecha(ctx, api, shell) {
  function fill() {
    $("disp-week").value = ctx.disp.week || "Fecha 6";
    $("disp-deadline").value = ctx.disp.deadline || "";
    $("disp-open").checked = ctx.disp.open !== false;
    const list = ctx.disp.entries || [];
    $("disp-count").textContent = list.length + (list.length === 1 ? " pareja anotada" : " parejas anotadas");
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
              <h3>${cat} · ${rows.length}</h3>
              <div class="admin-disp-rows">
                ${rows
                  .map((e) => {
                    const when = e.bye
                      ? "No juega esta semana"
                      : Object.entries(e.days || {})
                          .map(([d, h]) => `${d} ${h}`)
                          .join(" · ");
                    return `<article class="admin-disp-card" data-disp="${e.id}">
                      <div class="admin-result-meta">
                        <span>${e.recover ? "Recupera" : "Fecha"}</span>
                        <span>${when || "Sin horario"}</span>
                      </div>
                      <strong>${pairLabel(e)}</strong>
                      ${e.note ? `<p class="admin-help">${e.note}</p>` : ""}
                      <button class="admin-del" type="button" data-disp-del="${e.id}" aria-label="Eliminar">×</button>
                    </article>`;
                  })
                  .join("")}
              </div>
            </section>`;
          })
          .join("")
      : `<div class="admin-empty" id="disp-empty"><p>Todavía no hay disponibilidades en ${ctx.disp.week || "esta fecha"}.</p></div>`;
  }

  async function reload() {
    if (!ctx.token) {
      fill();
      return;
    }
    try {
      const file = await api.api(`/repos/${ctx.owner}/${ctx.repo}/contents/${DISP_PATH}?ref=main`);
      ctx.disp = JSON.parse(api.fromB64(String(file.content || "").replace(/\n/g, "")));
      fill();
      toast("Disponibilidades actualizadas", "ok");
      setMsg($("disp-msg"), "Disponibilidades actualizadas.", "ok");
    } catch (err) {
      fill();
      setMsg($("disp-msg"), err.message, "err");
      toast(err.message, "err");
    }
  }

  function bind() {
    ["disp-week", "disp-deadline", "disp-open"].forEach((id) => {
      $(id)?.addEventListener("change", () => shell.markDirty("fecha"));
      $(id)?.addEventListener("input", () => shell.markDirty("fecha"));
    });

    $("disp-reload")?.addEventListener("click", reload);
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
      ctx.disp.week = $("disp-week").value.trim() || "Fecha 6";
      ctx.disp.deadline = $("disp-deadline").value.trim();
      ctx.disp.open = $("disp-open").checked;
      ctx.disp.temp = ctx.siteData.currentSeason || "T4";
      setBusy($("disp-publish"), true, "Guardando…");
      setMsg($("disp-msg"), "Guardando fecha…");
      try {
        const file = await api.api(`/repos/${ctx.owner}/${ctx.repo}/contents/${DISP_PATH}?ref=main`);
        const latest = JSON.parse(api.fromB64(String(file.content || "").replace(/\n/g, "")));
        const keepIds = new Set((ctx.disp.entries || []).map((e) => e.id));
        latest.week = ctx.disp.week;
        latest.deadline = ctx.disp.deadline;
        latest.open = ctx.disp.open;
        latest.temp = ctx.disp.temp;
        latest.entries = (latest.entries || []).filter((e) => keepIds.has(e.id));
        await api.publishFile(
          DISP_PATH,
          JSON.stringify(latest, null, 2) + "\n",
          latest.open ? `Abre carga de ${latest.week}.` : `Cierra carga de ${latest.week}.`
        );
        ctx.disp = latest;
        shell.clearDirty("fecha");
        fill();
        setMsg($("disp-msg"), "Fecha guardada. El sitio se actualiza en ~1 minuto.", "ok");
        toast("Fecha guardada", "ok");
      } catch (err) {
        setMsg($("disp-msg"), err.message, "err");
        toast(err.message, "err");
      } finally {
        setBusy($("disp-publish"), false);
      }
    });
  }

  return { bind, fill, reload };
}
