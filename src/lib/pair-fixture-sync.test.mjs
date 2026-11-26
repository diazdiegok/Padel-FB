import assert from "node:assert/strict";
import { PENDING_AWAY, isPendingMatch } from "./fixturer.js";
import {
  relabelPairsInMatches,
  rivalOptionsFromPairs,
  splitMatchToPending,
  syncFixtureWithPairs,
} from "./pair-fixture-sync.js";
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

{
  const past = {
    week: "Fecha 1",
    temp,
    cat: "C Femenino",
    day: "Lunes",
    time: "21:00",
    venue: "La Emilia",
    court: "1",
    home: "Milagros Solaro / Ana Paula Croce",
    away: "Marien Robledo / Valeria Joubert",
    result: "6/4 6/3",
  };
  const current = {
    week: "Fecha 5",
    temp,
    cat: "C Femenino",
    day: "Lunes",
    time: "22:00",
    venue: "La Emilia",
    court: "2",
    home: "Milagros Solaro / Ana Paula Croce",
    away: "Marien Robledo / Valeria Joubert",
  };
  const earlierOpen = {
    week: "Fecha 4",
    temp,
    cat: "C Femenino",
    day: "Lunes",
    time: "19:30",
    venue: "Open Padel",
    court: "1",
    home: "Marien Robledo / Valeria Joubert",
    away: "Milagros Solaro / Ana Paula Croce",
  };
  const later = {
    week: "Fecha 6",
    temp,
    cat: "C Femenino",
    day: "Lunes",
    time: "20:00",
    venue: "Open Padel",
    court: "3",
    home: "Marien Robledo / Valeria Joubert",
    away: "Milagros Solaro / Ana Paula Croce",
  };
  const out = syncFixtureWithPairs({
    matches: [past, earlierOpen, current, later],
    pairs: pairs.filter((p) => p.p1 !== "Milagros Solaro"),
    temp,
    liveWeek: "Fecha 1",
    historyWeek: "Fecha 5",
  });
  const kept = out.matches.find((m) => m.week === "Fecha 1" && m.result);
  assert.ok(kept, "la fecha ya jugada queda");
  assert.equal(kept.venue, "La Emilia");
  assert.equal(kept.home, "Milagros Solaro / Ana Paula Croce");
  const fecha4 = out.matches.find((m) => m.week === "Fecha 4" && !isPendingMatch(m));
  assert.ok(fecha4, "una fecha anterior sin resultado también queda");
  assert.equal(fecha4.venue, "Open Padel");
  assert.ok(
    !out.matches.some(
      (m) =>
        (m.week === "Fecha 5" || m.week === "Fecha 6") &&
        !isPendingMatch(m) &&
        (pairsMatch(m.home, "Milagros Solaro / Ana Paula Croce") || pairsMatch(m.away, "Milagros Solaro / Ana Paula Croce"))
    ),
    "la baja no queda en la fecha en curso ni en las próximas"
  );
  const rival = out.matches.filter(
    (m) => m.week === "Fecha 5" && isPendingMatch(m) && pairsMatch(m.home, "Marien Robledo / Valeria Joubert")
  );
  assert.equal(rival.length, 1, "el rival de la fecha en curso pasa a pendiente");
  assert.equal(rival[0].venue, "");
  assert.ok(
    out.matches.some((m) => m.week === "Fecha 6" && isPendingMatch(m) && pairsMatch(m.home, "Marien Robledo / Valeria Joubert")),
    "en la fecha siguiente también queda pendiente el rival"
  );
  assert.ok(
    !out.matches.some((m) => isPendingMatch(m) && pairsMatch(m.home, "Milagros Solaro / Ana Paula Croce")),
    "la baja no pasa a pendiente"
  );
  console.log("ok: la baja conserva el historial y desarma solo la fecha en curso y las próximas");
}

{
  const never = pairs.find((p) => p.p1 === "Abril Diamela Migueles");
  const rival = pairs.find((p) => p.p1 === "Marien Robledo");
  const scheduled = {
    week: "Fecha 2",
    temp,
    cat: "B Femenino",
    day: "Martes",
    time: "20:00",
    venue: "La Emilia",
    court: "1",
    home: "Abril Diamela Migueles / Yamila Bertotti",
    away: "Marien Robledo / Valeria Joubert",
  };
  const waiting = {
    week: "Fecha 3",
    temp,
    cat: "B Femenino",
    day: "",
    time: "",
    venue: "",
    court: "",
    home: "Abril Diamela Migueles / Yamila Bertotti",
    away: PENDING_AWAY,
    pending: true,
    reason: "Pendiente de rival.",
  };
  const out = syncFixtureWithPairs({
    matches: [scheduled, waiting],
    pairs: pairs.filter((p) => p !== never),
    temp,
    liveWeek: "Fecha 5",
    historyWeek: "Fecha 5",
  });
  assert.ok(
    !out.matches.some(
      (m) =>
        pairsMatch(m.home, "Abril Diamela Migueles / Yamila Bertotti") ||
        pairsMatch(m.away, "Abril Diamela Migueles / Yamila Bertotti")
    ),
    "la que nunca jugó no queda en fixture ni en pendientes"
  );
  const rivalPending = out.matches.filter(
    (m) => m.week === "Fecha 2" && isPendingMatch(m) && pairsMatch(m.home, "Marien Robledo / Valeria Joubert")
  );
  assert.equal(rivalPending.length, 1, "el rival del partido armado pasa a pendiente");
  assert.equal(rival.p1, "Marien Robledo");
  console.log("ok: sin partidos sale de fixture y pendientes, y el rival queda pendiente");
}

{
  const fromPairs = [
    { id: "p1", temp, cat: "B Femenino", p1: "Milagros Luna", p2: "Lula Thomi" },
    { id: "p2", temp, cat: "B Femenino", p1: "Abril Diamela Migueles", p2: "Yamila Bertotti" },
  ];
  const toPairs = [
    { id: "p1", temp, cat: "B Femenino", p1: "Milagros Luna", p2: "Gisela Corona" },
    { id: "p2", temp, cat: "B Femenino", p1: "Abril Diamela Migueles", p2: "Yamila Bertotti" },
  ];
  const matches = [
    {
      week: "Fecha 2",
      temp,
      cat: "B Femenino",
      day: "Lunes",
      time: "20:00 - 21:30",
      venue: "Open",
      court: "1",
      home: "Milagros Luna / Lula Thomi",
      away: "Abril Diamela Migueles / Yamila Bertotti",
    },
    {
      week: "Fecha 2",
      temp,
      cat: "B Femenino",
      home: "Milagros Luna / Lula Thomi",
      away: PENDING_AWAY,
      pending: true,
    },
  ];
  const { matches: labeled, renamed } = relabelPairsInMatches(matches, fromPairs, toPairs);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].to, "Milagros Luna / Gisela Corona");
  assert.ok(pairsMatch(labeled[0].home, "Milagros Luna / Gisela Corona"));
  assert.ok(pairsMatch(labeled[0].away, "Abril Diamela Migueles / Yamila Bertotti"));
  assert.equal(labeled[0].venue, "Open", "el partido armado sigue con cancha/horario");
  const synced = syncFixtureWithPairs({
    matches: labeled,
    pairs: toPairs,
    temp,
    liveWeek: "Fecha 2",
    historyWeek: "Fecha 2",
  });
  const still = synced.matches.find(
    (m) =>
      !isPendingMatch(m) &&
      pairsMatch(m.home, "Milagros Luna / Gisela Corona") &&
      pairsMatch(m.away, "Abril Diamela Migueles / Yamila Bertotti")
  );
  assert.ok(still, "renombrar un integrante no desarma el partido");
  assert.equal(still.time, "20:00 - 21:30");
  console.log("ok: rename por id solo reetiqueta y no desarma");
}

console.log("pair-fixture-sync ok");
