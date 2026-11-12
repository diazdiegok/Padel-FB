import assert from "node:assert/strict";
import { assignCourtSlots, parseCourtSlot, parseCourtSlotRows, weekFromName } from "./slots.js";

assert.equal(weekFromName("Fecha 1.xlsx"), "Fecha 1");
assert.equal(weekFromName("fecha-2-canchas.csv"), "Fecha 2");
assert.equal(weekFromName("turnos.xlsx"), "");

const s1 = parseCourtSlot({ Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 20:30" });
assert.equal(s1.day, "Lunes");
assert.equal(s1.time, "19:00 - 20:30");
assert.equal(s1.venue, "Terrazas");
assert.equal(s1.court, "1");

const s2 = parseCourtSlot({ Complejo: "Open", Cancha: "2", Dia: "Martes", Horario: "20 a 22" });
assert.equal(s2.day, "Martes");
assert.ok(s2.from < s2.to);

assert.equal(parseCourtSlot({ Complejo: "Open", Cancha: "2", Horario: "20:00 - 21:30" }), null, "exige Dia");
assert.equal(parseCourtSlot({ Complejo: "Open", Dia: "Martes", Horario: "20:00 - 21:30" }), null, "exige Cancha");

const slots = parseCourtSlotRows([
  { Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 20:30" },
  { Complejo: "Terrazas", Cancha: "2", Dia: "Lunes", Horario: "19:00 - 20:30" },
  { Complejo: "Open", Cancha: "1", Dia: "Martes", Horario: "20:00 - 21:30" },
]);
assert.equal(slots.length, 3);

const matches = [
  { week: "Fecha 1", cat: "A Masculina", day: "Lunes", time: "19:00 - 20:30", home: "A / B", away: "C / D", venue: "", court: "" },
  { week: "Fecha 1", cat: "B Masculina", day: "Lunes", time: "19:00 - 20:30", home: "E / F", away: "G / H", venue: "", court: "" },
  { week: "Fecha 1", cat: "C Masculina", day: "Martes", time: "20:00 - 21:30", home: "I / J", away: "K / L", venue: "", court: "" },
  { week: "Fecha 1", cat: "A Masculina", day: "", time: "", home: "Solo", away: "Pendiente / Pendiente", pending: true },
];

const out = assignCourtSlots(matches, slots, { onlyEmpty: true });
assert.equal(out.assigned, 3);
assert.equal(out.leftover, 0);
assert.equal(out.matches[0].venue, "Terrazas");
assert.ok(out.matches[0].court);
assert.equal(out.matches[2].venue, "Open");
assert.ok(out.matches[3].pending);

const kept = assignCourtSlots(
  [{ ...matches[0], venue: "Palermo", court: "3", time: "19:00 - 20:30" }],
  slots,
  { onlyEmpty: true }
);
assert.equal(kept.assigned, 0);
assert.equal(kept.matches[0].venue, "Palermo");

console.log("slots ok");
