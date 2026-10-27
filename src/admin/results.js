import { FIXTURE_PATH, RANK_PATH, RESULTS_PATH } from "./constants.js";
import { cleanMatch, cleanRow, matchKey } from "./csv.js";
import { applyFixtureResults, describeResult, fold } from "../lib/scoring.js";
import { combineResults, seasonLabel, seasonNumber, weekKey, weekNumber } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

const NO_WEEK = "Sin fecha";
const ALL_WEEKS = "*";

export function createResults(ctx, api, shell, { onRankingChanged } = {}) {
  let selTemp = "";
  let selWeek = "";
  let filterCat = "";
  let term = "";
  let loaded = false;

  function allMatches() {
    const season = ctx.siteData.currentSeason || "T4";
    const live = (ctx.fixture || [])
      .map((m, i) => ({
        ...cleanMatch(m, {}, season),
        _source: "fixture",
        _i: i,
      }))
      .filter((m) => m.home && m.away);
    const liveKeys = new Set(live.map(weekKey));
    const archive = (ctx.results || [])
      .map((m, i) => ({ ...cleanMatch(m, {}, season), _source: "archive", _i: i }))
      .filter((m) => !liveKeys.has(weekKey(m)));
    return combineResults(archive, live);
  }

  function sourceMatch(m) {
    const list = m._source === "fixture" ? ctx.fixture : ctx.results;
    return list?.[m._i];
  }

  const tempOf = (m) => m.temp || ctx.siteData.currentSeason || "T4";
  const weekOf = (m) => m.week || NO_WEEK;
  const played = (list) => list.filter((m) => String(m.result || "").trim()).length;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const weekTitle = (week) => (week === ALL_WEEKS ? "Todas las fechas" : week);

  function seasons(list) {
    const current = ctx.siteData.currentSeason;
    const temps = new Set(list.map(tempOf));
    if (current) temps.add(current);
    return [...temps].sort((a, b) => seasonNumber(b) - seasonNumber(a));
  }

  function weeksOf(list) {
    return [...new Set(list.map(weekOf))].sort(
      (a, b) => weekNumber(a) - weekNumber(b) || String(a).localeCompare(String(b), "es")
    );
  }

  function progress(list) {
    return list.length ? `${played(list)} / ${count(list.length, "resultado", "resultados")}` : "Todavía sin partidos";
  }

  function renderCrumbs() {
    const parts = [
      selTemp ? `<button type="button" data-res-go="">Temporadas</button>` : `<b>Temporadas</b>`,
    ];
    if (selTemp) {
      parts.push(
        selWeek
          ? `<button type="button" data-res-go="${escAttr(selTemp)}">${escAttr(seasonLabel(selTemp))}</button>`
          : `<b>${escAttr(seasonLabel(selTemp))}</b>`
      );
    }
    if (selWeek) parts.push(`<b>${escAttr(weekTitle(selWeek))}</b>`);
    $("res-crumbs").innerHTML = parts.join(" <span>›</span> ");
  }

  function matchCard(m) {
    const parsed = describeResult(m.result);
    const hint = parsed ? `${parsed.label} · ${parsed.homePts}-${parsed.awayPts} pts` : "Sin resultado";
    const when = [selWeek === ALL_WEEKS ? weekOf(m) : "", m.day, m.time].filter(Boolean).join(" · ") || "—";
    return `<article class="admin-result-card">
      <div class="admin-result-meta">
        <span>${escAttr(when)}</span>
        ${m._source === "fixture" ? `<span class="admin-chip-live">Fecha en juego</span>` : `<span class="admin-chip-arch">Archivo</span>`}
      </div>
      <strong>${escAttr(m.home || "—")} <span class="muted">vs</span> ${escAttr(m.away || "—")}</strong>
      <p class="admin-help">${escAttr([m.venue, m.court].filter(Boolean).join(" · "))}</p>
      <label class="admin-result-score">Resultado
        <input data-res-source="${m._source}" data-res-i="${m._i}" value="${escAttr(m.result)}" placeholder="6-4 6-2" />
      </label>
      <p class="admin-hint" data-res-hint>${escAttr(hint)}</p>
    </article>`;
  }

  function renderFilters(pool) {
    const box = $("res-filters");
    const catsBox = $("res-cats");
    const search = $("res-search");
    if (!box || !catsBox || !search) return;
    const show = !!selWeek;
    box.hidden = !show;
    if (!show) return;
    const used = [...new Set(pool.map((m) => m.cat || "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));
    if (filterCat && !used.includes(filterCat)) filterCat = "";
    catsBox.innerHTML = [
      `<button class="pill${filterCat === "" ? " on" : ""}" type="button" data-res-cat="">Todas <small>${pool.length}</small></button>`,
      ...used.map((c) => {
        const n = pool.filter((m) => (m.cat || "Sin categoría") === c).length;
        return `<button class="pill${filterCat === c ? " on" : ""}" type="button" data-res-cat="${escAttr(c)}">${escAttr(c)} <small>${n}</small></button>`;
      }),
    ].join("");
    if (search.value !== term) search.value = term;
  }

  function render() {
    const all = allMatches();
    const temps = seasons(all);
    if (selTemp && !temps.includes(selTemp)) {
      selTemp = "";
      selWeek = "";
      filterCat = "";
      term = "";
    }
    const inSeason = all.filter((m) => tempOf(m) === selTemp);
    const weeks = weeksOf(inSeason);
    if (selWeek && selWeek !== ALL_WEEKS && !weeks.includes(selWeek)) {
      selWeek = "";
      filterCat = "";
      term = "";
    }
    renderCrumbs();

    let boxes = "";
    let list = [];
    let emptyText = "";
    if (!selTemp) {
      boxes = temps
        .map((temp) => {
          const games = all.filter((m) => tempOf(m) === temp);
          const live = temp === ctx.siteData.currentSeason;
          return `<button class="res-box${games.length && played(games) === games.length ? " done" : ""}" type="button" data-res-temp="${escAttr(temp)}">
            <span class="kicker">Temporada</span>
            <strong>${escAttr(seasonLabel(temp))}</strong>
            <p>${escAttr(count(weeksOf(games).length, "fecha", "fechas"))} · ${escAttr(progress(games))}</p>
            ${live ? `<span class="admin-chip-live">En juego</span>` : ""}
          </button>`;
        })
        .join("");
      $("res-count").textContent = count(all.length, "partido", "partidos");
    } else if (!selWeek) {
      const allBox = `<button class="res-box${inSeason.length && played(inSeason) === inSeason.length ? " done" : ""}" type="button" data-res-week="${ALL_WEEKS}">
        <span class="kicker">Temporada</span>
        <strong>Todas las fechas</strong>
        <p>${escAttr(count(weeks.length, "fecha", "fechas"))} · ${escAttr(progress(inSeason))}</p>
      </button>`;
      boxes =
        allBox +
        weeks
          .map((week) => {
            const games = inSeason.filter((m) => weekOf(m) === week);
            const live = games.some((m) => m._source === "fixture");
            return `<button class="res-box${played(games) === games.length ? " done" : ""}" type="button" data-res-week="${escAttr(week)}">
              <span class="kicker">Fecha</span>
              <strong>${escAttr(week)}</strong>
              <p>${escAttr(progress(games))}</p>
              ${live ? `<span class="admin-chip-live">En juego</span>` : ""}
            </button>`;
          })
          .join("");
      emptyText = `${seasonLabel(selTemp)} todavía no tiene fechas. Publicá un fixture en Fixture y la fecha aparece acá para cargar resultados.`;
      $("res-count").textContent = count(inSeason.length, "partido", "partidos");
      if (!inSeason.length) boxes = "";
    } else {
      list =
        selWeek === ALL_WEEKS
          ? inSeason.slice().sort(
              (a, b) =>
                weekNumber(weekOf(a)) - weekNumber(weekOf(b)) ||
                String(weekOf(a)).localeCompare(String(weekOf(b)), "es") ||
                String(a.cat || "").localeCompare(String(b.cat || ""), "es") ||
                String(a.home || "").localeCompare(String(b.home || ""), "es")
            )
          : inSeason.filter((m) => weekOf(m) === selWeek);
      $("res-count").textContent = `${played(list)} / ${count(list.length, "resultado", "resultados")}`;
    }

    $("res-boxes").innerHTML = boxes;
    const empty = $("res-empty");
    if (empty) {
      empty.hidden = !emptyText || !!boxes || !!selWeek;
      if (emptyText) empty.querySelector("p").textContent = emptyText;
    }

    renderFilters(list);

    const q = fold(term);
    let shown = filterCat ? list.filter((m) => (m.cat || "Sin categoría") === filterCat) : list;
    if (q) {
      shown = shown.filter((m) => fold(`${m.home || ""} ${m.away || ""}`).includes(q));
    }

    const cats = filterCat
      ? shown.length
        ? [filterCat]
        : []
      : [...new Set(shown.map((m) => m.cat || "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));

    $("res-list").innerHTML = selWeek
      ? cats.length
        ? cats
            .map((cat) => {
              const games = shown.filter((m) => (m.cat || "Sin categoría") === cat);
              return `<h3 class="res-cat-title">${escAttr(cat)}<span>${escAttr(progress(games))}</span></h3>${games.map(matchCard).join("")}`;
            })
            .join("")
        : list.length
          ? `<div class="admin-empty"><p>Nadie coincide con el filtro o la búsqueda.</p></div>`
          : ""
      : "";
  }

  async function reload() {
    try {
      const clean = !ctx.dirty.has("fixture") && !ctx.dirty.has("resultados");
      const [remote, remoteFx] = await Promise.all([
        api.readRemoteJson(RESULTS_PATH, []),
        clean ? api.readRemoteJson(FIXTURE_PATH, null) : null,
      ]);
      if (!ctx.dirty.has("resultados")) ctx.results = Array.isArray(remote) ? remote : [];
      if (Array.isArray(remoteFx)) {
        ctx.fixture = remoteFx;
        ctx.fixturePublished = structuredClone(remoteFx);
      }
      loaded = true;
      render();
    } catch (err) {
      if (!loaded) ctx.results = ctx.results || [];
      render();
      toast(err.message, "err");
    }
  }

  function bind() {
    $("res-boxes")?.addEventListener("click", (e) => {
      const temp = e.target.closest("[data-res-temp]");
      const week = e.target.closest("[data-res-week]");
      if (temp) {
        selTemp = temp.dataset.resTemp;
        selWeek = "";
        filterCat = "";
        term = "";
      } else if (week) {
        selWeek = week.dataset.resWeek;
        filterCat = "";
        term = "";
      } else {
        return;
      }
      render();
      $("res-crumbs")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("res-crumbs")?.addEventListener("click", (e) => {
      const go = e.target.closest("[data-res-go]");
      if (!go) return;
      selTemp = go.dataset.resGo;
      selWeek = "";
      filterCat = "";
      term = "";
      render();
    });
    $("res-cats")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-res-cat]");
      if (!btn) return;
      filterCat = btn.dataset.resCat || "";
      render();
    });
    $("res-search")?.addEventListener("input", (e) => {
      term = e.target.value;
      render();
    });
    $("res-list")?.addEventListener("input", (e) => {
      const input = e.target.closest("[data-res-source]");
      if (!input) return;
      const match = sourceMatch({ _source: input.dataset.resSource, _i: Number(input.dataset.resI) });
      if (!match) return;
      match.result = input.value;
      shell.markDirty("resultados");
      const card = input.closest(".admin-result-card");
      const hint = card?.querySelector("[data-res-hint]");
      const parsed = describeResult(input.value);
      if (hint) hint.textContent = parsed ? `${parsed.label} · ${parsed.homePts}-${parsed.awayPts} pts` : input.value.trim() ? "Resultado inválido" : "Sin resultado";
    });
    $("res-reload")?.addEventListener("click", reload);
    $("res-publish")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      if (ctx.dirty.has("fixture") || ctx.dirty.has("ranking")) {
        const message = ctx.dirty.has("fixture")
          ? "Hay un fixture armado sin publicar. Publicalo o descartalo en Fixture antes de publicar resultados."
          : "Hay cambios del ranking sin publicar. Publicalos en Ranking antes de cargar resultados.";
        setMsg($("res-msg"), message, "err");
        toast(message, "err");
        return;
      }
      const pending = [...(ctx.fixture || []), ...(ctx.results || [])];
      const invalid = pending.find((m) => String(m.result || "").trim() && !describeResult(m.result));
      if (invalid) {
        const message = `Resultado inválido (${invalid.home || "pareja"} vs ${invalid.away || "pareja"}). Usá 6-4 6-2 o 6-4 3-6 6-2.`;
        setMsg($("res-msg"), message, "err");
        toast(message, "err");
        return;
      }
      const ok = await confirmModal({
        title: "Publicar resultados",
        body: "Los scores cargados actualizan el ranking de su temporada. El sitio se actualiza en ~1 minuto.",
        confirmLabel: "Publicar resultados",
      });
      if (!ok) return;

      const season = ctx.siteData.currentSeason || "T4";
      const edits = new Map(allMatches().map((m) => [matchKey(m), String(m.result || "").trim()]));
      setBusy($("res-publish"), true, "Publicando…");
      setMsg($("res-msg"), "Publicando resultados y ranking…");
      try {
        const [remoteRank, remoteFx, remoteRes] = await Promise.all([
          api.readRemoteJson(RANK_PATH, ctx.rows),
          api.readRemoteJson(FIXTURE_PATH, []),
          api.readRemoteJson(RESULTS_PATH, []),
        ]);
        const ranking = (Array.isArray(remoteRank) ? remoteRank : [])
          .map((row) => cleanRow(row, season))
          .filter((row) => row.name && row.cat.toLowerCase() !== "s masculina");
        const nextFixture = (Array.isArray(remoteFx) ? remoteFx : []).map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
        const nextResults = (Array.isArray(remoteRes) ? remoteRes : []).map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
        const remoteKeys = new Set();
        for (const m of [...nextFixture, ...nextResults]) {
          const key = matchKey(m);
          remoteKeys.add(key);
          if (edits.has(key)) m.result = edits.get(key);
        }
        const lost = allMatches().find((m) => String(m.result || "").trim() !== String(m.appliedResult || "").trim() && !remoteKeys.has(matchKey(m)));
        if (lost) throw new Error(`El partido ${lost.home} vs ${lost.away} cambió en el fixture publicado. Tocá Actualizar y volvé a cargarlo.`);
        const report = applyFixtureResults(ranking, [...nextFixture, ...nextResults]);
        if (report.unmatched.length) throw new Error(report.unmatched[0]);
        await api.publishFiles(
          [
            { path: FIXTURE_PATH, content: JSON.stringify(nextFixture, null, 2) + "\n" },
            { path: RESULTS_PATH, content: JSON.stringify(nextResults, null, 2) + "\n" },
            { path: RANK_PATH, content: JSON.stringify(ranking, null, 2) + "\n" },
          ],
          report.applied
            ? `Carga ${report.applied} resultado${report.applied === 1 ? "" : "s"} y actualiza el ranking.`
            : "Actualiza resultados desde el admin."
        );
        ctx.rows = ranking;
        ctx.fixture = nextFixture;
        ctx.fixturePublished = structuredClone(nextFixture);
        ctx.results = nextResults;
        shell.clearDirty("resultados");
        shell.clearDirty("ranking");
        onRankingChanged?.();
        render();
        const extra = report.created.length ? ` Altas: ${[...new Set(report.created)].join(" · ")}.` : "";
        const text = report.applied
          ? `Resultados publicados. ${report.applied} score${report.applied === 1 ? "" : "s"} sumados al ranking.${extra}`
          : "Resultados publicados. No había scores nuevos.";
        setMsg($("res-msg"), text, "ok");
        toast("Resultados publicados", "ok");
      } catch (err) {
        const message = api.publishError(err);
        setMsg($("res-msg"), message, "err");
        toast(message, "err");
      } finally {
        setBusy($("res-publish"), false);
      }
    });
  }

  return { bind, render, reload };
}
