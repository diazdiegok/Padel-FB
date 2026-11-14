import assert from "node:assert/strict";
import {
  applyVenuePlan,
  assignCourtSlots,
  matchStartsInWindow,
  parseCourtSlot,
  parseCourtSlotRows,
  parseCourtWindow,
  summarizeCourtSlots,
  weekFromName,
  windowCapacity,
} from "./slots.js";

assert.equal(weekFromName("Fecha 1.xlsx"), "Fecha 1");
assert.equal(weekFromName("fecha-2-canchas.csv"), "Fecha 2");
assert.equal(weekFromName("turnos.xlsx"), "");

const s1 = parseCourtSlot({ Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 20:30" });
assert.equal(s1.day, "Lunes");
assert.equal(s1.time, "19:00 - 20:30");
assert.equal(s1.venue, "Terrazas Padel");
assert.equal(s1.court, "1");
assert.equal(s1.capacity, 1);

// Un solo horario = turno fijo de 1:30
const single = parseCourtWindow("14:30");
assert.deepEqual(single, { from: 14 * 60 + 30, to: 16 * 60, single: true });
const openSingle = parseCourtSlot({ Complejo: "OPEN", Cancha: "Cancha 1", Dia: "Lunes", Horario: "14:30" });
assert.equal(openSingle.time, "14:30 - 16:00");
assert.equal(openSingle.venue, "Open Padel");
assert.equal(openSingle.capacity, 1);

// Rango = ventana de disponibilidad (no 3 filas fijas del Excel)
const range = parseCourtSlot({
  Complejo: "La Manzana",
  Cancha: "Cancha 2",
  Dia: "Lunes",
  Horario: "16:30 - 21:00",
});
assert.ok(!Array.isArray(range));
assert.equal(range.from, 16 * 60 + 30);
assert.equal(range.to, 21 * 60);
assert.equal(range.capacity, 3);
assert.equal(range.time, "16:30 - 21:00");
assert.equal(windowCapacity(range.from, range.to), 3);

const starts = matchStartsInWindow(range.from, range.to);
assert.ok(starts.length > 3); // cada 30' dentro del rango
assert.equal(starts[0].time, "16:30 - 18:00");
assert.ok(starts.some((s) => s.time === "17:00 - 18:30"));
assert.ok(starts.some((s) => s.time === "19:30 - 21:00"));

assert.equal(parseCourtSlot({ Complejo: "Open", Cancha: "2", Horario: "20:00 - 21:30" }), null, "exige Dia");
assert.equal(parseCourtSlot({ Complejo: "Open", Dia: "Martes", Horario: "20:00 - 21:30" }), null, "exige Cancha");

const slots = parseCourtSlotRows([
  { Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 20:30" },
  { Complejo: "Terrazas", Cancha: "2", Dia: "Lunes", Horario: "19:00 - 20:30" },
  { Complejo: "Open", Cancha: "1", Dia: "Martes", Horario: "20:00 - 21:30" },
]);
assert.equal(slots.length, 3);

const summary = summarizeCourtSlots(slots);
assert.equal(summary.length, 2);

const planned = applyVenuePlan(slots, [
  { venue: "Terrazas Padel", count: 1, days: ["Lunes"] },
  { venue: "Open Padel", count: 1, days: ["Martes"] },
]);
assert.equal(planned.length, 2);

const matches = [
  { week: "Fecha 1", cat: "A Masculina", day: "Lunes", time: "19:00 - 20:30", home: "A / B", away: "C / D", venue: "", court: "" },
  { week: "Fecha 1", cat: "B Masculina", day: "Lunes", time: "19:00 - 20:30", home: "E / F", away: "G / H", venue: "", court: "" },
  { week: "Fecha 1", cat: "C Masculina", day: "Martes", time: "20:00 - 21:30", home: "I / J", away: "K / L", venue: "", court: "" },
  { week: "Fecha 1", cat: "A Masculina", day: "", time: "", home: "Solo", away: "Pendiente / Pendiente", pending: true },
];

const out = assignCourtSlots(matches, slots, { onlyEmpty: true });
assert.equal(out.assigned, 3);
assert.equal(out.matches[0].venue, "Terrazas Padel");
assert.ok(out.matches[0].court);
assert.equal(out.matches[2].venue, "Open Padel");
assert.ok(out.matches[3].pending);
assert.equal(out.matches[3].venue || "", "", "sin cupo libre el pendiente queda sin cancha");

const spareSlots = parseCourtSlotRows([
  { Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 20:30" },
  { Complejo: "Terrazas", Cancha: "2", Dia: "Lunes", Horario: "19:00 - 20:30" },
  { Complejo: "Open", Cancha: "1", Dia: "Martes", Horario: "20:00 - 21:30" },
  { Complejo: "Palermo", Cancha: "1", Dia: "Miércoles", Horario: "18:00 - 19:30" },
]);
const withPending = assignCourtSlots(matches, spareSlots, { onlyEmpty: true, preferPlan: true });
assert.equal(withPending.assigned, 4);
assert.ok(withPending.matches[3].pending);
assert.ok(withPending.matches[3].venue, "pendiente reserva complejo");
assert.ok(withPending.matches[3].day, "pendiente reserva día");
assert.ok(withPending.matches[3].time, "pendiente reserva horario");
assert.ok(withPending.matches[3].court, "pendiente reserva cancha");

// Dentro de 16:30-21:00 caben 3 partidos sin solapar en la misma cancha
const manzana = parseCourtSlotRows([
  { Complejo: "La Manzana", Cancha: "Cancha 2", Dia: "Lunes", Horario: "16:30 - 21:00" },
]);
const three = [
  { day: "Lunes", time: "", home: "A / B", away: "C / D", venue: "", court: "" },
  { day: "Lunes", time: "", home: "E / F", away: "G / H", venue: "", court: "" },
  { day: "Lunes", time: "", home: "I / J", away: "K / L", venue: "", court: "" },
  { day: "Lunes", time: "", home: "M / N", away: "O / P", venue: "", court: "" },
];
const packed = assignCourtSlots(three, manzana, { onlyEmpty: true, preferPlan: true });
assert.equal(packed.assigned, 3);

const kept = assignCourtSlots(
  [{ ...matches[0], venue: "Palermo", court: "3", time: "19:00 - 20:30" }],
  slots,
  { onlyEmpty: true }
);
assert.equal(kept.assigned, 0);
assert.equal(kept.matches[0].venue, "Palermo");

console.log("slots ok");
