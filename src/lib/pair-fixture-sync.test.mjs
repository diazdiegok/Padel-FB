import assert from "node:assert/strict";
import { PENDING_AWAY, isPendingMatch } from "./fixturer.js";
import { rivalOptionsFromPairs, splitMatchToPending, syncFixtureWithPairs } from "./pair-fixture-sync.js";
import { pairsMatch } from "./scoring.js";

const temp = "T5";
const week = "Fecha 1";
const pairs = [
  { temp, cat: "C Femenino", p1: "Marien Robledo", p2: "Valeria Joubert", days: { Lunes: "19:00 - 21:00" } },
  { temp, cat: "C Femenino", p1: "Milagros Solaro", p2: "Ana Paula Croce", days: { Lunes: "19:30 - 22:30" } },
  { temp, cat: "B Femenino", p1: "Abril Diamela Migueles", p2: "Yamila Bertotti", days: { Martes: "20:00 - 22:00" } },
];

{
  const matches = [
    {
      week,
      temp,
      cat: "C Femenino",
      day: "Lunes",
      time: "19:30 - 21:00",
      venue: "Open Padel",
      court: "1",
      home: "Marien Robledo / Valeria Joubert",
      away: "Milagros Solaro / Ana Paula Croce",
    },
  ];
  const withoutMilagros = pairs.filter((p) => p.p1 !== "Milagros Solaro");
  const out = syncFixtureWithPairs({ matches, pairs: withoutMilagros, temp, liveWeek: week });
  assert.equal(out.stats.pendingFromRemoved, 1);
  assert.ok(out.matches.every((m) => !m.venue || isPendingMatch(m)));
  const pend = out.matches.find((m) => isPendingMatch(m) && pairsMatch(m.home, "Marien Robledo / Valeria Joubert"));
  assert.ok(pend, "Marien queda pendiente");
  assert.equal(pend.away, PENDING_AWAY);
  assert.equal(pend.day, "");
  assert.equal(pend.venue, "");
}

{
  const matches = [
    {
      week,
      temp,
      cat: "C Femenino",
      day: "Lunes",
      time: "19:30 - 21:00",
      venue: "Open",
      court: "1",
      home: "Marien Robledo / Valeria Joubert",
      away: "Milagros Solaro / Ana Paula Croce",
    },
  ];
  const moved = pairs.map((p) =>
    p.p1 === "Marien Robledo" ? { ...p, cat: "B Femenino" } : p
  );
  const out = syncFixtureWithPairs({ matches, pairs: moved, temp, liveWeek: week });
  assert.ok(out.stats.pendingFromCatChange >= 2);
  const marien = out.matches.find((m) => isPendingMatch(m) && pairsMatch(m.home, "Marien Robledo / Valeria Joubert"));
  const milagros = out.matches.find((m) => isPendingMatch(m) && pairsMatch(m.home, "Milagros Solaro / Ana Paula Croce"));
  assert.equal(marien.cat, "B Femenino");
  assert.equal(milagros.cat, "C Femenino");
  assert.ok(!out.matches.some((m) => m.venue === "Open"));
}

{
  const matches = [];
  const out = syncFixtureWithPairs({ matches, pairs, temp, liveWeek: week });
  assert.equal(out.stats.addedPending, 3);
  assert.equal(out.matches.filter(isPendingMatch).length, 3);
}

{
  const opts = rivalOptionsFromPairs({
    pairs,
    temp,
    cat: "C Femenino",
    exclude: "Marien Robledo / Valeria Joubert",
  });
  assert.ok(opts.some((o) => o.includes("Milagros")));
  assert.ok(!opts.some((o) => o.includes("Marien")));
  assert.ok(!opts.some((o) => o.includes("Abril")));
}

{
  // Borrar home: el away pasa a pendiente.
  const matches = [
    {
      week,
      temp,
      cat: "C Femenino",
      day: "Lunes",
      time: "19:30 - 21:00",
      venue: "Open",
      court: "1",
      home: "Marien Robledo / Valeria Joubert",
      away: "Milagros Solaro / Ana Paula Croce",
    },
  ];
  const withoutMarien = pairs.filter((p) => p.p1 !== "Marien Robledo");
  const out = syncFixtureWithPairs({ matches, pairs: withoutMarien, temp, liveWeek: week });
  assert.equal(out.stats.pendingFromRemoved, 1);
  const pend = out.matches.find((m) => isPendingMatch(m) && pairsMatch(m.home, "Milagros Solaro / Ana Paula Croce"));
  assert.ok(pend);
  assert.equal(pend.venue, "");
}

{
  // Pareja nueva (Abril) sin partido en la fecha → pendiente.
  const matches = [
    {
      week,
      temp,
      cat: "C Femenino",
      day: "Lunes",
      time: "19:30 - 21:00",
      venue: "Open",
      court: "1",
      home: "Marien Robledo / Valeria Joubert",
      away: "Milagros Solaro / Ana Paula Croce",
    },
  ];
  const out = syncFixtureWithPairs({ matches, pairs, temp, liveWeek: week });
  assert.equal(out.stats.addedPending, 1);
  const abril = out.matches.find((m) => isPendingMatch(m) && pairsMatch(m.home, "Abril Diamela Migueles / Yamila Bertotti"));
  assert.ok(abril);
  assert.equal(abril.cat, "B Femenino");
  assert.ok(String(abril.avail || "").includes("Martes"));
}

{
  const match = {
    week,
    temp,
    cat: "C Femenino",
    day: "Lunes",
    time: "19:30 - 21:00",
    venue: "Open",
    court: "1",
    home: "Marien Robledo / Valeria Joubert",
    away: "Milagros Solaro / Ana Paula Croce",
  };
  const rows = splitMatchToPending(match, pairs);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(isPendingMatch));
  assert.ok(rows.every((r) => !r.venue && !r.day));
  assert.ok(rows.some((r) => pairsMatch(r.home, "Marien Robledo / Valeria Joubert")));
  assert.ok(rows.some((r) => pairsMatch(r.home, "Milagros Solaro / Ana Paula Croce")));
}

{
  const diego = { temp, cat: "B Masculina", p1: "Diego Ramirez", p2: "Martin Rondan", days: { Lunes: "16:00 - 00:00" } };
  const matches = [
    {
      week: "Fecha 2",
      temp,
      cat: "B Masculina",
      home: "Diego Ramirez / Martin Rondan",
      away: PENDING_AWAY,
      pending: true,
      recoverFrom: "Fecha 1",
      reason: "Recupera Fecha 1.",
    },
  ];
  const out = syncFixtureWithPairs({ matches, pairs: [...pairs, diego], temp, liveWeek: "Fecha 2" });
  const rows = out.matches.filter((m) => isPendingMatch(m) && pairsMatch(m.home, "Diego Ramirez / Martin Rondan"));
  assert.equal(rows.length, 2, "el recupero no reemplaza el pendiente normal");
  assert.ok(rows.some((m) => m.recoverFrom === "Fecha 1"));
  assert.ok(rows.some((m) => !m.recoverFrom));
}

console.log("pair-fixture-sync ok");
