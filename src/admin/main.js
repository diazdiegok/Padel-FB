import { createAcademiaInscripciones } from "./acadinsc.js";
import { createApi } from "./api.js";
import { createAuth } from "./auth.js";
import { HIDDEN_CATS } from "./constants.js";
import { createCms } from "./cms.js";
import { createFixture } from "./fixture.js";
import { createParejas } from "./parejas.js";
import { createPlayoff } from "./playoff.js";
import { normalizePlayoffs } from "../lib/playoff.js";
import { createRanking } from "./ranking.js";
import { createResults } from "./results.js";
import { createSeasons } from "./seasons.js";
import { createShell } from "./shell.js";
import { $ } from "./ui.js";

export function bootAdmin({ rankingJson, fixtureJson, siteJson, dispJson, resultsJson, playoffJson, pairsJson, pairsConfigJson }) {
  const ctx = {
    rows: structuredClone(rankingJson.filter((p) => !HIDDEN_CATS.has(p.cat))),
    siteData: structuredClone(siteJson),
    fixture: structuredClone(fixtureJson || []),
    fixturePublished: structuredClone(fixtureJson || []),
    results: structuredClone(resultsJson || []),
    disp: structuredClone(dispJson),
    pairs: structuredClone(Array.isArray(pairsJson) ? pairsJson : []),
    pairsConfig: { open: true, deadline: "", ...(pairsConfigJson || {}) },
    contacts: {},
    playoffs: normalizePlayoffs(playoffJson),
    owner: siteJson.githubOwner,
    repo: siteJson.githubRepo,
    API_URL: String(siteJson.apiUrl || "").replace(/\/$/, ""),
    BASE: import.meta.env.BASE_URL || "/",
    token: "",
    dirty: new Set(),
    currentSection: "",
  };

  const api = createApi(ctx);
  let ranking;
  let fixture;
  let results;
  let seasons;
  let cms;
  let playoff;
  let parejas;
  let acadinsc;

  const shell = createShell(ctx, {
    onEnterSection(id) {
      if (id === "resultados") results?.reload();
      if (id === "playoff") playoff?.reload();
      if (id === "parejas") parejas?.reload();
      if (id === "temporadas") seasons?.reload();
      if (id === "acadinsc") acadinsc?.reload();
    },
    onDiscardSection(id) {
      if (id === "fixture") {
        ctx.fixture = structuredClone(ctx.fixturePublished);
        fixture?.render();
      }
      if (id === "resultados") {
        for (const m of [...ctx.fixture, ...ctx.results]) m.result = m.appliedResult || "";
        results?.render();
      }
      if (id === "parejas") {
        ctx.dirty.delete("parejas");
        parejas?.reload();
      }
      if (id === "temporadas") {
        seasons?.discard();
      }
    },
  });

  ranking = createRanking(ctx, api, shell);
  fixture = createFixture(ctx, api, shell, {
    onRankingChanged() {
      ranking.refresh();
      results?.render();
      seasons?.render();
    },
  });
  results = createResults(ctx, api, shell, {
    onRankingChanged() {
      ranking.refresh();
      seasons?.render();
    },
  });
  seasons = createSeasons(ctx, api, shell, {
    onSeasonChanged() {
      ranking.refresh();
    },
  });
  cms = createCms(ctx, api, shell);
  playoff = createPlayoff(ctx, api, shell);
  acadinsc = createAcademiaInscripciones(ctx, api);
  parejas = createParejas(ctx, api, shell, {
    onRankingChanged() {
      ranking.refresh();
      seasons?.render();
    },
  });

  async function showApp() {
    $("gate").hidden = true;
    $("app").hidden = false;
    document.body.classList.add("admin-ready");
    sessionStorage.removeItem("liga-fb-gh-token");
    ctx.token = api.getPublishToken();
    try {
      await seasons.load();
    } catch {
      /* si GitHub no responde, se usan los datos de la última publicación */
    }
    ranking.refresh();
    seasons.render();
    fixture.syncWeek();
    fixture.render();
    results.render();
    playoff.render();
    parejas.render();
    cms.refreshAll();
    shell.setSection(shell.initialSection(), { force: true });
  }

  const auth = createAuth(ctx, { onLogin: showApp });

  shell.bind();
  auth.bind();
  ranking.bind();
  fixture.bind();
  results.bind();
  seasons.bind();
  cms.bind();
  playoff.bind();
  parejas.bind();
  acadinsc.bind();

  if (auth.isLoggedIn()) showApp();
}
