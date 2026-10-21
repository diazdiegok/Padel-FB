import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL;
  const origin = site || new URL("https://diazdiegok.github.io");
  const body = [
    "User-agent: *",
    "Allow: /",
    `Disallow: ${base}admin/`,
    `Disallow: ${base}acceso-fb/`,
    "",
    `Sitemap: ${new URL(`${base}sitemap.xml`, origin).href}`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
