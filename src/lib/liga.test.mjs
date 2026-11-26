import assert from "node:assert/strict";
import { isOpenWeek, openWeek, latestWeek } from "./liga.js";

const matches = [
  { temp: "T5", week: "Fecha 1", home: "A", away: "B" },
  { temp: "T5", week: "Fecha 1", home: "C", away: "D" },
  { temp: "T5", week: "Fecha 2", home: "E", away: "F" },
  { temp: "T4", week: "Fecha 9", home: "G", away: "H" },
];

assert.equal(openWeek(matches, "T5"), "Fecha 2");
assert.equal(isOpenWeek("Fecha 2", matches, "T5"), true);
assert.equal(isOpenWeek("Fecha 1", matches, "T5"), false, "Fecha 1 deja de ser En juego al existir Fecha 2");
assert.equal(isOpenWeek("Fecha 9", matches, "T4"), true);
assert.equal(latestWeek(matches.filter((m) => m.temp === "T5")), "Fecha 2");
console.log("liga.test.mjs passed");
