import { SITE_PATH } from "./constants.js";
import { DISP_PATH } from "../lib/disponibilidad.js";
import { listSeasons, nextSeason, seasonLabel } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createSeasons(ctx, api, shell, { onSeasonChanged } = {}) {
  function seasons() {
    return listSeasons(ctx.siteData, ctx.rows.map((row) => row.temp));
  }

  function venueCount() {
    const saved = Number(ctx.siteData.leagueVenueCount);
    if (Number.isFinite(saved) && ctx.siteData.leagueVenueCount !== "" && ctx.siteData.leagueVenueCount != null) return saved;
    return (ctx.siteData.venues || []).filter((venue) => venue.liga !== false).length;
  }

  function render() {
    const current = ctx.siteData.currentSeason || "";
    const list = seasons();
    const tag = $("season-current");
    if (tag) tag.textContent = current ? `${seasonLabel(current)} en juego` : "Sin temporada activa";
    const venuesInput = $("season-venues");
    if (venuesInput && document.activeElement !== venuesInput) {
      venuesInput.value = String(venueCount());
    }
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
          <p>${count} pareja${count === 1 ? "" : "s"} en el ranking de esta temporada${count ? ". Sale de la tabla de Ranking." : ". Todavía no hay tabla cargada."}</p>
          ${
            active
              ? `<p class="admin-help">Esta es la temporada que se ve en el inicio, el ranking, el fixture y la fecha.</p>`
              : `<button class="btn btn-ghost" type="button" data-season-activate="${escAttr(temp)}">Usar en el sitio</button>`
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
    $("season-venues-save")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const count = Math.max(0, Math.round(Number($("season-venues")?.value) || 0));
      setBusy($("season-venues-save"), true, "Guardando…");
      setMsg($("season-msg"), "Guardando sedes…");
      try {
        const remote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
        const nextSite = { ...remote, leagueVenueCount: count };
        await api.publishFile(SITE_PATH, JSON.stringify(nextSite, null, 2) + "\n", `Actualiza las sedes de la liga a ${count}.`);
        Object.assign(ctx.siteData, nextSite);
        render();
        setMsg($("season-msg"), `El inicio va a mostrar ${count} sedes. Se actualiza en ~1 minuto.`, "ok");
        toast("Sedes guardadas", "ok");
      } catch (err) {
        const message = api.publishError(err);
        setMsg($("season-msg"), message, "err");
        toast(message, "err");
      } finally {
        setBusy($("season-venues-save"), false);
      }
    });
    $("season-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-season-activate]");
      if (!btn) return;
      const temp = btn.dataset.seasonActivate;
      const ok = await confirmModal({
        title: `Usar ${seasonLabel(temp)} en el sitio`,
        body: `El inicio, el ranking, el fixture y la fecha van a mostrar ${seasonLabel(temp)}. El ranking de las otras temporadas sigue guardado.`,
        confirmLabel: "Usar en el sitio",
      });
      if (!ok) return;
      await activate(temp);
    });
  }

  return { bind, render };
}
