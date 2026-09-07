# Padel FB - sitio estático (Astro)

Sitio nuevo de academiapadelfb.com. Sin WordPress. Ranking, fotos y textos extraídos del WP actual.

## Desarrollo

```bash
npm install
npm run dev
```

## Publicar en Hostinger

```bash
npm run build
```

Subí el contenido de `dist/` a `public_html`. Hacé backup de WordPress antes. El `.htaccess` ya redirige las URLs viejas de Elementor.

## Admin

Panel en `/admin/` (botón al lado de Sumate). Login: usuario `Admin`, la clave del cliente y el código de 6 dígitos del autenticador. Para publicar cambios en el sitio hace falta además un Personal Access Token de GitHub (Contents: Read and write).

CSV sugerido: `name,cat,pts,pj,dif,pos,temp`

## Configurar

- WhatsApp: `src/data/site.json` → `whatsapp` (hoy placeholder `5493430000000`; el sitio original no tenía número público).
- Temporada en juego: `currentSeason` (hoy `T4`).
- Ranking: `src/data/ranking.json` (T1–T4, sin S Masculina).

## Extraído del sitio viejo

- 77 imágenes de la biblioteca
- Rankings T1 (individual), T2, T3 y T4 (parejas)
- Sedes: Palermo, Open/Talleres, Américas + complejos mencionados
- Copy de la liga y horarios de academia
