import type { APIRoute } from "astro";
import playoffJson from "../data/playoff.json";
import { normalizePlayoffs, playoffSlug } from "../lib/playoff.js";

const playoffRoutes = normalizePlayoffs(playoffJson)
  .filter((p) => p.categories.length)
  .map((p) => `playoff/${playoffSlug(p.temp)}/`);

const routes = [
  "",
  "liga/",
  "ranking/",
  "fixture/",
  "resultados/",
  "playoff/",
  ...playoffRoutes,
  "inscribir-pareja/",
  "sedes/",
  "academia/",
  "academia/infantiles/",
  "academia/sedes/",
  "academia/inscripcion/",
  "torneos/",
  "inscripcion/",
];

export const GET: APIRoute = ({ site }) => {
  const origin = site || new URL("https://diazdiegok.github.io");
  const base = import.meta.env.BASE_URL;
  const urls = routes
    .map((route) => `<url><loc>${new URL(`${base}${route}`, origin).href}</loc></url>`)
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
