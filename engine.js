/* Master Thinking Coach — game engine (leveling, XP, streaks, quest generation, achievements).
   Pure functions over a plain-object state, persisted to localStorage. No build step. */

const MTC = (() => {
  const STORAGE_KEY = "mtc_state_v1";

  function todayStr(d = new Date()) {
    // Daily activity should follow the player's calendar day, not UTC. Using
    // toISOString() made streaks and quests roll over early or late outside UTC.
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isoWeekKey(d = new Date()) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }

  function weekIndex(d = new Date()) {
    const epoch = new Date(Date.UTC(2024, 0, 1));
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return Math.floor((date - epoch) / (7 * 86400000));
  }

  function xpCostForLevel(level) {
    return 100 + (level - 1) * 40;
  }

  function deriveLevel(totalXp) {
    let level = 1;
    let remaining = totalXp;
    while (level < 100 && remaining >= xpCostForLevel(level)) {
      remaining -= xpCostForLevel(level);
      level++;
    }
    return { level, xpIntoLevel: remaining, xpForNext: xpCostForLevel(Math.min(level, 100)) };
  }

  function titleForLevel(level) {
    let title = MTC_LEVEL_TITLES[0][1];
    for (const [lvl, name] of MTC_LEVEL_TITLES) {
      if (level >= lvl) title = name;
    }
    return title;
  }

  function defaultState() {
    return {
      name: null,
      createdAt: new Date().toISOString(),
      totalXp: 0,
      streak: 0,
      lastActiveDate: null,
      totalExercises: 0,
      typeCounts: {},
      frameworkCounts: {},
      flags: {},
      achievements: [],
      bossBattlesCompleted: 0,
      graceShields: 1, // consumed to survive one missed day; re-earned by finishing the core trio
      calibration: { answers: [], asked: [] },
      reviews: {}, // cardId -> {ease, interval, reps, due}
      reviewCount: 0,
      trackXp: {}, // skillTrackId -> lifetime XP earned on that track
      newIntro: null, // {date, count} — caps new review cards introduced per day
      weaknessScores: {}, // frameworkId -> {attempts, totalScore}
      history: [], // {date, exerciseId, type, score, xp, hintsUsed}
      dailyQuest: null, // {date, items: [{exerciseId, type}], completed: [exerciseId]}
      bossBattle: null, // {week, battleId, completed, stageNotes: []}
      profile: { focus: "general", sessionLength: "standard" },
      decisions: [], // {id, title, context, options, criteria, decision, preMortem, indicators, reviewDate, createdAt, reviewedAt, outcome}
    };
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function nonNegativeNumber(value, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function boundedNumber(value, min, max, fallback = min) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  function dateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  function numberMap(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([, n]) => Number.isFinite(n) && n >= 0)
      .map(([key, n]) => [key, n]));
  }

  // All state may come from localStorage or an imported file, so normalize it
  // before the UI consumes it. This also gives older progress files safe defaults.
  function normalizeState(value) {
    if (!isRecord(value)) throw new Error("Not a valid progress file");
    const state = defaultState();
    const exerciseTypes = new Set([...MTC_QUEST_TYPES, "boss", "calibration", "review", "workbench"]);
    const exerciseIds = new Set(MTC_EXERCISES.map((e) => e.id));
    const bossIds = new Set(MTC_BOSS_BATTLES.map((b) => b.id));
    const frameworkIds = new Set(MTC_FRAMEWORKS.map((f) => f.id));
    const reviewIds = new Set(reviewDeck().map((c) => c.id));

    state.name = typeof value.name === "string" ? value.name.slice(0, 40) : null;
    state.createdAt = typeof value.createdAt === "string" ? value.createdAt : state.createdAt;
    state.totalXp = nonNegativeNumber(value.totalXp);
    state.streak = Math.floor(nonNegativeNumber(value.streak));
    state.lastActiveDate = dateKey(value.lastActiveDate);
    state.totalExercises = Math.floor(nonNegativeNumber(value.totalExercises));
    state.typeCounts = numberMap(value.typeCounts);
    state.frameworkCounts = numberMap(value.frameworkCounts);
    state.flags = numberMap(value.flags);
    state.achievements = Array.isArray(value.achievements)
      ? [...new Set(value.achievements.filter((id) => MTC_ACHIEVEMENTS.some((a) => a.id === id)))] : [];
    state.bossBattlesCompleted = Math.floor(nonNegativeNumber(value.bossBattlesCompleted));
    state.graceShields = Math.min(1, Math.floor(nonNegativeNumber(value.graceShields, 1)));
    state.reviewCount = Math.floor(nonNegativeNumber(value.reviewCount));
    state.trackXp = numberMap(value.trackXp);
    if (isRecord(value.profile)) {
      state.profile = {
        focus: typeof value.profile.focus === "string" ? value.profile.focus.slice(0, 60) : "general",
        sessionLength: ["quick", "standard", "deep"].includes(value.profile.sessionLength) ? value.profile.sessionLength : "standard",
      };
    }

    if (isRecord(value.calibration)) {
      state.calibration.asked = Array.isArray(value.calibration.asked)
        ? value.calibration.asked.filter((id) => typeof id === "string").slice(-500) : [];
      state.calibration.answers = Array.isArray(value.calibration.answers)
        ? value.calibration.answers.filter((answer) => isRecord(answer) && dateKey(answer.date)
          && (answer.kind === "binary" || answer.kind === "interval"))
          .map((answer) => answer.kind === "binary"
            ? { id: String(answer.id || ""), kind: "binary", correct: Boolean(answer.correct), confidence: boundedNumber(answer.confidence, 0, 100), date: answer.date }
            : { id: String(answer.id || ""), kind: "interval", hit: Boolean(answer.hit), date: answer.date })
          .slice(-500) : [];
    }

    if (isRecord(value.reviews)) {
      for (const [id, rec] of Object.entries(value.reviews)) {
        if (!reviewIds.has(id) || !isRecord(rec) || !dateKey(rec.due)) continue;
        state.reviews[id] = {
          ease: boundedNumber(rec.ease, 1.3, 5, 2.5),
          interval: Math.floor(nonNegativeNumber(rec.interval)),
          reps: Math.floor(nonNegativeNumber(rec.reps)),
          due: rec.due,
        };
      }
    }

    if (isRecord(value.newIntro) && dateKey(value.newIntro.date)) {
      state.newIntro = { date: value.newIntro.date, count: Math.floor(nonNegativeNumber(value.newIntro.count)) };
    }
    if (isRecord(value.weaknessScores)) {
      for (const [id, score] of Object.entries(value.weaknessScores)) {
        if (!frameworkIds.has(id) || !isRecord(score)) continue;
        state.weaknessScores[id] = {
          attempts: Math.floor(nonNegativeNumber(score.attempts)),
          totalScore: nonNegativeNumber(score.totalScore),
        };
      }
    }
    if (Array.isArray(value.history)) {
      state.history = value.history.filter((entry) => isRecord(entry) && dateKey(entry.date)
        && typeof entry.exerciseId === "string" && typeof entry.type === "string" && exerciseTypes.has(entry.type))
        .map((entry) => ({
          date: entry.date,
          exerciseId: entry.exerciseId.slice(0, 100),
          type: entry.type,
          score: boundedNumber(entry.score, 0, 100),
          xp: nonNegativeNumber(entry.xp),
          hintsUsed: Math.floor(nonNegativeNumber(entry.hintsUsed)),
          answer: typeof entry.answer === "string" ? entry.answer.slice(0, 8000) : "",
          ...(Number.isFinite(entry.confidence) ? { confidence: boundedNumber(entry.confidence, 0, 100) } : {}),
        })).slice(-5000);
    }
    if (isRecord(value.dailyQuest) && dateKey(value.dailyQuest.date) && Array.isArray(value.dailyQuest.items)) {
      const items = value.dailyQuest.items.filter((item) => isRecord(item) && exerciseIds.has(item.exerciseId)
        && MTC_QUEST_TYPES.includes(item.type)).map((item) => ({ exerciseId: item.exerciseId, type: item.type, core: Boolean(item.core) }));
      if (items.length === MTC_QUEST_TYPES.length) {
        const validIds = new Set(items.map((item) => item.exerciseId));
        state.dailyQuest = { date: value.dailyQuest.date, items,
          completed: Array.isArray(value.dailyQuest.completed) ? value.dailyQuest.completed.filter((id) => validIds.has(id)) : [] };
      }
    }
    if (isRecord(value.bossBattle) && typeof value.bossBattle.week === "string" && bossIds.has(value.bossBattle.battleId)) {
      state.bossBattle = { week: value.bossBattle.week, battleId: value.bossBattle.battleId, completed: Boolean(value.bossBattle.completed) };
    }
    if (Array.isArray(value.decisions)) {
      state.decisions = value.decisions.filter((decision) => isRecord(decision) && typeof decision.id === "string"
        && typeof decision.title === "string" && dateKey(decision.createdAt) && dateKey(decision.reviewDate))
        .map((decision) => ({
          id: decision.id.slice(0, 80), title: decision.title.slice(0, 160),
          context: typeof decision.context === "string" ? decision.context.slice(0, 4000) : "",
          options: typeof decision.options === "string" ? decision.options.slice(0, 4000) : "",
          criteria: typeof decision.criteria === "string" ? decision.criteria.slice(0, 4000) : "",
          decision: typeof decision.decision === "string" ? decision.decision.slice(0, 4000) : "",
          preMortem: typeof decision.preMortem === "string" ? decision.preMortem.slice(0, 4000) : "",
          indicators: typeof decision.indicators === "string" ? decision.indicators.slice(0, 4000) : "",
          reviewDate: decision.reviewDate, createdAt: decision.createdAt,
          reviewedAt: dateKey(decision.reviewedAt), outcome: typeof decision.outcome === "string" ? decision.outcome.slice(0, 4000) : "",
        })).slice(-200);
    }
    return state;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function statsView(state) {
    const { level } = deriveLevel(state.totalXp);
    const bin = state.calibration.answers.filter((a) => a.kind === "binary");
    const accuracy = bin.length ? (bin.filter((a) => a.correct).length / bin.length) * 100 : 0;
    const avgConfidence = bin.length ? bin.reduce((t, a) => t + a.confidence, 0) / bin.length : 0;
    return {
      totalExercises: state.totalExercises,
      typeCounts: state.typeCounts,
      frameworkCounts: state.frameworkCounts,
      flags: state.flags,
      streak: state.streak,
      level,
      bossBattlesCompleted: state.bossBattlesCompleted,
      calibrationAnswers: state.calibration.answers.length,
      calibrationGap: bin.length ? Math.abs(accuracy - avgConfidence) : 100,
      reviewCount: state.reviewCount || 0,
    };
  }

  function updateStreak(state) {
    const today = todayStr();
    if (state.lastActiveDate === today) return;
    if (state.lastActiveDate) {
      const prev = new Date(state.lastActiveDate + "T00:00:00Z");
      const diffDays = Math.round((new Date(today + "T00:00:00Z") - prev) / 86400000);
      if (diffDays === 1) {
        state.streak++;
      } else if (diffDays === 2 && state.graceShields > 0) {
        // one missed day survived by spending a grace shield
        state.graceShields--;
        state.streak++;
      } else {
        state.streak = 1;
      }
    } else {
      state.streak = 1;
    }
    state.lastActiveDate = today;
  }

  function checkAchievements(state) {
    const stats = statsView(state);
    const unlocked = [];
    for (const a of MTC_ACHIEVEMENTS) {
      if (state.achievements.includes(a.id)) continue;
      if (a.rule(stats)) {
        state.achievements.push(a.id);
        state.totalXp += a.xp;
        unlocked.push(a);
      }
    }
    return unlocked;
  }

  function weaknessProfile(state) {
    const rows = Object.keys(state.weaknessScores).map((fw) => {
      const { attempts, totalScore } = state.weaknessScores[fw];
      const avg = attempts ? totalScore / attempts : 0;
      const meta = MTC_FRAMEWORKS.find((f) => f.id === fw);
      return { id: fw, name: meta ? meta.name : fw, avg, attempts };
    });
    rows.sort((a, b) => a.avg - b.avg);
    return rows;
  }

  function weakFrameworkIds(state) {
    return weaknessProfile(state)
      .filter((w) => w.attempts > 0 && w.avg < 70)
      .map((w) => w.id);
  }

  function pickExerciseForType(state, type, weak) {
    const pool = MTC_EXERCISES.filter((e) => e.type === type);
    const recentIds = state.history
      .filter((h) => h.type === type)
      .slice(-2)
      .map((h) => h.exerciseId);
    let candidates = pool.filter((e) => !recentIds.includes(e.id));
    if (candidates.length === 0) candidates = pool;

    const weakMatches = candidates.filter((e) => e.frameworks.some((f) => weak.includes(f)));

    const useWeak = weakMatches.length > 0 && Math.random() < 0.6;
    const finalPool = useWeak ? weakMatches : candidates;
    return finalPool[Math.floor(Math.random() * finalPool.length)];
  }

  function getOrCreateDailyQuest(state) {
    const today = todayStr();
    if (state.dailyQuest && state.dailyQuest.date === today) return state.dailyQuest;
    const weak = weakFrameworkIds(state);
    const items = MTC_QUEST_TYPES.map((type) => {
      const ex = pickExerciseForType(state, type, weak);
      return { exerciseId: ex.id, type, core: false };
    });
    // Core trio for short sessions: the warm-up plus the two exercises that
    // best target the player's current weak frameworks.
    const ranked = items
      .filter((it) => it.type !== "warmup")
      .map((it) => {
        const ex = getExercise(it.exerciseId);
        return { it, overlap: ex.frameworks.filter((f) => weak.includes(f)).length };
      })
      .sort((a, b) => b.overlap - a.overlap);
    items.find((it) => it.type === "warmup").core = true;
    ranked.slice(0, 2).forEach((r) => { r.it.core = true; });
    state.dailyQuest = { date: today, items, completed: [] };
    saveState(state);
    return state.dailyQuest;
  }

  function getExercise(id) {
    return MTC_EXERCISES.find((e) => e.id === id);
  }

  function hintPenaltyFactor(hintsUsed) {
    return Math.max(0.4, 1 - hintsUsed * 0.2);
  }

  // Single source of truth for the XP formula — used both to award XP on
  // submit and to show the "est. XP" preview in the UI.
  function estimateXp(xpBase, score, hintsUsed) {
    const clamped = Math.max(0, Math.min(100, score));
    return Math.round(xpBase * (clamped / 100) * hintPenaltyFactor(hintsUsed || 0));
  }

  function rubricScore(checkedCount, total) {
    return Math.round((checkedCount / total) * 100);
  }

  function trimAnswer(text) {
    return String(text || "").trim().slice(0, 8000);
  }

  function lastRecordFor(state, exerciseId, type) {
    for (let i = state.history.length - 1; i >= 0; i--) {
      const h = state.history[i];
      if (h.exerciseId === exerciseId && (!type || h.type === type)) return h;
    }
    return null;
  }

  // Shared bookkeeping for every scored attempt (exercise or boss battle):
  // framework stats, history, streak, XP, level-ups, achievements, persistence.
  function applyAttempt(state, frameworks, historyEntry) {
    for (const t of MTC_SKILL_TRACKS) {
      if (frameworks.some((f) => t.frameworks.includes(f))) {
        state.trackXp[t.id] = (state.trackXp[t.id] || 0) + historyEntry.xp;
      }
    }
    for (const fw of frameworks) {
      state.frameworkCounts[fw] = (state.frameworkCounts[fw] || 0) + 1;
      if (!state.weaknessScores[fw]) state.weaknessScores[fw] = { attempts: 0, totalScore: 0 };
      state.weaknessScores[fw].attempts++;
      state.weaknessScores[fw].totalScore += historyEntry.score;
    }
    state.history.push(historyEntry);

    const beforeLevel = deriveLevel(state.totalXp).level;
    updateStreak(state);
    state.totalXp += historyEntry.xp;
    const afterLevel = deriveLevel(state.totalXp).level;
    const achievementsUnlocked = checkAchievements(state);
    saveState(state);

    return {
      xpAwarded: historyEntry.xp,
      leveledUp: afterLevel > beforeLevel,
      newLevel: afterLevel,
      achievementsUnlocked,
    };
  }

  function submitExercise(state, exerciseId, selfScore, hintsUsed, answerText, confidence) {
    const ex = getExercise(exerciseId);
    if (!ex) throw new Error("Unknown exercise: " + exerciseId);
    const score = Math.max(0, Math.min(100, selfScore));

    state.totalExercises++;
    state.typeCounts[ex.type] = (state.typeCounts[ex.type] || 0) + 1;
    if (ex.flag) state.flags[ex.flag] = (state.flags[ex.flag] || 0) + 1;

    const quest = getOrCreateDailyQuest(state);
    if (!quest.completed.includes(exerciseId)) quest.completed.push(exerciseId);
    const coreDone = quest.items.filter((i) => i.core).every((i) => quest.completed.includes(i.exerciseId));
    if (coreDone) state.graceShields = 1;

    const entry = {
      date: todayStr(),
      exerciseId,
      type: ex.type,
      score,
      xp: estimateXp(ex.xpBase, score, hintsUsed),
      hintsUsed,
      answer: trimAnswer(answerText),
    };
    if (typeof confidence === "number") entry.confidence = Math.max(0, Math.min(100, confidence));
    const result = applyAttempt(state, ex.frameworks, entry);
    result.questComplete = quest.completed.length >= quest.items.length;
    return result;
  }

  function getCurrentBossBattle(state) {
    const week = isoWeekKey();
    if (state.bossBattle && state.bossBattle.week === week) return state.bossBattle;
    const idx = ((weekIndex() % MTC_BOSS_BATTLES.length) + MTC_BOSS_BATTLES.length) % MTC_BOSS_BATTLES.length;
    const battle = MTC_BOSS_BATTLES[idx];
    state.bossBattle = { week, battleId: battle.id, completed: false };
    saveState(state);
    return state.bossBattle;
  }

  function getBossBattleDef(battleId) {
    return MTC_BOSS_BATTLES.find((b) => b.id === battleId);
  }

  function submitBossBattle(state, battleId, selfScore, answerText) {
    const battle = getBossBattleDef(battleId);
    const score = Math.max(0, Math.min(100, selfScore));

    state.bossBattlesCompleted++;
    if (state.bossBattle && state.bossBattle.battleId === battleId) state.bossBattle.completed = true;

    return applyAttempt(state, battle.frameworks, {
      date: todayStr(),
      exerciseId: battleId,
      type: "boss",
      score,
      xp: estimateXp(battle.xpBase, score, 0),
      hintsUsed: 0,
      answer: trimAnswer(answerText),
    });
  }

  function exportStateJSON() {
    return JSON.stringify(loadState(), null, 2);
  }

  function importState(json) {
    const parsed = JSON.parse(json);
    if (!isRecord(parsed) || !Number.isFinite(parsed.totalXp) || !Array.isArray(parsed.history)) {
      throw new Error("Not a valid progress file");
    }
    const state = normalizeState(parsed);
    saveState(state);
    return state;
  }

  /* ---------- Calibration training ---------- */

  function pickCalibrationQuestions(state) {
    const pick = (pool, n) => {
      let fresh = pool.filter((q) => !state.calibration.asked.includes(q.id));
      if (fresh.length < n) fresh = pool;
      return [...fresh].sort(() => Math.random() - 0.5).slice(0, n);
    };
    return { binary: pick(MTC_CALIBRATION_BINARY, 5), intervals: pick(MTC_CALIBRATION_INTERVALS, 2) };
  }

  const CALIBRATION_MAX_XP = 5 * 12 + 2 * 10;

  // Proper scoring rule (Brier-based): honest confidence maximizes expected XP.
  function gradeCalibration(state, responses) {
    const graded = responses.map((r) => {
      if (r.kind === "binary") {
        const q = MTC_CALIBRATION_BINARY.find((x) => x.id === r.id);
        const correct = q.answer === r.answer;
        const c = Math.min(0.99, Math.max(0.5, r.confidence / 100));
        const brier = correct ? (1 - c) ** 2 : c ** 2;
        const points = Math.max(0, Math.round(12 * (1 - 2 * brier)));
        return { kind: "binary", id: q.id, statement: q.statement, truth: q.answer, note: q.note,
                 answer: r.answer, confidence: r.confidence, correct, points };
      }
      const q = MTC_CALIBRATION_INTERVALS.find((x) => x.id === r.id);
      const hit = r.low <= q.answer && q.answer <= r.high;
      return { kind: "interval", id: q.id, prompt: q.prompt, unit: q.unit, truth: q.answer,
               low: r.low, high: r.high, hit, points: hit ? 10 : 0 };
    });

    const today = todayStr();
    for (const g of graded) {
      state.calibration.asked.push(g.id);
      state.calibration.answers.push(g.kind === "binary"
        ? { id: g.id, kind: "binary", correct: g.correct, confidence: g.confidence, date: today }
        : { id: g.id, kind: "interval", hit: g.hit, date: today });
    }

    const xp = graded.reduce((t, g) => t + g.points, 0);
    const score = Math.round((xp / CALIBRATION_MAX_XP) * 100);
    const result = applyAttempt(state, ["probabilistic-thinking", "bayesian-thinking"], {
      date: today, exerciseId: "calibration", type: "calibration", score, xp, hintsUsed: 0, answer: "",
    });
    result.graded = graded;
    return result;
  }

  function calibrationStats(state) {
    const answers = state.calibration.answers;
    const bin = answers.filter((a) => a.kind === "binary");
    const intervals = answers.filter((a) => a.kind === "interval");
    const buckets = [[50, 59], [60, 69], [70, 79], [80, 89], [90, 99]].map(([lo, hi]) => {
      const inB = bin.filter((a) => a.confidence >= lo && a.confidence <= hi);
      return { label: `${lo}\u2013${hi}%`, n: inB.length,
               actual: inB.length ? Math.round((inB.filter((a) => a.correct).length / inB.length) * 100) : null };
    });
    return {
      total: answers.length,
      binaryCount: bin.length,
      accuracy: bin.length ? Math.round((bin.filter((a) => a.correct).length / bin.length) * 100) : null,
      avgConfidence: bin.length ? Math.round(bin.reduce((t, a) => t + a.confidence, 0) / bin.length) : null,
      buckets,
      intervalCount: intervals.length,
      intervalHitRate: intervals.length ? Math.round((intervals.filter((a) => a.hit).length / intervals.length) * 100) : null,
    };
  }

  /* ---------- Spaced review (SM-2 lite) over frameworks & toolbox ---------- */

  function reviewDeck() {
    return [
      ...MTC_FRAMEWORKS.map((f) => ({
        id: "fw:" + f.id, kind: "Framework", front: f.name,
        hint: "What problem does it solve? When is it dangerous?",
        back: f.core + " Expert use: " + f.expertUse,
      })),
      ...MTC_TOOLBOX.map((t) => ({
        id: "tool:" + t.id, kind: "Tool", front: t.name,
        hint: "What is it? When do you reach for it?",
        back: t.summary + " When: " + t.when,
      })),
    ];
  }

  function dueReviewCards(state) {
    const today = todayStr();
    const deck = reviewDeck();
    const due = deck.filter((c) => state.reviews[c.id] && state.reviews[c.id].due <= today);
    const fresh = deck.filter((c) => !state.reviews[c.id]);
    // top up short sessions with new cards — at most 5 new per day, so the
    // deck can't be ground through in one sitting
    const usedToday = state.newIntro && state.newIntro.date === today ? state.newIntro.count : 0;
    const newCount = Math.min(Math.max(0, 5 - usedToday), Math.max(0, 8 - due.length));
    return [...due.slice(0, 10), ...fresh.slice(0, newCount)];
  }

  function nextReviewDue(state) {
    const dues = Object.values(state.reviews).map((r) => r.due).sort();
    return dues[0] || null;
  }

  function gradeReviewCard(state, cardId, grade) {
    const isNew = !state.reviews[cardId];
    if (isNew) {
      const today = todayStr();
      if (!state.newIntro || state.newIntro.date !== today) state.newIntro = { date: today, count: 0 };
      state.newIntro.count++;
    }
    const rec = state.reviews[cardId] || { ease: 2.5, interval: 0, reps: 0 };
    if (grade === "again") {
      rec.reps = 0; rec.interval = 1; rec.ease = Math.max(1.3, rec.ease - 0.2);
    } else if (grade === "hard") {
      rec.interval = Math.max(1, Math.round(rec.interval * 1.2)); rec.ease = Math.max(1.3, rec.ease - 0.15); rec.reps++;
    } else if (grade === "good") {
      rec.interval = rec.reps === 0 ? 1 : rec.reps === 1 ? 3 : Math.round(rec.interval * rec.ease); rec.reps++;
    } else {
      rec.interval = rec.reps === 0 ? 2 : Math.round(Math.max(rec.interval, 1) * rec.ease * 1.3); rec.ease += 0.1; rec.reps++;
    }
    const d = new Date();
    d.setDate(d.getDate() + rec.interval);
    rec.due = todayStr(d);
    state.reviews[cardId] = rec;
    state.reviewCount = (state.reviewCount || 0) + 1;
    saveState(state);
    return grade === "again" ? 0 : grade === "hard" ? 1 : 2;
  }

  function finishReviewSession(state, sessionXp, count) {
    if (count === 0) return null;
    return applyAttempt(state, [], {
      date: todayStr(), exerciseId: "review", type: "review", score: 100, xp: sessionXp, hintsUsed: 0, answer: "",
    });
  }

  function skillTracks(state) {
    return MTC_SKILL_TRACKS.map((t) => {
      const xp = state.trackXp[t.id] || 0;
      return { id: t.id, name: t.name, xp, level: 1 + Math.floor(xp / 120), pct: Math.round(((xp % 120) / 120) * 100) };
    });
  }

  // How far pre-reveal confidence sits from the rubric score, on average —
  // the everyday-exercise counterpart of the calibration trainer.
  function exerciseConfidenceGap(state) {
    const entries = state.history.filter((h) => typeof h.confidence === "number");
    if (!entries.length) return null;
    const gap = entries.reduce((t, h) => t + Math.abs(h.confidence - h.score), 0) / entries.length;
    return { gap: Math.round(gap), n: entries.length };
  }

  function lastSimilarAnswer(state, exerciseId) {
    const ex = getExercise(exerciseId);
    if (!ex) return null;
    for (let i = state.history.length - 1; i >= 0; i--) {
      const h = state.history[i];
      if (h.exerciseId === exerciseId || !h.answer) continue;
      const other = getExercise(h.exerciseId);
      if (other && other.frameworks.some((f) => ex.frameworks.includes(f))) {
        return { record: h, title: other.title };
      }
    }
    return null;
  }

  /* ---------- Workbench: apply a tool to your own problem ---------- */

  function submitWorkbench(state, toolId, text) {
    const tool = MTC_TOOLBOX.find((t) => t.id === toolId);
    if (!tool) throw new Error("Unknown tool: " + toolId);
    return applyAttempt(state, [], {
      date: todayStr(),
      exerciseId: "tool:" + toolId,
      type: "workbench",
      score: 100,
      xp: 10,
      hintsUsed: 0,
      answer: trimAnswer(text),
    });
  }

  // Weekly confidence-vs-accuracy gap from binary calibration answers.
  function calibrationTrend(state) {
    const byWeek = {};
    for (const a of state.calibration.answers) {
      if (a.kind !== "binary") continue;
      const wk = isoWeekKey(new Date(a.date + "T00:00:00Z"));
      (byWeek[wk] = byWeek[wk] || []).push(a);
    }
    return Object.keys(byWeek).sort().slice(-8).map((wk) => {
      const arr = byWeek[wk];
      const acc = (arr.filter((a) => a.correct).length / arr.length) * 100;
      const conf = arr.reduce((t, a) => t + a.confidence, 0) / arr.length;
      return { week: wk, gap: Math.round(Math.abs(acc - conf)), n: arr.length };
    });
  }

  /* ---------- Weekly report ---------- */

  function weeklyReport(state) {
    const agg = (week) => {
      const entries = state.history.filter((h) => isoWeekKey(new Date(h.date + "T00:00:00Z")) === week);
      const scored = entries.filter((h) => MTC_QUEST_TYPES.includes(h.type) || h.type === "boss");
      return {
        xp: entries.reduce((t, h) => t + h.xp, 0),
        exercises: entries.filter((h) => MTC_QUEST_TYPES.includes(h.type)).length,
        avgScore: scored.length ? Math.round(scored.reduce((t, h) => t + h.score, 0) / scored.length) : null,
        calibrationSessions: entries.filter((h) => h.type === "calibration").length,
        reviewSessions: entries.filter((h) => h.type === "review").length,
        bosses: entries.filter((h) => h.type === "boss").length,
      };
    };
    const focus = weaknessProfile(state).find((w) => w.attempts > 0) || null;
    return {
      week: isoWeekKey(),
      current: agg(isoWeekKey()),
      previous: agg(isoWeekKey(new Date(Date.now() - 7 * 86400000))),
      focus,
    };
  }

  function saveDecision(state, fields) {
    const title = trimAnswer(fields.title).slice(0, 160);
    if (!title) throw new Error("A decision title is required");
    const reviewDate = dateKey(fields.reviewDate);
    if (!reviewDate) throw new Error("Choose a review date");
    const id = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.decisions.push({
      id, title, reviewDate, createdAt: todayStr(), reviewedAt: null, outcome: "",
      context: trimAnswer(fields.context), options: trimAnswer(fields.options), criteria: trimAnswer(fields.criteria),
      decision: trimAnswer(fields.decision), preMortem: trimAnswer(fields.preMortem), indicators: trimAnswer(fields.indicators),
    });
    saveState(state);
    return state.decisions[state.decisions.length - 1];
  }

  function reviewDecision(state, id, outcome) {
    const decision = state.decisions.find((entry) => entry.id === id);
    if (!decision) throw new Error("Decision not found");
    decision.outcome = trimAnswer(outcome);
    decision.reviewedAt = todayStr();
    saveState(state);
    return decision;
  }

  function dueDecisions(state) {
    const today = todayStr();
    return state.decisions.filter((decision) => !decision.reviewedAt && decision.reviewDate <= today);
  }

  function weeklyInsights(state) {
    const insights = [];
    const weak = weaknessProfile(state).find((item) => item.attempts > 0);
    if (weak) insights.push(`Practice ${weak.name}: your current average is ${Math.round(weak.avg)}% over ${weak.attempts} attempt${weak.attempts === 1 ? "" : "s"}.`);
    const confidence = exerciseConfidenceGap(state);
    if (confidence && confidence.n >= 3) insights.push(`Your pre-reveal confidence differs from rubric scores by ${confidence.gap}% on average. Use that gap to calibrate your certainty.`);
    const calibration = calibrationStats(state);
    if (calibration.binaryCount >= 5 && calibration.accuracy !== calibration.avgConfidence) {
      const direction = calibration.avgConfidence > calibration.accuracy ? "higher" : "lower";
      insights.push(`Your confidence is ${Math.abs(calibration.avgConfidence - calibration.accuracy)} points ${direction} than your accuracy.`);
    }
    const thisWeek = state.history.filter((entry) => isoWeekKey(new Date(entry.date + "T00:00:00")) === isoWeekKey());
    const activeDays = new Set(thisWeek.map((entry) => entry.date)).size;
    if (activeDays > 0) insights.push(`You practiced on ${activeDays} day${activeDays === 1 ? "" : "s"} this week. Consistency beats a perfect streak.`);
    return insights.slice(0, 3);
  }

  return {
    todayStr,
    deriveLevel,
    titleForLevel,
    loadState,
    saveState,
    weaknessProfile,
    getOrCreateDailyQuest,
    getExercise,
    estimateXp,
    rubricScore,
    lastRecordFor,
    exportStateJSON,
    importState,
    skillTracks,
    submitWorkbench,
    calibrationTrend,
    exerciseConfidenceGap,
    lastSimilarAnswer,
    pickCalibrationQuestions,
    gradeCalibration,
    calibrationStats,
    dueReviewCards,
    nextReviewDue,
    gradeReviewCard,
    finishReviewSession,
    weeklyReport,
    weeklyInsights,
    saveDecision,
    reviewDecision,
    dueDecisions,
    submitExercise,
    getCurrentBossBattle,
    getBossBattleDef,
    submitBossBattle,
  };
})();
