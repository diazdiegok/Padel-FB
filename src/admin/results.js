import { FIXTURE_PATH, RANK_PATH, RESULTS_PATH } from "./constants.js";
import { cleanMatch, cleanRow } from "./csv.js";
import { applyFixtureResults, describeResult } from "../lib/scoring.js";
import { combineResults, weekKey } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createResults(ctx, api, shell, { onRankingChanged } = {}) {
  let filterWeek = "TODAS";
  let filterCat = "TODAS";
  let loaded = false;

  function allMatches() {
    const season = ctx.siteData.currentSeason || "T4";
    const live = (ctx.fixture || []).map((m, i) => ({
      ...cleanMatch(m, {}, season),
      _source: "fixture",
      _i: i,
    }));
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
        const hint = parsed ? `${parsed.label} · ${parsed.homePts}-${parsed.awayPts} pts` : "Sin resultado";
        return `<article class="admin-result-card">
          <div class="admin-result-meta">
            <span>${escAttr(m.week || "—")}</span>
            <span>${escAttr(m.temp || "—")}</span>
            <span>${escAttr(m.cat || "—")}</span>
            <span>${escAttr([m.day, m.time].filter(Boolean).join(" · ") || "—")}</span>
            ${m._source === "fixture" ? `<span class="admin-chip-live">Fecha en juego</span>` : `<span class="admin-chip-arch">Archivo</span>`}
          </div>
          <strong>${escAttr(m.home || "—")} <span class="muted">vs</span> ${escAttr(m.away || "—")}</strong>
          <p class="admin-help">${escAttr([m.venue, m.court].filter(Boolean).join(" · "))}</p>
          <label class="admin-result-score">Resultado
            <input data-res-source="${m._source}" data-res-i="${m._i}" value="${escAttr(m.result)}" placeholder="6-4 6-2" />
          </label>
          <p class="admin-hint" data-res-hint>${escAttr(hint)}</p>
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
      const ranking = structuredClone(ctx.rows)
        .map((row) => cleanRow(row, season))
        .filter((row) => row.name && row.cat.toLowerCase() !== "s masculina");
      const snapshot = pending.map((m) => m.appliedResult);
      setBusy($("res-publish"), true, "Publicando…");
      setMsg($("res-msg"), "Publicando resultados y ranking…");
      try {
        const report = applyFixtureResults(ranking, pending);
        if (report.unmatched.length) throw new Error(report.unmatched[0]);
        const nextFixture = ctx.fixture.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
        const nextResults = ctx.results.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
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
        pending.forEach((m, i) => {
          m.appliedResult = snapshot[i];
        });
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
