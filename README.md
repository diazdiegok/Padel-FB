# Padel FB - sitio estático (Astro)

Sitio nuevo de academiapadelfb.com. Sin WordPress. Ranking, fotos y textos extraídos del WP actual.

## Desarrollo

```bash
npm install
npm run dev
```

## Publicar

Push a `main` → GitHub Pages. Build local:

```bash
npm run build
```

## Admin

Panel en `/admin/` (acceso vía `/acceso-fb/`).

**Login:** usuario + clave del cliente + código TOTP de 6 dígitos. La sesión se guarda en el navegador (~14 días). La publicación va por el Worker `padel-fb-api` (no hace falta pegar un PAT de GitHub en la UI).

### Secciones

| Área | Qué hace |
|------|----------|
| **Ranking** | Editar tabla, CSV (modelo / exportar / importar), publicar `ranking.json` |
| **Fixture** | Cargar Drive/CSV → revisar partidos → publicar (archiva fechas viejas en Resultados y actualiza ranking con scores) |
| **Resultados** | Archivo de fechas jugadas + partidos live con resultado |
| **Fecha** | Abrir/cerrar carga de disponibilidad (`/fecha/`) |
| **Sedes** | Complejos (flags Liga / Academia) |
| **Academia / Infantiles** | Textos, profes, horarios |
| **Sitio** | Temporada, WhatsApp, Instagram, copy de inicio |
| **Torneos** | Listado o aviso vacío |

CSV ranking: `name,cat,pts,pj,dif,pos,temp`

Fixture Drive: `categoria, partido, complejo, cancha, dia, horario`

## Configurar

- WhatsApp / temporada / copy: desde Admin → Sitio, o `src/data/site.json`
- Ranking: `src/data/ranking.json`
- API: `site.json` → `apiUrl` (Worker)

## Extraído del sitio viejo

- 77 imágenes de la biblioteca
- Rankings T1 (individual), T2, T3 y T4 (parejas)
- Sedes: Palermo, Open/Talleres, Américas + complejos mencionados
- Copy de la liga y horarios de academia
