import { createApi } from "./api.js";
import { createAuth } from "./auth.js";
import { HIDDEN_CATS } from "./constants.js";
import { createCms } from "./cms.js";
import { createFecha } from "./fecha.js";
import { createFixture } from "./fixture.js";
import { createRanking } from "./ranking.js";
import { createResults } from "./results.js";
import { createSeasons } from "./seasons.js";
import { createShell } from "./shell.js";
import { $ } from "./ui.js";

export function bootAdmin({ rankingJson, fixtureJson, siteJson, dispJson, resultsJson }) {
  const ctx = {
    rows: structuredClone(rankingJson.filter((p) => !HIDDEN_CATS.has(p.cat))),
    siteData: structuredClone(siteJson),
    fixture: structuredClone(fixtureJson || []),
    results: structuredClone(resultsJson || []),
    disp: structuredClone(dispJson),
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
  let fecha;
  let cms;

  const shell = createShell(ctx, {
    onEnterSection(id) {
      if (id === "fecha") fecha?.reload();
      if (id === "resultados") results?.reload();
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
      fecha?.fill();
    },
  });
  fecha = createFecha(ctx, api, shell);
  cms = createCms(ctx, api, shell);

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
    $("fx-week").value = ctx.fixture[0]?.week || $("fx-week").value || "Fecha 1";
    fixture.render();
    results.render();
    cms.refreshAll();
    fecha.fill();
    fecha.reload();
    shell.setSection(shell.initialSection(), { force: true });
  }

  const auth = createAuth(ctx, { onLogin: showApp });

  shell.bind();
  auth.bind();
  ranking.bind();
  fixture.bind();
  results.bind();
  seasons.bind();
  fecha.bind();
  cms.bind();

  if (auth.isLoggedIn()) showApp();
}
