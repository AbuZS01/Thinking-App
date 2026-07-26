/* Master Thinking Coach — UI layer. Renders from MTC engine state into #app. */

let STATE = MTC.loadState();
let exUI = null; // {exerciseId, hintsRevealed, checked:Set, showAssessment}
let bossUI = null; // {battleId, hintsShown:Set, checked:Set, showResolution}
let pendingResult = null;
let calUI = null; // {queue, idx, responses, results}
let revUI = null; // {queue, idx, revealed, xp, count}
let toolboxFilter = "";
let frameworksFilter = "";
let journalFilter = "";

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let activeRec = null;

const OUTLINES = {
  warmup: "First instinct:\n\nAlternative explanations:\n- ",
  challenge: "First-order effect:\n\nSecond-order effects:\n- \n\nWhat would change my mind:\n",
  case: "What actually happened (mechanism):\n\nWhy it seemed rational at the time:\n\nGeneral lesson:\n",
  reflection: "The specific case:\n\nWhat it shows about my thinking:\n\nWhat I'd do differently:\n",
  creativity: "Ideas (no judging yet):\n1. \n2. \n3. \n\nBest one and why:\n",
  logic_puzzle: "Given facts:\n\nStep by step:\n\nAnswer:\n",
  decision: "Options:\n- \nCriteria:\n- \nDecision and why:\n\nWhat would change my mind:\n",
  bias: "The bias:\n\nHow it operates here:\n\nThe fix:\n",
  observation: "What it claims:\n\nWhat's missing:\n\nWhat I'd check:\n",
};

const BOSS_OUTLINE = "The system and its loops:\n\nOptions and trade-offs:\n\nMy decision:\n\nPre-mortem (two most likely failure modes):\n1. \n2. \n\nLeading indicators to watch:\n";

const CHANGE_MIND_TYPES = ["challenge", "case", "decision", "bias", "observation"];

const BOSS_FINAL_STAGE = {
  question: "Commit to a decision. Pre-mortem its two most likely failure modes, and name the leading indicators that would tell you within weeks that you chose wrong.",
  considerations: "A decision without a monitoring plan is a bet you'll never learn from. Good leading indicators are observable soon, not at the post-mortem. If you can't name a failure mode, you haven't red-teamed your own choice yet.",
};
const BOSS_MONITOR_RUBRIC = "I committed to ONE decision, wrote the two most likely ways it fails, and named early signs that would tell me I chose wrong";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function frameworkNames(ids) {
  return ids.map((f) => (MTC_FRAMEWORKS.find((fw) => fw.id === f) || {}).name).filter(Boolean).join(" &middot; ");
}

function route() {
  const h = location.hash || "#/dashboard";
  return h.slice(2) || "dashboard";
}

function navigate(path) {
  location.hash = "#/" + path;
}

function levelInfo() {
  const { level, xpIntoLevel, xpForNext } = MTC.deriveLevel(STATE.totalXp);
  return { level, xpIntoLevel, xpForNext, title: MTC.titleForLevel(level), pct: Math.min(100, Math.round((xpIntoLevel / xpForNext) * 100)) };
}

/* ---------- Layout ---------- */

function navBtn(key, label) {
  const r = route();
  const active = r === key || r.startsWith(key + "/") || (key === "quest" && r.startsWith("exercise/"));
  return `<a href="#/${key}" data-nav="${key}" ${active ? 'class="active" aria-current="page"' : ""}>${label}</a>`;
}

function navHTML() {
  const li = levelInfo();
  const dueCount = MTC.dueReviewCards(STATE).length;
  return `<div class="topnav">
    <a class="brand" href="#/dashboard"><span class="mark">&#9670;</span> Master Thinking Coach</a>
    <div class="navlinks">
      ${navBtn("dashboard", "Dashboard")}
      ${navBtn("quest", "Daily Quest")}
      ${navBtn("calibration", "Calibration")}
      ${navBtn("review", dueCount > 0 ? `Review (${dueCount})` : "Review")}
      ${navBtn("boss", "Boss Battle")}
      ${navBtn("journal", "Journal")}
      ${navBtn("toolbox", "Toolbox")}
      ${navBtn("frameworks", "Frameworks")}
      ${navBtn("achievements", "Achievements")}
    </div>
    <div class="status-chip">Lv <b>${li.level}</b> &middot; ${esc(li.title)} ${STATE.streak > 0 ? `&middot; &#128293;${STATE.streak}` : ""} ${STATE.graceShields > 0 ? `&middot; &#128737;&#65039;` : ""}</div>
  </div>`;
}

function footerHTML() {
  return `<footer class="foot">
    Progress is stored in this browser only.
    &middot; <button data-export-progress>Export progress</button>
    &middot; <button data-import-progress>Import progress</button>
    &middot; <button data-reset-progress>Erase all progress</button>
    <input type="file" id="import-file" accept=".json,application/json" style="display:none" />
  </footer>`;
}

/* ---------- Onboarding ---------- */

function onboardingHTML() {
  return `<div class="onboarding">
    <h1>Master Thinking Coach</h1>
    <p>Daily exercises that train sharper reasoning. Your progress stays on this device.</p>
    <form data-onboard-form>
      <input type="text" name="playerName" placeholder="Your name" maxlength="40" autofocus />
      <div class="field"><button class="btn" type="submit">Start</button></div>
    </form>
  </div>`;
}

/* ---------- Dashboard ---------- */

function dashboardHTML() {
  const li = levelInfo();
  const calStats = MTC.calibrationStats(STATE);
  const dueCount = MTC.dueReviewCards(STATE).length;
  const quest = MTC.getOrCreateDailyQuest(STATE);
  const battleState = MTC.getCurrentBossBattle(STATE);
  const battle = MTC.getBossBattleDef(battleState.battleId);
  const weak = MTC.weaknessProfile(STATE).filter((w) => w.attempts > 0).slice(0, 5);

  return `
  <div class="panel">
    <div class="level-hero">
      <div class="level-num">${li.level}<sup>lvl</sup></div>
      <div style="flex:1">
        <div class="subtle">Welcome back, ${esc(STATE.name)}</div>
        <h1>${esc(li.title)}</h1>
        <div class="subtle">${li.xpIntoLevel} / ${li.xpForNext} XP to next level</div>
        <div class="xp-bar"><div class="fill" style="width:${li.pct}%"></div></div>
        <div class="subtle" style="margin-top:8px">${STATE.graceShields > 0 ? "&#128737;&#65039; Grace day ready &mdash; one missed day won't break your streak" : "No grace day held &mdash; finish the &#9733; core trio to earn one"}</div>
      </div>
    </div>
  </div>

  <div class="grid">
    <a class="panel card" href="#/quest">
      <span class="tag">Today</span>
      <h2>Daily Quest</h2>
      <p class="subtle">${quest.completed.length} / ${quest.items.length} done</p>
      <span class="cta">Continue &rarr;</span>
    </a>
    <a class="panel card" href="#/boss">
      <span class="tag">This week</span>
      <h2>${battleState.completed ? "Boss Defeated" : "Boss Battle"}</h2>
      <p class="subtle">${battleState.completed ? "New battle next week." : esc(battle.name)}</p>
      <span class="cta">${battleState.completed ? "Review" : "Enter"} &rarr;</span>
    </a>
    <a class="panel card" href="#/calibration">
      <span class="tag">Auto-graded</span>
      <h2>Calibration</h2>
      <p class="subtle">${calStats.total ? `${calStats.total} answered &middot; ${calStats.accuracy}% right at ${calStats.avgConfidence}% confidence` : "How well do you know what you know?"}</p>
      <span class="cta">Train &rarr;</span>
    </a>
    <a class="panel card" href="#/review">
      <span class="tag">Memory</span>
      <h2>Review</h2>
      <p class="subtle">${dueCount > 0 ? `${dueCount} card${dueCount === 1 ? "" : "s"} ready` : "All caught up"}</p>
      <span class="cta">Review &rarr;</span>
    </a>
    <a class="panel card" href="#/achievements">
      <span class="tag">Progress</span>
      <h2>Achievements</h2>
      <p class="subtle">${STATE.achievements.length} / ${MTC_ACHIEVEMENTS.length} unlocked</p>
      <span class="cta">View &rarr;</span>
    </a>
  </div>

  <div class="panel">
    <h2>Weakness Radar</h2>
    ${weak.length === 0
      ? `<p class="subtle">Complete a few exercises to reveal your weakest frameworks.</p>`
      : weak.map((w) => `<div class="weak-row"><span class="name">${esc(w.name)}</span><div class="weak-meter"><div class="fill" style="width:${Math.round(w.avg)}%"></div></div><span class="subtle">${Math.round(w.avg)}%</span></div>`).join("")}
  </div>

  <div class="panel">
    <h2>Skill Tracks</h2>
    ${MTC.skillTracks(STATE).map((t) => `<div class="weak-row"><span class="name">${esc(t.name)}</span><div class="weak-meter"><div class="fill" style="width:${t.pct}%"></div></div><span class="subtle" style="width:52px">Lv ${t.level}</span></div>`).join("")}
  </div>

  <div class="grid tight">
    <a class="panel card" href="#/journal"><h2>Journal</h2><p class="subtle">${STATE.history.length} answer${STATE.history.length === 1 ? "" : "s"}</p><span class="cta">Open &rarr;</span></a>
    <a class="panel card" href="#/toolbox"><h2>Toolbox</h2><p class="subtle">${MTC_TOOLBOX.length} thinking tools</p><span class="cta">Open &rarr;</span></a>
    <a class="panel card" href="#/frameworks"><h2>Frameworks</h2><p class="subtle">${MTC_FRAMEWORKS.length} thinking styles</p><span class="cta">Open &rarr;</span></a>
    <a class="panel card" href="#/report"><h2>Weekly Report</h2><p class="subtle">This week vs last</p><span class="cta">Open &rarr;</span></a>
  </div>`;
}

/* ---------- Daily Quest ---------- */

const TYPE_LABELS = {
  warmup: "Warm-up", challenge: "Challenge", case: "Real-World Case", reflection: "Reflection",
  creativity: "Creativity", logic_puzzle: "Logic Puzzle", decision: "Decision Scenario",
  bias: "Bias Detection", observation: "Observation", fluency: "Fluency", boss: "Boss Battle",
  calibration: "Calibration", review: "Review",
};

function questHTML() {
  const quest = MTC.getOrCreateDailyQuest(STATE);
  const hasCore = quest.items.some((i) => i.core);
  return `<div class="panel">
    <h1>Daily Quest</h1>
    <p class="subtle">One of each type &middot; 20&ndash;30 min &middot; ${quest.completed.length}/${quest.items.length} done.${hasCore ? ` Short on time? Do the <span style="color:var(--accent)">&#9733; core</span> three.` : ""}</p>
  </div>
  <div class="grid">
    ${quest.items.map((item) => {
      const ex = MTC.getExercise(item.exerciseId);
      const done = quest.completed.includes(item.exerciseId);
      return `<a class="card ${done ? "done" : ""}" href="#/exercise/${ex.id}">
        <span class="tag">${TYPE_LABELS[item.type]}</span>${item.core ? `<span class="tag core">&#9733; Core</span>` : ""}
        <h2>${esc(ex.title)}</h2>
        <p class="subtle">${frameworkNames(ex.frameworks)}</p>
        <span class="cta">${done ? "Review" : "Start"} &rarr;</span>
      </a>`;
    }).join("")}
  </div>`;
}

/* ---------- Exercise player ---------- */

function exerciseHTML(id) {
  const ex = MTC.getExercise(id);
  if (!ex) return `<div class="panel">Exercise not found. <a class="btn" href="#/quest">Daily Quest</a></div>`;
  const quest = MTC.getOrCreateDailyQuest(STATE);
  const alreadyDone = quest.completed.includes(id);
  const fwNames = frameworkNames(ex.frameworks);

  const header = `<div class="panel">
    <a class="crumb" href="#/quest">&larr; Daily Quest</a>
    <div><span class="pill">${TYPE_LABELS[ex.type]}</span><span class="pill">${fwNames}</span></div>
    <h1>${esc(ex.title)}</h1>
    <p>${esc(ex.prompt)}</p>
  </div>`;

  if (alreadyDone) {
    const record = MTC.lastRecordFor(STATE, id);
    return header + `<div class="panel">
      <p class="subtle">Completed today${record ? ` &mdash; self-assessed ${record.score}%, +${record.xp} XP` : ""}.</p>
      ${record && record.answer ? `<div class="model-answer"><div class="lbl">Your Answer</div><div class="journal-answer">${esc(record.answer)}</div></div>` : ""}
      <div class="model-answer"><div class="lbl">Model Answer</div>${esc(ex.modelAnswer)}</div>
      <div class="model-answer"><div class="lbl">Expert Note</div>${esc(ex.expertNote)}</div>
      <div class="field"><a class="btn" href="#/quest">Back to Daily Quest</a></div>
    </div>`;
  }

  if (!exUI || exUI.exerciseId !== id) {
    exUI = { exerciseId: id, hintsRevealed: 0, checked: new Set(), showAssessment: false, draft: "", confidence: 70 };
  }

  const hintsHTML = ex.hints.slice(0, exUI.hintsRevealed).map((h) => `<div class="hint-box">${esc(h)}</div>`).join("");
  const hintBtn = exUI.hintsRevealed < ex.hints.length
    ? `<button class="btn ghost" data-hint>Show a hint (&minus;20% XP &middot; ${exUI.hintsRevealed}/${ex.hints.length} used)</button>`
    : `<p class="subtle">All hints revealed.</p>`;

  let assessmentHTML = "";
  if (!exUI.showAssessment) {
    const ready = exUI.draft.trim().length >= 20;
    assessmentHTML = `<div class="field">
      <label class="subtle" for="ex-confidence">Before revealing &mdash; how confident are you that your answer covers the key points? <b id="ex-conf-val">${exUI.confidence}</b>%</label>
      <input type="range" id="ex-confidence" min="0" max="100" value="${exUI.confidence}" />
    </div>
    <div class="field">
      <button class="btn" data-show-assessment ${ready ? "" : "disabled"}>Done &mdash; reveal model answer</button>
      <p class="subtle" data-gate-note ${ready ? 'style="display:none"' : ""}>Write your attempt above first &mdash; it unlocks the model answer.</p>
    </div>`;
  } else {
    const total = ex.rubric.length;
    const checkedCount = exUI.checked.size;
    const scorePreview = MTC.rubricScore(checkedCount, total);
    assessmentHTML = `
      <div class="panel">
        <h2>Self-Assessment</h2>
        <p class="subtle">Tick only what you truly did &mdash; if unsure, leave it unchecked. Strict grading is the training.</p>
        ${ex.rubric.map((r, i) => `<label class="rubric-item"><input type="checkbox" data-rubric-idx="${i}" ${exUI.checked.has(i) ? "checked" : ""}/> <span>${esc(r)}</span></label>`).join("")}
        <div class="model-answer"><div class="lbl">Model Answer</div>${esc(ex.modelAnswer)}</div>
        <div class="model-answer"><div class="lbl">Expert Note</div>${esc(ex.expertNote)}</div>
        <p style="margin-top:12px">Self-assessed score: <b>${scorePreview}%</b> (${checkedCount}/${total} criteria) &middot; est. XP: <b>${MTC.estimateXp(ex.xpBase, scorePreview, exUI.hintsRevealed)}</b></p>
        <button class="btn" data-submit-exercise>Submit</button>
      </div>`;
  }

  const similar = MTC.lastSimilarAnswer(STATE, id);
  const tools = `<div class="field draft-tools">
      ${OUTLINES[ex.type] ? `<button class="btn ghost" data-outline="${ex.type}">Insert outline</button>` : ""}
      ${SpeechRec ? `<button class="btn ghost" data-mic="ex-draft">&#127908; Dictate</button>` : ""}
    </div>`;
  return header + `<div class="panel">
    <textarea id="ex-draft" placeholder="Write your answer &mdash; saved to your journal on submit.">${esc(exUI.draft)}</textarea>
    ${CHANGE_MIND_TYPES.includes(ex.type) ? `<p class="subtle" style="margin-top:6px">End with: what evidence would change your mind?</p>` : ""}
    ${tools}
    <div class="field">${hintBtn}</div>
    ${hintsHTML}
  </div>
  ${similar ? `<details class="panel past-answer"><summary class="subtle">Your last answer on a similar problem &mdash; ${esc(similar.title)} (${esc(similar.record.date)})</summary><div class="journal-answer">${esc(similar.record.answer)}</div></details>` : ""}
  ${assessmentHTML}`;
}

/* ---------- Boss Battle ---------- */

function bossHTML() {
  const battleState = MTC.getCurrentBossBattle(STATE);
  const battle = MTC.getBossBattleDef(battleState.battleId);

  if (battleState.completed) {
    const record = MTC.lastRecordFor(STATE, battle.id, "boss");
    return `<div class="panel">
      <span class="pill">${esc(battle.domain)}</span>
      <h1>${esc(battle.name)}</h1>
      <p>${esc(battle.briefing)}</p>
      ${record && record.answer ? `<div class="model-answer"><div class="lbl">Your Answer</div><div class="journal-answer">${esc(record.answer)}</div></div>` : ""}
      <div class="model-answer"><div class="lbl">Expert Framing</div>${esc(battle.noPerfectAnswerNote)}</div>
      <p class="subtle" style="margin-top:12px">Boss defeated this week. A new battle unlocks next week.</p>
    </div>`;
  }

  if (!bossUI || bossUI.battleId !== battle.id) {
    bossUI = { battleId: battle.id, consShown: {}, checked: new Set(), showResolution: false, draft: "" };
  }
  const rubric = [...battle.rubric, BOSS_MONITOR_RUBRIC];

  const allStages = [...battle.stages, BOSS_FINAL_STAGE];
  const stagesHTML = allStages.map((s, i) => {
    const cues = s.considerations.split(/(?<=\.)\s+/);
    const shown = bossUI.consShown[i] || 0;
    const isFinal = i === allStages.length - 1;
    return `
    <div class="stage">
      <h2>${isFinal ? "Final Stage &mdash; Decide &amp; Monitor" : `Stage ${i + 1}`}</h2>
      <p>${esc(s.question)}</p>
      ${cues.slice(0, shown).map((c) => `<div class="hint-box">${esc(c)}</div>`).join("")}
      ${shown < cues.length ? `<button class="btn ghost" data-boss-hint="${i}">Show a consideration (${shown}/${cues.length})</button>` : ""}
    </div>`;
  }).join("");

  let resolutionHTML = "";
  if (!bossUI.showResolution) {
    const ready = bossUI.draft.trim().length >= 20;
    resolutionHTML = `<div class="field">
      <button class="btn" data-boss-show-resolution ${ready ? "" : "disabled"}>Done &mdash; reveal expert framing</button>
      <p class="subtle" data-gate-note ${ready ? 'style="display:none"' : ""}>Work through the stages above first &mdash; it unlocks the framing.</p>
    </div>`;
  } else {
    const total = rubric.length;
    const checkedCount = bossUI.checked.size;
    const scorePreview = MTC.rubricScore(checkedCount, total);
    resolutionHTML = `<div class="panel">
      <h2>Self-Assessment</h2>
      <p class="subtle">Tick only what you truly did &mdash; if unsure, leave it unchecked.</p>
      ${rubric.map((r, i) => `<label class="rubric-item"><input type="checkbox" data-boss-rubric-idx="${i}" ${bossUI.checked.has(i) ? "checked" : ""}/> <span>${esc(r)}</span></label>`).join("")}
      <div class="model-answer"><div class="lbl">Expert Framing (no perfect answer)</div>${esc(battle.noPerfectAnswerNote)}</div>
      <p style="margin-top:12px">Self-assessed score: <b>${scorePreview}%</b> &middot; est. XP: <b>${MTC.estimateXp(battle.xpBase, scorePreview, 0)}</b></p>
      <button class="btn" data-submit-boss="${battle.id}">Submit</button>
    </div>`;
  }

  return `<div class="panel">
    <span class="pill">${esc(battle.domain)}</span><span class="pill">Week ${esc(battleState.week)}</span>
    <h1>${esc(battle.name)}</h1>
    <p>${esc(battle.briefing)}</p>
    ${stagesHTML}
  </div>
  <div class="panel">
    <textarea id="boss-draft" placeholder="Work through your reasoning &mdash; saved to your journal on submit.">${esc(bossUI.draft)}</textarea>
    <div class="field draft-tools">
      <button class="btn ghost" data-outline="boss">Insert outline</button>
      ${SpeechRec ? `<button class="btn ghost" data-mic="boss-draft">&#127908; Dictate</button>` : ""}
    </div>
    ${resolutionHTML}
  </div>`;
}

/* ---------- Toolbox ---------- */

function toolboxResultsHTML() {
  const q = toolboxFilter.toLowerCase();
  const items = MTC_TOOLBOX.filter((t) => !q || t.name.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q));
  return items.map((t) => `<div class="panel"><h2>${esc(t.name)}</h2><p>${esc(t.summary)}</p><p class="subtle"><b>When:</b> ${esc(t.when)}</p></div>`).join("") || `<p class="subtle">No tools match.</p>`;
}

function toolboxHTML() {
  return `<div class="panel">
    <h1>Toolbox</h1>
    <input type="text" id="toolbox-search" placeholder="Search tools..." value="${esc(toolboxFilter)}" />
  </div>
  <div class="grid" id="toolbox-results">${toolboxResultsHTML()}</div>`;
}

/* ---------- Framework encyclopedia ---------- */

function frameworksResultsHTML() {
  const q = frameworksFilter.toLowerCase();
  const items = MTC_FRAMEWORKS.filter((f) => !q || f.name.toLowerCase().includes(q) || f.core.toLowerCase().includes(q));
  return items.map((f) => `<a class="card panel" href="#/frameworks/${f.id}"><h2>${esc(f.name)}</h2><p class="subtle">${esc(f.core)}</p><span class="cta">Read &rarr;</span></a>`).join("") || `<p class="subtle">No frameworks match.</p>`;
}

function frameworksListHTML() {
  return `<div class="panel">
    <h1>Frameworks</h1>
    <input type="text" id="frameworks-search" placeholder="Search frameworks..." value="${esc(frameworksFilter)}" />
  </div>
  <div class="grid" id="frameworks-results">${frameworksResultsHTML()}</div>`;
}

function frameworkDetailHTML(id) {
  const f = MTC_FRAMEWORKS.find((x) => x.id === id);
  if (!f) return `<div class="panel">Not found. <a class="btn" href="#/frameworks">Frameworks</a></div>`;
  const row = (label, val) => `<div class="panel"><h2>${label}</h2><p>${esc(val)}</p></div>`;
  return `<div class="panel">
      <a class="crumb" href="#/frameworks">&larr; Frameworks</a>
      <h1>${esc(f.name)}</h1>
      <p class="subtle">${esc(f.core)}</p>
    </div>
    ${row("What problem does this solve?", f.problem)}
    ${row("Why do smart people get this wrong?", f.whyWrong)}
    ${row("Mistakes to avoid", f.avoid)}
    ${row("When is this dangerous?", f.danger)}
    ${row("Famous example", f.example)}
    ${row("How an expert uses it", f.expertUse)}`;
}

/* ---------- Achievements ---------- */

function achievementsHTML() {
  return `<div class="panel">
    <h1>Achievements</h1>
    <p class="subtle">${STATE.achievements.length} / ${MTC_ACHIEVEMENTS.length} unlocked</p>
  </div>
  <div class="grid tight">
    ${MTC_ACHIEVEMENTS.map((a) => {
      const unlocked = STATE.achievements.includes(a.id);
      return `<div class="panel ach-card ${unlocked ? "" : "locked"}">
        <h2>${unlocked ? "&#127942; " : "&#128274; "}${esc(a.name)}</h2>
        <p class="subtle">${esc(a.desc)}</p>
        <p class="xp">+${a.xp} XP</p>
      </div>`;
    }).join("")}
  </div>`;
}

/* ---------- Calibration ---------- */

function calibrationLandingHTML() {
  const st = MTC.calibrationStats(STATE);
  const statsHTML = st.total === 0
    ? `<p class="subtle">Nothing answered yet. Your accuracy-vs-confidence curve appears here.</p>`
    : `<p class="subtle">${st.binaryCount} statements &middot; ${st.accuracy}% correct at ${st.avgConfidence}% average confidence${st.intervalCount ? ` &middot; ranges: ${st.intervalHitRate}% hit (target 90%)` : ""}</p>
       ${st.buckets.filter((b) => b.n > 0).map((b) => `
         <div class="weak-row"><span class="name">Said ${b.label}</span><div class="weak-meter"><div class="fill" style="width:${b.actual}%"></div></div><span class="subtle">right ${b.actual}% (${b.n})</span></div>`).join("")}`;
  const exGap = MTC.exerciseConfidenceGap(STATE);
  return `<div class="panel">
    <h1>Calibration</h1>
    <p class="subtle">Auto-graded &mdash; no honor system. Honest confidence earns the most XP; overconfidence is penalized.</p>
    ${exGap ? `<p class="subtle">Daily exercises: your pre-reveal confidence differs from your rubric score by <b>${exGap.gap}</b> points on average (${exGap.n} exercise${exGap.n === 1 ? "" : "s"}).</p>` : ""}
  </div>
  <div class="panel">
    <h2>Your calibration</h2>
    ${statsHTML}
  </div>
  <div class="panel">
    <button class="btn" data-cal-start>Start a session &middot; 7 questions</button>
  </div>`;
}

function calibrationHTML() {
  if (!calUI) return calibrationLandingHTML();

  if (calUI.results) {
    return `<div class="panel"><h1>Session results</h1></div>` + calUI.results.map((g) => {
      if (g.kind === "binary") {
        return `<div class="panel">
          <p>${esc(g.statement)}</p>
          <p class="subtle">You said <b>${g.answer ? "true" : "false"}</b> at ${g.confidence}% &middot; ${g.correct ? "correct" : `wrong &mdash; it's ${g.truth ? "true" : "false"}`} &middot; +${g.points} XP</p>
          <div class="model-answer"><div class="lbl">Why</div>${esc(g.note)}</div>
        </div>`;
      }
      return `<div class="panel">
        <p>${esc(g.prompt)} (${esc(g.unit)})</p>
        <p class="subtle">Your range: ${g.low}&ndash;${g.high} &middot; actual: <b>${g.truth}</b> &middot; ${g.hit ? "hit" : "miss"} &middot; +${g.points} XP</p>
      </div>`;
    }).join("") + `<div class="panel"><button class="btn" data-cal-done>Done</button></div>`;
  }

  const q = calUI.queue[calUI.idx];
  const progress = `<p class="subtle">Question ${calUI.idx + 1} of ${calUI.queue.length}</p>`;
  if (q.kind === "binary") {
    return `<div class="panel">
      <button class="crumb" data-cal-quit>&larr; Calibration</button>
      ${progress}
      <h1>True or false?</h1>
      <p>${esc(q.statement)}</p>
      <label class="rubric-item"><input type="radio" name="cal-answer" value="true" /> <span>True</span></label>
      <label class="rubric-item"><input type="radio" name="cal-answer" value="false" /> <span>False</span></label>
      <div class="field">
        <label class="subtle" for="cal-conf">How confident? <b id="cal-conf-val">70</b>%</label>
        <input type="range" id="cal-conf" min="50" max="99" value="70" />
      </div>
      <div class="field"><button class="btn" data-cal-next disabled>Next</button></div>
    </div>`;
  }
  return `<div class="panel">
    <button class="crumb" data-cal-quit>&larr; Calibration</button>
    ${progress}
    <h1>Estimate a range</h1>
    <p>${esc(q.prompt)}, in <b>${esc(q.unit)}</b>. Give a range you're 90% sure contains the answer &mdash; too narrow and you'll miss, too wide and you're not saying much.</p>
    <div class="field"><input type="number" id="cal-low" placeholder="Low" step="any" /></div>
    <div class="field"><input type="number" id="cal-high" placeholder="High" step="any" /></div>
    <div class="field"><button class="btn" data-cal-next disabled>Next</button></div>
  </div>`;
}

/* ---------- Spaced review ---------- */

function reviewHTML() {
  if (!revUI) {
    const due = MTC.dueReviewCards(STATE);
    const next = MTC.nextReviewDue(STATE);
    return `<div class="panel">
      <h1>Review</h1>
      <p class="subtle">Spaced repetition for the frameworks and tools. Cards you find hard come back sooner.</p>
    </div>
    <div class="panel">
      ${due.length === 0
        ? `<p class="subtle">All caught up.${next ? ` Next review due ${esc(next)}.` : ""}</p>`
        : `<p class="subtle">${due.length} card${due.length === 1 ? "" : "s"} ready.</p>
           <div class="field"><button class="btn" data-rev-start>Start reviewing</button></div>`}
    </div>`;
  }
  const card = revUI.queue[revUI.idx];
  return `<div class="panel">
    <button class="crumb" data-rev-quit>&larr; Review</button>
    <p class="subtle">Card ${revUI.idx + 1} of ${revUI.queue.length}</p>
    <div><span class="pill">${esc(card.kind)}</span></div>
    <h1>${esc(card.front)}</h1>
    <p style="font-style:italic; color:var(--text-dim)">${esc(card.hint)}</p>
    ${revUI.revealed
      ? `<div class="model-answer"><div class="lbl">Answer</div>${esc(card.back)}</div>
         <div class="field rev-grades">
           <button class="btn secondary" data-rev-grade="again">Again</button>
           <button class="btn secondary" data-rev-grade="hard">Hard</button>
           <button class="btn" data-rev-grade="good">Good</button>
           <button class="btn" data-rev-grade="easy">Easy</button>
         </div>`
      : `<div class="field"><button class="btn" data-rev-reveal>Show answer</button></div>`}
  </div>`;
}

/* ---------- Weekly report ---------- */

function reportHTML() {
  const r = MTC.weeklyReport(STATE);
  const row = (label, cur, prev) => `<div class="weak-row"><span class="name">${label}</span><span><b>${cur}</b></span><span class="subtle">last week: ${prev}</span></div>`;
  return `<div class="panel">
    <a class="crumb" href="#/dashboard">&larr; Dashboard</a>
    <h1>Weekly Report</h1>
    <p class="subtle">Week ${esc(r.week)}</p>
  </div>
  <div class="panel">
    ${row("XP earned", r.current.xp, r.previous.xp)}
    ${row("Exercises", r.current.exercises, r.previous.exercises)}
    ${row("Avg self-score", r.current.avgScore === null ? "&mdash;" : r.current.avgScore + "%", r.previous.avgScore === null ? "&mdash;" : r.previous.avgScore + "%")}
    ${row("Calibration sessions", r.current.calibrationSessions, r.previous.calibrationSessions)}
    ${row("Review sessions", r.current.reviewSessions, r.previous.reviewSessions)}
    ${row("Boss battles", r.current.bosses, r.previous.bosses)}
  </div>
  ${r.focus ? `<div class="panel"><h2>Suggested focus</h2><p><i>${esc(r.focus.name)}</i> is your weakest framework &mdash; ${Math.round(r.focus.avg)}% average over ${r.focus.attempts} attempt${r.focus.attempts === 1 ? "" : "s"}. Daily quests will favor it until it improves.</p>
  <p><b>Field assignment:</b> apply ${esc(r.focus.name)} to one real decision this week, and write what happened in that exercise's answer box when it next appears.</p></div>` : ""}`;
}

/* ---------- Journal ---------- */

function journalResultsHTML() {
  const q = journalFilter.toLowerCase();
  const entries = STATE.history
    .filter((h) => h.type !== "review" && h.type !== "calibration")
    .filter((h) => {
      if (!q) return true;
      const isBoss = h.type === "boss";
      const def = isBoss ? MTC.getBossBattleDef(h.exerciseId) : MTC.getExercise(h.exerciseId);
      const title = def ? (isBoss ? def.name : def.title) : h.exerciseId;
      return (title + " " + (h.answer || "") + " " + h.type).toLowerCase().includes(q);
    })
    .slice(-100)
    .reverse();
  if (entries.length === 0) {
    return `<div class="panel"><p class="subtle">${journalFilter ? "No entries match." : "Complete an exercise and your answer will appear here."}</p></div>`;
  }
  return entries.map((h) => {
    const isBoss = h.type === "boss";
    const def = isBoss ? MTC.getBossBattleDef(h.exerciseId) : MTC.getExercise(h.exerciseId);
    const title = def ? (isBoss ? def.name : def.title) : h.exerciseId;
    return `<div class="panel">
      <span class="pill">${TYPE_LABELS[h.type] || esc(h.type)}</span><span class="pill">${esc(h.date)}</span>
      <h2>${esc(title)}</h2>
      <p class="subtle">Self-assessed ${h.score}% &middot; +${h.xp} XP${h.hintsUsed ? ` &middot; ${h.hintsUsed} hint${h.hintsUsed === 1 ? "" : "s"} used` : ""}</p>
      ${h.answer ? `<div class="journal-answer">${esc(h.answer)}</div>` : `<p class="subtle">(no written answer was saved with this entry)</p>`}
    </div>`;
  }).join("");
}

function journalHTML() {
  return `<div class="panel">
    <h1>Journal</h1>
    <input type="text" id="journal-search" placeholder="Search your answers..." value="${esc(journalFilter)}" />
  </div>
  <div id="journal-results">${journalResultsHTML()}</div>`;
}

/* ---------- Result toast ---------- */

function resultToastHTML(result) {
  return `<div class="toast-overlay">
    <div class="toast-card">
      <div class="subtle">Exercise complete</div>
      <div class="xp-gain">+${result.xpAwarded} XP</div>
      ${result.leveledUp ? `<p>&#127881; Level up! You're now <b>Level ${result.newLevel}</b> &mdash; ${esc(MTC.titleForLevel(result.newLevel))}</p>` : ""}
      ${result.missed && result.missed.length ? `<div class="unlock" style="text-align:left"><b>Focus next time:</b>${result.missed.map((m) => `<div>&middot; ${esc(m)}</div>`).join("")}</div>` : ""}
      ${result.achievementsUnlocked.length ? result.achievementsUnlocked.map((a) => `<div class="unlock">&#127942; Achievement unlocked: <b>${esc(a.name)}</b> (+${a.xp} XP)</div>`).join("") : ""}
      <div class="field"><button class="btn" data-dismiss-result>Continue</button></div>
    </div>
  </div>`;
}

/* ---------- Main render ---------- */

function render() {
  const app = document.getElementById("app");
  if (!STATE.name) {
    app.innerHTML = onboardingHTML();
    return;
  }
  const r = route();
  let body;
  if (r === "dashboard") body = dashboardHTML();
  else if (r === "quest") body = questHTML();
  else if (r.startsWith("exercise/")) body = exerciseHTML(r.split("/")[1]);
  else if (r === "boss") body = bossHTML();
  else if (r === "calibration") body = calibrationHTML();
  else if (r === "review") body = reviewHTML();
  else if (r === "report") body = reportHTML();
  else if (r === "journal") body = journalHTML();
  else if (r === "toolbox") body = toolboxHTML();
  else if (r === "frameworks") body = frameworksListHTML();
  else if (r.startsWith("frameworks/")) body = frameworkDetailHTML(r.split("/")[1]);
  else if (r === "achievements") body = achievementsHTML();
  else body = dashboardHTML();

  app.innerHTML = navHTML() + body + footerHTML();
  if (pendingResult) app.insertAdjacentHTML("beforeend", resultToastHTML(pendingResult));
}

/* ---------- Events ---------- */

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-hint]")) {
    const ex = MTC.getExercise(exUI.exerciseId);
    exUI.hintsRevealed = Math.min(ex.hints.length, exUI.hintsRevealed + 1);
    render();
    return;
  }

  if (e.target.closest("[data-show-assessment]")) { exUI.showAssessment = true; render(); return; }

  if (e.target.closest("[data-submit-exercise]")) {
    const ex = MTC.getExercise(exUI.exerciseId);
    const score = MTC.rubricScore(exUI.checked.size, ex.rubric.length);
    const result = MTC.submitExercise(STATE, exUI.exerciseId, score, exUI.hintsRevealed, exUI.draft, exUI.confidence);
    result.missed = ex.rubric.filter((r, i) => !exUI.checked.has(i)).slice(0, 3);
    pendingResult = result;
    exUI = null;
    render();
    return;
  }

  if (e.target.closest("[data-boss-hint]")) {
    const idx = Number(e.target.closest("[data-boss-hint]").dataset.bossHint);
    bossUI.consShown[idx] = (bossUI.consShown[idx] || 0) + 1;
    render();
    return;
  }

  if (e.target.closest("[data-boss-show-resolution]")) { bossUI.showResolution = true; render(); return; }

  const submitBoss = e.target.closest("[data-submit-boss]");
  if (submitBoss) {
    const battleId = submitBoss.dataset.submitBoss;
    const rubric = [...MTC.getBossBattleDef(battleId).rubric, BOSS_MONITOR_RUBRIC];
    const score = MTC.rubricScore(bossUI.checked.size, rubric.length);
    const result = MTC.submitBossBattle(STATE, battleId, score, bossUI.draft);
    pendingResult = result;
    bossUI = null;
    render();
    return;
  }

  if (e.target.closest("[data-dismiss-result]")) {
    pendingResult = null;
    const cur = route();
    const target = cur.startsWith("exercise/") ? "quest" : cur;
    if (target !== cur) navigate(target); else render();
    return;
  }

  if (e.target.closest("[data-cal-start]")) {
    const qs = MTC.pickCalibrationQuestions(STATE);
    calUI = {
      queue: [...qs.binary.map((q) => ({ ...q, kind: "binary" })), ...qs.intervals.map((q) => ({ ...q, kind: "interval" }))],
      idx: 0, responses: [], results: null,
    };
    render();
    return;
  }

  if (e.target.closest("[data-cal-next]")) {
    const q = calUI.queue[calUI.idx];
    if (q.kind === "binary") {
      const picked = document.querySelector('input[name="cal-answer"]:checked');
      if (!picked) return;
      calUI.responses.push({ id: q.id, kind: "binary", answer: picked.value === "true", confidence: Number(document.getElementById("cal-conf").value) });
    } else {
      calUI.responses.push({ id: q.id, kind: "interval", low: parseFloat(document.getElementById("cal-low").value), high: parseFloat(document.getElementById("cal-high").value) });
    }
    calUI.idx++;
    if (calUI.idx >= calUI.queue.length) {
      const result = MTC.gradeCalibration(STATE, calUI.responses);
      calUI.results = result.graded;
      pendingResult = result;
    }
    render();
    return;
  }

  if (e.target.closest("[data-cal-done]") || e.target.closest("[data-cal-quit]")) {
    calUI = null;
    render();
    return;
  }

  if (e.target.closest("[data-rev-start]")) {
    revUI = { queue: MTC.dueReviewCards(STATE), idx: 0, revealed: false, xp: 0, count: 0 };
    render();
    return;
  }

  if (e.target.closest("[data-rev-reveal]")) {
    revUI.revealed = true;
    render();
    return;
  }

  const gradeEl = e.target.closest("[data-rev-grade]");
  if (gradeEl) {
    const card = revUI.queue[revUI.idx];
    revUI.xp += MTC.gradeReviewCard(STATE, card.id, gradeEl.dataset.revGrade);
    revUI.count++;
    revUI.idx++;
    revUI.revealed = false;
    if (revUI.idx >= revUI.queue.length) {
      pendingResult = MTC.finishReviewSession(STATE, revUI.xp, revUI.count);
      revUI = null;
    }
    render();
    return;
  }

  if (e.target.closest("[data-rev-quit]")) {
    if (revUI && revUI.count > 0) pendingResult = MTC.finishReviewSession(STATE, revUI.xp, revUI.count);
    revUI = null;
    render();
    return;
  }

  const outlineBtn = e.target.closest("[data-outline]");
  if (outlineBtn) {
    const key = outlineBtn.dataset.outline;
    const targetId = key === "boss" ? "boss-draft" : "ex-draft";
    const template = key === "boss" ? BOSS_OUTLINE : OUTLINES[key];
    const ta = document.getElementById(targetId);
    if (ta && template) {
      ta.value = ta.value.trim() ? ta.value + "\n\n" + template : template;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
    }
    return;
  }

  const micBtn = e.target.closest("[data-mic]");
  if (micBtn && SpeechRec) {
    if (activeRec) {
      activeRec.stop();
      return;
    }
    const targetId = micBtn.dataset.mic;
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = false;
    activeRec = rec;
    micBtn.textContent = "\u23F9 Stop dictating";
    rec.onresult = (ev) => {
      const ta = document.getElementById(targetId);
      if (!ta) return;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) ta.value = (ta.value ? ta.value + " " : "") + ev.results[i][0].transcript.trim();
      }
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    };
    rec.onend = () => {
      activeRec = null;
      const btn = document.querySelector(`[data-mic="${targetId}"]`);
      if (btn) btn.innerHTML = "&#127908; Dictate";
    };
    rec.onerror = rec.onend;
    try { rec.start(); } catch (err) { activeRec = null; }
    return;
  }

  if (e.target.closest("[data-export-progress]")) {
    const blob = new Blob([MTC.exportStateJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `thinking-coach-progress-${MTC.todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }

  if (e.target.closest("[data-import-progress]")) {
    document.getElementById("import-file").click();
    return;
  }

  if (e.target.closest("[data-reset-progress]")) {
    if (confirm("This will permanently erase all progress on this device. Continue?")) {
      localStorage.removeItem("mtc_state_v1");
      location.hash = "#/dashboard";
      location.reload();
    }
    return;
  }
});

document.addEventListener("change", (e) => {
  if (e.target.matches('input[name="cal-answer"]')) {
    const btn = document.querySelector("[data-cal-next]");
    if (btn) btn.disabled = false;
    return;
  }
  if (e.target.id === "import-file") {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    file.text().then((text) => {
      if (!confirm("Importing will replace ALL progress on this device with the file's progress. Continue?")) return;
      try {
        STATE = MTC.importState(text);
        exUI = null;
        bossUI = null;
        pendingResult = null;
        render();
      } catch (err) {
        alert("That file doesn't look like a Thinking Coach progress export.");
      }
    });
    return;
  }
  if (e.target.matches("[data-rubric-idx]")) {
    const idx = Number(e.target.dataset.rubricIdx);
    if (e.target.checked) exUI.checked.add(idx); else exUI.checked.delete(idx);
    render();
  }
  if (e.target.matches("[data-boss-rubric-idx]")) {
    const idx = Number(e.target.dataset.bossRubricIdx);
    if (e.target.checked) bossUI.checked.add(idx); else bossUI.checked.delete(idx);
    render();
  }
});

function toggleGate(btnSelector, value) {
  const ready = value.trim().length >= 20;
  const btn = document.querySelector(btnSelector);
  if (btn) btn.disabled = !ready;
  const note = document.querySelector("[data-gate-note]");
  if (note) note.style.display = ready ? "none" : "";
}

document.addEventListener("input", (e) => {
  if (e.target.id === "ex-draft") {
    if (exUI) exUI.draft = e.target.value;
    toggleGate("[data-show-assessment]", e.target.value);
    return;
  }
  if (e.target.id === "boss-draft") {
    if (bossUI) bossUI.draft = e.target.value;
    toggleGate("[data-boss-show-resolution]", e.target.value);
    return;
  }
  if (e.target.id === "ex-confidence") {
    if (exUI) exUI.confidence = Number(e.target.value);
    const val = document.getElementById("ex-conf-val");
    if (val) val.textContent = e.target.value;
    return;
  }
  if (e.target.id === "journal-search") {
    journalFilter = e.target.value;
    const box = document.getElementById("journal-results");
    if (box) box.innerHTML = journalResultsHTML();
    return;
  }
  if (e.target.id === "cal-conf") {
    const val = document.getElementById("cal-conf-val");
    if (val) val.textContent = e.target.value;
    return;
  }
  if (e.target.id === "cal-low" || e.target.id === "cal-high") {
    const low = parseFloat(document.getElementById("cal-low").value);
    const high = parseFloat(document.getElementById("cal-high").value);
    const btn = document.querySelector("[data-cal-next]");
    if (btn) btn.disabled = !(isFinite(low) && isFinite(high) && low <= high);
    return;
  }
  if (e.target.id === "toolbox-search") {
    toolboxFilter = e.target.value;
    document.getElementById("toolbox-results").innerHTML = toolboxResultsHTML();
  } else if (e.target.id === "frameworks-search") {
    frameworksFilter = e.target.value;
    document.getElementById("frameworks-results").innerHTML = frameworksResultsHTML();
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.matches("[data-onboard-form]")) {
    e.preventDefault();
    const name = new FormData(e.target).get("playerName");
    STATE.name = (name && name.trim()) || "Thinker";
    MTC.saveState(STATE);
    render();
  }
});

window.addEventListener("hashchange", render);
// STATE is cached in memory; pick up writes from other tabs.
window.addEventListener("storage", (e) => {
  if (e.key === "mtc_state_v1") {
    STATE = MTC.loadState();
    render();
  }
});
window.addEventListener("DOMContentLoaded", () => {
  if (!location.hash) location.hash = "#/dashboard";
  render();
});
