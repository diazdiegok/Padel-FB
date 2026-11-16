import assert from "node:assert/strict";
import {
  PENDING_AWAY,
  MAX_PAIR_MATCHES,
  absorbCoveredPending,
  buildFixture,
  parseWindow,
  countPairMatches,
  coverCandidates,
  importRecoveryDebts,
  isPendingMatch,
  isRealPairMatch,
} from "./fixturer.js";

assert.deepEqual(parseWindow("19:00 - 22:00"), [1140, 1320]);
assert.deepEqual(parseWindow("19 a 22"), [1140, 1320]);
assert.deepEqual(parseWindow("desde las 20hs"), [1200, 1440]);
assert.deepEqual(parseWindow("hasta 21"), [480, 1260]);
assert.deepEqual(parseWindow(""), [480, 1440]);

const ranking = [
  { name: "Gea Sánchez, Julián / Gea Sánchez, Joaquín", cat: "A Masculina", pos: 1, temp: "T5" },
  { name: "Fusse, Bruno / Rodríguez, Marcos", cat: "A Masculina", pos: 2, temp: "T5" },
  { name: "Enrique, Ariel / Enrique, Marcelo", cat: "A Masculina", pos: 3, temp: "T5" },
  { name: "Agnoli, Imanol / Rodriguez, Roman", cat: "A Masculina", pos: 4, temp: "T5" },
];
const e = (p1, p2, cat, days, extra = {}) => ({ p1, p2, cat, days, bye: false, recover: false, ...extra });
const entries = [
  e("Julián Gea Sánchez", "Joaquín Gea Sánchez", "A Masculina", { Lunes: "19:00 - 22:00", Jueves: "20 a 23" }),
  e("Bruno Fusse", "Marcos Rodríguez", "A Masculina", { Lunes: "20:00 - 23:00" }),
  e("Ariel Enrique", "Marcelo Enrique", "A Masculina", { Jueves: "21 a 23" }),
  e("Imanol Agnoli", "Roman Rodriguez", "A Masculina", { Martes: "18 a 20" }),
  e("Ana", "Bea", "B Femenino", { Lunes: "19 a 21" }),
  e("Caro", "Dani", "B Femenino", {}, { bye: true }),
];
const history = [{ temp: "T5", cat: "A Masculina", home: "Gea Sánchez, Julián / Gea Sánchez, Joaquín", away: "Fusse, Bruno / Rodríguez, Marcos" }];

const out = buildFixture({ entries, ranking, history, week: "Fecha 3", temp: "T5" });
console.log(out.matches.map((m) => `${m.cat} | ${m.day || "—"} ${m.time || "—"} | ${m.home} vs ${m.away}${m.rematch ? " (revancha)" : ""}${m.pending ? " [pendiente]" : ""}`).join("\n"));
console.log("--- pendientes");
console.log(out.pending.map((p) => `${p.cat} | ${p.home} vs ${p.away} | ${p.reason}`).join("\n"));

assert.equal(out.matches.filter((m) => !m.pending).length, 1);
assert.ok(!out.matches.find((m) => !m.pending)?.rematch, "evita repetir rival cuando hay otra opción");
assert.equal(out.pending.length, 3);
assert.ok(out.pending.every((p) => p.away === PENDING_AWAY && p.pending), "pendientes salen como vs Pendiente / Pendiente");
assert.ok(out.matches.filter((m) => m.pending).every(isPendingMatch));
assert.ok(out.matches.filter((m) => !m.pending).every(isRealPairMatch));
assert.ok(out.matches.some((m) => !m.pending && m.home.includes(",") && m.away.includes(",")), "usa los nombres del ranking");
assert.ok(!out.pending.some((p) => p.home.includes("Caro")), "los que no juegan no quedan pendientes");

const rec = buildFixture({
  entries: [
    e("A", "B", "C Masculina", { Lunes: "18 a 23" }, { recover: true }),
    e("C", "D", "C Masculina", { Lunes: "18 a 20" }),
    e("E", "F", "C Masculina", { Lunes: "18 a 23" }),
  ],
  temp: "T5",
});
assert.equal(rec.matches.filter((m) => !m.pending).length, 2, "la que recupera juega dos");
const [m1, m2] = rec.matches.filter((m) => !m.pending);
assert.notEqual(m1.time, m2.time, "no le superpone horarios");
console.log("--- recupera");
console.log(rec.matches.filter((m) => !m.pending).map((m) => `${m.day} ${m.time} | ${m.home} vs ${m.away}`).join("\n"));

const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const big = [];
for (const cat of ["A Masculina", "B Masculina", "C Masculina", "B Femenino", "C Femenino"]) {
  for (let i = 0; i < 30; i++) {
    const pick = days.filter((_, d) => (i * 7 + d * 3) % 4 === 0);
    big.push(e(`J${i}a ${cat}`, `J${i}b ${cat}`, cat, Object.fromEntries(pick.map((d) => [d, `${18 + (i % 3)} a 23`]))));
  }
}
const t0 = Date.now();
const res = buildFixture({ entries: big, temp: "T5" });
console.log(`--- 150 parejas: ${res.matches.filter((m) => !m.pending).length} partidos, ${res.pending.length} pendientes, ${Date.now() - t0} ms`);
assert.ok(Date.now() - t0 < 5000, "arma rápido");

// Tope 12 PJ + cover candidates
const played = Array.from({ length: MAX_PAIR_MATCHES }, (_, i) => ({
  temp: "T5",
  cat: "A Masculina",
  week: `Fecha ${i + 1}`,
  home: "Gea Sánchez, Julián / Gea Sánchez, Joaquín",
  away: `Rival ${i}a / Rival ${i}b`,
}));
assert.equal(countPairMatches("Gea Sánchez, Julián / Gea Sánchez, Joaquín", "A Masculina", "T5", [played]), MAX_PAIR_MATCHES);
assert.equal(
  countPairMatches("Gea Sánchez, Julián / Gea Sánchez, Joaquín", "A Masculina", "T5", [
    [...played, { temp: "T5", cat: "A Masculina", week: "Fecha X", home: "X", away: PENDING_AWAY, pending: true }],
  ]),
  MAX_PAIR_MATCHES,
  "pendientes no suman PJ"
);

const pendingSlot = {
  temp: "T5",
  cat: "A Masculina",
  week: "Fecha 3",
  home: "Enrique, Ariel / Enrique, Marcelo",
  away: PENDING_AWAY,
  pending: true,
};
const pairs = [
  { temp: "T5", cat: "A Masculina", p1: "Bruno Fusse", p2: "Marcos Rodríguez" },
  { temp: "T5", cat: "A Masculina", p1: "Julián Gea Sánchez", p2: "Joaquín Gea Sánchez" },
  { temp: "T5", cat: "A Masculina", p1: "Imanol Agnoli", p2: "Roman Rodriguez" },
  { temp: "T5", cat: "B Masculina", p1: "Otro", p2: "Masculino" },
  { temp: "T5", cat: "A Masculina", p1: "Ariel Enrique", p2: "Marcelo Enrique" },
];
const covers = coverCandidates({ match: pendingSlot, pairs, pools: [played], temp: "T5" });
assert.ok(covers.every((c) => c.cat === "A Masculina"), "solo misma categoría");
assert.ok(!covers.some((c) => c.label.includes("Gea")), "excluye quien ya tiene 12 PJ");
assert.ok(!covers.some((c) => c.label.includes("Enrique")), "excluye a la pareja home");
assert.ok(!covers.some((c) => c.label.includes("Otro")), "no mezcla B Masculina en A Masculina");
assert.ok(covers.some((c) => c.label.includes("Fusse")), "incluye rivales con PJ < 12");
console.log("--- cover", covers.map((c) => `${c.label} (${c.pj})`).join(" · "));

// Cubrir pendiente con otra pendiente → ambas salen; queda el partido.
{
  const laura = {
    week: "Fecha 1",
    temp: "T5",
    cat: "C Femenino",
    home: "Laura Martínez / Dalila Sosa",
    away: PENDING_AWAY,
    pending: true,
  };
  const stefania = {
    week: "Fecha 1",
    temp: "T5",
    cat: "C Femenino",
    home: "Stefania Benedetich / Florencia Benedetich",
    away: PENDING_AWAY,
    pending: true,
  };
  const other = {
    week: "Fecha 1",
    temp: "T5",
    cat: "C Femenino",
    home: "Marien Robledo / Valeria Joubert",
    away: PENDING_AWAY,
    pending: true,
  };
  const covered = {
    week: "Fecha 1",
    temp: "T5",
    cat: "C Femenino",
    home: laura.home,
    away: stefania.home,
    day: "Viernes",
    time: "19:00 - 20:30",
    venue: "Open Padel",
    court: "Cancha 1",
  };
  const list = [laura, stefania, other, covered];
  const out = absorbCoveredPending(list, covered, stefania.home);
  assert.equal(out.length, 2, "quedan el partido y el otro pendiente");
  assert.ok(out.includes(covered), "queda el partido cubierto");
  assert.ok(out.includes(other), "el pendiente ajeno sigue");
  assert.ok(!out.some((m) => isPendingMatch(m) && m.home === laura.home), "laura ya no está pendiente");
  assert.ok(!out.some((m) => isPendingMatch(m) && m.home === stefania.home), "stefania ya no está pendiente");
}

// Cubrir el partido normal no borra el que recupera, ni al revés.
{
  const normal = {
    week: "Fecha 2",
    temp: "T5",
    cat: "B Masculina",
    home: "Diego Ramirez / Martin Rondan",
    away: PENDING_AWAY,
    pending: true,
  };
  const makeup = {
    week: "Fecha 2",
    temp: "T5",
    cat: "B Masculina",
    home: "Diego Ramirez / Martin Rondan",
    away: PENDING_AWAY,
    pending: true,
    recoverFrom: "Fecha 1",
  };
  const covered = {
    week: "Fecha 2",
    temp: "T5",
    cat: "B Masculina",
    home: normal.home,
    away: "Otra Pareja / Rival",
  };
  const out = absorbCoveredPending([normal, makeup, covered], covered, covered.away);
  assert.ok(out.includes(covered));
  assert.ok(!out.includes(normal), "sale el pendiente normal");
  assert.ok(out.includes(makeup), "el recupero sigue");
  const coveredMakeup = { ...covered, recoverFrom: "Fecha 1" };
  const out2 = absorbCoveredPending([normal, makeup, coveredMakeup], coveredMakeup, coveredMakeup.away);
  assert.ok(out2.includes(normal), "cubrir el recupero no saca el partido normal");
  assert.ok(!out2.includes(makeup));
}

{
  const debt = {
    week: "Fecha 1",
    temp: "T5",
    cat: "B Masculina",
    home: "Diego Ramirez / Martin Rondan",
    away: PENDING_AWAY,
    pending: true,
    days: { Lunes: "16:00 - 00:00" },
  };
  const played = {
    week: "Fecha 1",
    temp: "T5",
    cat: "B Masculina",
    home: "Otra Pareja / Rival A",
    away: "Otra Pareja / Rival B",
    day: "Lunes",
    time: "19:00 - 20:30",
  };
  const history = [debt, played];
  const first = importRecoveryDebts(history, { temp: "T5", week: "Fecha 2", history });
  assert.equal(first.added, 1, "el que no jugó tiene un partido menos");
  assert.equal(debt.pending, true, "sigue pendiente en la fecha que no jugó");
  assert.equal(debt.recoverLater, undefined);
  const brought = first.matches.find((m) => m.week === "Fecha 2");
  assert.equal(brought.recoverFrom, "Fecha 1");
  assert.equal(brought.pending, true);
  assert.equal(brought.home, debt.home);
  assert.ok(first.matches.includes(debt), "no se saca el pendiente original");
  const again = importRecoveryDebts(first.matches, { temp: "T5", week: "Fecha 2", history: first.matches });
  assert.equal(again.added, 0, "no duplica");
  const sameWeek = importRecoveryDebts(history, { temp: "T5", week: "Fecha 1", history });
  assert.equal(sameWeek.added, 0, "en la misma fecha no arma recupero");
  const even = importRecoveryDebts(
    [
      played,
      {
        week: "Fecha 1",
        temp: "T5",
        cat: "B Masculina",
        home: debt.home,
        away: "Otra Pareja / Rival C",
      },
    ],
    { temp: "T5", week: "Fecha 2" }
  );
  assert.equal(even.added, 0, "si ya jugó, no recupera");
  const zero = { temp: "T5", cat: "B Masculina", p1: "Sin", p2: "Partidos", days: { Lunes: "18:00 - 21:00" } };
  const fromZero = importRecoveryDebts([played], {
    temp: "T5",
    week: "Fecha 2",
    history: [played],
    pairs: [zero],
  });
  assert.equal(fromZero.added, 1, "en Fecha 2, 0 partidos jugados recupera");
  assert.equal(fromZero.matches.find((m) => m.week === "Fecha 2").home, "Sin / Partidos");
  assert.equal(fromZero.matches.find((m) => m.week === "Fecha 2").recoverFrom, "Fecha 1");
}

console.log("ok");
