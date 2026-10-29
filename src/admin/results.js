import { FIXTURE_PATH, RANK_PATH, RESULTS_PATH } from "./constants.js";
import {
  RES_IMPORT_COLS,
  cleanMatch,
  cleanRow,
  downloadCsv,
  matchKey,
  parseResultsImportObjects,
  parseResultsImportText,
} from "./csv.js";
import { applyFixtureResults, describeResult, fold, pairsMatch, parseResult } from "../lib/scoring.js";
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

  function flipResult(raw) {
    const parsed = parseResult(raw);
    if (!parsed?.sets?.length) return raw;
    return parsed.sets.map(([a, b]) => `${b}-${a}`).join(" ");
  }

  function findImportTarget(pool, row) {
    let best = null;
    let bestScore = -1;
    let swapped = false;
    for (const m of pool) {
      if (row.temp && tempOf(m) !== row.temp) continue;
      if (row.week && weekOf(m) !== row.week) continue;
      if (row.cat && (m.cat || "") !== row.cat) continue;
      const same = pairsMatch(m.home, row.home) && pairsMatch(m.away, row.away);
      const flip = !same && pairsMatch(m.home, row.away) && pairsMatch(m.away, row.home);
      if (!same && !flip) continue;
      const score = 10 + (row.week ? 2 : 0) + (row.cat ? 1 : 0) + (same ? 1 : 0);
      if (score > bestScore) {
        best = m;
        bestScore = score;
        swapped = flip;
      }
    }
    return best ? { match: best, swapped } : null;
  }

  async function readImportRows(file) {
    const season = ctx.siteData.currentSeason || "T4";
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      return parseResultsImportText(await file.text(), season);
    }
    if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("El Excel no tiene hojas.");
      const objects = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      return parseResultsImportObjects(objects, season);
    }
    throw new Error("Usá un archivo .csv, .xls o .xlsx.");
  }

  function exportTemplate() {
    const season = selTemp || ctx.siteData.currentSeason || "T4";
    let list = allMatches().filter((m) => tempOf(m) === season);
    if (selWeek && selWeek !== ALL_WEEKS) list = list.filter((m) => weekOf(m) === selWeek);
    if (!list.length) {
      toast("Todavía no hay partidos publicados para armar la plantilla.", "err");
      return;
    }
    downloadCsv(
      `resultados-${String(season).toLowerCase()}.csv`,
      RES_IMPORT_COLS,
      list.map((m) => ({
        fecha: weekOf(m),
        categoria: m.cat || "",
        pareja1: m.home || "",
        pareja2: m.away || "",
        resultado: m.result || "",
      }))
    );
    toast("Plantilla descargada", "ok");
  }

  async function importResultsFile(file) {
    const rows = await readImportRows(file);
    const pool = allMatches();
    if (!pool.length) throw new Error("No hay partidos publicados. Publicá el fixture primero.");
    let applied = 0;
    let invalid = 0;
    let missing = 0;
    for (const row of rows) {
      const hit = findImportTarget(pool, row);
      if (!hit) {
        missing += 1;
        continue;
      }
      let result = String(row.result || "").trim();
      if (hit.swapped) result = flipResult(result);
      if (!describeResult(result)) {
        invalid += 1;
        continue;
      }
      const target = sourceMatch(hit.match);
      if (!target) {
        missing += 1;
        continue;
      }
      target.result = result;
      applied += 1;
    }
    if (applied) {
      shell.markDirty("resultados");
      render();
    }
    return { applied, invalid, missing, total: rows.length };
  }
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

  function listHtml(list) {
    const q = fold(term);
    let shown = filterCat ? list.filter((m) => (m.cat || "Sin categoría") === filterCat) : list;
    if (q) shown = shown.filter((m) => fold(`${m.home || ""} ${m.away || ""}`).includes(q));
    const used = [...new Set(list.map((m) => m.cat || "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));
    if (filterCat && !used.includes(filterCat)) filterCat = "";
    const filters = `<div class="res-filters">
      <div class="pills">
        <button class="pill${filterCat === "" ? " on" : ""}" type="button" data-res-cat="">Todas <small>${list.length}</small></button>
        ${used
          .map((c) => {
            const n = list.filter((m) => (m.cat || "Sin categoría") === c).length;
            return `<button class="pill${filterCat === c ? " on" : ""}" type="button" data-res-cat="${escAttr(c)}">${escAttr(c)} <small>${n}</small></button>`;
          })
          .join("")}
      </div>
      <input class="admin-search" data-res-search type="search" placeholder="Buscar pareja…" autocomplete="off" value="${escAttr(term)}" />
    </div>`;
    const cats = filterCat ? (shown.length ? [filterCat] : []) : [...new Set(shown.map((m) => m.cat || "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es"));
    const body = cats.length
      ? cats
          .map((cat) => {
            const games = shown.filter((m) => (m.cat || "Sin categoría") === cat);
            return `<h3 class="res-cat-title">${escAttr(cat)}<span>${escAttr(progress(games))}</span></h3>${games.map(matchCard).join("")}`;
          })
          .join("")
      : list.length
        ? `<div class="admin-empty"><p>Nadie coincide con el filtro o la búsqueda.</p></div>`
        : "";
    return `${filters}<div data-res-list>${body}</div>`;
  }

  function render() {
    const all = allMatches();
    const temps = seasons(all);
    const root = $("res-boxes");
    if (!root) return;
    if (selTemp && !temps.includes(selTemp)) {
      selTemp = "";
      selWeek = "";
      filterCat = "";
      term = "";
    }

    const empty = $("res-empty");
    if (!temps.length) {
      root.className = "res-boxes";
      root.innerHTML = "";
      $("res-count").textContent = "0 partidos";
      if (empty) {
        empty.hidden = false;
        empty.querySelector("p").textContent =
          "Todavía no hay partidos. Cuando publiques un fixture, aparecen acá para cargar el resultado.";
      }
      return;
    }
    if (empty) empty.hidden = true;
    $("res-count").textContent = count(all.length, "partido", "partidos");

    // Nivel 1: solo cajas tipo resumen Temporada 1…5
    if (!selTemp) {
      root.className = "res-boxes hub-like";
      root.innerHTML = temps
        .map((temp) => {
          const games = all.filter((m) => tempOf(m) === temp);
          const weeks = weeksOf(games);
          const live = temp === ctx.siteData.currentSeason;
          return `<button class="res-box hub-season" type="button" data-res-open="${escAttr(temp)}">
            <span class="kicker">Temporada${live ? " · En juego" : ""}</span>
            <strong>${escAttr(seasonLabel(temp))}</strong>
            <p>${escAttr(count(weeks.length, "fecha", "fechas"))} · ${escAttr(progress(games))}</p>
          </button>`;
        })
        .join("");
      return;
    }

    // Nivel 2: UNA caja Temporada; adentro las fechas
    const games = all.filter((m) => tempOf(m) === selTemp);
    const weeks = weeksOf(games);
    if (selWeek && selWeek !== ALL_WEEKS && !weeks.includes(selWeek)) {
      selWeek = "";
      filterCat = "";
      term = "";
    }
    const live = selTemp === ctx.siteData.currentSeason;
    const list = selWeek
      ? selWeek === ALL_WEEKS
        ? games.slice().sort(
            (a, b) =>
              weekNumber(weekOf(a)) - weekNumber(weekOf(b)) ||
              String(weekOf(a)).localeCompare(String(weekOf(b)), "es") ||
              String(a.cat || "").localeCompare(String(b.cat || ""), "es") ||
              String(a.home || "").localeCompare(String(b.home || ""), "es")
          )
        : games.filter((m) => weekOf(m) === selWeek)
      : [];

    root.className = "res-boxes stack";
    root.innerHTML = `<article class="season-box open" data-res-season="${escAttr(selTemp)}">
      <div class="season-box-head">
        <button class="season-back" type="button" data-res-back>← Temporadas</button>
        <span class="kicker">Temporada${live ? " · En juego" : ""}</span>
        <strong>${escAttr(seasonLabel(selTemp))}</strong>
        <p>${escAttr(count(weeks.length, "fecha", "fechas"))} · ${escAttr(progress(games))}</p>
      </div>
      <div class="season-box-body">
        ${
          weeks.length
            ? `<div class="res-inner-grid">
          <button class="res-box${selWeek === ALL_WEEKS ? " done" : ""}" type="button" data-res-week="${ALL_WEEKS}" style="min-height:96px">
            <span class="kicker">Temporada</span>
            <strong>Todas las fechas</strong>
            <p>${escAttr(count(weeks.length, "fecha", "fechas"))} · ${escAttr(progress(games))}</p>
          </button>
          ${weeks
            .map((week) => {
              const weekGames = games.filter((m) => weekOf(m) === week);
              const weekLive = weekGames.some((m) => m._source === "fixture");
              return `<button class="res-box${selWeek === week ? " done" : ""}" type="button" data-res-week="${escAttr(week)}" style="min-height:96px">
                <span class="kicker">Fecha</span>
                <strong>${escAttr(week)}</strong>
                <p>${escAttr(progress(weekGames))}</p>
                ${weekLive ? `<span class="admin-chip-live">En juego</span>` : ""}
              </button>`;
            })
            .join("")}
        </div>${selWeek ? listHtml(list) : ""}`
            : `<div class="admin-empty"><p>${escAttr(seasonLabel(selTemp))} todavía no tiene fechas. Publicá un fixture en Fixture.</p></div>`
        }
      </div>
    </article>`;
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
      if (e.target.closest("[data-res-back]")) {
        selTemp = "";
        selWeek = "";
        filterCat = "";
        term = "";
        render();
        return;
      }
      const openBtn = e.target.closest("[data-res-open]");
      if (openBtn) {
        selTemp = openBtn.dataset.resOpen;
        selWeek = "";
        filterCat = "";
        term = "";
        render();
        return;
      }
      const weekBtn = e.target.closest("[data-res-week]");
      const catBtn = e.target.closest("[data-res-cat]");
      if (catBtn) {
        filterCat = catBtn.dataset.resCat || "";
        render();
        return;
      }
      if (!weekBtn) return;
      selWeek = weekBtn.dataset.resWeek || "";
      filterCat = "";
      term = "";
      render();
    });
    $("res-boxes")?.addEventListener("input", (e) => {
      const search = e.target.closest("[data-res-search]");
      if (search) {
        term = search.value;
        render();
        const again = $("res-boxes")?.querySelector("[data-res-search]");
        if (again) {
          again.focus();
          const len = again.value.length;
          again.setSelectionRange(len, len);
        }
        return;
      }
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
    $("res-template")?.addEventListener("click", exportTemplate);
    $("res-import")?.addEventListener("click", () => $("res-import-file")?.click());
    $("res-import-file")?.addEventListener("change", async (e) => {
      const input = e.target;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      setBusy($("res-import"), true, "Importando…");
      try {
        const report = await importResultsFile(file);
        const parts = [`${report.applied} de ${report.total} resultado${report.total === 1 ? "" : "s"} cargado${report.applied === 1 ? "" : "s"}`];
        if (report.missing) parts.push(`${report.missing} sin partido coincidente`);
        if (report.invalid) parts.push(`${report.invalid} con formato inválido`);
        const text = parts.join(". ") + ". Revisá y publicá.";
        setMsg($("res-msg"), text, report.applied ? "ok" : "err");
        toast(report.applied ? "Resultados importados" : "Nada se pudo importar", report.applied ? "ok" : "err");
      } catch (err) {
        setMsg($("res-msg"), err.message || String(err), "err");
        toast(err.message || "No se pudo importar", "err");
      } finally {
        setBusy($("res-import"), false);
      }
    });
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
