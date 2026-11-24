import assert from "node:assert/strict";
import {
  mergeDriveFixtureRows,
  parseDriveSheetValues,
  pendingDriveRows,
  recoverDriveRows,
} from "./drive-sheet.js";
import { pairsMatch } from "./scoring.js";

const header = ["Fecha", "Dia", "Horario", "Categoria", "Complejo", "Cancha", "Pareja 1", "Pareja 2", "Resultado"];

const played = [
  "Fecha 1",
  "Lunes",
  "17:00 - 18:30",
  "B Masculina",
  "Complejo Padel",
  "Cancha 1",
  "Jeronimo Acuña / Lucio Acuña",
  "José Luis López / Martín Leguizamón",
  "2/6 5/7",
];
const open = [
  "Fecha 1",
  "Martes",
  "16:30 - 18:00",
  "A Masculina",
  "Americas Padel",
  "Cancha 1",
  "Julián Gea Sánchez / Joaquín Gea Sánchez",
  "Mariano Carrere / Tomas Castillo",
  "",
];

const existing = parseDriveSheetValues([header, played, open]);
assert.equal(existing.length, 2);
assert.equal(existing[0].resultado, "2/6 5/7");

const incoming = [
  {
    fecha: "Fecha 1",
    dia: "Lunes",
    horario: "20:00 - 21:30",
    categoria: "B Masculina",
    complejo: "Otro",
    cancha: "Cancha 9",
    pareja1: "Lucio Acuña / Jerónimo Acuña",
    pareja2: "Martín Leguizamón / José Luis López",
    resultado: "",
  },
  {
    fecha: "Fecha 1",
    dia: "Martes",
    horario: "19:00 - 20:30",
    categoria: "A Masculina",
    complejo: "Americas Padel",
    cancha: "Cancha 2",
    pareja1: "Julián Gea Sánchez / Joaquín Gea Sánchez",
    pareja2: "Mariano Carrere / Tomas Castillo",
    resultado: "",
  },
  {
    fecha: "Fecha 1",
    dia: "Miércoles",
    horario: "18:00 - 19:30",
    categoria: "C Masculina",
    complejo: "Open Padel",
    cancha: "Cancha 1",
    pareja1: "Nueva Uno / Nueva Dos",
    pareja2: "Otra Uno / Otra Dos",
    resultado: "",
  },
];

const merged = mergeDriveFixtureRows(existing, incoming);
assert.equal(merged.kept, 1);
assert.equal(merged.rows.length, 3);
assert.equal(merged.rows[0].horario, "17:00 - 18:30", "el partido con resultado no cambia de horario");
assert.equal(merged.rows[0].cancha, "Cancha 1");
assert.equal(merged.rows[0].resultado, "2/6 5/7");
assert.equal(merged.rows[1].horario, "19:00 - 20:30", "sin resultado se actualiza");
assert.equal(merged.rows[1].cancha, "Cancha 2");
assert.equal(merged.rows[2].pareja1, "Nueva Uno / Nueva Dos");

const orphan = mergeDriveFixtureRows(existing, [incoming[1]]);
assert.equal(orphan.rows.length, 2);
assert.equal(orphan.rows[1].resultado, "2/6 5/7", "si el pegado no lo trae, el resultado igual queda");
assert.equal(orphan.keptExtra, 1);

const withOtherScore = mergeDriveFixtureRows(existing, [{ ...incoming[0], resultado: "6/0 6/0" }]);
assert.equal(withOtherScore.rows[0].resultado, "2/6 5/7", "un score ya cargado no se pisa");
assert.equal(withOtherScore.rows[0].horario, "17:00 - 18:30");

const pending = pendingDriveRows(
  [
    {
      week: "Fecha 5",
      cat: "C Femenino",
      home: "Marien Robledo / Valeria Joubert",
      away: "Pendiente / Pendiente",
      pending: true,
      reason: "Su rival ya no está inscripto.",
      days: { Lunes: "19:00 - 21:00" },
    },
    {
      week: "Fecha 5",
      cat: "B Masculina",
      home: "Diego Diaz / Emiliano Fontanetto",
      away: "Alguien / Otro",
      result: "6/4 6/3",
    },
    {
      week: "Fecha 2",
      cat: "C Masculina",
      home: "Ausente / W.O.",
      away: "Pendiente / Pendiente",
      pending: true,
      reason: "No se presentó (W.O.).",
    },
  ],
  (m) => Object.entries(m.days || {}).map(([d, h]) => `${d} ${h}`).join(" · "),
  (m) =>
    pairsMatch(m.home, "Marien Robledo / Valeria Joubert")
      ? { tel1: "5493411111111", tel2: "5493412222222" }
      : {}
);
assert.equal(pending.length, 2, "pendientes normales y W.O. ausente van a Pendientes; el partido con resultado no");
assert.equal(pending[0].puede, "Lunes 19:00 - 21:00");
assert.equal(pending[0].nota, "Su rival ya no está inscripto.");
assert.equal(pending[0].pareja, "Marien Robledo / Valeria Joubert");
assert.equal(pending[0].whatsapp1, "5493411111111");
assert.equal(pending[0].whatsapp2, "5493412222222");
assert.equal(pending[1].pareja, "Ausente / W.O.");
assert.equal(pending[1].nota, "No se presentó (W.O.).");

const recover = recoverDriveRows([
  {
    week: "Fecha 2",
    cat: "C Masculina",
    home: "Ausente / W.O.",
    away: "Pendiente / Pendiente",
    pending: true,
    reason: "No se presentó (W.O.).",
  },
  {
    week: "Fecha 1",
    recoveredIn: "Fecha 2",
    cat: "C Femenino",
    home: "Ana / Bea",
    away: "Pendiente / Pendiente",
    pending: true,
    recoverFrom: "Fecha 1",
    reason: "Tiene 0 partidos en Fecha 1. Recupera esa fecha.",
  },
  {
    week: "Fecha 2",
    cat: "C Femenino",
    home: "Sin rival / Solo",
    away: "Pendiente / Pendiente",
    pending: true,
    reason: "Su rival ya no está inscripto.",
  },
]);
assert.equal(recover.length, 1, "solo recuperan (recoverFrom) van a Recuperan; el W.O. no");
assert.equal(recover[0].pareja, "Ana / Bea");
assert.equal(recover[0].fecha, "Fecha 2", "fecha = recoveredIn cuando recupera en otra fecha");
assert.match(recover[0].nota, /Le falta 1 partido en Fecha 1/);

console.log("drive-sheet.test.mjs passed");
