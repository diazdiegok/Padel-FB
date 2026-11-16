# Google Sheets

## Canchas (Leer Drive)

Sheet fijo (público lector):  
https://docs.google.com/spreadsheets/d/1OHnpx9ganzFR805yv8f5mmyYH_-o-2bNsOn9agmJcvg/edit

- Pestañas: `Fecha 1`, `Fecha 2`, … (mismo nombre que en Fixture)
- Columnas: Complejo, Cancha, Dia, Horario
- Horario: un turno (`16:30`) o rango (`16:30 - 18:00`). El API lee el export CSV del Sheet (no gviz), así que los rangos se conservan aunque la celda esté tipada como hora.
- Compartido: **Cualquiera con el enlace → Lector**

El admin usa **Leer Drive** y pide la pestaña de la fecha abierta.

## Fixture armado (Pegar en Drive)

Sheet fijo donde el admin pega los partidos con rival (sin pendientes):  
https://docs.google.com/spreadsheets/d/1OI6ogfmdOAQ5mz3JqP482cDPT_xp-PjWdE07k54AAiQ/edit

- **Una pestaña por fecha** (`Fecha 1`, `Fecha 2`, …): se crea si no existe y se reemplaza al pegar
- La fecha que pegás queda **primera (izquierda)**; las fechas anteriores se corren a la derecha
- Columnas: Fecha, Dia, Horario, Categoria, Complejo, Cancha, Pareja 1, Pareja 2, Resultado
- Formato: encabezado en **negrita** (fondo suave), fila congelada, filtro, columnas autoajustadas; datos sin negrita
- El Worker necesita el secret `GOOGLE_SERVICE_ACCOUNT` y que ese Sheet esté compartido con el `client_email` de la SA como **Editor**
- Botón en Fixture: **Pegar en Drive** (usa el mismo orden que Descargar Excel; no envía pendientes)
