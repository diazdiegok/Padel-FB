import { SITE_PATH } from "./constants.js";
import { DISP_PATH } from "../lib/disponibilidad.js";
import { listSeasons, nextSeason, normalizeSeason, seasonLabel } from "../lib/liga.js";
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

  async function publishSitePatch(fields, message, { button, busyLabel = "Publicando…" } = {}) {
    const gate = api.usePublishToken();
    if (!gate.ok) {
      toast(gate.message, "err");
      return false;
    }
    const busyBtn = button || $("season-publish") || $("season-create");
    setBusy(busyBtn, true, busyLabel);
    setMsg($("season-msg"), message.loading || "Publicando…");
    try {
      const remote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
      const seasonVenues = readVenuesFromDom();
      const nextSite = {
        ...remote,
        ...fields,
        seasonVenues: { ...(remote.seasonVenues || {}), ...seasonVenues, ...(fields.seasonVenues || {}) },
      };
      if (fields.currentSeason) {
        ctx.disp.temp = fields.currentSeason;
        await api.publishFiles(
          [
            { path: SITE_PATH, content: JSON.stringify(nextSite, null, 2) + "\n" },
            { path: DISP_PATH, content: JSON.stringify(ctx.disp, null, 2) + "\n" },
          ],
          message.commit
        );
      } else {
        await api.publishFile(SITE_PATH, JSON.stringify(nextSite, null, 2) + "\n", message.commit);
      }
      Object.assign(ctx.siteData, nextSite);
      shell.clearDirty("temporadas");
      onSeasonChanged?.();
      render();
      setMsg($("season-msg"), message.ok, "ok");
      toast(message.toast || message.ok, "ok");
      return true;
    } catch (err) {
      const text = api.publishError(err);
      setMsg($("season-msg"), text, "err");
      toast(text, "err");
      return false;
    } finally {
      setBusy(busyBtn, false);
    }
  }

  async function publishSection() {
    const seasonVenues = readVenuesFromDom();
    await publishSitePatch(
      { seasonVenues },
      {
        loading: "Publicando temporadas…",
        commit: "Actualiza sedes por temporada desde el admin.",
        ok: "Temporadas publicadas. El sitio se actualiza en ~1 minuto.",
        toast: "Temporadas publicadas",
      },
      { button: $("season-publish") }
    );
  }

  async function activate(temp, { created = false, button } = {}) {
    const list = seasons();
    const nextList = list.includes(temp) ? list : [...list, temp];
    const soon = upcoming() === temp ? "" : upcoming();
    await publishSitePatch(
      { seasons: nextList, currentSeason: temp, upcomingSeason: soon },
      {
        loading: `Publicando ${seasonLabel(temp)}…`,
        commit: created ? `Crea ${seasonLabel(temp)} y la deja en juego.` : `Pone ${seasonLabel(temp)} en juego.`,
        ok: created
          ? `${seasonLabel(temp)} creada y en juego. El sitio se actualiza en ~1 minuto.`
          : `${seasonLabel(temp)} quedó en juego. El sitio se actualiza en ~1 minuto.`,
      },
      { button: button || $("season-create") }
    );
  }

  async function markUpcoming(temp, { button } = {}) {
    if (temp === ctx.siteData.currentSeason) {
      toast("Esa temporada ya está en juego.", "err");
      return;
    }
    await publishSitePatch(
      { upcomingSeason: temp },
      {
        loading: `Marcando ${seasonLabel(temp)}…`,
        commit: `Marca ${seasonLabel(temp)} como próximamente.`,
        ok: `${seasonLabel(temp)} quedó como próximamente en el inicio.`,
        toast: "Próximamente actualizado",
      },
      { button, busyLabel: "Publicando…" }
    );
  }

  async function clearUpcoming({ button } = {}) {
    await publishSitePatch(
      { upcomingSeason: "" },
      {
        loading: "Quitando próximamente…",
        commit: "Quita la temporada próximamente del inicio.",
        ok: "Se quitó el aviso de próximamente del inicio.",
        toast: "Próximamente quitado",
      },
      { button, busyLabel: "Publicando…" }
    );
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
          body: `El inicio, el ranking, el fixture y las inscripciones pasan a ${seasonLabel(temp)}. El ranking de las otras temporadas queda guardado.`,
          confirmLabel: "Poner en juego",
        });
        if (!ok) return;
        await activate(temp, { button: play });
        return;
      }
      const soonBtn = e.target.closest("[data-season-soon]");
      if (soonBtn) {
        const temp = soonBtn.dataset.seasonSoon;
        const ok = await confirmModal({
          title: `Próximamente ${seasonLabel(temp)}`,
          body: `En el inicio se va a ver “Próximamente ${seasonLabel(temp)}”. La temporada en juego no cambia.`,
          confirmLabel: "Marcar próximamente",
        });
        if (!ok) return;
        await markUpcoming(temp, { button: soonBtn });
        return;
      }
      const clearBtn = e.target.closest("[data-season-soon-clear]");
      if (clearBtn) {
        await clearUpcoming({ button: clearBtn });
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

  return { bind, render, load, reload };
}
