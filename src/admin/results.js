import { RESULTS_PATH } from "./constants.js";
import { cleanMatch } from "./csv.js";
import { describeResult } from "../lib/scoring.js";
import { combineResults } from "../lib/liga.js";
import { $, escAttr, toast } from "./ui.js";

export function createResults(ctx, api, shell) {
  let filterWeek = "TODAS";
  let filterCat = "TODAS";
  let loaded = false;

  function allMatches() {
    const season = ctx.siteData.currentSeason || "T4";
    const archive = (ctx.results || []).map((m) => cleanMatch(m, {}, season));
    const live = (ctx.fixture || [])
      .map((m) => cleanMatch(m, {}, season))
      .filter((m) => m.result);
    return combineResults(archive, live).map((m) => ({
      ...m,
      _live: (ctx.fixture || []).some(
        (f) => f.week === m.week && f.home === m.home && f.away === m.away && f.cat === m.cat
      ),
    }));
  }

  function weeks() {
    return [...new Set(allMatches().map((m) => m.week).filter(Boolean))];
  }

  function cats() {
    return [...new Set(allMatches().map((m) => m.cat).filter(Boolean))].sort();
  }

  function fillFilters() {
    const w = weeks();
    if (filterWeek !== "TODAS" && w.length && !w.includes(filterWeek)) filterWeek = "TODAS";
    $("res-weeks").innerHTML =
      `<button class="pill${filterWeek === "TODAS" ? " on" : ""}" type="button" data-week="TODAS">Todas</button>` +
      w.map((week) => `<button class="pill${week === filterWeek ? " on" : ""}" type="button" data-week="${escAttr(week)}">${escAttr(week)}</button>`).join("");
    const c = cats();
    if (filterCat !== "TODAS" && !c.includes(filterCat)) filterCat = "TODAS";
    $("res-cats").innerHTML =
      `<button class="pill${filterCat === "TODAS" ? " on" : ""}" type="button" data-cat="TODAS">Todas</button>` +
      c.map((cat) => `<button class="pill${cat === filterCat ? " on" : ""}" type="button" data-cat="${escAttr(cat)}">${escAttr(cat)}</button>`).join("");
  }

  function render() {
    fillFilters();
    let list = allMatches();
    if (filterWeek !== "TODAS") list = list.filter((m) => m.week === filterWeek);
    if (filterCat !== "TODAS") list = list.filter((m) => m.cat === filterCat);
    $("res-count").textContent = list.length + (list.length === 1 ? " partido" : " partidos");
    const empty = $("res-empty");
    if (empty) empty.hidden = list.length > 0;
    $("res-list").innerHTML = list
      .map((m) => {
        const parsed = describeResult(m.result);
        const hint = parsed ? `${parsed.label} · ${parsed.homePts}-${parsed.awayPts} pts` : m.result || "Sin resultado";
        return `<article class="admin-result-card">
          <div class="admin-result-meta">
            <span>${escAttr(m.week || "—")}</span>
            <span>${escAttr(m.cat || "—")}</span>
            <span>${escAttr([m.day, m.time].filter(Boolean).join(" · ") || "—")}</span>
            ${m._live ? `<span class="admin-chip-live">En fixture</span>` : `<span class="admin-chip-arch">Archivo</span>`}
          </div>
          <strong>${escAttr(m.home || "—")} <span class="muted">vs</span> ${escAttr(m.away || "—")}</strong>
          <p>${escAttr(hint)}</p>
          <p class="admin-help">${escAttr([m.venue, m.court].filter(Boolean).join(" · "))}</p>
          ${m._live ? `<button class="btn btn-ghost" type="button" data-goto-fixture>Editar en Fixture</button>` : ""}
        </article>`;
      })
      .join("");
  }

  async function reload() {
    try {
      const remote = await api.readRemoteJson(RESULTS_PATH, []);
      ctx.results = Array.isArray(remote) ? remote : [];
      loaded = true;
      render();
    } catch (err) {
      if (!loaded) ctx.results = ctx.results || [];
      render();
      toast(err.message, "err");
    }
  }

  function bind() {
    $("res-weeks")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-week]");
      if (!btn) return;
      filterWeek = btn.dataset.week;
      render();
    });
    $("res-cats")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      filterCat = btn.dataset.cat;
      render();
    });
    $("res-list")?.addEventListener("click", (e) => {
      if (!e.target.closest("[data-goto-fixture]")) return;
      shell.setSection("fixture");
    });
    $("res-reload")?.addEventListener("click", reload);
  }

  return { bind, render, reload };
}
