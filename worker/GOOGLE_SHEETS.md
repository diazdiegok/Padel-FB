# Google Sheet de canchas

Sheet fijo (público lector):  
https://docs.google.com/spreadsheets/d/1OHnpx9ganzFR805yv8f5mmyYH_-o-2bNsOn9agmJcvg/edit

- Pestañas: `Fecha 1`, `Fecha 2`, … (mismo nombre que en Fixture)
- Columnas: Complejo, Cancha, Dia, Horario
- Horario: un turno (`16:30`) o rango (`16:30 - 18:00`). El API lee el export CSV del Sheet (no gviz), así que los rangos se conservan aunque la celda esté tipada como hora.
- Compartido: **Cualquiera con el enlace → Lector**

El admin usa **Leer Drive** y pide la pestaña de la fecha abierta.
