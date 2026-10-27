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
              <span>Sedes de la liga</span>
              <span class="admin-stepper">
                <button type="button" data-season-step="${escAttr(temp)}" data-dir="-1" aria-label="Una sede menos">−</button>
                <input type="number" min="0" step="1" inputmode="numeric" aria-label="Sedes de la liga" data-season-venues="${escAttr(temp)}" value="${venuesFor(temp)}" />
                <button type="button" data-season-step="${escAttr(temp)}" data-dir="1" aria-label="Una sede más">+</button>
              </span>
            </div>
            <button class="btn btn-ghost" type="button" data-season-venues-save="${escAttr(temp)}">Guardar</button>
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
    const busyBtn = button || $("season-create");
    setBusy(busyBtn, true, busyLabel);
    setMsg($("season-msg"), message.loading || "Publicando…");
    try {
      const remote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
      const nextSite = { ...remote, ...fields };
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
      { button, busyLabel: "Guardando…" }
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
      { button, busyLabel: "Guardando…" }
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
    $("season-list")?.addEventListener("click", async (e) => {
      const play = e.target.closest("[data-season-play]");
      if (play) {
        const temp = play.dataset.seasonPlay;
        const ok = await confirmModal({
          title: `Poner ${seasonLabel(temp)} en juego`,
          body: `El inicio, el ranking, el fixture y la fecha pasan a ${seasonLabel(temp)}. El ranking de las otras temporadas queda guardado.`,
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
      if (step) {
        const input = document.querySelector(`[data-season-venues="${step.dataset.seasonStep}"]`);
        if (input) input.value = Math.max(0, (Math.round(Number(input.value)) || 0) + Number(step.dataset.dir));
        return;
      }
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
        const prev = Number(remote.seasonVenues?.[temp]);
        if (prev === count) {
          if (remote.seasonVenues) ctx.siteData.seasonVenues = { ...remote.seasonVenues };
          setMsg(
            $("season-msg"),
            `${seasonLabel(temp)} ya tiene ${count} sedes. En el inicio elegí ${temp} para verlas. La página abre en la temporada en juego.`,
            "ok"
          );
          toast("Ya estaba guardado", "ok");
          return;
        }
        const seasonVenues = { ...(remote.seasonVenues || {}), [temp]: count };
        const nextSite = { ...remote, seasonVenues };
        await api.publishFile(
          SITE_PATH,
          JSON.stringify(nextSite, null, 2) + "\n",
          `Actualiza las sedes de ${seasonLabel(temp)} a ${count}.`
        );
        Object.assign(ctx.siteData, nextSite);
        render();
        setMsg(
          $("season-msg"),
          `${seasonLabel(temp)} guardada con ${count} sedes. En el inicio elegí ${temp} para ver ese número.`,
          "ok"
        );
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

  return { bind, render, load };
}
