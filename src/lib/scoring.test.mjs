import assert from "node:assert/strict";
import { addPairsToRanking, syncRankingToSeasonPairs } from "./scoring.js";

{
  const rows = [
    { name: "Juan / Pedro", cat: "7ma", pts: 6, pj: 2, dif: 2, pos: 1, temp: "T5" },
    { name: "Carolina / Lucia", cat: "7ma", pts: 3, pj: 1, dif: 1, pos: 2, temp: "T5" },
    { name: "Otra / Temp", cat: "7ma", pts: 9, pj: 3, dif: 3, pos: 1, temp: "T4" },
  ];
  const pairs = [
    { p1: "Juan Perez", p2: "Pedro Gomez", cat: "7ma", temp: "T5" },
    { p1: "Carolina", p2: "Lucia", cat: "7ma", temp: "T5" },
  ];
  const { removed, renamed } = syncRankingToSeasonPairs(rows, pairs, "T5");
  assert.equal(removed.length, 0);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].from, "Juan / Pedro");
  assert.equal(renamed[0].to, "Juan Perez / Pedro Gomez");
  assert.equal(rows.find((r) => r.temp === "T5" && r.pts === 6).name, "Juan Perez / Pedro Gomez");
  assert.equal(rows.find((r) => r.temp === "T4").name, "Otra / Temp");
  // No duplica la fila al agregar: sigue matcheando por fuzzy match.
  const added = addPairsToRanking(rows, pairs);
  assert.equal(added.length, 0);
  assert.equal(rows.filter((r) => r.temp === "T5").length, 2);
  console.log("ok: rename keeps points and does not duplicate");
}

{
  const rows = [{ name: "Vieja / Pareja", cat: "6ta", pts: 3, pj: 1, dif: 0, pos: 1, temp: "T5" }];
  const pairs = [{ p1: "Nueva", p2: "Completa", cat: "6ta", temp: "T5" }];
  const { removed, renamed } = syncRankingToSeasonPairs(rows, pairs, "T5");
  assert.equal(renamed.length, 0);
  assert.equal(removed.length, 1);
  assert.equal(rows.length, 0);
  const added = addPairsToRanking(rows, pairs);
  assert.deepEqual(added, ["Nueva / Completa"]);
  assert.equal(rows[0].pts, 0);
  console.log("ok: unmatched row dropped, new pair added at 0");
}

{
  const rows = [
    { name: "Juan / Pedro", cat: "7ma", pts: 6, pj: 2, dif: 2, pos: 1, temp: "T5" },
    { name: "Juanito / Pedrito", cat: "7ma", pts: 0, pj: 0, dif: 0, pos: 2, temp: "T5" },
  ];
  const pairs = [{ p1: "Juan", p2: "Pedro", cat: "7ma", temp: "T5" }];
  const { removed, renamed } = syncRankingToSeasonPairs(rows, pairs, "T5");
  assert.equal(removed.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Juan / Pedro");
  assert.ok(renamed.length <= 1);
  console.log("ok: one pair cannot keep two ranking rows");
}

console.log("scoring.test.mjs passed");
