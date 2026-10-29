import type { APIRoute } from "astro";
import fixture from "../data/fixture.json";
import results from "../data/results.json";
import ranking from "../data/ranking.json";
import playoffJson from "../data/playoff.json";
import { site } from "../data/site";
import { combineResults, seasonSlug, weekSlug } from "../lib/liga.js";
import { normalizePlayoffs, playoffSlug } from "../lib/playoff.js";

const playoffRoutes = normalizePlayoffs(playoffJson)
  .filter((p) => p.categories.length)
  .map((p) => `playoff/${playoffSlug(p.temp)}/`);

const rankRoutes = [...new Set(ranking.map((p: any) => p.temp).filter(Boolean))].map(
  (t) => `ranking/${seasonSlug(t)}/`
);

const allMatches = combineResults(results, (fixture as any[]).filter((m) => m.home && m.away));
const temps = [...new Set(allMatches.map((m) => m.temp || site.currentSeason).filter(Boolean))];
const seasonWeekRoutes = temps.flatMap((temp) => {
  const weeks = [
    ...new Set(
      allMatches
        .filter((m) => (m.temp || site.currentSeason) === temp)
        .map((m) => m.week || "Sin fecha")
    ),
  ];
  return [
    `fixture/${seasonSlug(temp)}/`,
    `resultados/${seasonSlug(temp)}/`,
    ...weeks.flatMap((week) => [
      `fixture/${seasonSlug(temp)}/${weekSlug(week)}/`,
      `resultados/${seasonSlug(temp)}/${weekSlug(week)}/`,
    ]),
  ];
});

const routes = [
  "",
  "liga/",
  "ranking/",
  ...rankRoutes,
  "fixture/",
  "resultados/",
  ...seasonWeekRoutes,
  "playoff/",
  ...playoffRoutes,
  "ascensos/",
  "inscribir-pareja/",
  "sedes/",
  "academia/",
  "academia/infantiles/",
  "academia/sedes/",
  "academia/inscripcion/",
  "torneos/",
  "inscripcion/",
];

export const GET: APIRoute = ({ site: astroSite }) => {
  const origin = astroSite || new URL("https://diazdiegok.github.io");
  const base = import.meta.env.BASE_URL;
  const urls = routes
    .map((route) => `<url><loc>${new URL(`${base}${route}`, origin).href}</loc></url>`)
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
