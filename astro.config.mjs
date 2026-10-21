import { defineConfig } from "astro/config";

const onVercel = Boolean(process.env.VERCEL);
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const githubOrigin = "https://diazdiegok.github.io";
const vercelAlias = "https://padel-fb.vercel.app";

async function servesShareImage(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL("/images/og-share.jpg", origin).href;
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    const type = res.headers.get("content-type") || "";
    return res.ok && type.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const preferred =
  process.env.SITE_URL || (onVercel && vercelHost ? `https://${vercelHost}` : githubOrigin);
const alias = vercelHost?.endsWith(".vercel.app") ? `https://${vercelHost}` : vercelAlias;

// WhatsApp sigue og:url. academiapadelfb.com todavía sirve el WordPress viejo
// y la imagen da 404, así que la previsualización queda solo con el dominio.
const site = onVercel && !(await servesShareImage(preferred)) ? alias : preferred;

export default defineConfig({
  site,
  base: onVercel ? "/" : "/Padel-FB/",
  output: "static",
  trailingSlash: "always",
});
