import { SITE_PATH } from "./constants.js";
import { DISP_PATH } from "../lib/disponibilidad.js";
import { listSeasons, nextSeason, seasonLabel } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createSeasons(ctx, api, shell, { onSeasonChanged } = {}) {
  function seasons() {
    return listSeasons(ctx.siteData, ctx.rows.map((row) => row.temp));
  }

  function render() {
    const current = ctx.siteData.currentSeason || "";
    const list = seasons();
    const tag = $("season-current");
    if (tag) tag.textContent = current ? `${seasonLabel(current)} en juego` : "Sin temporada activa";
    $("season-list").innerHTML = list
      .map((temp) => {
        const count = ctx.rows.filter((row) => row.temp === temp).length;
        const active = temp === current;
        return `<article class="admin-result-card">
          <div class="admin-result-meta">
            <span>${escAttr(temp)}</span>
            ${active ? `<span class="admin-chip-live">En juego</span>` : ""}
          </div>
          <strong>${escAttr(seasonLabel(temp))}</strong>
          <p>${count} pareja${count === 1 ? "" : "s"} en el ranking${count ? "" : ". Todavía no tiene tabla"}.</p>
          ${
            active
              ? `<p class="admin-help">El inicio, el ranking, el fixture y la fecha usan esta temporada.</p>`
              : `<button class="btn btn-ghost" type="button" data-season-activate="${escAttr(temp)}">Activar</button>`
          }
        </article>`;
      })
      .join("");
  }

  async function activate(temp, { created = false } = {}) {
    const gate = api.usePublishToken();
    if (!gate.ok) {
      toast(gate.message, "err");
      return;
    }
    const list = seasons();
    const nextList = list.includes(temp) ? list : [...list, temp];
    setBusy($("season-create"), true, "Publicando…");
    setMsg($("season-msg"), `Publicando ${seasonLabel(temp)}…`);
    try {
      const remote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
      const nextSite = { ...remote, seasons: nextList, currentSeason: temp };
      ctx.disp.temp = temp;
      await api.publishFiles(
        [
          { path: SITE_PATH, content: JSON.stringify(nextSite, null, 2) + "\n" },
          { path: DISP_PATH, content: JSON.stringify(ctx.disp, null, 2) + "\n" },
        ],
        created ? `Crea ${seasonLabel(temp)} y la deja en juego.` : `Activa ${seasonLabel(temp)}.`
      );
      Object.assign(ctx.siteData, nextSite);
      shell.clearDirty("temporadas");
      onSeasonChanged?.();
      render();
      const text = created
        ? `${seasonLabel(temp)} creada y en juego. El sitio se actualiza en ~1 minuto.`
        : `${seasonLabel(temp)} quedó en juego.`;
      setMsg($("season-msg"), text, "ok");
      toast(text, "ok");
    } catch (err) {
      const message = api.publishError(err);
      setMsg($("season-msg"), message, "err");
      toast(message, "err");
    } finally {
      setBusy($("season-create"), false);
    }
  }

  function bind() {
    $("season-create")?.addEventListener("click", async () => {
      const created = nextSeason(seasons());
      const ok = await confirmModal({
        title: `Crear ${seasonLabel(created)}`,
        body: `${seasonLabel(created)} pasa a ser la temporada en juego. El ranking de las anteriores queda guardado. El sitio se actualiza en ~1 minuto.`,
        confirmLabel: "Crear temporada",
      });
      if (!ok) return;
      await activate(created, { created: true });
    });
    $("season-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-season-activate]");
      if (!btn) return;
      const temp = btn.dataset.seasonActivate;
      const ok = await confirmModal({
        title: `Activar ${seasonLabel(temp)}`,
        body: `El sitio, el fixture y la fecha van a usar ${seasonLabel(temp)}.`,
        confirmLabel: "Activar",
      });
      if (!ok) return;
      await activate(temp);
    });
  }

  return { bind, render };
}
