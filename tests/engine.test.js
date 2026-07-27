const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadEngine() {
  let stored = null;
  const context = {
    Date,
    Math,
    JSON,
    localStorage: {
      getItem: () => stored,
      setItem: (_key, value) => { stored = value; },
    },
  };
  vm.createContext(context);
  const source = ["content.js", "engine.js"]
    .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
    .join("\n") + "\nglobalThis.engineForTest = MTC;";
  vm.runInContext(source, context);
  return { MTC: context.engineForTest, stored: () => stored };
}

test("import normalizes malformed nested state", () => {
  const { MTC } = loadEngine();
  const state = MTC.importState(JSON.stringify({
    name: "Ada",
    totalXp: 100,
    history: [{
      date: "2026-07-27",
      exerciseId: "anything",
      type: "workbench",
      score: "<img>",
      xp: "<img src=x onerror=alert(1)>",
      hintsUsed: null,
      answer: "hello",
    }],
    reviews: null,
    calibration: null,
  }));

  assert.deepEqual(MTC.dueReviewCards(state).length > 0, true);
  assert.equal(state.history[0].score, 0);
  assert.equal(state.history[0].xp, 0);
  assert.equal(state.history[0].hintsUsed, 0);
  assert.equal(state.calibration.answers.length, 0);
  assert.equal(state.calibration.asked.length, 0);
});

test("todayStr uses local calendar components", () => {
  const { MTC } = loadEngine();
  const date = new Date(2026, 6, 27, 0, 30);
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  assert.equal(MTC.todayStr(date), expected);
});

test("decision records can be saved and completed", () => {
  const { MTC } = loadEngine();
  const state = MTC.loadState();
  const saved = MTC.saveDecision(state, {
    title: "Choose a launch date",
    context: "We need enough time to test.",
    options: "Launch now or wait.",
    criteria: "Customer impact and reliability.",
    decision: "Wait one week.",
    preMortem: "A critical issue is missed.",
    indicators: "Error rate and support volume.",
    reviewDate: MTC.todayStr(),
  });

  assert.equal(MTC.dueDecisions(state).length, 1);
  MTC.reviewDecision(state, saved.id, "The extra week found the issue.");
  assert.equal(MTC.dueDecisions(state).length, 0);
  assert.equal(state.decisions[0].outcome, "The extra week found the issue.");
});
