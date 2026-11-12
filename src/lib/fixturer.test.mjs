import assert from "node:assert/strict";
import {
  PENDING_AWAY,
  MAX_PAIR_MATCHES,
  buildFixture,
  parseWindow,
  countPairMatches,
  coverCandidates,
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

console.log("ok");
