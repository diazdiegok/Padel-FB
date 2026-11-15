import assert from "node:assert/strict";
import {
  applyVenuePlan,
  assignCourtSlots,
  driveCourtOptions,
  isCourtTaken,
  matchStartsInWindow,
  parseCourtSlot,
  parseCourtSlotRows,
  parseCourtWindow,
  rematchForCourts,
  slotFitsPairAvailability,
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

// Bug: varios partidos del fixtureo caen en el mismo horario; al agotarse esas canchas
// deben reubicarse en otro turno del plan (no quedar con día/hora y sin complejo).
const crowdedSlots = parseCourtSlotRows([
  { Complejo: "Open", Cancha: "1", Dia: "Lunes", Horario: "18:00 - 19:30" },
  { Complejo: "Open", Cancha: "2", Dia: "Lunes", Horario: "19:00 - 20:30" },
  { Complejo: "Americas", Cancha: "1", Dia: "Lunes", Horario: "17:00 - 18:30" },
]);
const crowded = [
  { day: "Lunes", time: "18:00 - 19:30", home: "A1 / A2", away: "A3 / A4", venue: "", court: "", cat: "A Masculina" },
  { day: "Lunes", time: "18:00 - 19:30", home: "B1 / B2", away: "B3 / B4", venue: "", court: "", cat: "B Masculina" },
  { day: "Lunes", time: "18:00 - 19:30", home: "C1 / C2", away: "C3 / C4", venue: "", court: "", cat: "C Masculina" },
];
const rescued = assignCourtSlots(crowded, crowdedSlots, { onlyEmpty: true, preferPlan: true });
assert.equal(rescued.assigned, 3, "los 3 consiguen cancha aunque peleen el mismo horario");
assert.ok(rescued.matches.every((m) => m.venue && m.court && m.day && m.time));
assert.equal(rescued.matches.filter((m) => m.time === "18:00 - 19:30").length, 1, "solo una cancha a las 18:00");

// Disponibilidad: nunca viernes 15:00 si la pareja anotó 16:30-19:30 (caso Diaz/Fontanetto).
const friEarly = {
  venue: "La manzana Padel",
  court: "Cancha 1",
  day: "Viernes",
  from: 15 * 60,
  to: 16 * 60 + 30,
  time: "15:00 - 16:30",
};
const friOk = {
  venue: "Open Padel",
  court: "Cancha 1",
  day: "Viernes",
  from: 17 * 60,
  to: 18 * 60 + 30,
  time: "17:00 - 18:30",
};
const diazDays = { Jueves: "16:30 - 19:30", Viernes: "16:30 - 19:30", Sábado: "16:30 - 19:30" };
const rivalDays = { Viernes: "14:00 - 22:00" };
assert.equal(
  slotFitsPairAvailability(friEarly, { homeDays: rivalDays, awayDays: diazDays }),
  false,
  "15:00-16:30 no entra en 16:30-19:30"
);
assert.equal(slotFitsPairAvailability(friOk, { homeDays: rivalDays, awayDays: diazDays }), true);

const availSlots = parseCourtSlotRows([
  { Complejo: "La Manzana", Cancha: "1", Dia: "Viernes", Horario: "15:00 - 16:30" },
  { Complejo: "La Manzana", Cancha: "1", Dia: "Viernes", Horario: "16:30 - 18:00" },
  { Complejo: "Open", Cancha: "1", Dia: "Viernes", Horario: "17:00 - 18:30" },
]);
const diazMatch = {
  day: "Viernes",
  time: "16:30 - 18:00",
  home: "Denis Márquez / Ramira Omar",
  away: "Diego Diaz / Emiliano Fontanetto",
  venue: "",
  court: "",
  cat: "A Masculina",
  homeDays: rivalDays,
  awayDays: diazDays,
};
// Otro partido se queda con 16:30; Diaz no puede caer en 15:00 aunque preferPlan busque otra cancha.
const crowdedAvail = assignCourtSlots(
  [
    { day: "Viernes", time: "16:30 - 18:00", home: "A / B", away: "C / D", venue: "", court: "", cat: "B Masculina" },
    diazMatch,
  ],
  availSlots,
  { onlyEmpty: true, preferPlan: true }
);
assert.equal(crowdedAvail.assigned, 2);
const diazRow = crowdedAvail.matches.find((m) => /Fontanetto/i.test(m.away));
assert.ok(diazRow.venue, "Diaz consigue cancha");
assert.notEqual(diazRow.time, "15:00 - 16:30", "no puede ir a las 15");
assert.ok(
  ["16:30 - 18:00", "17:00 - 18:30"].includes(diazRow.time),
  `horario válido, got ${diazRow.time}`
);

const onlyEarly = assignCourtSlots(
  [{ ...diazMatch, time: "16:30 - 18:00", venue: "", court: "" }],
  parseCourtSlotRows([{ Complejo: "La Manzana", Cancha: "1", Dia: "Viernes", Horario: "15:00 - 16:30" }]),
  { onlyEmpty: true, preferPlan: true }
);
assert.equal(onlyEarly.assigned, 0, "mejor sin cancha que fuera de disponibilidad");
assert.equal(onlyEarly.matches[0].venue || "", "");
assert.equal(onlyEarly.matches[0].time, "16:30 - 18:00");

// Pool vs pack: con disponibilidad 16:30-19:30 el pack temprano dejaba 15:00 y faltaban canchas;
// el pool ofrece 18:00 y completa complejo/cancha sin violar inscripción.
const rangeSlots = parseCourtSlotRows([
  { Complejo: "Open", Cancha: "1", Dia: "Viernes", Horario: "15:00 - 21:00" },
  { Complejo: "Open", Cancha: "2", Dia: "Viernes", Horario: "15:00 - 21:00" },
]);
const packedEarly = applyVenuePlan(rangeSlots, [{ venue: "Open Padel", count: 4, days: ["Viernes"] }]);
assert.ok(
  packedEarly.filter((s) => s.time === "15:00 - 16:30").length >= 2,
  "pack agarra turnos tempranos"
);
const poolAll = applyVenuePlan(rangeSlots, [{ venue: "Open Padel", count: 4, days: ["Viernes"] }], { mode: "pool" });
assert.ok(poolAll.some((s) => s.time === "18:00 - 19:30"), "pool incluye turnos tarde");
const narrow = { Viernes: "16:30 - 19:30" };
const fourNarrow = [0, 1, 2, 3].map((i) => ({
  day: "Viernes",
  time: "16:30 - 18:00",
  home: `H${i}a / H${i}b`,
  away: `A${i}a / A${i}b`,
  venue: "",
  court: "",
  homeDays: narrow,
  awayDays: narrow,
}));
const filled = assignCourtSlots(fourNarrow, poolAll, {
  onlyEmpty: true,
  preferPlan: true,
  venueCaps: { "Open Padel": 4 },
});
assert.equal(filled.assigned, 4, "4 partidos con cancha respetando 16:30-19:30");
assert.ok(filled.matches.every((m) => m.venue && m.court));
assert.ok(filled.matches.every((m) => m.time !== "15:00 - 16:30"));

// Reasignación: el flexible cede el turno de las 18:00 al que solo puede de tarde.
{
  const oneCourt = parseCourtSlotRows([
    { Complejo: "Open", Cancha: "1", Dia: "Lunes", Horario: "16:00 - 22:00" },
  ]);
  const onePool = applyVenuePlan(oneCourt, [{ venue: "Open Padel", count: 2, days: ["Lunes"] }], { mode: "pool" });
  const swap = assignCourtSlots(
    [
      {
        day: "Lunes",
        time: "18:00 - 19:30",
        home: "Flexible / A",
        away: "Flexible / B",
        venue: "",
        court: "",
        homeDays: { Lunes: "16:00 - 22:00" },
        awayDays: { Lunes: "16:00 - 22:00" },
      },
      {
        day: "Lunes",
        time: "18:00 - 19:30",
        home: "Tarde / A",
        away: "Tarde / B",
        venue: "",
        court: "",
        homeDays: { Lunes: "18:00 - 21:00" },
        awayDays: { Lunes: "18:00 - 21:00" },
      },
    ],
    onePool,
    { preferPlan: true, venueCaps: { "Open Padel": 2 } }
  );
  assert.equal(swap.assigned, 2, "ambos con cancha vía reasignación");
  const tarde = swap.matches.find((m) => /Tarde/.test(m.home));
  assert.ok(tarde.venue, "el de la tarde tiene complejo");
  assert.ok(Number(tarde.time.slice(0, 2)) >= 18 || tarde.time.startsWith("18:") || tarde.time.startsWith("19:"), tarde.time);
}

// Desplegable: canchas del Sheet sin tope de cupo; con disponibilidad, también otros días.
{
  const sheet = parseCourtSlotRows([
    { Complejo: "Americas", Cancha: "Cancha 1", Dia: "Lunes", Horario: "16:00 - 22:00" },
    { Complejo: "Americas", Cancha: "Cancha 2", Dia: "Lunes", Horario: "19:00 - 20:30" },
    { Complejo: "Open", Cancha: "Cancha 1", Dia: "Lunes", Horario: "19:00 - 20:30" },
    { Complejo: "Open", Cancha: "Cancha 1", Dia: "Lunes", Horario: "19:00 - 20:30" },
    { Complejo: "Open", Cancha: "Cancha 2", Dia: "Martes", Horario: "19:00 - 20:30" },
    { Complejo: "Terrazas", Cancha: "Cancha 1", Dia: "Lunes", Horario: "21:00 - 22:30" },
    { Complejo: "Palermo", Cancha: "Cancha 1", Dia: "Viernes", Horario: "18:00 - 19:30" },
  ]);
  const match = {
    day: "Lunes",
    time: "19:00 - 20:30",
    home: "A / B",
    away: "C / D",
    venue: "",
    court: "",
    homeDays: { Lunes: "18:00 - 22:00", Martes: "18:00 - 22:00" },
    awayDays: { Lunes: "18:00 - 22:00", Martes: "18:00 - 22:00" },
  };
  const opts = driveCourtOptions(match, sheet, [
    { day: "Lunes", time: "16:30 - 18:00", venue: "Americas Padel", court: "Cancha 1" },
  ]);
  assert.ok(opts.some((o) => o.sameWhen && o.venue === "Americas Padel" && o.court === "Cancha 1"));
  assert.ok(opts.some((o) => o.sameWhen && o.venue === "Open Padel" && o.court === "Cancha 1"));
  assert.ok(opts.some((o) => o.day === "Martes" && o.venue === "Open Padel" && o.court === "Cancha 2"), "ofrece otro día si pueden");
  assert.ok(!opts.some((o) => o.day === "Viernes"), "no ofrece un día fuera de la inscripción");
  assert.equal(opts.filter((o) => o.venue === "Open Padel" && o.court === "Cancha 1" && o.sameWhen).length, 1, "no duplica");

  const blockedSame = driveCourtOptions(match, sheet, [
    { day: "Lunes", time: "19:00 - 20:30", venue: "Americas Padel", court: "Cancha 1" },
    { day: "Lunes", time: "18:30 - 20:00", venue: "Americas Padel", court: "Cancha 2" },
    { day: "Lunes", time: "19:00 - 20:30", venue: "Open Padel", court: "Cancha 1" },
    { day: "Lunes", time: "21:00 - 22:30", venue: "Terrazas Padel", court: "Cancha 1" },
  ]);
  assert.ok(
    blockedSame.every((o) => !(o.day === "Lunes" && o.time === "19:00 - 20:30" && ["Americas Padel", "Open Padel"].includes(o.venue))),
    "no ofrece una cancha ocupada en ese horario"
  );
  assert.ok(blockedSame.some((o) => o.day === "Martes"), "si el horario quedó lleno, ofrece otro día");

  const garbarino = driveCourtOptions(
    {
      day: "Viernes",
      time: "18:00 - 19:30",
      home: "Jorgelina Garbarino / Laura Ramírez Kunzi",
      away: "Laura Martínez / Dalila Sosa",
      venue: "",
      court: "",
      homeDays: {
        Miércoles: "18:00 - 00:00",
        Jueves: "18:00 - 00:00",
        Viernes: "18:00 - 00:00",
        Sábado: "10:00 - 18:00",
      },
      awayDays: {
        Lunes: "16:30 - 20:30",
        Martes: "16:30 - 20:30",
        Viernes: "16:30 - 21:00",
        Sábado: "19:00 - 20:30",
      },
    },
    parseCourtSlotRows([
      { Complejo: "Open", Cancha: "1", Dia: "Viernes", Horario: "18:00 - 19:30" },
      { Complejo: "Open", Cancha: "2", Dia: "Viernes", Horario: "19:00 - 20:30" },
      { Complejo: "Terrazas", Cancha: "1", Dia: "Sábado", Horario: "19:00 - 20:30" },
      { Complejo: "Americas", Cancha: "1", Dia: "Lunes", Horario: "18:00 - 19:30" },
    ]),
    [{ day: "Viernes", time: "18:00 - 19:30", venue: "Open Padel", court: "1" }]
  );
  assert.deepEqual(
    garbarino.map((o) => `${o.day}|${o.time}|${o.venue}|${o.court}`),
    ["Viernes|19:00 - 20:30|Open Padel|2"],
    "si Viernes 18:00 está ocupado, ofrece otro turno del viernes que puedan; no sábado (sin solape) ni lunes (solo una pareja)"
  );

  const outside = driveCourtOptions(
    { ...match, homeDays: { Lunes: "16:00 - 17:00" }, awayDays: { Lunes: "16:00 - 17:00" } },
    sheet,
    []
  );
  assert.equal(outside.length, 0, "no ofrece un horario fuera de la inscripción");
  assert.equal(driveCourtOptions({ time: "19:00 - 20:30" }, sheet, []).length, 0, "sin día ni disponibilidad no inventa turnos");
}

{
  const taken = [{ day: "Viernes", time: "18:00 - 19:30", venue: "Open Padel", court: "1" }];
  assert.equal(
    isCourtTaken({ day: "Viernes", time: "18:00 - 19:30", venue: "Open Padel", court: "1" }, taken),
    true,
    "misma cancha y horario = en uso"
  );
  assert.equal(
    isCourtTaken({ day: "Viernes", time: "18:00 - 19:30", venue: "Open Padel", court: "2" }, taken),
    false,
    "otra cancha libre"
  );
  assert.equal(
    isCourtTaken({ day: "Viernes", time: "19:00 - 20:30", venue: "Open Padel", court: "1" }, taken),
    true,
    "horario solapado también cuenta como en uso"
  );
  assert.equal(
    isCourtTaken({ day: "Viernes", time: "20:00 - 21:30", venue: "Open Padel", court: "1" }, taken),
    false,
    "mismo complejo/cancha pero horario libre"
  );
}

// Si A-B no entra en cancha y C-D sí, cambiar rivales puede salvar ambos turnos.
{
  const sheet = parseCourtSlotRows([
    { Complejo: "Open", Cancha: "1", Dia: "Lunes", Horario: "18:00 - 19:30" },
    { Complejo: "Open", Cancha: "1", Dia: "Martes", Horario: "18:00 - 19:30" },
  ]);
  const matches = [
    {
      cat: "C Femenino",
      day: "Lunes",
      time: "18:00 - 19:30",
      home: "A1 / A2",
      away: "B1 / B2",
      venue: "",
      court: "",
      // A solo lunes, B solo martes → este cruce nunca entra en cancha
      homeDays: { Lunes: "17:00 - 21:00" },
      awayDays: { Martes: "17:00 - 21:00" },
    },
    {
      cat: "C Femenino",
      day: "Martes",
      time: "18:00 - 19:30",
      home: "C1 / C2",
      away: "D1 / D2",
      venue: "",
      court: "",
      // C solo martes, D solo lunes → este cruce tampoco
      homeDays: { Martes: "17:00 - 21:00" },
      awayDays: { Lunes: "17:00 - 21:00" },
    },
  ];
  const stuck = assignCourtSlots(matches, sheet, { onlyEmpty: true, preferPlan: true });
  assert.equal(stuck.assigned, 0, "sin cambiar rivales no hay cancha");
  const fixed = rematchForCourts(matches, sheet, { onlyEmpty: true, preferPlan: true });
  assert.ok(fixed.swaps >= 1, "cambia rivales");
  assert.equal(fixed.assigned, 2, "después del cambio ambos tienen cancha");
  assert.ok(fixed.matches.every((m) => m.venue && m.court));
  const homes = fixed.matches.map((m) => m.home).sort();
  const aways = fixed.matches.map((m) => m.away).sort();
  assert.ok(homes.includes("A1 / A2") && homes.includes("C1 / C2"));
  assert.ok(aways.includes("D1 / D2") && aways.includes("B1 / B2"));
}

console.log("slots ok");
