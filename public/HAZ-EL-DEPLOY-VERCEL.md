# HAZ EL DEPLOY — Vercel

Cuando se libere la cuota Hobby (~100 deploys / 24 h), **hay que publicar `main` en Vercel**.
Hasta entonces el admin en prod sigue con JS/CSS viejo.

## Qué falta ver en el sitio (solo UI admin, ya está en `main`)

1. **Consumos en 3 bloques** — Cloudflare / Vercel / GitHub separados, cada uno con barra, “quedan X” y renovación (hora AR + countdown).
2. **Alerta Consumos en ámbar** — puntito/aviso sin poner el botón rojo como Salir.
3. **Resultados: inputs legibles** — fondo oscuro y texto claro en el score.

## Qué NO entra en este deploy (y no se toca)

- **Fixture** (armar, pendientes, near slots, Pegar en Drive, Excel, etc.): no se modifica en este paquete.
- Datos de partidos / parejas / ranking: no cambian por un deploy de Vercel.
- Worker (API): ya está al día por `wrangler deploy` (barras Vercel/GitHub en Actualizar, Drive, etc.).

## Cómo saber que el deploy salió

- En Consumos el texto de ayuda dice: *Cuotas separadas: Cloudflare…*
- Aparecen títulos **CLOUDFLARE / VERCEL / GITHUB** (no solo alertas arriba).
- Este archivo queda público en: `/HAZ-EL-DEPLOY-VERCEL.md` (o el HTML generado si el host lo sirve).

## Trigger

Cualquier push a `main` dispara Vercel. Este commit es el recordatorio: **HAZ EL DEPLOY**.
