import { SITE_PATH } from "./constants.js";
import { DISP_PATH } from "../lib/disponibilidad.js";
import { listSeasons, nextSeason, normalizeSeason, seasonLabel } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createSeasons(ctx, api, shell, { onSeasonChanged } = {}) {
  let published = null;

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

  function ensureVenues() {
    if (!ctx.siteData.seasonVenues || typeof ctx.siteData.seasonVenues !== "object") {
      ctx.siteData.seasonVenues = {};
    }
    return ctx.siteData.seasonVenues;
  }

  function readVenuesFromDom() {
    const next = { ...ensureVenues() };
    document.querySelectorAll("[data-season-venues]").forEach((input) => {
      const temp = input.dataset.seasonVenues;
      if (!temp) return;
      next[temp] = Math.max(0, Math.round(Number(input.value) || 0));
    });
    ctx.siteData.seasonVenues = next;
    return next;
  }

  function setVenueCount(temp, count) {
    const venues = ensureVenues();
    venues[temp] = Math.max(0, Math.round(Number(count) || 0));
    shell.markDirty("temporadas");
  }

  function snapshot() {
    published = {
      currentSeason: ctx.siteData.currentSeason || "",
      upcomingSeason: ctx.siteData.upcomingSeason || "",
      seasons: Array.isArray(ctx.siteData.seasons) ? [...ctx.siteData.seasons] : [],
      seasonVenues: { ...(ctx.siteData.seasonVenues || {}) },
    };
  }

  function restore() {
    if (!published) return;
    ctx.siteData.currentSeason = published.currentSeason;
    ctx.siteData.upcomingSeason = published.upcomingSeason;
    ctx.siteData.seasons = [...published.seasons];
    ctx.siteData.seasonVenues = { ...published.seasonVenues };
  }

  function upcoming() {
    const value = normalizeSeason(ctx.siteData.upcomingSeason);
    const current = normalizeSeason(ctx.siteData.currentSeason);
    return value && value !== current ? value : "";
  }

  async function load() {
    const remote = await api.readRemoteJson(SITE_PATH, null);
    if (!remote || typeof remote !== "object") return;
    if (remote.currentSeason) ctx.siteData.currentSeason = remote.currentSeason;
    if (Array.isArray(remote.seasons)) ctx.siteData.seasons = remote.seasons;
    if ("upcomingSeason" in remote) ctx.siteData.upcomingSeason = remote.upcomingSeason || "";
    if ("showPlayoff" in remote) ctx.siteData.showPlayoff = Boolean(remote.showPlayoff);
    if (remote.seasonVenues && typeof remote.seasonVenues === "object") {
      ctx.siteData.seasonVenues = { ...remote.seasonVenues };
    }
    snapshot();
  }

  async function reload() {
    if (!ctx.token || ctx.dirty.has("temporadas")) {
      render();
      return;
    }
    try {
      await load();
      render();
    } catch (err) {
      setMsg($("season-msg"), err.message, "err");
    }
  }

  function discard() {
    restore();
    shell.clearDirty("temporadas");
    render();
  }

  function render() {
    const current = ctx.siteData.currentSeason || "";
    const soon = upcoming();
    const list = seasons();
    const tag = $("season-current");
    if (tag) {
      const parts = [];
      if (current) parts.push(`${seasonLabel(current)} en juego`);
      if (soon) parts.push(`${seasonLabel(soon)} próximamente`);
      tag.textContent = parts.join(" · ") || "Sin temporada activa";
    }
    const focused = document.activeElement?.dataset?.seasonVenues || "";
    $("season-list").innerHTML = list
      .map((temp) => {
        const count = ctx.rows.filter((row) => row.temp === temp).length;
        const active = temp === current;
        const isSoon = temp === soon;
        let badge = "";
        if (active) {
          badge = `<span class="admin-chip-live">En juego</span>`;
        } else if (isSoon) {
          badge = `<div class="admin-season-actions">
            <span class="admin-chip-soon">Próximamente</span>
            <button class="btn btn-ghost admin-season-play" type="button" data-season-play="${escAttr(temp)}">Poner en juego</button>
            <button class="btn btn-ghost" type="button" data-season-soon-clear="${escAttr(temp)}">Quitar</button>
          </div>`;
        } else {
          badge = `<div class="admin-season-actions">
            <button class="btn btn-ghost admin-season-play" type="button" data-season-play="${escAttr(temp)}">Poner en juego</button>
            <button class="btn btn-ghost" type="button" data-season-soon="${escAttr(temp)}">Próximamente</button>
          </div>`;
        }
        return `<article class="admin-result-card">
          <div class="admin-season-head">
            <div>
              <div class="admin-result-meta"><span>${escAttr(temp)}</span></div>
              <strong>${escAttr(seasonLabel(temp))}</strong>
            </div>
            ${badge}
          </div>
          <p>${count} pareja${count === 1 ? "" : "s"} en el ranking.</p>
          <div class="admin-season-venues">
            <div class="admin-season-field">
              <span>Sedes de la liga:</span>
              <span class="admin-stepper">
                <button type="button" data-season-step="${escAttr(temp)}" data-dir="-1" aria-label="Una sede menos">−</button>
                <input type="number" min="0" step="1" inputmode="numeric" aria-label="Sedes de la liga" data-season-venues="${escAttr(temp)}" value="${venuesFor(temp)}" />
                <button type="button" data-season-step="${escAttr(temp)}" data-dir="1" aria-label="Una sede más">+</button>
              </span>
            </div>
          </div>
        </article>`;
      })
      .join("");
    if (focused) document.querySelector(`[data-season-venues="${focused}"]`)?.focus();
  }

  function applyLocal(fields, note) {
    Object.assign(ctx.siteData, fields);
    shell.markDirty("temporadas");
    render();
    if (note) {
      setMsg($("season-msg"), note, "ok");
      toast(note, "ok");
    }
  }

  async function publishSection() {
    const gate = api.usePublishToken();
    if (!gate.ok) {
      toast(gate.message, "err");
      return;
    }
    const btn = $("season-publish");
    setBusy(btn, true, "Publicando…");
    setMsg($("season-msg"), "Publicando temporadas…");
    try {
      const remote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
      const seasonVenues = readVenuesFromDom();
      const currentSeason = ctx.siteData.currentSeason || remote.currentSeason;
      const nextSite = {
        ...remote,
        seasons: Array.isArray(ctx.siteData.seasons) ? ctx.siteData.seasons : remote.seasons,
        currentSeason,
        upcomingSeason: ctx.siteData.upcomingSeason || "",
        seasonVenues: { ...(remote.seasonVenues || {}), ...seasonVenues },
      };
      const files = [{ path: SITE_PATH, content: JSON.stringify(nextSite, null, 2) + "\n" }];
      if (currentSeason && currentSeason !== remote.currentSeason) {
        ctx.disp.temp = currentSeason;
        files.push({ path: DISP_PATH, content: JSON.stringify(ctx.disp, null, 2) + "\n" });
      }
      await api.publishFiles(files, "Actualiza temporadas desde el admin.");
      Object.assign(ctx.siteData, nextSite);
      snapshot();
      shell.clearDirty("temporadas");
      onSeasonChanged?.();
      render();
      setMsg($("season-msg"), "Temporadas publicadas. El sitio se actualiza en ~1 minuto.", "ok");
      toast("Temporadas publicadas", "ok");
    } catch (err) {
      const text = api.publishError(err);
      setMsg($("season-msg"), text, "err");
      toast(text, "err");
    } finally {
      setBusy(btn, false);
    }
  }

  function activateLocal(temp, { created = false } = {}) {
    const list = seasons();
    const nextList = list.includes(temp) ? list : [...list, temp];
    const soon = upcoming() === temp ? "" : upcoming();
    applyLocal(
      { seasons: nextList, currentSeason: temp, upcomingSeason: soon },
      created
        ? `${seasonLabel(temp)} creada y marcada en juego. Tocá Publicar temporadas para subir el cambio.`
        : `${seasonLabel(temp)} marcada en juego. Tocá Publicar temporadas para subir el cambio.`
    );
  }

  function markUpcomingLocal(temp) {
    if (temp === ctx.siteData.currentSeason) {
      toast("Esa temporada ya está en juego.", "err");
      return;
    }
    applyLocal(
      { upcomingSeason: temp },
      `${seasonLabel(temp)} marcada como próximamente. Tocá Publicar temporadas para subir el cambio.`
    );
  }

  function clearUpcomingLocal() {
    applyLocal({ upcomingSeason: "" }, "Se quitó próximamente. Tocá Publicar temporadas para subir el cambio.");
  }

  function bind() {
    $("season-create")?.addEventListener("click", async () => {
      const created = nextSeason(seasons());
      const ok = await confirmModal({
        title: `Crear ${seasonLabel(created)}`,
        body: `${seasonLabel(created)} queda marcada en juego acá. Después tocá Publicar temporadas para que el sitio lo tome.`,
        confirmLabel: "Crear temporada",
      });
      if (!ok) return;
      activateLocal(created, { created: true });
    });
    $("season-publish")?.addEventListener("click", () => publishSection());
    $("season-list")?.addEventListener("input", (e) => {
      const input = e.target.closest("[data-season-venues]");
      if (!input) return;
      setVenueCount(input.dataset.seasonVenues, input.value);
    });
    $("season-list")?.addEventListener("change", (e) => {
      const input = e.target.closest("[data-season-venues]");
      if (!input) return;
      const value = Math.max(0, Math.round(Number(input.value) || 0));
      input.value = String(value);
      setVenueCount(input.dataset.seasonVenues, value);
    });
    $("season-list")?.addEventListener("click", async (e) => {
      const play = e.target.closest("[data-season-play]");
      if (play) {
        const temp = play.dataset.seasonPlay;
        const ok = await confirmModal({
          title: `Poner ${seasonLabel(temp)} en juego`,
          body: `Queda marcada en juego acá. El inicio, ranking, fixture e inscripciones la van a usar cuando toques Publicar temporadas.`,
          confirmLabel: "Poner en juego",
        });
        if (!ok) return;
        activateLocal(temp);
        return;
      }
      const soonBtn = e.target.closest("[data-season-soon]");
      if (soonBtn) {
        const temp = soonBtn.dataset.seasonSoon;
        const ok = await confirmModal({
          title: `Próximamente ${seasonLabel(temp)}`,
          body: `Queda marcada como próximamente acá. Tocá Publicar temporadas para que se vea en el inicio.`,
          confirmLabel: "Marcar próximamente",
        });
        if (!ok) return;
        markUpcomingLocal(temp);
        return;
      }
      const clearBtn = e.target.closest("[data-season-soon-clear]");
      if (clearBtn) {
        clearUpcomingLocal();
        return;
      }
      const step = e.target.closest("[data-season-step]");
      if (!step) return;
      const input = document.querySelector(`[data-season-venues="${step.dataset.seasonStep}"]`);
      if (!input) return;
      const value = Math.max(0, (Math.round(Number(input.value)) || 0) + Number(step.dataset.dir));
      input.value = String(value);
      setVenueCount(step.dataset.seasonStep, value);
    });
  }

  return { bind, render, load, reload, discard };
}
