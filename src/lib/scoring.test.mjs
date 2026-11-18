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
  const rows = [
    { name: "Vieja / Pareja", cat: "6ta", pts: 3, pj: 1, dif: 0, pos: 1, temp: "T5" },
    { name: "Nunca / Jugo", cat: "6ta", pts: 0, pj: 0, dif: 0, pos: 2, temp: "T5" },
  ];
  const pairs = [{ p1: "Nueva", p2: "Completa", cat: "6ta", temp: "T5" }];
  const { removed, renamed } = syncRankingToSeasonPairs(rows, pairs, "T5");
  assert.equal(renamed.length, 0);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].name, "Nunca / Jugo");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Vieja / Pareja");
  assert.equal(rows[0].pts, 3);
  const added = addPairsToRanking(rows, pairs);
  assert.deepEqual(added, ["Nueva / Completa"]);
  assert.equal(rows.find((r) => r.name === "Nueva / Completa").pts, 0);
  console.log("ok: la baja con partidos queda en el ranking; sin partidos, sale");
}

{
  const rows = [{ name: "Milagros Solaro / Ana Paula Croce", cat: "C Femenino", pts: 0, pj: 0, dif: 0, pos: 1, temp: "T5" }];
  const pairs = [{ p1: "Marien Robledo", p2: "Valeria Joubert", cat: "C Femenino", temp: "T5" }];
  const matches = [
    {
      temp: "T5",
      cat: "C Femenino",
      week: "Fecha 1",
      result: "6/4 6/3",
      home: "Milagros Solaro / Ana Paula Croce",
      away: "Marien Robledo / Valeria Joubert",
    },
  ];
  const { removed } = syncRankingToSeasonPairs(rows, pairs, "T5", matches);
  assert.equal(removed.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Milagros Solaro / Ana Paula Croce");
  console.log("ok: un resultado jugado alcanza para quedar en el ranking");
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

{
  const { playersMatch, pairsMatch, queryMatchesText } = await import("./scoring.js");
  const diego = "Diego Diaz / Emiliano Fontanetto";
  assert.equal(queryMatchesText(diego, "Diaz Die"), true, "apellido y arranque del nombre");
  assert.equal(queryMatchesText(diego, "diego diaz"), true);
  assert.equal(queryMatchesText(diego, "Diego"), true);
  assert.equal(queryMatchesText("Gonzalo Damian Diaz", "Diaz Die"), false);
  assert.equal(queryMatchesText("Martin Mendez / Diego Godoy", "Diego"), true);
  assert.equal(queryMatchesText("Martin Mendez / Diego Godoy", "diego diaz"), false);
  assert.equal(playersMatch("Juan Perez", "Juan Pérez"), true);
  assert.equal(playersMatch("Ana Paula Croce", "Ana Croce"), true);
  assert.equal(playersMatch("Martin Mendez", "Martin Rondan"), false, "mismo nombre ≠ misma persona");
  assert.equal(playersMatch("Diego Godoy", "Diego Ramirez"), false);
  assert.equal(
    pairsMatch("Martin Mendez / Diego Godoy", "Diego Ramirez / Martin Rondan"),
    false,
    "no cruzar A Masc con B Masc por nombre de pila"
  );
  assert.equal(pairsMatch("Laura  Martínez / Dalila Sosa", "Laura Martínez/Dalila Sosa"), true);
  console.log("ok: playersMatch no confunde solo por nombre de pila");
}

{
  const { parseResult, describeResult, formatResult } = await import("./scoring.js");
  const slash = describeResult("2/6 5/7");
  assert.equal(slash.homeWin, false);
  assert.equal(slash.score, "2/6 5/7");
  assert.equal(slash.label, "(0-2)");
  assert.equal(slash.awayPts, 3);
  assert.equal(slash.homePts, 0);
  const old = describeResult("6-4 3-6 6-2");
  assert.equal(old.homeWin, true);
  assert.equal(old.score, "6/4 3/6 6/2");
  assert.equal(old.awayPts, 1);
  assert.equal(formatResult("6-4 6-2"), "6/4 6/2");
  assert.equal(parseResult("6/4"), null);
  console.log("ok: el score se lee con / y se muestra con /");
}

{
  const { applyFixtureResults, preserveRemoteMatchScores } = await import("./scoring.js");
  const remote = [
    {
      week: "Fecha 1",
      temp: "T5",
      cat: "A Masculina",
      home: "Julián Gea / Joaquín Gea",
      away: "Mariano Carrere / Tomas Castillo",
      result: "6/3 7/5",
      appliedResult: "6/3 7/5",
    },
  ];
  const local = [
    {
      week: "Fecha 1",
      temp: "T5",
      cat: "A Masculina",
      home: "Julián Gea / Joaquín Gea",
      away: "Mariano Carrere / Tomas Castillo",
      day: "Martes",
      time: "16:30 - 18:00",
      result: "",
      appliedResult: "",
    },
  ];
  const kept = preserveRemoteMatchScores(local, remote);
  assert.equal(kept[0].result, "6/3 7/5");
  assert.equal(kept[0].appliedResult, "6/3 7/5");

  const ranking = [
    { name: "Julián Gea / Joaquín Gea", cat: "A Masculina", pts: 3, pj: 1, dif: 2, pos: 1, temp: "T5" },
    { name: "Mariano Carrere / Tomas Castillo", cat: "A Masculina", pts: 0, pj: 1, dif: -2, pos: 2, temp: "T5" },
  ];
  const match = {
    week: "Fecha 1",
    temp: "T5",
    cat: "A Masculina",
    home: "Julián Gea / Joaquín Gea",
    away: "Mariano Carrere / Tomas Castillo",
    result: "6-3 7-5",
    appliedResult: "6/3 7/5",
  };
  const report = applyFixtureResults(ranking, [match]);
  assert.equal(report.applied, 0, "mismo score con otro formato no vuelve a sumar");
  assert.equal(ranking[0].pj, 1);
  assert.equal(ranking[0].pts, 3);
  assert.equal(match.appliedResult, "6/3 7/5");
  console.log("ok: no se pisan scores al republicar ni se dobla el PJ por formato");
}

console.log("scoring.test.mjs passed");
