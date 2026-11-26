import assert from "node:assert/strict";
import {
  applyVenuePlan,
  assignCourtSlots,
  attachPairDaysFromPairs,
  courtKey,
  driveCourtOptions,
  findCourtConflicts,
  isCourtTaken,
  matchStartsInWindow,
  matchViolatesAvailability,
  coverSlotTier,
  nearCoverCourtOptions,
  optionMark,
  packNonOverlappingTurns,
  pairsSharePlayableWindow,
  parkAvailabilityViolations,
  parkBareMatchesAsPending,
  parseCourtSlot,
  parseCourtSlotRows,
  parseCourtWindow,
  rematchForCourts,
  releaseOverlappingCourts,
  filterSharedSlotsToDrive,
  pairsHaveDriveCourt,
  pairPendingsWithExactCourts,
  slotAvailabilityMiss,
  slotFitsPairAvailability,
  summarizeCourtSlots,
  freeWindowCapacity,
  freeCourtDriveRows,
  weekFromName,
  windowCapacity,
  courtDayIsOpen,
  widenUnusedCourtWindows,
  expandCourtCandidates,
} from "./slots.js";
import { buildFixture, isPendingMatch, isRealPairMatch, PENDING_AWAY, parseWindow } from "./fixturer.js";
import { DAYS } from "./disponibilidad.js";

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
assert.deepEqual(
  starts.map((s) => s.time),
  [
    "16:30 - 18:00",
    "17:00 - 18:30",
    "17:30 - 19:00",
    "18:00 - 19:30",
    "18:30 - 20:00",
    "19:00 - 20:30",
    "19:30 - 21:00",
  ]
);

const twoHours = matchStartsInWindow(17 * 60, 19 * 60);
assert.deepEqual(
  twoHours.map((s) => s.time),
  ["17:00 - 18:30", "17:30 - 19:00"]
);
const explicit = [
  parseCourtSlot({ Complejo: "Americas", Cancha: "1", Dia: "Viernes", Horario: "17:00 - 18:30" }),
  parseCourtSlot({ Complejo: "Americas", Cancha: "1", Dia: "Viernes", Horario: "17:30 - 19:00" }),
];
assert.deepEqual(
  explicit.map((s) => s.time),
  ["17:00 - 18:30", "17:30 - 19:00"]
);
assert.equal(optionMark(0, 1), "");
assert.equal(optionMark(0, 2), " (opción 1)");
assert.equal(optionMark(1, 3), " (opción 2)");

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
assert.equal(summary.find((s) => s.venue === "Terrazas Padel")?.total, 2);
assert.equal(summary.find((s) => s.venue === "Terrazas Padel")?.sheetTotal, 2);

// Si ya hay partidos en esas canchas, bajan los libres (sin repetir turno).
const takenLunes = [
  { day: "Lunes", time: "19:00 - 20:30", venue: "Terrazas Padel", court: "1" },
];
assert.equal(freeWindowCapacity(slots[0], takenLunes), 0);
assert.equal(freeWindowCapacity(slots[1], takenLunes), 1);
const summaryFree = summarizeCourtSlots(slots, takenLunes);
assert.equal(summaryFree.find((s) => s.venue === "Terrazas Padel")?.total, 1);
assert.equal(summaryFree.find((s) => s.venue === "Terrazas Padel")?.sheetTotal, 2);
assert.equal(summaryFree.find((s) => s.venue === "Terrazas Padel")?.days.find((d) => d.day === "Lunes")?.count, 1);

// Ventana larga: un partido de 90' resta un cupo empaquetado.
const longWin = parseCourtSlot({
  Complejo: "Americas",
  Cancha: "1",
  Dia: "Jueves",
  Horario: "16:30 - 21:00",
});
assert.equal(longWin.capacity, 3);
assert.equal(
  freeWindowCapacity(longWin, [{ day: "Jueves", time: "16:30 - 18:00", venue: "Americas Padel", court: "1" }]),
  2
);
assert.equal(
  freeWindowCapacity(longWin, [{ day: "Jueves", time: "17:00 - 18:30", venue: "Americas Padel", court: "1" }]),
  1,
  "un turno corrido tapa dos bloques empaquetados"
);

const planned = applyVenuePlan(slots, [
  { venue: "Terrazas Padel", count: 1, days: ["Lunes"] },
  { venue: "Open Padel", count: 1, days: ["Martes"] },
]);
assert.equal(planned.length, 2);

// Complejos avanzados off: plan vacío = todos los horarios del Drive.
const allSlots = applyVenuePlan(slots, [], { mode: "pool" });
assert.ok(allSlots.length >= planned.length, "sin cupos se usan todos los candidatos");
assert.equal(allSlots.length, expandCourtCandidates(slots).length);

// Cruce solo si hay cancha del Drive en el overlap (si no, después caía a pendiente).
{
  const sheet = parseCourtSlotRows([
    { Complejo: "Open", Cancha: "1", Dia: "Lunes", Horario: "22:30 - 24:00" },
    { Complejo: "Open", Cancha: "2", Dia: "Lunes", Horario: "22:30 - 24:00" },
  ]);
  const pool = applyVenuePlan(sheet, [], { mode: "pool" });
  const lateA = { days: { Lunes: "20:30 - 00:00", Martes: "20:30 - 00:00" } };
  const lateB = { days: { Lunes: "18:30 - 00:00", Martes: "18:30 - 00:00" } };
  const earlyA = { days: { Lunes: "16:00 - 18:00" } };
  const earlyB = { days: { Lunes: "16:00 - 18:00" } };
  assert.equal(pairsHaveDriveCourt(lateA, lateB, pool), true, "nocturnos tienen Terrazas/Open 22:30");
  assert.equal(pairsHaveDriveCourt(earlyA, earlyB, pool), false, "tarde sin cancha en el Drive");

  const MATCH = 90;
  function shared(a, b) {
    const out = [];
    for (const day of DAYS) {
      if (!(day in a.days) || !(day in b.days)) continue;
      const [fa, ta] = parseWindow(a.days[day]);
      const [fb, tb] = parseWindow(b.days[day]);
      const end = Math.min(ta, tb);
      for (let start = Math.ceil(Math.max(fa, fb) / 30) * 30; start + MATCH <= end; start += 30) out.push({ day, start });
    }
    return out;
  }
  const lateSlots = filterSharedSlotsToDrive(shared(lateA, lateB), lateA, lateB, pool);
  assert.ok(lateSlots.some((s) => s.day === "Lunes" && s.start === 22 * 60 + 30), "prioriza el turno exacto del Drive");
  assert.deepEqual(filterSharedSlotsToDrive(shared(earlyA, earlyB), earlyA, earlyB, pool), []);

  const entries = [
    { p1: "Milton", p2: "Lucero", cat: "B Masculina", days: lateA.days },
    { p1: "Marcos", p2: "Albornoz", cat: "B Masculina", days: lateB.days },
    { p1: "Early", p2: "One", cat: "B Masculina", days: earlyA.days },
    { p1: "Early", p2: "Two", cat: "B Masculina", days: earlyB.days },
  ];
  const out = buildFixture({
    entries,
    ranking: [],
    history: [],
    week: "Fecha 2",
    temp: "T5",
    seed: 1,
    filterSharedSlots: (slots, a, b) => filterSharedSlotsToDrive(slots, a, b, pool),
  });
  const real = out.matches.filter((m) => isRealPairMatch(m) && !isPendingMatch(m));
  const pending = out.matches.filter(isPendingMatch);
  assert.equal(real.length, 1, "solo el cruce nocturno con cancha");
  assert.ok(
    real.some((m) => /Milton/i.test(m.home) && /Marcos|Albornoz/i.test(m.away)) ||
      real.some((m) => /Marcos|Albornoz/i.test(m.home) && /Milton/i.test(m.away)),
    "Milton vs Marcos se arma porque hay exactos en el Drive"
  );
  assert.equal(pending.length, 2, "los early sin cancha quedan pendientes");
  assert.ok(
    pending.every((p) => /exacto|Drive/i.test(p.reason || "")),
    "motivo: sin exacto en Drive"
  );

  // Dos pendientes con exacto libre se rearman solos (no quedan para cercanos).
  const pendings = [
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "Milton Reatto / Joaquín Lucero",
      away: PENDING_AWAY,
      pending: true,
      days: lateA.days,
      homeDays: lateA.days,
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "Marcos Saavedra / Luis Alberto Albornoz",
      away: PENDING_AWAY,
      pending: true,
      days: lateB.days,
      homeDays: lateB.days,
    },
  ];
  const rejoined = pairPendingsWithExactCourts(pendings, pool, { onlyEmpty: true, preferPlan: true });
  assert.equal(rejoined.paired, 1, "exactos se matchean entre pendientes");
  assert.equal(rejoined.matches.filter(isPendingMatch).length, 0);
  assert.ok(rejoined.matches.some((m) => isRealPairMatch(m) && m.venue), "quedan con cancha exacta");

  // Si el primer par de pendientes no entra (cancha ocupada), sigue con el siguiente.
  const occupiedPool = applyVenuePlan(
    parseCourtSlotRows([
      { Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "22:30 - 24:00" },
      { Complejo: "Open", Cancha: "1", Dia: "Martes", Horario: "19:00 - 20:30" },
    ]),
    [],
    { mode: "pool" }
  );
  const crowded = [
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "Late One / Late Two",
      away: PENDING_AWAY,
      pending: true,
      days: { Lunes: "22:00 - 24:00" },
      homeDays: { Lunes: "22:00 - 24:00" },
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "Late Three / Late Four",
      away: PENDING_AWAY,
      pending: true,
      days: { Lunes: "22:00 - 24:00" },
      homeDays: { Lunes: "22:00 - 24:00" },
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "Open One / Open Two",
      away: PENDING_AWAY,
      pending: true,
      days: { Martes: "18:30 - 21:00" },
      homeDays: { Martes: "18:30 - 21:00" },
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "Open Three / Open Four",
      away: PENDING_AWAY,
      pending: true,
      days: { Martes: "18:30 - 21:00" },
      homeDays: { Martes: "18:30 - 21:00" },
    },
    // La única cancha de Lunes 22:30 ya está tomada.
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "A Masculina",
      home: "Taken / Pair",
      away: "Other / Pair",
      day: "Lunes",
      time: "22:30 - 24:00",
      venue: "Terrazas Padel",
      court: "1",
    },
  ];
  const skipped = pairPendingsWithExactCourts(crowded, occupiedPool, { onlyEmpty: true, preferPlan: true });
  assert.equal(skipped.paired, 1, "salta el par sin cancha libre y arma el que sí entra");
  assert.ok(
    skipped.matches.some(
      (m) => isRealPairMatch(m) && /Open One/i.test(m.home + m.away) && String(m.venue || "").trim()
    ),
    "Open One vs Open Three quedan con cancha"
  );
  assert.equal(
    skipped.matches.filter((m) => isPendingMatch(m) && /Late/i.test(m.home)).length,
    2,
    "los late sin cancha libre siguen pendientes"
  );
}

// Sin cupos: no se pisan canchas y se respetan horarios de parejas.
{
  const sheet = parseCourtSlotRows([
    { Complejo: "Open", Cancha: "Cancha 1", Dia: "Lunes", Horario: "16:00 - 22:00" },
    { Complejo: "Open", Cancha: "Cancha 2", Dia: "Lunes", Horario: "16:00 - 22:00" },
    { Complejo: "Open", Cancha: "Cancha 1", Dia: "Martes", Horario: "18:00 - 22:00" },
    { Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 22:00" },
  ]);
  const pool = applyVenuePlan(sheet, [], { mode: "pool" });
  const crowd = [
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "A1 / A2",
      away: "B1 / B2",
      homeDays: { Lunes: "16:30 - 20:00" },
      awayDays: { Lunes: "16:00 - 21:00" },
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Masculina",
      home: "C1 / C2",
      away: "D1 / D2",
      homeDays: { Lunes: "16:30 - 20:00" },
      awayDays: { Lunes: "16:00 - 21:00" },
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "A Masculina",
      home: "E1 / E2",
      away: "F1 / F2",
      homeDays: { Lunes: "19:00 - 23:00" },
      awayDays: { Lunes: "19:00 - 23:00" },
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "C Masculina",
      home: "G1 / G2",
      away: "H1 / H2",
      homeDays: { Martes: "18:00 - 22:00" },
      awayDays: { Martes: "18:00 - 22:00" },
    },
    {
      week: "Fecha 2",
      temp: "T5",
      cat: "B Femenino",
      home: "I1 / I2",
      away: "J1 / J2",
      homeDays: { Lunes: "15:00 - 16:00" },
      awayDays: { Lunes: "15:00 - 16:00" },
    },
  ];
  const out = rematchForCourts(crowd, pool, { onlyEmpty: true, preferPlan: true });
  assert.equal(findCourtConflicts(out.matches).length, 0, "sin cupos: 0 canchas pisadas");
  for (const m of out.matches) {
    if (!isRealPairMatch(m) || isPendingMatch(m) || !m.venue) continue;
    assert.equal(matchViolatesAvailability(m), false, `horario inválido: ${m.home} ${m.day} ${m.time}`);
  }
  const lateOnly = out.matches.find((m) => m.home === "E1 / E2");
  assert.ok(lateOnly?.venue, "pareja de 19hs consigue cancha");
  assert.ok(
    !lateOnly.time.startsWith("16:") && !lateOnly.time.startsWith("17:"),
    "no le dan un turno antes de su disponibilidad"
  );
  const noFit = out.matches.find((m) => m.home === "I1 / I2");
  assert.ok(!noFit?.venue || isPendingMatch(noFit), "sin ventana en el Drive queda sin cancha");

  // Red de seguridad: si forzamos un doble book, releaseOverlappingCourts libera el exceso.
  const forced = [
    { week: "Fecha 2", temp: "T5", day: "Lunes", time: "19:00 - 20:30", venue: "Open Padel", court: "Cancha 1", home: "X / Y", away: "Z / W" },
    { week: "Fecha 2", temp: "T5", day: "Lunes", time: "19:00 - 20:30", venue: "Open Padel", court: "1", home: "P / Q", away: "R / S" },
  ];
  assert.equal(findCourtConflicts(forced).length, 1, "Cancha 1 y 1 son la misma");
  const freed = releaseOverlappingCourts(forced);
  assert.equal(freed.released, 1);
  assert.equal(findCourtConflicts(freed.matches).length, 0);
  assert.ok(!freed.matches[1].venue, "el segundo pierde la cancha");
}

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

// Cubrir pendiente: ancla en la pendiente; quien cubre puede aflojar horario.
{
  const sheet = parseCourtSlotRows([
    { Complejo: "Open", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 20:30" },
    { Complejo: "Open", Cancha: "2", Dia: "Lunes", Horario: "19:00 - 20:30" },
    { Complejo: "Americas", Cancha: "1", Dia: "Miércoles", Horario: "18:00 - 19:30" },
    { Complejo: "Terrazas", Cancha: "1", Dia: "Viernes", Horario: "19:00 - 20:30" },
    { Complejo: "Terrazas", Cancha: "2", Dia: "Viernes", Horario: "19:00 - 20:30" },
    { Complejo: "Open", Cancha: "1", Dia: "Sábado", Horario: "10:00 - 11:30" },
  ]);
  const pendingCover = {
    day: "",
    time: "",
    venue: "",
    court: "",
    pending: false,
    home: "Andrea / Carla",
    away: "Marien / Sofi",
    homeDays: {
      Lunes: "18:00 - 22:00",
      Miércoles: "18:00 - 22:00",
      Viernes: "18:00 - 22:00",
    },
    awayDays: {
      Lunes: "19:00 - 21:00",
      Viernes: "18:00 - 22:00",
      Sábado: "10:00 - 14:00",
    },
  };
  const taken = [{ day: "Viernes", time: "19:00 - 20:30", venue: "Terrazas Padel", court: "Cancha 1" }];
  const coverOpts = driveCourtOptions(pendingCover, sheet, taken, { softAway: true });
  const keys = coverOpts.map((o) => `${o.day}|${o.time}|${o.venue}|${o.court}|${o.fitsAway ? "ambas" : "flex"}`);
  assert.deepEqual(
    keys,
    [
      "Lunes|19:00 - 20:30|Open Padel|1|ambas",
      "Lunes|19:00 - 20:30|Open Padel|2|ambas",
      "Viernes|19:00 - 20:30|Terrazas Padel|2|ambas",
      "Miércoles|18:00 - 19:30|Americas Padel|1|flex",
    ],
    "al cubrir: prioriza turnos de ambas; incluye miércoles (solo pendiente) como flexible; excluye sábado (solo cover) y cancha tomada (1 ≡ Cancha 1)"
  );
  const strict = driveCourtOptions(pendingCover, sheet, taken);
  assert.ok(!strict.some((o) => o.day === "Miércoles"), "sin softAway no ofrece el día solo de la pendiente");
}

{
  assert.equal(courtKey("Cancha 1"), "1");
  assert.equal(courtKey("1"), "1");
  const taken = [{ day: "Viernes", time: "18:00 - 19:30", venue: "Open Padel", court: "1" }];
  assert.equal(
    isCourtTaken({ day: "Viernes", time: "18:00 - 19:30", venue: "Open Padel", court: "1" }, taken),
    true,
    "misma cancha y horario = en uso"
  );
  assert.equal(
    isCourtTaken({ day: "Viernes", time: "18:00 - 19:30", venue: "Open Padel", court: "Cancha 1" }, taken),
    true,
    "Cancha 1 y 1 son la misma"
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

// No doble-book: varias parejas no pueden llevarse la misma Open Cancha 1 al mismo horario.
{
  const sheet = parseCourtSlotRows([
    { Complejo: "Open", Cancha: "Cancha 1", Dia: "Lunes", Horario: "20:00 - 21:30" },
    { Complejo: "Open", Cancha: "1", Dia: "Lunes", Horario: "20:00 - 21:30" },
    { Complejo: "Open", Cancha: "Cancha 2", Dia: "Lunes", Horario: "20:00 - 21:30" },
  ]);
  const pool = applyVenuePlan(sheet, [{ venue: "Open Padel", count: 10, days: ["Lunes"] }], { mode: "pool" });
  const out = assignCourtSlots(
    [
      { day: "Lunes", time: "20:00 - 21:30", home: "A / B", away: "C / D", cat: "B Femenino", venue: "", court: "" },
      { day: "Lunes", time: "20:00 - 21:30", home: "E / F", away: "G / H", cat: "B Masculina", venue: "", court: "" },
      { day: "Lunes", time: "20:00 - 21:30", home: "I / J", away: "K / L", cat: "C Femenino", venue: "", court: "" },
    ],
    pool,
    { preferPlan: true }
  );
  const open20 = out.matches.filter((m) => m.venue === "Open Padel" && m.time === "20:00 - 21:30");
  const keys = open20.map((m) => courtKey(m.court));
  assert.equal(new Set(keys).size, keys.length, "no repite la misma cancha a las 20:00");
  assert.ok(out.assigned >= 2, "al menos dos partidos entran (cancha 1 y 2)");
}

// onlyEmpty debe respetar canchas ya ocupadas (no pisar Open Cancha 1 a las 20:00).
{
  const sheet = parseCourtSlotRows([
    { Complejo: "Open", Cancha: "Cancha 1", Dia: "Lunes", Horario: "20:00 - 21:30" },
    { Complejo: "Open", Cancha: "Cancha 2", Dia: "Lunes", Horario: "20:00 - 21:30" },
    { Complejo: "Open", Cancha: "Cancha 1", Dia: "Lunes", Horario: "21:30 - 23:00" },
  ]);
  const pool = applyVenuePlan(sheet, [{ venue: "Open Padel", count: 10, days: ["Lunes"] }], { mode: "pool" });
  const out = assignCourtSlots(
    [
      {
        day: "Lunes",
        time: "20:00 - 21:30",
        home: "A / B",
        away: "C / D",
        cat: "B Femenino",
        venue: "Open Padel",
        court: "Cancha 1",
      },
      { day: "Lunes", time: "20:00 - 21:30", home: "E / F", away: "G / H", cat: "B Masculina", venue: "", court: "" },
      { day: "Lunes", time: "20:00 - 21:30", home: "I / J", away: "K / L", cat: "C Femenino", venue: "", court: "" },
    ],
    pool,
    { onlyEmpty: true, preferPlan: true }
  );
  const open20 = out.matches.filter((m) => m.venue === "Open Padel" && m.time === "20:00 - 21:30");
  const keys = open20.map((m) => courtKey(m.court));
  assert.equal(new Set(keys).size, keys.length, "onlyEmpty no repite Cancha 1 ya ocupada");
  assert.equal(
    out.matches[0].court,
    "Cancha 1",
    "el partido que ya tenía cancha se mantiene"
  );
  assert.ok(
    out.matches.filter((m) => courtKey(m.court) === "1" && m.time === "20:00 - 21:30").length === 1,
    "una sola pareja en Cancha 1 a las 20:00"
  );
}

// Si el fixture ya viene con doble book, onlyEmpty libera el exceso y reasigna.
{
  const sheet = parseCourtSlotRows([
    { Complejo: "La Manzana", Cancha: "Cancha 1", Dia: "Jueves", Horario: "18:00" },
    { Complejo: "La Manzana", Cancha: "Cancha 2", Dia: "Jueves", Horario: "16:30" },
    { Complejo: "La Manzana", Cancha: "Cancha 2", Dia: "Jueves", Horario: "21:00" },
  ]);
  const pool = applyVenuePlan(sheet, [{ venue: "La manzana Padel", count: 10, days: ["Jueves"] }], { mode: "pool" });
  const out = assignCourtSlots(
    [
      {
        day: "Jueves",
        time: "18:00 - 19:30",
        home: "A / B",
        away: "C / D",
        cat: "B Masculina",
        venue: "La manzana Padel",
        court: "Cancha 1",
        homeDays: { Jueves: "18:00 - 21:00" },
        awayDays: { Jueves: "17:00 - 21:00" },
      },
      {
        day: "Jueves",
        time: "18:00 - 19:30",
        home: "E / F",
        away: "G / H",
        cat: "C Femenino",
        venue: "La manzana Padel",
        court: "Cancha 1",
        homeDays: { Jueves: "18:00 - 20:00" },
        awayDays: { Jueves: "08:00 - 20:00" },
      },
      {
        day: "Jueves",
        time: "18:00 - 19:30",
        home: "I / J",
        away: "K / L",
        cat: "C Femenino",
        venue: "La manzana Padel",
        court: "Cancha 1",
        homeDays: { Jueves: "18:00 - 00:00" },
        awayDays: { Jueves: "17:30 - 22:00" },
      },
    ],
    pool,
    { onlyEmpty: true, preferPlan: true }
  );
  assert.equal(findCourtConflicts(out.matches).length, 0, "sin conflictos después de reparar");
  assert.equal(
    out.matches.filter((m) => courtKey(m.court) === "1" && m.time === "18:00 - 19:30").length,
    1,
    "solo uno se queda en Manzana Cancha 1 18:00"
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

// Sin cancha después de intentar → pendientes (no quedan con rival sin sede).
{
  const stuck = [
    {
      cat: "C Femenino",
      week: "Fecha 1",
      temp: "T5",
      day: "Viernes",
      time: "19:00 - 20:30",
      home: "Marien / Valeria",
      away: "Andrea / Gisela",
      venue: "",
      court: "",
      homeDays: { Viernes: "19:00 - 21:00" },
      awayDays: { Viernes: "18:00 - 21:00" },
    },
    {
      cat: "C Femenino",
      week: "Fecha 1",
      temp: "T5",
      day: "Lunes",
      time: "19:00 - 20:30",
      home: "Otra / Pareja",
      away: "Relleno / Dos",
      venue: "Open Padel",
      court: "1",
      homeDays: { Lunes: "18:00 - 22:00" },
      awayDays: { Lunes: "18:00 - 22:00" },
    },
  ];
  const parked = parkBareMatchesAsPending(stuck);
  assert.equal(parked.parked, 1);
  assert.equal(parked.matches.length, 3);
  assert.ok(parked.matches.some((m) => m.venue === "Open Padel"), "el que tenía cancha sigue");
  const pend = parked.matches.filter(isPendingMatch);
  assert.equal(pend.length, 2);
  assert.ok(pend.every((m) => m.away === PENDING_AWAY));
  assert.ok(pend.some((m) => m.home === "Marien / Valeria"));
  assert.ok(pend.some((m) => m.home === "Andrea / Gisela"));
  assert.ok(!parked.matches.some(isRealPairMatch) || parked.matches.filter(isRealPairMatch).every((m) => m.venue));
}

// Dos pendientes: Marien Vie 19-21 y Manuela Vie 8-19 no comparten 1:30.
{
  assert.equal(
    pairsSharePlayableWindow(
      { Lunes: "19:00 - 21:00", Viernes: "19:00 - 21:00" },
      { Martes: "08:00 - 21:00", Viernes: "08:00 - 19:00", Sábado: "08:00 - 14:00" }
    ),
    false,
    "Marien/Manuela sin tramo común de 90'"
  );
  assert.equal(
    pairsSharePlayableWindow({ Viernes: "18:00 - 21:00" }, { Viernes: "19:00 - 22:00" }),
    true,
    "18-21 ∩ 19-22 = 19-21 → 90' ok"
  );
}

// Nunca fixturear fuera de la inscripción (caso Benedetich Lunes 16:30).
{
  const stefDays = { Lunes: "19:00 - 22:00", Viernes: "19:00 - 22:00" };
  const lauraDays = {
    Lunes: "16:30 - 20:30",
    Martes: "16:30 - 20:30",
    Viernes: "16:30 - 21:00",
    Sábado: "19:00 - 20:30",
  };
  const bad = {
    week: "Fecha 1",
    temp: "T5",
    cat: "C Femenino",
    day: "Lunes",
    time: "16:30 - 18:00",
    venue: "Palermo Padel",
    court: "Cancha 2",
    home: "Laura Martínez / Dalila Sosa",
    away: "Stefania Benedetich / Florencia Benedetich",
    homeDays: lauraDays,
    awayDays: stefDays,
  };
  assert.equal(matchViolatesAvailability(bad), true, "16:30 no entra en 19:00-22:00 de Benedetich");
  const slot = { day: "Lunes", time: "16:30 - 18:00", from: 16 * 60 + 30, to: 18 * 60 };
  assert.equal(slotFitsPairAvailability(slot, bad), false);
  const okSlot = { day: "Lunes", time: "19:00 - 20:30", from: 19 * 60, to: 20 * 60 + 30 };
  assert.equal(slotFitsPairAvailability(okSlot, bad), true, "19:00-20:30 sí entra en ambas");

  const pairs = [
    { temp: "T5", cat: "C Femenino", p1: "Laura Martínez", p2: "Dalila Sosa", days: lauraDays },
    { temp: "T5", cat: "C Femenino", p1: "Stefania Benedetich", p2: "Florencia Benedetich", days: stefDays },
  ];
  const attached = attachPairDaysFromPairs([{ ...bad, homeDays: undefined, awayDays: undefined }], pairs)[0];
  assert.ok(attached.homeDays && attached.awayDays);
  const parked = parkAvailabilityViolations([attached]);
  assert.equal(parked.parked, 1);
  assert.equal(parked.matches.filter(isPendingMatch).length, 2);
  assert.ok(parked.matches.every((m) => !m.venue));
  assert.ok(parked.details?.length >= 1, "explica por qué se aparcó");
  assert.match(parked.details[0], /Stefania|19:00/i);
}

// Espacios / tildes en nombres y horarios NO disparan falso park.
{
  const pairs = [
    {
      temp: "T5",
      cat: "C Femenino",
      p1: "Laura Martínez",
      p2: "Dalila Sosa",
      days: { Lunes: "16:30-20:30", Viernes: "16:30 - 21:00" },
    },
    {
      temp: "T5",
      cat: "C Femenino",
      p1: "Stefania Benedetich",
      p2: "Florencia Benedetich",
      days: { Lunes: "19:00 - 22:00", Viernes: "19:00-22:00" },
    },
  ];
  const spaced = attachPairDaysFromPairs(
    [
      {
        home: "  Laura  Martínez/Dalila Sosa ",
        away: "stefania benedetich / florencia benedetich",
        day: "Lunes",
        time: "19:00-20:30",
        cat: "C Femenino",
        temp: "T5",
        venue: "Open",
        court: "1",
      },
    ],
    pairs
  )[0];
  assert.ok(spaced.homeDays && spaced.awayDays, "adjunta days pese a espacios raros");
  assert.equal(matchViolatesAvailability(spaced), false, "19:00-20:30 entra en ambas");

  // Claves de días sin tilde también tienen que matchear.
  const accent = {
    home: "A",
    away: "B",
    day: "Miércoles",
    time: "18:00 - 19:30",
    homeDays: { Miercoles: "18:00 - 23:00" },
    awayDays: { Miércoles: "17:00 - 22:00" },
    venue: "X",
    court: "1",
  };
  assert.equal(matchViolatesAvailability(accent), false, "Miercoles≈Miércoles");
}

// Cubrir sin softAway: no ofrecer turno que solo entra a la pendiente.
{
  const sheet = [
    parseCourtSlot({ Complejo: "Palermo", Cancha: "2", Dia: "Lunes", Horario: "16:30 - 18:00" }),
    parseCourtSlot({ Complejo: "Palermo", Cancha: "2", Dia: "Lunes", Horario: "19:00 - 20:30" }),
  ];
  const opts = driveCourtOptions(
    {
      home: "Laura",
      away: "Stefania",
      pending: false,
      homeDays: { Lunes: "16:30 - 20:30" },
      awayDays: { Lunes: "19:00 - 22:00" },
    },
    sheet,
    [],
    { softAway: false }
  );
  assert.ok(!opts.some((o) => o.time === "16:30 - 18:00"), "16:30 queda fuera");
  assert.ok(opts.some((o) => o.time === "19:00 - 20:30"), "19:00 entra");
}

// Sin 1:30 en común → sugerencias libres más cercanas (Cavallaro vs Laikan).
{
  const flo = {
    Martes: "19:00 - 21:30",
    Miércoles: "18:30 - 21:30",
    Jueves: "19:00 - 21:30",
    Viernes: "18:00 - 20:00",
    Sábado: "16:00 - 18:00",
  };
  const vale = {
    Lunes: "15:00 - 18:00",
    Martes: "09:00 - 18:00",
    Jueves: "09:00 - 17:00",
    Viernes: "15:00 - 19:00",
    Sábado: "09:00 - 12:00",
  };
  assert.equal(pairsSharePlayableWindow(flo, vale), false, "solo 60' el viernes → sin 1:30");
  const sheet = [
    parseCourtSlot({ Complejo: "Open", Cancha: "1", Dia: "Viernes", Horario: "17:30 - 19:00" }),
    parseCourtSlot({ Complejo: "Open", Cancha: "1", Dia: "Viernes", Horario: "18:00 - 19:30" }),
    parseCourtSlot({ Complejo: "Open", Cancha: "2", Dia: "Lunes", Horario: "16:00 - 17:30" }),
    parseCourtSlot({ Complejo: "Open", Cancha: "1", Dia: "Martes", Horario: "19:00 - 20:30" }),
  ];
  const near = nearCoverCourtOptions({ homeDays: flo, awayDays: vale }, sheet, [], { limit: 6 });
  assert.ok(near.length, "hay sugerencias cercanas");
  assert.ok(near.every((o) => o.near && o.miss > 0));
  // Viernes 18-19:30: Flo +0, Vale +30 → miss 30; mejor que Lunes (Flo sin día).
  assert.equal(near[0].day, "Viernes", "prioriza el viernes (menor distancia)");
  assert.ok(near[0].miss <= near[near.length - 1].miss);
  const vie1830 = near.find((o) => o.time === "18:00 - 19:30");
  assert.ok(vie1830);
  assert.equal(slotAvailabilityMiss(flo, { day: "Viernes", from: 18 * 60, to: 19 * 60 + 30 }), 0, "Flo entra exacta 18-19:30");
  assert.equal(slotAvailabilityMiss(vale, { day: "Viernes", from: 18 * 60, to: 19 * 60 + 30 }), 30, "Vale corta a las 19");
  assert.equal(vie1830.miss, 30);
}

// Libres exactos + cercanos con desfase (caso Marien/Milagros: 19:30 libre y 21:00 cercano).
{
  const marien = {
    Lunes: "18:00 - 22:00",
    Martes: "18:00 - 22:00",
  };
  const milagros = {
    Lunes: "19:00 - 22:00",
    Martes: "19:00 - 21:00",
  };
  const sheet = [
    parseCourtSlot({ Complejo: "La manzana Padel", Cancha: "2", Dia: "Lunes", Horario: "19:30 - 21:00" }),
    parseCourtSlot({ Complejo: "La manzana Padel", Cancha: "1", Dia: "Lunes", Horario: "21:00 - 22:30" }),
    parseCourtSlot({ Complejo: "Open", Cancha: "3", Dia: "Martes", Horario: "20:00 - 21:30" }),
  ];
  const exact = driveCourtOptions(
    { homeDays: marien, awayDays: milagros, pending: false },
    sheet,
    [],
    { softAway: false }
  );
  assert.ok(exact.some((o) => o.time === "19:30 - 21:00"), "19:30 entra exacto");
  assert.ok(!exact.some((o) => o.time === "21:00 - 22:30"), "21:00 no entra exacto (sale a 22:30)");
  const near = nearCoverCourtOptions({ homeDays: marien, awayDays: milagros }, sheet, [], { limit: 8 });
  assert.ok(near.some((o) => o.time === "21:00 - 22:30"), "21:00 aparece como cercano");
  assert.ok(near.every((o) => o.near && o.miss > 0 && o.bothHaveDay));
  const exactKeys = new Set(exact.map((o) => o.key));
  const nearOnly = near.filter((o) => !exactKeys.has(o.key));
  assert.ok(nearOnly.length, "con exactos igual hay cercanos distintos");
}

// Sin día en común (caso jueves): igual listar todas las canchas libres como estimables.
{
  const brenda = {
    Lunes: "21:00 - 23:00",
    Martes: "21:00 - 23:00",
    Jueves: "21:00 - 23:30",
    Sábado: "13:00 - 18:00",
  };
  const martinez = {
    Lunes: "09:00 - 12:00",
    Martes: "09:00 - 12:00",
    Sábado: "09:00 - 12:00",
  };
  assert.equal(pairsSharePlayableWindow(brenda, martinez), false, "no comparten 1:30");
  const sheet = [
    parseCourtSlot({ Complejo: "Open", Cancha: "1", Dia: "Jueves", Horario: "21:00 - 22:30" }),
    parseCourtSlot({ Complejo: "Open", Cancha: "2", Dia: "Lunes", Horario: "21:00 - 22:30" }),
    parseCourtSlot({ Complejo: "Palermo", Cancha: "1", Dia: "Sábado", Horario: "13:00 - 14:30" }),
  ];
  const strict = nearCoverCourtOptions({ homeDays: brenda, awayDays: martinez }, sheet, [], { limit: 8 });
  assert.equal(strict.length, 0, "sin desfase chico no hay cercanos");
  const all = nearCoverCourtOptions({ homeDays: brenda, awayDays: martinez }, sheet, [], { includeFar: true });
  assert.equal(all.length, 3, "las tres canchas libres figuran");
  assert.ok(all.every((o) => o.estimate && !o.close));
  const jueves = all.find((o) => o.day === "Jueves");
  assert.ok(jueves, "el jueves entra aunque quien cubre no pueda ese día");
  assert.equal(jueves.nearLabel.includes("sin día"), true);
  const taken = [{ day: "Lunes", time: "21:00 - 22:30", venue: "Open Padel", court: "2" }];
  const free = nearCoverCourtOptions({ homeDays: brenda, awayDays: martinez }, sheet, taken, { includeFar: true });
  assert.ok(!free.some((o) => o.day === "Lunes"), "la cancha ocupada no se ofrece");
  assert.equal(free.length, 2);
}

// Misma cancha libre 16:00-22:00: se listan todos los inicios de 1:30; al asignar varios, no se pisan.
{
  const sheet = [parseCourtSlot({ Complejo: "La manzana", Cancha: "2", Dia: "Lunes", Horario: "16:00 - 22:00" })];
  const home = { Lunes: "16:00 - 22:00" };
  const away = { Lunes: "16:00 - 22:00" };
  const exact = driveCourtOptions({ homeDays: home, awayDays: away, pending: false }, sheet, [], { softAway: false });
  assert.ok(exact.length > 4, "el rango ofrece cada inicio de 1:30 que cierra adentro");
  const packed = packNonOverlappingTurns(exact);
  assert.deepEqual(
    packed.map((o) => o.time).sort(),
    ["16:00 - 17:30", "17:30 - 19:00", "19:00 - 20:30", "20:30 - 22:00"],
    "cuatro turnos de 1:30, sin solape"
  );
  const otherCourt = { day: "Lunes", time: "19:00 - 20:30", venue: "Open Padel", court: "1" };
  const both = packNonOverlappingTurns([...packed, otherCourt]);
  assert.equal(both.length, 5, "otra cancha al mismo horario sigue libre");
  const exactSlot = { day: "Lunes", time: "19:30 - 21:00", venue: "La manzana Padel", court: "2" };
  const nearSlot = { day: "Lunes", time: "19:00 - 20:30", venue: "La manzana Padel", court: "2", near: true, close: true };
  const preferExact = packNonOverlappingTurns([nearSlot, exactSlot]);
  assert.equal(preferExact.length, 1);
  assert.equal(preferExact[0].time, "19:30 - 21:00", "si se pisan, queda el exacto");
}

// Drive: Americas Cancha 1, Jueves 14:00-18:30. Cabe 17:00-18:30.
// Un partido el lunes en esa misma cancha no la ocupa el jueves.
{
  const sheet = [parseCourtSlot({ Complejo: "Americas", Cancha: "Cancha 1", Dia: "Jueves", Horario: "14:00 - 18:30" })];
  assert.equal(sheet[0].capacity, 3);
  const taken = [
    { day: "Lunes", time: "17:00 - 18:30", venue: "Americas Padel", court: "Cancha 1" },
    { day: "Martes", time: "16:30 - 18:00", venue: "Americas Padel", court: "Cancha 1" },
  ];
  const home = { Jueves: "18:00 - 23:00", Lunes: "18:00 - 23:00" };
  const away = { Lunes: "19:00 - 22:00", Viernes: "19:00 - 22:00" };
  const flex = nearCoverCourtOptions({ homeDays: home, awayDays: away }, sheet, taken, { includeFar: true });
  assert.ok(flex.some((o) => o.day === "Jueves" && o.time === "17:00 - 18:30"), "el jueves 17:00 entra como estimable");
  const packed = packNonOverlappingTurns(flex);
  assert.deepEqual(
    packed.map((o) => o.time),
    ["14:00 - 15:30", "15:30 - 17:00", "17:00 - 18:30"],
    "tres turnos de 1:30, el de las 17 queda"
  );
}

// Canchas libres: respetan el horario exacto del Drive (nunca inventan turnos fuera del rango).
// Un rango de 18:00 a 22:00 ofrece cada turno de 1:30 que cierra adentro; si ya hay un partido, solo quedan los que no se pisan.
{
  const sheet = [
    parseCourtSlot({ Complejo: "Americas", Cancha: "Cancha 4", Dia: "Jueves", Horario: "18:00 - 22:00" }),
    parseCourtSlot({ Complejo: "Terrazas", Cancha: "Cancha 1", Dia: "Jueves", Horario: "18:00 - 20:00" }),
  ];
  const wide = widenUnusedCourtWindows(sheet);
  assert.equal(wide[0].from, 18 * 60);
  assert.equal(wide[0].to, 22 * 60);
  assert.equal(wide[1].from, 18 * 60);
  assert.equal(wide[1].to, 20 * 60);

  const freeOpts = nearCoverCourtOptions(
    { homeDays: { Jueves: "18:00 - 00:00" }, awayDays: { Lunes: "18:00 - 21:00" } },
    wide,
    [],
    { includeFar: true }
  );
  const americasFree = freeOpts.filter((o) => o.venue === "Americas Padel").map((o) => o.time);
  assert.deepEqual(
    americasFree,
    ["18:00 - 19:30", "18:30 - 20:00", "19:00 - 20:30", "19:30 - 21:00", "20:00 - 21:30", "20:30 - 22:00"],
    "18:00 a 22:00 lista cada turno de 1:30 que cierra adentro, y ninguno de las 21:00-22:30"
  );
  assert.ok(freeOpts.every((o) => !o.outsideSheet), "nunca ofrece un horario que no exista en el Drive");

  const terrazasFree = freeOpts.filter((o) => o.venue === "Terrazas Padel").map((o) => o.time);
  assert.deepEqual(
    terrazasFree,
    ["18:00 - 19:30", "18:30 - 20:00"],
    "18:00 a 20:00 ofrece los dos turnos de 1:30 que cierran a las 20:00, y nada después"
  );

  const partial = [{ day: "Jueves", time: "18:00 - 19:30", venue: "Americas Padel", court: "Cancha 4" }];
  const remaining = nearCoverCourtOptions(
    { homeDays: { Jueves: "18:00 - 00:00" }, awayDays: { Lunes: "18:00 - 21:00" } },
    wide,
    partial,
    { includeFar: true }
  )
    .filter((o) => o.venue === "Americas Padel")
    .map((o) => o.time);
  assert.deepEqual(
    remaining,
    ["19:30 - 21:00", "20:00 - 21:30", "20:30 - 22:00"],
    "si ya hay un partido a las 18:00, solo ofrece los horarios que no se pisan y siguen dentro de 18:00-22:00"
  );

  const fixedOnly = [parseCourtSlot({ Complejo: "Americas", Cancha: "Cancha 2", Dia: "Jueves", Horario: "19:00" })];
  assert.deepEqual(
    expandCourtCandidates(fixedOnly).map((s) => s.time),
    ["19:00 - 20:30"],
    "un turno fijo 19:00 ofrece solo 19:00-20:30"
  );
}

// Marien sin martes, Milagros entra de noche: eso es cercano, no una cancha libre.
// El turno de la tarde, con +5 h, queda al final.
{
  const sinDia = 24 * 60 + 90;
  const noche = { near: true, close: false, estimate: true, homeMiss: sinDia, awayMiss: 0, openDay: true };
  const mediaHora = { near: true, close: false, estimate: true, homeMiss: sinDia, awayMiss: 30, openDay: true };
  const tarde = { near: true, close: false, estimate: true, homeMiss: sinDia, awayMiss: 5 * 60 + 30, openDay: false };
  const unaHora = { near: true, close: false, estimate: true, homeMiss: sinDia, awayMiss: 60, openDay: false };
  assert.equal(coverSlotTier(noche), "near", "cubre ok sube a cercano aunque la cancha esté libre");
  assert.equal(coverSlotTier(mediaHora), "near", "+30' también es cercano");
  assert.equal(coverSlotTier(unaHora), "estimate", "+1 h sigue estimable");
  assert.equal(coverSlotTier(tarde), "estimate", "+5 h en cancha ocupada no es cancha vacía");
  assert.equal(coverSlotTier({ ...tarde, openDay: true }), "free", "cancha vacía y lejos queda última");
}

// Complejos libres: turnos del Sheet que el fixture aún no usó (1:30 sin solape).
{
  const libreSlots = [
    parseCourtSlot({ Complejo: "Terrazas", Cancha: "1", Dia: "Lunes", Horario: "19:00 - 22:00" }),
    parseCourtSlot({ Complejo: "Open", Cancha: "2", Dia: "Martes", Horario: "18:00 - 19:30" }),
  ];
  const takenOne = [
    { day: "Lunes", time: "19:00 - 20:30", venue: "Terrazas Padel", court: "1" },
  ];
  const freeAll = freeCourtDriveRows(libreSlots, [], "Fecha 2");
  assert.ok(freeAll.length >= 2, "sin partidos: quedan turnos libres");
  assert.equal(freeAll[0].fecha, "Fecha 2");
  assert.ok(freeAll.every((r) => r.dia && r.horario && r.complejo && r.cancha));

  const freePartial = freeCourtDriveRows(libreSlots, takenOne, "Fecha 2");
  assert.ok(
    freePartial.every(
      (r) => !(r.dia === "Lunes" && r.complejo.includes("Terrazas") && r.cancha === "1" && r.horario.startsWith("19:00"))
    ),
    "el turno ya usado no figura en libres"
  );
  assert.ok(
    freePartial.some((r) => r.dia === "Martes" && r.horario.startsWith("18:00")),
    "la otra cancha sigue libre"
  );
  const takenMartes = [{ day: "Martes", time: "18:00 - 19:30", venue: "Open Padel", court: "2" }, ...takenOne];
  assert.equal(
    freeCourtDriveRows(libreSlots, takenMartes, "Fecha 2").filter((r) => r.dia === "Martes").length,
    0,
    "Martes ocupado no aparece"
  );
}

console.log("slots ok");
