import { defineConfig } from "astro/config";

const onVercel = Boolean(process.env.VERCEL);
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export default defineConfig({
  site: process.env.SITE_URL || (onVercel && vercelHost ? `https://${vercelHost}` : "https://diazdiegok.github.io"),
  base: onVercel ? "/" : "/Padel-FB/",
  output: "static",
  trailingSlash: "always",
});
