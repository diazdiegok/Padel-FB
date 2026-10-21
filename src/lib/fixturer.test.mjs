import assert from "node:assert/strict";
import { buildFixture, parseWindow } from "./fixturer.js";

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
console.log(out.matches.map((m) => `${m.cat} | ${m.day} ${m.time} | ${m.home} vs ${m.away}${m.rematch ? " (revancha)" : ""}`).join("\n"));
console.log("--- pendientes");
console.log(out.pending.map((p) => `${p.cat} | ${p.home} | ${p.reason}`).join("\n"));

assert.equal(out.matches.length, 1);
assert.ok(!out.matches[0].rematch, "evita repetir rival cuando hay otra opción");
assert.equal(out.pending.length, 3);
assert.ok(out.matches.every((m) => m.home.includes(",") && m.away.includes(",")), "usa los nombres del ranking");
assert.ok(!out.pending.some((p) => p.home.includes("Caro")), "los que no juegan no quedan pendientes");
const rec = buildFixture({
  entries: [
    e("A", "B", "C Masculina", { Lunes: "18 a 23" }, { recover: true }),
    e("C", "D", "C Masculina", { Lunes: "18 a 20" }),
    e("E", "F", "C Masculina", { Lunes: "18 a 23" }),
  ],
  temp: "T5",
});
assert.equal(rec.matches.length, 2, "la que recupera juega dos");
const [m1, m2] = rec.matches;
assert.notEqual(m1.time, m2.time, "no le superpone horarios");
console.log("--- recupera");
console.log(rec.matches.map((m) => `${m.day} ${m.time} | ${m.home} vs ${m.away}`).join("\n"));
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
console.log(`--- 150 parejas: ${res.matches.length} partidos, ${res.pending.length} pendientes, ${Date.now() - t0} ms`);
assert.ok(Date.now() - t0 < 5000, "arma rápido");
console.log("ok");
