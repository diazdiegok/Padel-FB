import type { APIRoute } from "astro";

const routes = [
  "",
  "liga/",
  "ranking/",
  "fixture/",
  "resultados/",
  "fecha/",
  "sedes/",
  "academia/",
  "academia/infantiles/",
  "academia/sedes/",
  "torneos/",
  "inscripcion/",
];

export const GET: APIRoute = ({ site }) => {
  const origin = site || new URL("https://diazdiegok.github.io");
  const base = "/Padel-FB/";
  const urls = routes
    .map((route) => `<url><loc>${new URL(`${base}${route}`, origin).href}</loc></url>`)
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
