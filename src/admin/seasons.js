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

  // Misma regla que el inicio: con puntos o PJ ya “arrancó” → En juego; si no → Próximamente (Inscribite YA).
  function seasonLive(temp) {
    const key = String(temp || "").toUpperCase();
    return (ctx.rows || []).some(
      (row) => String(row.temp || "").toUpperCase() === key && (Number(row.pts) > 0 || Number(row.pj) > 0)
    );
  }

  function hasFixture(temp) {
    const key = String(temp || "").toUpperCase();
    const rows = [...(ctx.fixturePublished || []), ...(ctx.fixture || []), ...(ctx.results || [])];
    return rows.some((m) => String(m.temp || "").toUpperCase() === key && m.home && m.away && !String(m.home).startsWith("BYE"));
  }

  // En juego = ya hay resultados/PJ, o ya se publicó fixture (arrancó Fecha 1).
  function phaseOf(temp) {
    if (seasonLive(temp) || hasFixture(temp)) return "live";
    return "soon";
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

  function nextTeaser() {
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
    const teaser = nextTeaser();
    const list = seasons();
    const tag = $("season-current");
    if (tag) {
      const parts = [];
      if (current) {
        const phase = phaseOf(current) === "live" ? "En juego" : "Próximamente";
        parts.push(`${seasonLabel(current)} · ${phase}`);
      }
      if (teaser) parts.push(`${seasonLabel(teaser)} siguiente`);
      tag.textContent = parts.join(" · ") || "Sin temporada activa";
    }
    const focused = document.activeElement?.dataset?.seasonVenues || "";
    $("season-list").innerHTML = list
      .map((temp) => {
        const count = ctx.rows.filter((row) => row.temp === temp).length;
        const active = temp === current;
        const isTeaser = temp === teaser;
        const phase = phaseOf(temp);
        let badge = "";
        if (active) {
          badge =
            phase === "live"
              ? `<span class="admin-chip-live">En juego</span>`
              : `<span class="admin-chip-soon">Próximamente</span>`;
        } else if (isTeaser) {
          badge = `<div class="admin-season-actions">
            <span class="admin-chip-soon">Siguiente</span>
            <button class="btn btn-ghost admin-season-play" type="button" data-season-play="${escAttr(temp)}">Usar esta</button>
            <button class="btn btn-ghost" type="button" data-season-soon-clear="${escAttr(temp)}">Quitar</button>
          </div>`;
        } else {
          badge = `<div class="admin-season-actions">
            <button class="btn btn-ghost admin-season-play" type="button" data-season-play="${escAttr(temp)}">Usar esta</button>
            <button class="btn btn-ghost" type="button" data-season-soon="${escAttr(temp)}">Siguiente</button>
          </div>`;
        }
        const phaseHint = active
          ? phase === "live"
            ? `<p class="muted">Misma señal que el inicio: ya hay fixture o partidos con puntos.</p>`
            : `<p class="muted">Misma señal que el inicio: Inscribite YA / Próximamente. Pasa a En juego al publicar Fecha 1 o cargar resultados.</p>`
          : "";
        return `<article class="admin-result-card">
          <div class="admin-season-head">
            <div>
              <div class="admin-result-meta"><span>${escAttr(temp)}</span></div>
              <strong>${escAttr(seasonLabel(temp))}</strong>
            </div>
            ${badge}
          </div>
          <p>${count} pareja${count === 1 ? "" : "s"} en el ranking.</p>
          ${phaseHint}
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
    const teaser = nextTeaser() === temp ? "" : nextTeaser();
    applyLocal(
      { seasons: nextList, currentSeason: temp, upcomingSeason: teaser },
      created
        ? `${seasonLabel(temp)} creada y queda como temporada del sistema. Tocá Publicar temporadas.`
        : `${seasonLabel(temp)} queda como temporada del sistema (inscripciones, ranking, fixture). Tocá Publicar temporadas.`
    );
  }

  function markTeaserLocal(temp) {
    if (temp === ctx.siteData.currentSeason) {
      toast("Esa ya es la temporada del sistema. El aviso “siguiente” es para la que viene después.", "err");
      return;
    }
    applyLocal(
      { upcomingSeason: temp },
      `${seasonLabel(temp)} marcada como siguiente. Tocá Publicar temporadas para el aviso en el inicio.`
    );
  }

  function clearTeaserLocal() {
    applyLocal({ upcomingSeason: "" }, "Se quitó el aviso de siguiente temporada. Tocá Publicar temporadas.");
  }

  function bind() {
    $("season-create")?.addEventListener("click", async () => {
      const created = nextSeason(seasons());
      const ok = await confirmModal({
        title: `Crear ${seasonLabel(created)}`,
        body: `${seasonLabel(created)} pasa a ser la temporada del sistema (inscripciones y ranking). Empezará en Próximamente en el inicio hasta que publiques Fecha 1 o resultados. Después tocá Publicar temporadas.`,
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
          title: `Usar ${seasonLabel(temp)}`,
          body: `Queda como temporada del sistema: inscripciones, ranking y fixture. El chip Próximamente / En juego sigue la misma regla que el inicio.`,
          confirmLabel: "Usar esta",
        });
        if (!ok) return;
        activateLocal(temp);
        return;
      }
      const soonBtn = e.target.closest("[data-season-soon]");
      if (soonBtn) {
        const temp = soonBtn.dataset.seasonSoon;
        const ok = await confirmModal({
          title: `Siguiente: ${seasonLabel(temp)}`,
          body: `Solo un aviso en el inicio de la que viene. No cambia inscripciones ni ranking (siguen en la temporada del sistema).`,
          confirmLabel: "Marcar siguiente",
        });
        if (!ok) return;
        markTeaserLocal(temp);
        return;
      }
      const clearBtn = e.target.closest("[data-season-soon-clear]");
      if (clearBtn) {
        clearTeaserLocal();
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
