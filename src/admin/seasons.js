import { SITE_PATH } from "./constants.js";
import { DISP_PATH } from "../lib/disponibilidad.js";
import { listSeasons, nextSeason, seasonLabel } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createSeasons(ctx, api, shell, { onSeasonChanged } = {}) {
  function seasons() {
    return listSeasons(ctx.siteData, ctx.rows.map((row) => row.temp));
  }

  function fallbackVenues() {
    return (ctx.siteData.venues || []).filter((venue) => venue.liga !== false).length;
  }

  function venuesFor(temp) {
    const saved = Number(ctx.siteData.seasonVenues?.[temp]);
    return Number.isFinite(saved) ? saved : fallbackVenues();
  }

  function render() {
    const current = ctx.siteData.currentSeason || "";
    const list = seasons();
    const tag = $("season-current");
    if (tag) tag.textContent = current ? `${seasonLabel(current)} en juego` : "Sin temporada activa";
    const focused = document.activeElement?.dataset?.seasonVenues || "";
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
          <p>${count} pareja${count === 1 ? "" : "s"} en el ranking.</p>
          <div class="admin-season-venues">
            <label>Sedes de la liga
              <input type="number" min="0" step="1" data-season-venues="${escAttr(temp)}" value="${venuesFor(temp)}" />
            </label>
            <button class="btn btn-ghost" type="button" data-season-venues-save="${escAttr(temp)}">Guardar</button>
          </div>
        </article>`;
      })
      .join("");
    if (focused) document.querySelector(`[data-season-venues="${focused}"]`)?.focus();
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
      const btn = e.target.closest("[data-season-venues-save]");
      if (!btn) return;
      const temp = btn.dataset.seasonVenuesSave;
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const input = document.querySelector(`[data-season-venues="${temp}"]`);
      const count = Math.max(0, Math.round(Number(input?.value) || 0));
      setBusy(btn, true, "Guardando…");
      setMsg($("season-msg"), `Guardando sedes de ${seasonLabel(temp)}…`);
      try {
        const remote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
        const seasonVenues = { ...(remote.seasonVenues || {}), [temp]: count };
        const nextSite = { ...remote, seasonVenues };
        await api.publishFile(
          SITE_PATH,
          JSON.stringify(nextSite, null, 2) + "\n",
          `Actualiza las sedes de ${seasonLabel(temp)} a ${count}.`
        );
        Object.assign(ctx.siteData, nextSite);
        render();
        setMsg($("season-msg"), `${seasonLabel(temp)} va a mostrar ${count} sedes en el inicio. Se actualiza en ~1 minuto.`, "ok");
        toast("Sedes guardadas", "ok");
      } catch (err) {
        const message = api.publishError(err);
        setMsg($("season-msg"), message, "err");
        toast(message, "err");
      } finally {
        setBusy(btn, false);
      }
    });
  }

  return { bind, render };
}
