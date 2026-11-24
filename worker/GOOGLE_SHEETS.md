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

- **Una pestaña por fecha** (`Fecha 1`, `Fecha 2`, …): se crea si no existe. Al volver a pegar, los partidos que ya tienen resultado quedan igual; el resto se actualiza
- La fecha que pegás queda **primera (izquierda)**; las fechas anteriores se corren a la derecha
- Columnas: Fecha, Dia, Horario, Categoria, Complejo, Cancha, Pareja 1, Pareja 2, Resultado
- Formato: encabezado en **negrita** (fondo suave), fila congelada, filtro, columnas autoajustadas; datos sin negrita
- El Worker necesita el secret `GOOGLE_SERVICE_ACCOUNT` y que ese Sheet esté compartido con el `client_email` de la SA como **Editor**
- Botón en Fixture: **Pegar en Drive** (usa el mismo orden que Descargar Excel para los partidos con rival)
- Un score que ya está en la hoja no se pisa ni se borra, aunque el fixture lo traiga distinto

## Pendientes

Sheet fijo, solo parejas que todavía no tienen rival (incluye ausentes por W.O.):  
https://docs.google.com/spreadsheets/d/1-iy8HSNkDDUJg4do08aydAK1MMtfhqrWmO4PGebkxe4/edit

- El mismo botón **Pegar en Drive** lo actualiza después de pegar resultados
- **Una pestaña por fecha**. Quien ya tiene partido deja de figurar
- Columnas: Fecha, Categoria, Pareja, WhatsApp 1, WhatsApp 2, Puede, Nota
- `WhatsApp 1` / `WhatsApp 2` salen de los contactos de la inscripción (solo en este sheet)
- `Puede` es la disponibilidad de la inscripción (ej. `Lunes 19:00 - 21:00`)
- W.O.: en `Nota` va `No se presentó (W.O.).`
- Compartido con el `client_email` de la cuenta de servicio como **Editor**

## Recuperan fecha

Sheet fijo para quien debe un partido de otra fecha (lo del admin en Recuperan fecha):  
https://docs.google.com/spreadsheets/d/1M4OMDttW86SdOixs-uCbXyZLoPSbf-YLylZO7qwkYrQ/edit

- El mismo botón **Pegar en Drive** lo actualiza junto con Pendientes
- **Una pestaña por fecha**. Misma forma de columnas que Pendientes
- En `Nota` va el texto tipo `Le falta 1 partido en Fecha 1.`
- Los W.O. de la fecha actual van a Pendientes, no acá
- Compartido con el `client_email` de la cuenta de servicio como **Editor**

## Complejos libres

Sheet fijo con los turnos del Drive de canchas que el fixture todavía no usó:  
https://docs.google.com/spreadsheets/d/1yLTWLdIfrZXuho8dwXdYVuJKcDMLEHxymHXMdIv1hAs/edit

- El mismo botón **Pegar en Drive** lo actualiza junto con Resultados, Pendientes y Recuperan
- **Una pestaña por fecha** (`Fecha 1`, `Fecha 2`, …): se crea si no existe
- Columnas: Fecha, Dia, Horario, Complejo, Cancha
- Un turno = 1:30 libre (sin solaparse con partidos ya armados en esa cancha)
- Si no hay canchas leídas del Drive, este sheet no se toca
- Compartido con el `client_email` de la cuenta de servicio como **Editor**
