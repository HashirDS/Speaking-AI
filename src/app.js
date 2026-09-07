import {
  CUE_CARDS,
  OFFICIAL_SOURCES,
  PART_ONE_TOPICS,
  PLAN_DAYS,
  RUBRIC_SUMMARY,
  getPlanDay,
  pickRandom,
} from "./data.js";
import {
  addAttempt,
  addSession,
  clearProgress,
  exportAllData,
  getAttempts,
  getProfile,
  getSessions,
  getTopics,
  openDatabase,
  saveProfile,
  seedTopics,
} from "./db.js";
import { SCORING_VERSION, analyzeResponse, combineSessionScores, createAdaptiveFollowUp, weakestCriterion } from "./scoring.js";
import { SpeechCoach, speak, stopSpeaking } from "./speech.js";

const app = document.querySelector("#app");
const CRITERIA = ["fluency", "lexical", "grammar", "pronunciation"];
const NAV_ITEMS = [
  ["dashboard", "Today", "⌂"],
  ["conversation", "Talk", "◌"],
  ["practice", "Practice", "◉"],
  ["mock", "Mock test", "◷"],
  ["plan", "30-day plan", "◫"],
  ["progress", "Progress", "↗"],
  ["bank", "Question bank", "≡"],
  ["settings", "Settings", "⚙"],
];

const state = {
  view: "dashboard",
  profile: null,
  attempts: [],
  sessions: [],
  topics: [],
  session: null,
  result: null,
  recording: false,
  speechStats: null,
  questionResult: null,
  bankQuery: "",
  bankType: "all",
  recordTimer: null,
  prepTimer: null,
  busy: false,
  conversationMode: "daily",
  conversationMessages: [],
};

const speechCoach = new SpeechCoach({
  onUpdate: (snapshot) => {
    state.speechStats = snapshot;
    const textarea = document.querySelector("#answer-text");
    if (textarea && state.recording) textarea.value = snapshot.transcript;
    updateRecordingUI(snapshot);
  },
  onState: (status) => {
    if (status === "idle" && !speechCoach.keepListening && state.recording) {
      updateRecordingUI(state.speechStats || speechCoach.snapshot());
    }
  },
  onError: (error) => {
    state.recording = false;
    if (error === "unsupported") showToast("Voice recognition is not available here. You can type, or use Chrome/Edge for speaking.");
    else if (error === "not-allowed" || error === "service-not-allowed") showToast("Microphone access was blocked. Allow it in browser settings, or type your answer.");
    else showToast(`Voice recognition paused: ${error}. You can continue by typing.`);
    updateRecordingUI(state.speechStats || {});
  },
});

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function uid(prefix = "id") {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatBand(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(Number(value) % 1 ? 1 : 0);
}

function formatDuration(seconds = 0) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatDate(value, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en", options).format(new Date(value));
}

function criterionAverages(attempts = state.attempts) {
  return Object.fromEntries(CRITERIA.map((key) => {
    const values = attempts.map((attempt) => attempt.criteria?.[key]).filter((value) => value != null);
    return [key, values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 2) / 2 : null];
  }));
}

function currentBand() {
  const latestSession = state.sessions.at(-1);
  if (latestSession?.summary?.overall != null) return latestSession.summary.overall;
  if (!state.attempts.length) return null;
  const recent = state.attempts.filter((attempt) => attempt.overall != null).slice(-8);
  if (!recent.length) return null;
  return Math.round((recent.reduce((sum, item) => sum + item.overall, 0) / recent.length) * 2) / 2;
}

function currentBandRange() {
  const latestSession = [...state.sessions].reverse().find((session) => session.summary?.bandRange);
  if (latestSession) return latestSession.summary.bandRange;
  return [...state.attempts].reverse().find((attempt) => attempt.bandRange)?.bandRange || null;
}

function getStreak() {
  const unique = [...new Set(state.attempts.map((attempt) => localDateKey(attempt.createdAt)))].sort().reverse();
  if (!unique.length) return 0;
  const cursor = new Date();
  const today = todayISO();
  if (unique[0] !== today) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (const date of unique) {
    const expected = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (date !== expected) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function minutesPractised() {
  return Math.round(state.attempts.reduce((sum, attempt) => sum + (attempt.metrics?.durationSeconds || 0), 0) / 60);
}

function currentDay() {
  return getPlanDay(state.profile?.planStart);
}

function initials(name = "Learner") {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function renderOnboarding() {
  const minDate = todayISO();
  app.innerHTML = `
    <main class="onboarding">
      <section class="onboarding-story">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <span>Hashir Data Scientist</span>
        </div>
        <div class="story-copy">
          <p class="eyebrow">IELTS speaking, made human</p>
          <h1>Find your voice.<br><em>Keep it yours.</em></h1>
          <p>Practise spontaneous English with an examiner-style coach. No scripts, no magic vocabulary lists—just deliberate speaking, useful evidence, and a path that adapts to you.</p>
        </div>
        <div class="trust-row">
          <span>No account</span>
          <span>No paid AI key</span>
          <span>Progress stays on this device</span>
        </div>
      </section>
      <section class="onboarding-form-wrap">
        <form class="onboarding-form" id="onboarding-form">
          <span class="step-count">YOUR 30-DAY STARTING POINT</span>
          <h2>Let’s make practice fit you.</h2>
          <p>This takes less than a minute. Your first diagnostic will establish the real baseline.</p>
          <div class="field">
            <label for="learner-name">What should the coach call you?</label>
            <input id="learner-name" name="name" autocomplete="name" maxlength="40" required placeholder="Your first name" />
          </div>
          <div class="field-grid">
            <div class="field">
              <label for="target-band">Target speaking band</label>
              <select id="target-band" name="targetBand">
                ${[6, 6.5, 7, 7.5, 8, 8.5, 9].map((band) => `<option value="${band}" ${band === 7.5 ? "selected" : ""}>Band ${band}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="daily-minutes">Daily practice</label>
              <select id="daily-minutes" name="dailyMinutes">
                <option value="15">15 minutes</option>
                <option value="20" selected>20 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="test-date">Test date <span class="micro-copy">(optional)</span></label>
            <input id="test-date" name="testDate" type="date" min="${minDate}" />
          </div>
          <button class="btn btn-primary btn-wide" type="submit">Create my private plan <span aria-hidden="true">→</span></button>
          <p class="micro-copy" style="margin-top:14px;text-align:center">Practice scores are estimates, not official IELTS results. Certified examiners alone award official bands.</p>
        </form>
      </section>
    </main>`;
}

function sidebar() {
  const day = currentDay();
  const completed = state.profile.completedDays?.length || 0;
  return `
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <span>Hashir Data Scientist</span>
      </div>
      <nav class="sidebar-nav" aria-label="Main navigation">
        ${NAV_ITEMS.map(([route, label, icon]) => `<button class="nav-item ${state.view === route ? "active" : ""}" data-route="${route}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join("")}
      </nav>
      <div class="sidebar-foot">
        <div class="mini-goal">
          <span>30-day journey</span>
          <strong>Day ${day} · ${PLAN_DAYS[day - 1].phase}</strong>
          <div class="mini-progress"><i style="width:${Math.max((completed / 30) * 100, (day / 30) * 35)}%"></i></div>
        </div>
        <p class="privacy-note">🔒 Voice is processed by your browser. Luma does not upload or sell your practice data.</p>
      </div>
    </aside>`;
}

function mobileNav() {
  const items = NAV_ITEMS.filter(([route]) => ["dashboard", "conversation", "practice", "mock", "progress", "bank"].includes(route));
  return `<nav class="mobile-nav" aria-label="Mobile navigation">${items.map(([route, label, icon]) => `<button class="nav-item ${state.view === route ? "active" : ""}" data-route="${route}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join("")}</nav>`;
}

function shell(content, title) {
  const streak = getStreak();
  app.innerHTML = `
    <div class="app-shell">
      ${sidebar()}
      <main class="main-area">
        <header class="topbar">
          <div class="topbar-title">${escapeHTML(title)}</div>
          <div class="top-actions">
            <span class="streak-chip">${streak ? `🔥 ${streak} day streak` : "Start your streak today"}</span>
            <button class="avatar" data-route="settings" aria-label="Open settings">${escapeHTML(initials(state.profile.name))}</button>
          </div>
        </header>
        ${content}
      </main>
      ${mobileNav()}
    </div>`;
}

function rubricRows(averages, target = state.profile.targetBand) {
  const lowest = weakestCriterion(state.attempts);
  return `<div class="criterion-list">${CRITERIA.map((key) => {
    const value = averages[key];
    return `<div class="criterion-row ${lowest === key && value != null ? "weak" : ""}">
      <span title="${escapeHTML(RUBRIC_SUMMARY[key].label)}">${escapeHTML(RUBRIC_SUMMARY[key].label)}</span>
      <div class="bar"><i style="width:${value == null ? 0 : Math.min(100, (value / 9) * 100)}%"></i></div>
      <strong>${formatBand(value)}</strong>
    </div>`;
  }).join("")}</div>`;
}

function weekStrip() {
  const today = currentDay();
  const completed = new Set(state.profile.completedDays || []);
  const start = Math.max(1, Math.min(24, today - 3));
  return `<div class="day-strip">${Array.from({ length: 7 }, (_, index) => start + index).map((day) => {
    const status = completed.has(day) ? "done" : day === today ? "today" : day > today ? "future" : "";
    return `<div class="day-pill ${status}"><span>Day</span><strong>${completed.has(day) ? "✓" : day}</strong></div>`;
  }).join("")}</div>`;
}

function renderDashboard() {
  const band = currentBand();
  const range = currentBandRange();
  const averages = criterionAverages(state.attempts.slice(-12));
  const day = currentDay();
  const plan = PLAN_DAYS[day - 1];
  const weakKey = weakestCriterion(state.attempts);
  const weakLabel = RUBRIC_SUMMARY[weakKey].label;
  const hasBaseline = state.sessions.length > 0;
  shell(`
    <div class="page">
      <div class="page-heading">
        <div><p class="eyebrow">${greeting()}, ${escapeHTML(state.profile.name)}</p><h1>Your speaking room</h1><p>Day ${day} of 30 · ${escapeHTML(plan.phase)} phase · ${state.profile.dailyMinutes} minutes planned</p></div>
        <div class="heading-actions"><button class="btn btn-primary" data-start-session="${hasBaseline ? plan.focus : "diagnostic"}">${hasBaseline ? "Start today’s practice" : "Take the diagnostic"} →</button></div>
      </div>
      <div class="dashboard-grid">
        <div class="stack">
          <section class="card hero-card">
            <div class="hero-content">
              <span class="hero-kicker">TODAY · DAY ${day} · ${escapeHTML(plan.phase)}</span>
              <h2>${escapeHTML(plan.title)}</h2>
              <p>${escapeHTML(plan.description)}${plan.focus === "adaptive" ? ` Your current evidence points to ${escapeHTML(weakLabel.toLowerCase())}.` : ""}</p>
              <div class="hero-actions">
                <button class="btn btn-lime" data-start-session="${hasBaseline ? plan.focus : "diagnostic"}">${hasBaseline ? "Begin focused session" : "Establish my baseline"} →</button>
                <button class="btn btn-ghost" data-route="practice">Choose another mode</button>
              </div>
            </div>
          </section>
          <section class="card card-pad">
            <div class="card-title-row"><h3>This week</h3><button class="text-button" data-route="plan">See the full plan</button></div>
            ${weekStrip()}
          </section>
          <section class="card card-pad">
            <div class="card-title-row"><h3>Quick practice</h3><span class="micro-copy">Unscripted, one focus at a time</span></div>
            <div class="quick-grid">
              <button class="quick-card quick-card-featured" data-route="conversation"><span class="quick-icon">◌</span><strong>Talk with your coach</strong><span>Daily conversation or IELTS follow-ups</span></button>
              <button class="quick-card" data-start-session="part1"><span class="quick-icon">☕</span><strong>Part 1 interview</strong><span>Familiar topics · 4 questions</span></button>
              <button class="quick-card" data-start-session="part2"><span class="quick-icon">◫</span><strong>Cue card</strong><span>1 min prepare · up to 2 min speak</span></button>
              <button class="quick-card" data-start-session="part3"><span class="quick-icon">◇</span><strong>Part 3 discussion</strong><span>Abstract ideas · evidence and nuance</span></button>
              <button class="quick-card" data-start-session="mock"><span class="quick-icon">◷</span><strong>Full mock</strong><span>Authentic flow · feedback at the end</span></button>
            </div>
          </section>
        </div>
        <div class="stack">
          <section class="card card-pad">
            <div class="card-title-row"><h3>Practice estimate</h3><button class="text-button" data-route="progress">Details</button></div>
            <div class="score-orb ${band == null ? "empty" : ""}" style="--score-deg:${band == null ? 0 : (band / 9) * 360}deg">
              <strong>${band == null ? "No baseline" : formatBand(band)}</strong><span>${band == null ? "Speak to begin" : "estimated band"}</span>
            </div>
            <p class="score-target">${range ? `Likely range: ${formatBand(range.low)}–${formatBand(range.high)} · ` : ""}Target: Band ${formatBand(state.profile.targetBand)} · ${state.attempts.length} answer${state.attempts.length === 1 ? "" : "s"} analysed</p>
            <div style="margin-top:22px">${rubricRows(averages)}</div>
          </section>
          <section class="card card-pad insight-card">
            <span class="insight-badge">Coach’s focus</span>
            <h3>${state.attempts.length ? escapeHTML(weakLabel) : "Speak before you study"}</h3>
            <p>${state.attempts.length ? `This is currently your lowest measured criterion. The plan will keep returning to it while still training all four criteria.` : "Your first answers should be natural—even imperfect. A true baseline makes the next 30 days much more useful."}</p>
          </section>
        </div>
      </div>
    </div>`, "Today");
}

function renderPractice() {
  shell(`
    <div class="page">
      <div class="page-heading">
        <div><p class="eyebrow">Focused practice</p><h1>Choose the pressure</h1><p>Each mode uses fresh questions and adapts one follow-up to what you actually say.</p></div>
      </div>
      <div class="mode-grid">
        <article class="card mode-card conversation-card" data-number="0"><span class="mode-tag">Free voice room</span><h3>Talk with your coach</h3><p>Have an open conversation about daily life or switch to IELTS-style practice with spoken follow-ups.</p><button class="btn btn-lime" data-route="conversation">Open conversation room →</button></article>
        <article class="card mode-card coral" data-number="1"><span class="mode-tag">4–5 minutes</span><h3>Part 1 interview</h3><p>Build concise, personal answers about familiar subjects. Train directness, tense control and natural extension.</p><button class="btn btn-primary" data-start-session="part1">Practise Part 1 →</button></article>
        <article class="card mode-card featured" data-number="2"><span class="mode-tag">1 + 2 minutes</span><h3>Part 2 long turn</h3><p>Receive a cue card, make four-anchor notes, then keep speaking naturally for up to two minutes.</p><button class="btn btn-lime" data-start-session="part2">Draw a cue card →</button></article>
        <article class="card mode-card" data-number="3"><span class="mode-tag">4–5 minutes</span><h3>Part 3 discussion</h3><p>Move beyond personal stories into causes, comparisons, consequences, exceptions and future change.</p><button class="btn btn-primary" data-start-session="part3">Practise Part 3 →</button></article>
      </div>
      <div class="section-heading"><h2>Deliberate training</h2><p>Use the weakest area found in recent answers</p></div>
      <div class="quick-grid">
        <button class="quick-card" data-start-session="fluency"><span class="quick-icon">≈</span><strong>Fluency & coherence</strong><span>Extend, connect and reduce disruptive hesitation.</span></button>
        <button class="quick-card" data-start-session="lexical"><span class="quick-icon">Aa</span><strong>Lexical resource</strong><span>Paraphrase and choose precise, natural language.</span></button>
        <button class="quick-card" data-start-session="grammar"><span class="quick-icon">{ }</span><strong>Grammar control</strong><span>Use range only when it carries meaning.</span></button>
        <button class="quick-card" data-start-session="pronunciation"><span class="quick-icon">◖</span><strong>Pronunciation</strong><span>Train intelligibility, chunking, stress and pace.</span></button>
      </div>
    </div>`, "Practice");
}

function conversationReply(text, mode) {
  const clean = text.trim().replace(/\s+/g, " ");
  const words = clean.toLowerCase().match(/[a-z]+/g) || [];
  const topics = ["work", "study", "family", "friend", "home", "travel", "food", "music", "book", "technology", "health", "future"];
  const topic = topics.find((item) => words.includes(item));
  if (mode === "ielts") {
    const analysis = analyzeResponse({ text: clean, part: 3, inputMode: "typed" });
    const priority = analysis.feedback.priorities[0];
    const prompt = topic ? `You mentioned ${topic}. What is the main reason this matters, and can you give a specific example?` : "What is your main view, what is one reason for it, and what example supports your idea?";
    return { text: prompt, feedback: priority };
  }
  const prompts = topic
    ? [`That sounds interesting. What do you enjoy most about ${topic}?`, `How has ${topic} affected your everyday routine?`, `What would you like to change about ${topic}?`]
    : ["Tell me a little more about that.", "What was the best part of that experience?", "How did that make you feel?", "What might you do next?"];
  const prompt = prompts[words.length % prompts.length];
  return { text: prompt, feedback: "Try answering with one clear idea, a reason, and a real detail from your life." };
}

function ensureConversation() {
  if (state.conversationMessages.length) return;
  state.conversationMessages.push({ role: "assistant", text: state.conversationMode === "ielts" ? "Welcome to IELTS Coach. Give me a natural answer, and I will ask a useful follow-up." : "Hi, I’m your conversation coach. Tell me about something from your day." });
}

function renderConversation() {
  ensureConversation();
  shell(`
    <div class="page conversation-page">
      <div class="page-heading">
        <div><p class="eyebrow">Live voice practice</p><h1>Talk with your coach</h1><p>Free browser voice practice. Your speech stays in this browser; responses are generated from local conversation prompts.</p></div>
      </div>
      <section class="conversation-layout">
        <div class="card conversation-card-main">
          <div class="conversation-toolbar" role="group" aria-label="Conversation mode">
            <button class="mode-switch ${state.conversationMode === "daily" ? "active" : ""}" data-conversation-mode="daily">Daily conversation</button>
            <button class="mode-switch ${state.conversationMode === "ielts" ? "active" : ""}" data-conversation-mode="ielts">IELTS coach</button>
          </div>
          <div class="conversation-log" aria-live="polite">${state.conversationMessages.map((message) => `<div class="conversation-message ${message.role}"><span>${message.role === "assistant" ? "Coach" : "You"}</span><p>${escapeHTML(message.text)}</p>${message.feedback ? `<small>${escapeHTML(message.feedback)}</small>` : ""}</div>`).join("")}</div>
          <textarea id="answer-text" class="answer-box conversation-input" placeholder="Speak, or type your message here…" aria-label="Your conversation message"></textarea>
          <div class="conversation-actions"><button class="btn btn-coral" id="record-button" data-action="toggle-conversation-record">● Start speaking</button><button class="btn btn-primary" data-action="send-conversation">Send message</button><button class="btn btn-ghost" data-action="clear-conversation">New conversation</button></div>
          <p class="voice-note">This free mode uses your browser’s speech recognition and voice. It is an adaptive practice coach, not a cloud generative AI model or official IELTS examiner.</p>
        </div>
        <aside class="card conversation-guide"><span class="insight-badge">How to improve</span><h3>${state.conversationMode === "ielts" ? "Answer like a speaker, not a script." : "Keep the conversation moving."}</h3><p>${state.conversationMode === "ielts" ? "Give a position, a reason, an example and a consequence. The coach will ask you to develop the idea." : "Use complete thoughts, ask questions back, and add one specific detail instead of stopping at a short answer."}</p></aside>
      </section>
    </div>`, "Talk");
}

function renderMock() {
  shell(`
    <div class="page">
      <div class="page-heading"><div><p class="eyebrow">Exam conditions</p><h1>Full speaking mock</h1><p>One continuous interview. Coaching stays hidden until the test is complete.</p></div></div>
      <section class="card mock-intro">
        <div class="mock-copy">
          <h2>Meet the test before test day.</h2>
          <p>The simulation follows the official public structure and examiner transitions. You will answer familiar questions, prepare for one minute, speak for up to two minutes, then discuss connected abstract issues.</p>
          <div class="hero-actions">
            <button class="btn btn-primary" data-start-session="mock">Begin full mock →</button>
            <button class="btn btn-ghost" data-start-session="diagnostic">Short diagnostic</button>
          </div>
        </div>
        <div class="mock-panel">
          <div class="mock-step"><div class="mock-step-number">1</div><div><strong>Introduction & interview</strong><span>Personal and familiar topics</span></div><time>4–5 min</time></div>
          <div class="mock-step"><div class="mock-step-number">2</div><div><strong>Individual long turn</strong><span>1 minute prep, up to 2 minutes speaking</span></div><time>3–4 min</time></div>
          <div class="mock-step"><div class="mock-step-number">3</div><div><strong>Two-way discussion</strong><span>Connected abstract questions</span></div><time>4–5 min</time></div>
          <p class="mock-warning">Keep your microphone on and use a quiet room. Browser recognition supports the practice estimate; it cannot reproduce a certified examiner’s phonetic judgement.</p>
          <button class="btn btn-lime btn-wide" data-start-session="mock">I’m ready</button>
        </div>
      </section>
    </div>`, "Mock test");
}

function renderPlan() {
  const day = currentDay();
  const complete = new Set(state.profile.completedDays || []);
  shell(`
    <div class="page">
      <div class="page-heading">
        <div><p class="eyebrow">Basic to advanced</p><h1>Your 30-day route</h1><p>The route remains open: follow today’s lesson or practise any part whenever you need it.</p></div>
        <div class="heading-actions"><button class="btn btn-primary" data-start-session="${PLAN_DAYS[day - 1].focus}">Start Day ${day} →</button></div>
      </div>
      <div class="plan-list">
        ${PLAN_DAYS.map((plan) => {
          const status = complete.has(plan.day) ? "done" : plan.day === day ? "current" : plan.day > day ? "future" : "";
          return `<div class="plan-row ${status}">
            <div class="plan-day">Day ${plan.day}</div>
            <div class="plan-title">${escapeHTML(plan.title)}</div>
            <div class="plan-description">${escapeHTML(plan.description)}</div>
            <div class="plan-meta">${plan.minutes} min</div>
            <button class="text-button status-dot" data-start-session="${plan.focus}">${complete.has(plan.day) ? "Done" : plan.day === day ? "Today" : "Practise"}</button>
          </div>`;
        }).join("")}
      </div>
    </div>`, "30-day plan");
}

function renderProgress() {
  const band = currentBand();
  const averages = criterionAverages(state.attempts.slice(-16));
  const recent = state.sessions.filter((session) => session.summary?.overall != null).slice(-10);
  const attempts = [...state.attempts].reverse().slice(0, 12);
  shell(`
    <div class="page">
      <div class="page-heading">
        <div><p class="eyebrow">Evidence, not guesswork</p><h1>Your progress</h1><p>Practice estimates become more useful when you give several complete spoken answers across all three parts.</p></div>
        <div class="heading-actions"><button class="btn btn-ghost" data-action="export-data">Export my data</button><button class="btn btn-primary" data-start-session="checkpoint">New checkpoint</button></div>
      </div>
      <div class="progress-hero">
        <section class="card stat-card"><span>Current practice estimate</span><strong>${band == null ? "—" : formatBand(band)}</strong><p>Target Band ${formatBand(state.profile.targetBand)} · ${minutesPractised()} spoken minute${minutesPractised() === 1 ? "" : "s"}</p></section>
        <section class="card trend-card">
          <div class="card-title-row"><h3>Session trend</h3><span class="micro-copy">Most recent ${Math.min(recent.length, 10)}</span></div>
          ${recent.length ? `<div class="trend-chart">${recent.map((session) => `<div class="trend-bar" style="--height:${Math.max(10, (session.summary.overall / 9) * 100)}%"><span>${formatBand(session.summary.overall)}</span></div>`).join("")}</div>` : `<div class="trend-empty">Complete a diagnostic or practice session<br>to begin your trend.</div>`}
        </section>
      </div>
      <div class="settings-grid" style="margin-top:19px">
        <section class="card card-pad"><div class="card-title-row"><h3>Four criteria</h3><span class="micro-copy">Recent 16 answers</span></div>${rubricRows(averages)}</section>
        <section class="card card-pad insight-card"><span class="insight-badge">Next priority</span><h3>${escapeHTML(RUBRIC_SUMMARY[weakestCriterion(state.attempts)].label)}</h3><p>${escapeHTML(RUBRIC_SUMMARY[weakestCriterion(state.attempts)].short)} Your next adaptive session will emphasise this area.</p></section>
      </div>
      <section class="card card-pad" style="margin-top:19px">
        <div class="card-title-row"><h3>Recent answer evidence</h3><span class="micro-copy">Stored only in this browser</span></div>
        ${attempts.length ? `<div class="attempt-table"><div class="attempt-row header"><span>Date</span><span>Part</span><span>Question</span><span>Band</span><span>Words / pace</span></div>${attempts.map((attempt) => `<div class="attempt-row"><span>${formatDate(attempt.createdAt)}</span><span>Part ${attempt.part}</span><span class="attempt-question" title="${escapeHTML(attempt.question)}">${escapeHTML(attempt.question)}</span><span><b class="band-badge">${formatBand(attempt.overall)}</b></span><span>${attempt.metrics.words} · ${attempt.metrics.wpm == null ? "typed" : `${attempt.metrics.wpm} wpm`}</span></div>`).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">↗</div><h3>Your first data point is one answer away.</h3><p>Take the diagnostic and answer naturally. The coach needs real speech, not your best rehearsed performance.</p><button class="btn btn-primary" data-start-session="diagnostic">Start diagnostic</button></div>`}
      </section>
    </div>`, "Progress");
}

function renderBank() {
  const query = state.bankQuery.toLowerCase();
  const topics = state.topics.filter((topic) => {
    const matchesType = state.bankType === "all" || topic.type === state.bankType;
    const haystack = `${topic.title} ${topic.prompt || ""} ${(topic.questions || topic.part3 || []).join(" ")}`.toLowerCase();
    return matchesType && haystack.includes(query);
  });
  shell(`
    <div class="page">
      <div class="page-heading"><div><p class="eyebrow">Original IELTS-style material</p><h1>Question bank</h1><p>${state.topics.length} topic sets seeded into your local database. These are practice prompts, not leaked or predicted test questions.</p></div></div>
      <div class="bank-tools">
        <input class="search-input" id="bank-search" type="search" value="${escapeHTML(state.bankQuery)}" placeholder="Search topics and questions…" aria-label="Search question bank" />
        <select class="filter-select" id="bank-type" aria-label="Filter question type">
          <option value="all" ${state.bankType === "all" ? "selected" : ""}>All parts</option>
          <option value="part1" ${state.bankType === "part1" ? "selected" : ""}>Part 1</option>
          <option value="part2" ${state.bankType === "part2" ? "selected" : ""}>Cue cards + Part 3</option>
        </select>
      </div>
      ${topics.length ? `<div class="topic-grid">${topics.map((topic) => `<article class="card topic-card">
        <div class="topic-top"><span class="topic-type">${topic.type === "part1" ? "Part 1" : "Parts 2 + 3"}</span><span class="level-chip">${escapeHTML(topic.level)}</span></div>
        <h3>${escapeHTML(topic.title)}</h3>
        <p>${topic.type === "part1" ? `${topic.questions.length} familiar-topic questions` : `Cue card + ${topic.part3.length} connected discussion questions`}</p>
        <button class="btn btn-ghost btn-small" data-topic-id="${topic.id}" data-start-session="${topic.type}">Practise this topic →</button>
      </article>`).join("")}</div>` : `<div class="card empty-state"><div class="empty-icon">⌕</div><h3>No matching topic</h3><p>Try a broader phrase or show all parts.</p></div>`}
    </div>`, "Question bank");
  const search = document.querySelector("#bank-search");
  if (search) {
    search.focus({ preventScroll: true });
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

function renderSettings() {
  const profile = state.profile;
  shell(`
    <div class="page">
      <div class="page-heading"><div><p class="eyebrow">Private by design</p><h1>Settings & sources</h1><p>Adjust your plan and see exactly what the coach uses as its public reference.</p></div></div>
      <div class="settings-grid">
        <form class="card setting-card" id="settings-form">
          <h3>Your plan</h3>
          <div class="field"><label for="settings-name">Name</label><input id="settings-name" name="name" value="${escapeHTML(profile.name)}" maxlength="40" required /></div>
          <div class="field-grid">
            <div class="field"><label for="settings-band">Target band</label><select id="settings-band" name="targetBand">${[6,6.5,7,7.5,8,8.5,9].map((band) => `<option value="${band}" ${Number(profile.targetBand) === band ? "selected" : ""}>Band ${band}</option>`).join("")}</select></div>
            <div class="field"><label for="settings-minutes">Daily minutes</label><select id="settings-minutes" name="dailyMinutes">${[15,20,30,45].map((minutes) => `<option value="${minutes}" ${Number(profile.dailyMinutes) === minutes ? "selected" : ""}>${minutes} minutes</option>`).join("")}</select></div>
          </div>
          <div class="field"><label for="settings-date">Test date</label><input id="settings-date" name="testDate" type="date" value="${escapeHTML(profile.testDate || "")}" /></div>
          <button class="btn btn-primary" type="submit">Save plan</button>
        </form>
        <section class="card setting-card">
          <h3>Coach behaviour</h3>
          <div class="toggle-row"><div class="toggle-copy"><strong>Examiner voice</strong><span>Read transitions and questions aloud.</span></div><button class="toggle ${profile.autoSpeak ? "on" : ""}" data-toggle-setting="autoSpeak" aria-label="Toggle examiner voice" aria-pressed="${profile.autoSpeak}"><i></i></button></div>
          <div class="toggle-row"><div class="toggle-copy"><strong>Authentic Part 2 timing</strong><span>Use 60 seconds preparation and cap speech at 2 minutes.</span></div><button class="toggle ${profile.strictTiming ? "on" : ""}" data-toggle-setting="strictTiming" aria-label="Toggle authentic Part 2 timing" aria-pressed="${profile.strictTiming}"><i></i></button></div>
          <div class="toggle-row"><div class="toggle-copy"><strong>Speech language</strong><span>Recognition and examiner voice.</span></div><select class="filter-select" id="speech-lang"><option value="en-GB" ${profile.lang === "en-GB" ? "selected" : ""}>English (UK)</option><option value="en-US" ${profile.lang === "en-US" ? "selected" : ""}>English (US)</option><option value="en-AU" ${profile.lang === "en-AU" ? "selected" : ""}>English (Australia)</option></select></div>
          <p class="micro-copy" style="margin-top:16px">Any English accent is accepted in IELTS. The language choice only helps your browser recognise and voice the conversation; it is not an accent target.</p>
        </section>
        <section class="card setting-card">
          <h3>Official public references</h3>
          <div class="source-list">${OFFICIAL_SOURCES.map((source) => `<a class="source-link" href="${source.url}" target="_blank" rel="noreferrer"><strong>${escapeHTML(source.title)} ↗</strong><span>${escapeHTML(source.publisher)} · ${escapeHTML(source.use)}</span></a>`).join("")}</div>
        </section>
        <section class="card setting-card">
          <h3>Your data</h3>
          <p class="micro-copy">Profile, transcripts, practice estimates and the question bank are stored in IndexedDB inside this browser. There is no application server and no account.</p>
          <div class="hero-actions"><button class="btn btn-ghost" data-action="export-data">Export JSON</button></div>
          <div class="danger-zone"><p class="micro-copy">Clearing progress permanently removes your local profile, transcripts and scores on this device.</p><button class="btn btn-danger btn-small" data-action="clear-data">Clear all local data</button></div>
        </section>
      </div>
    </div>`, "Settings");
}

function render() {
  if (!state.profile) return renderOnboarding();
  if (state.view === "conversation") return renderConversation();
  if (state.view === "session") return renderSession();
  if (state.view === "results") return renderResults();
  if (state.view === "practice") return renderPractice();
  if (state.view === "mock") return renderMock();
  if (state.view === "plan") return renderPlan();
  if (state.view === "progress") return renderProgress();
  if (state.view === "bank") return renderBank();
  if (state.view === "settings") return renderSettings();
  return renderDashboard();
}

function getModeFromFocus(mode) {
  if (mode === "checkpoint") return "diagnostic";
  if (["mock", "diagnostic", "part1", "part2", "part3"].includes(mode)) return mode;
  if (["fluency", "coherence", "lexical", "grammar", "pronunciation", "adaptive"].includes(mode)) {
    const focus = mode === "adaptive" ? weakestCriterion(state.attempts) : mode;
    return focus === "pronunciation" ? "part1" : focus === "grammar" || focus === "lexical" ? "part2" : "part3";
  }
  return "part1";
}

function buildQuestions(requestedMode, topicId) {
  const mode = getModeFromFocus(requestedMode);
  const chosenP1 = topicId ? PART_ONE_TOPICS.find((topic) => topic.id === topicId) : pickRandom(PART_ONE_TOPICS, 1)[0];
  const cue = topicId ? CUE_CARDS.find((topic) => topic.id === topicId) : pickRandom(CUE_CARDS, 1)[0];
  const q = (part, question, extra = {}) => ({ id: uid("question"), part, question, ...extra });
  if (mode === "part1") return chosenP1.questions.map((question, index) => q(1, question, { topicId: chosenP1.id, allowAdaptive: index === 0, maxSeconds: 50 }));
  if (mode === "part2") return [q(2, cue.prompt, { topicId: cue.id, cue, maxSeconds: 120 })];
  if (mode === "part3") return cue.part3.map((question, index) => q(3, question, { topicId: cue.id, theme: cue.part3Theme, allowAdaptive: index === 0, maxSeconds: 90 }));

  if (mode === "diagnostic") {
    return [
      ...chosenP1.questions.slice(0, 2).map((question) => q(1, question, { topicId: chosenP1.id, maxSeconds: 35 })),
      q(2, cue.prompt, { topicId: cue.id, cue, maxSeconds: 120 }),
      ...cue.part3.slice(0, 2).map((question) => q(3, question, { topicId: cue.id, theme: cue.part3Theme, maxSeconds: 65 })),
    ];
  }

  const secondP1 = pickRandom(PART_ONE_TOPICS, 1, [chosenP1.id])[0];
  return [
    ...chosenP1.questions.slice(0, 3).map((question) => q(1, question, { topicId: chosenP1.id, maxSeconds: 35 })),
    ...secondP1.questions.slice(0, 3).map((question) => q(1, question, { topicId: secondP1.id, maxSeconds: 35 })),
    q(2, cue.prompt, { topicId: cue.id, cue, maxSeconds: 120 }),
    q(2, cue.followUp, { topicId: cue.id, maxSeconds: 35, followUp: true }),
    ...cue.part3.slice(0, 5).map((question) => q(3, question, { topicId: cue.id, theme: cue.part3Theme, maxSeconds: 65 })),
  ];
}

function startSession(requestedMode, topicId = null) {
  stopSpeaking();
  clearTimers();
  const resolvedMode = getModeFromFocus(requestedMode);
  const questions = buildQuestions(requestedMode, topicId);
  state.session = {
    id: uid("session"),
    requestedMode,
    mode: resolvedMode,
    startedAt: new Date().toISOString(),
    questions,
    index: 0,
    analyses: [],
    attemptIds: [],
    phase: questions[0].cue ? "ready" : "answer",
    notes: "",
    prepRemaining: 60,
  };
  state.questionResult = null;
  state.result = null;
  state.view = "session";
  state.speechStats = null;
  speechCoach.reset();
  render();
  window.setTimeout(announceQuestion, 220);
}

function sessionLabel() {
  if (state.session?.requestedMode === "checkpoint") return "Progress checkpoint";
  const mode = state.session?.mode;
  if (mode === "mock") return "Full mock test";
  if (mode === "diagnostic") return "Diagnostic";
  return `Part ${mode?.replace("part", "")} practice`;
}

function cueCardHTML(cue) {
  if (!cue) return "";
  return `<ul class="cue-bullets">${cue.bullets.map((bullet) => `<li>${escapeHTML(bullet)}</li>`).join("")}</ul><p class="cue-instruction">You should speak for 1–2 minutes. Explain the final point fully; the bullets are prompts, not a checklist you must memorise.</p>`;
}

function renderSession() {
  const session = state.session;
  const question = session.questions[session.index];
  const isNoCoaching = ["mock", "diagnostic"].includes(session.mode);
  const progress = `${session.index + 1} / ${session.questions.length}`;
  const elapsed = Math.round((Date.now() - new Date(session.startedAt)) / 1000);
  const phase = session.phase;

  let interaction = "";
  if (phase === "ready" && question.cue) {
    interaction = `
      ${cueCardHTML(question.cue)}
      <div class="answer-actions"><div><button class="btn btn-primary" data-action="start-prep">Begin 1-minute preparation</button></div></div>`;
  } else if (phase === "prep") {
    interaction = `
      ${cueCardHTML(question.cue)}
      <div class="prep-layout">
        <div class="prep-clock"><strong id="prep-count">${session.prepRemaining}</strong><span>seconds</span></div>
        <div><label class="notes-label" for="prep-notes">Four-anchor notes — keywords only</label><textarea id="prep-notes" class="notes-box" placeholder="who / where / key moments / why…">${escapeHTML(session.notes)}</textarea></div>
      </div>
      ${!isNoCoaching && !state.profile.strictTiming ? `<div class="answer-actions"><div></div><button class="btn btn-ghost" data-action="begin-answer">I’m ready to speak</button></div>` : ""}`;
  } else if (state.questionResult && !isNoCoaching) {
    interaction = `${cueCardHTML(question.cue)}${answerFeedbackHTML(state.questionResult)}<div class="answer-actions"><div><button class="btn btn-ghost" data-action="retry-question">Try this answer again</button></div><button class="btn btn-primary" data-action="next-question">${session.index + 1 >= session.questions.length ? "See session result" : "Next question →"}</button></div>`;
  } else {
    interaction = `
      ${question.cue ? cueCardHTML(question.cue) : ""}
      <div class="answer-zone">
        <label class="sr-only" for="answer-text">Your answer transcript</label>
        <textarea id="answer-text" class="answer-box" placeholder="Your live transcript will appear here. You can also type if voice recognition is unavailable."></textarea>
        <div class="recording-panel">
          <div class="recording-status"><span class="record-dot"></span><div><strong id="record-label">Ready when you are</strong><span id="record-time" style="display:block;margin-top:2px">0:00${question.cue ? " / 2:00" : ""}</span></div></div>
          <div class="wave" aria-hidden="true">${Array.from({ length: 14 }, () => "<i></i>").join("")}</div>
        </div>
        <div class="answer-actions">
          <div><button class="btn btn-coral" id="record-button" data-action="toggle-record">● Start speaking</button><button class="btn btn-ghost" data-action="submit-typed">Submit typed answer</button></div>
          ${isNoCoaching ? "" : `<button class="btn btn-ghost" data-action="skip-question">Skip</button>`}
        </div>
        <p class="voice-note">For the most useful estimate, speak in Chrome or Edge and allow microphone access. Typed answers provide language feedback but cannot provide fluency, pronunciation or an overall speaking band.</p>
      </div>`;
  }

  app.innerHTML = `
    <main class="session-page">
      <header class="session-topbar">
        <div class="session-brand"><div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div><span>Hashir Data Scientist</span></div>
        <div class="session-meta"><span class="session-chip mode-name">${escapeHTML(sessionLabel())}</span><span class="session-chip">${progress}</span><span class="session-chip" id="session-time">${formatDuration(elapsed)}</span><button class="session-exit" data-action="exit-session">Exit</button></div>
      </header>
      <section class="session-stage">
        <div class="examiner-wrap"><div class="examiner-avatar">E</div><strong>Examiner</strong><span>${isNoCoaching ? "Test mode · feedback is hidden" : "Practice mode · adaptive follow-up active"}</span></div>
        <article class="question-card ${state.recording ? "recording" : ""}">
          <div class="question-label"><span>Part ${question.part}${question.followUp ? " · Follow-up" : ""}</span><button class="speak-again" data-action="repeat-question">◖ Hear again</button></div>
          <h1>${escapeHTML(question.question)}</h1>
          ${interaction}
        </article>
      </section>
    </main>`;
  startSessionClock();
}

function answerFeedbackHTML(analysis) {
  const range = analysis.bandRange;
  return `<div class="answer-feedback">
    <div class="mini-score-grid">${CRITERIA.map((key) => `<div class="mini-score"><span>${escapeHTML(RUBRIC_SUMMARY[key].label)}</span><strong>${formatBand(analysis.criteria[key])}</strong></div>`).join("")}</div>
    <div class="feedback-columns">
      <div class="feedback-block"><h4>Evidence of strength</h4><p>${escapeHTML(analysis.feedback.strengths.join(" "))}</p></div>
      <div class="feedback-block priority"><h4>One useful next move</h4><p>${escapeHTML(analysis.feedback.priorities[0])}</p></div>
    </div>
    <p class="micro-copy" style="margin:13px 0 0">${analysis.metrics.words} words · ${analysis.metrics.wpm == null ? "typed response" : `${analysis.metrics.wpm} wpm`} · ${analysis.metrics.fillers} detected filler${analysis.metrics.fillers === 1 ? "" : "s"} · evidence quality: ${analysis.reliability}${range ? ` · likely range ${formatBand(range.low)}–${formatBand(range.high)}` : ""}</p>
  </div>`;
}

function announceQuestion() {
  const session = state.session;
  if (!session || state.view !== "session") return;
  const question = session.questions[session.index];
  let text = question.question;
  if (question.cue) text = `Now I am going to give you a topic. I would like you to talk about ${question.question.replace(/^Describe /i, "").replace(/\.$/, "")}. You will have one minute to prepare.`;
  else if (session.index === 0 && ["mock", "diagnostic"].includes(session.mode)) text = `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}. My name is your practice examiner. Let us begin. ${question.question}`;
  else if (question.part === 3 && session.questions[session.index - 1]?.part !== 3) text = `We have been talking about ${question.theme || "this topic"}. Now I would like to discuss it in a more general way. ${question.question}`;
  speak(text, { lang: state.profile.lang, enabled: state.profile.autoSpeak });
}

function startPrep() {
  const session = state.session;
  session.phase = "prep";
  session.prepRemaining = 60;
  render();
  state.prepTimer = window.setInterval(() => {
    session.prepRemaining -= 1;
    const counter = document.querySelector("#prep-count");
    if (counter) counter.textContent = session.prepRemaining;
    if (session.prepRemaining <= 0) beginAnswer();
  }, 1000);
}

function beginAnswer() {
  window.clearInterval(state.prepTimer);
  state.prepTimer = null;
  if (!state.session) return;
  const notes = document.querySelector("#prep-notes");
  if (notes) state.session.notes = notes.value;
  state.session.phase = "answer";
  render();
  speak("All right. You can start speaking now.", { lang: state.profile.lang, enabled: state.profile.autoSpeak });
}

function startSessionClock() {
  window.clearInterval(state.recordTimer);
  state.recordTimer = window.setInterval(() => {
    if (!state.session || state.view !== "session") return;
    const elapsed = Math.round((Date.now() - new Date(state.session.startedAt)) / 1000);
    const label = document.querySelector("#session-time");
    if (label) label.textContent = formatDuration(elapsed);
    if (state.recording) {
      const snapshot = speechCoach.snapshot();
      state.speechStats = snapshot;
      updateRecordingUI(snapshot);
      const question = state.session.questions[state.session.index];
      const enforceLimit = question.cue || ["mock", "diagnostic"].includes(state.session.mode);
      if (enforceLimit && snapshot.durationSeconds >= question.maxSeconds) finishSpeechAnswer();
    }
  }, 500);
}

function updateRecordingUI(snapshot = {}) {
  const card = document.querySelector(".question-card");
  const button = document.querySelector("#record-button");
  const label = document.querySelector("#record-label");
  const time = document.querySelector("#record-time");
  const question = state.session?.questions[state.session.index];
  card?.classList.toggle("recording", state.recording);
  if (button) button.textContent = state.recording ? "■ Finish answer" : "● Start speaking";
  if (label) label.textContent = state.recording ? "Listening… speak naturally" : snapshot.transcript ? "Transcript ready" : "Ready when you are";
  if (time) time.textContent = `${formatDuration(snapshot.durationSeconds || 0)}${question?.cue ? " / 2:00" : ""}`;
}

async function toggleRecording() {
  if (state.busy) return;
  if (state.recording) {
    finishSpeechAnswer();
    return;
  }
  const initialText = document.querySelector("#answer-text")?.value || "";
  speechCoach.reset();
  speechCoach.lang = state.profile.lang;
  const question = state.session.questions[state.session.index];
  const enforceLimit = question.cue && state.profile.strictTiming || ["mock", "diagnostic"].includes(state.session.mode);
  const started = speechCoach.start({ initialText, maxSeconds: enforceLimit ? question.maxSeconds : 0 });
  if (started) {
    state.recording = true;
    state.speechStats = speechCoach.snapshot();
    updateRecordingUI(state.speechStats);
  }
}

function finishSpeechAnswer() {
  if (state.busy || !state.session) return;
  state.recording = false;
  speechCoach.stop();
  updateRecordingUI(state.speechStats || speechCoach.snapshot());
  // SpeechRecognition delivers the final result after stop() asynchronously.
  // Wait briefly so the final words are included before scoring the answer.
  state.busy = true;
  window.setTimeout(() => {
    state.busy = false;
    processCurrentAnswer();
  }, 260);
}

async function processCurrentAnswer(forceTyped = false) {
  if (state.busy || !state.session) return;
  const textarea = document.querySelector("#answer-text");
  const stats = forceTyped ? null : (state.speechStats || speechCoach.snapshot());
  // The final recognition event can arrive after the stop button was pressed;
  // prefer that snapshot over the last interim text shown in the textarea.
  const text = (forceTyped ? textarea?.value : stats?.transcript || textarea?.value)?.trim() || "";
  if (!text) {
    showToast("Give an answer first, or skip this question.");
    return;
  }
  state.busy = true;
  state.recording = false;
  speechCoach.stop();
  const session = state.session;
  const question = session.questions[session.index];
  const inputMode = !forceTyped && stats?.durationSeconds >= 2 ? "speech" : "typed";
  const analysis = analyzeResponse({
    text,
    part: question.part,
    durationSeconds: inputMode === "speech" ? stats.durationSeconds : 0,
    confidence: stats?.confidence,
    pauseCount: stats?.pauseCount || 0,
    restarts: stats?.restarts || 0,
    inputMode,
  });
  const attempt = {
    id: uid("attempt"),
    sessionId: session.id,
    createdAt: new Date().toISOString(),
    mode: session.mode,
    requestedMode: session.requestedMode,
    topicId: question.topicId,
    question: question.question,
    part: question.part,
    inputMode,
    ...analysis,
  };
  try {
    await addAttempt(attempt);
  } catch (error) {
    console.error(error);
    state.busy = false;
    showToast("Could not save this answer locally. Please try submitting it again.");
    return;
  }
  state.attempts.push(attempt);
  session.analyses.push(analysis);
  session.attemptIds.push(attempt.id);

  if (question.allowAdaptive && !["mock", "diagnostic"].includes(session.mode)) {
    const fallback = question.part === 1 ? "Why do you feel that way?" : "Do you think this will change in the future?";
    session.questions.splice(session.index + 1, 0, {
      id: uid("question"), part: question.part, question: createAdaptiveFollowUp(text, question.part, fallback), topicId: question.topicId, adaptive: true, maxSeconds: question.maxSeconds,
    });
  }
  state.speechStats = null;
  speechCoach.reset();
  state.busy = false;
  if (["mock", "diagnostic"].includes(session.mode)) nextQuestion();
  else {
    state.questionResult = analysis;
    render();
  }
}

function retryQuestion() {
  const session = state.session;
  if (!session) return;
  const question = session.questions[session.index];
  state.questionResult = null;
  state.speechStats = null;
  state.recording = false;
  session.phase = question.cue ? "answer" : "answer";
  render();
  window.setTimeout(announceQuestion, 180);
}

function nextQuestion() {
  const session = state.session;
  if (!session) return;
  if (session.index + 1 >= session.questions.length) {
    completeSession();
    return;
  }
  session.index += 1;
  const next = session.questions[session.index];
  session.phase = next.cue ? "ready" : "answer";
  session.notes = "";
  session.prepRemaining = 60;
  state.questionResult = null;
  state.speechStats = null;
  state.recording = false;
  speechCoach.reset();
  render();
  window.setTimeout(announceQuestion, 200);
}

function skipQuestion() {
  state.recording = false;
  speechCoach.reset();
  nextQuestion();
}

async function completeSession() {
  const session = state.session;
  clearTimers();
  stopSpeaking();
  const summary = combineSessionScores(session.analyses);
  if (!summary) {
    state.view = "dashboard";
    state.session = null;
    render();
    showToast("Session ended without an answer.");
    return;
  }
  const record = {
    id: session.id,
    createdAt: session.startedAt,
    completedAt: new Date().toISOString(),
    mode: session.mode,
    requestedMode: session.requestedMode,
    questionCount: session.analyses.length,
    attemptIds: session.attemptIds,
    summary,
    scoringVersion: SCORING_VERSION,
  };
  let persistenceWarning = false;
  try {
    await addSession(record);
  } catch (error) {
    console.error(error);
    persistenceWarning = true;
  }
  state.sessions.push(record);
  const day = currentDay();
  const completed = new Set(state.profile.completedDays || []);
  completed.add(day);
  state.profile.completedDays = [...completed].sort((a, b) => a - b);
  try {
    await saveProfile(state.profile);
  } catch (error) {
    console.error(error);
    persistenceWarning = true;
  }
  state.result = record;
  state.session = null;
  state.view = "results";
  render();
  if (persistenceWarning) showToast("Result shown, but local storage failed. Export this result before leaving the page.");
}

function renderResults() {
  const summary = state.result.summary;
  const range = summary.bandRange;
  const hasOverall = summary.overall != null;
  const weak = Object.entries(summary.criteria).filter(([, value]) => value != null).sort((a, b) => a[1] - b[1])[0]?.[0] || "fluency";
  const title = state.result.mode === "mock" ? "Mock complete" : state.result.mode === "diagnostic" ? "Baseline established" : "Practice complete";
  app.innerHTML = `
    <main class="results-page">
      <section class="card results-card">
        <div class="result-score-panel">
          <div class="result-brand"><div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div><strong>Hashir Data Scientist</strong></div>
          <span>${hasOverall ? "Practice estimate" : "Language evidence only"}</span><div class="big-band">${formatBand(summary.overall)}</div><strong>${hasOverall ? "Overall speaking band" : "Overall band unavailable"}</strong>
          <p>${range ? `Likely range: ${formatBand(range.low)}–${formatBand(range.high)}<br>` : ""}Evidence quality: ${escapeHTML(summary.reliability)}<br>${summary.totalWords} words · ${formatDuration(summary.totalSeconds)} recorded speech</p>
        </div>
        <div class="result-detail">
          <p class="eyebrow">${escapeHTML(title)}</p><h1>${escapeHTML(state.profile.name)}, here is the useful part.</h1>
          <p>${hasOverall ? "Your central estimate equally weights the four public speaking criteria. The displayed range reflects limited automated evidence; use the pattern across several sessions, not one number." : "Language feedback is shown where evidence exists. An overall speaking band is withheld because fluency or pronunciation evidence was unavailable; the app does not fill missing criteria with guessed values."}</p>
          <div style="margin-top:28px">${rubricRows(summary.criteria)}</div>
          <div class="feedback-block priority" style="margin-top:25px"><h4>Next training priority</h4><p><strong>${escapeHTML(RUBRIC_SUMMARY[weak].label)}.</strong> ${escapeHTML(RUBRIC_SUMMARY[weak].short)} Re-answering with a different example is more valuable than memorising a polished response.</p></div>
          <div class="result-actions"><button class="btn btn-primary" data-start-session="adaptive">Train this weakness →</button><button class="btn btn-ghost" data-route="progress">View progress</button><button class="btn btn-ghost" data-route="dashboard">Back to today</button></div>
          <p class="result-disclaimer">This is an automated practice estimate, not an official IELTS score. Browser recognition cannot fully judge individual sounds, stress, rhythm or intonation, so provisional pronunciation is capped at 7.5 and left unscored when confidence data is unavailable.</p>
        </div>
      </section>
    </main>`;
}

function clearTimers() {
  window.clearInterval(state.recordTimer);
  window.clearInterval(state.prepTimer);
  state.recordTimer = null;
  state.prepTimer = null;
}

function exitSession() {
  if (!confirm("End this session? Completed answers will stay in your progress.")) return;
  state.recording = false;
  speechCoach.reset();
  stopSpeaking();
  clearTimers();
  state.session = null;
  state.questionResult = null;
  state.view = "dashboard";
  render();
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3900);
}

async function exportProgress() {
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `luma-ielts-progress-${todayISO()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Progress exported as JSON.");
}

async function resetAllData() {
  if (!confirm("Permanently clear your local profile, transcripts and progress? This cannot be undone.")) return;
  await clearProgress();
  localStorage.removeItem("lumaHasProfile");
  state.profile = null;
  state.attempts = [];
  state.sessions = [];
  state.view = "dashboard";
  render();
}

function sendConversation() {
  if (state.busy) return;
  const textarea = document.querySelector("#answer-text");
  const text = textarea?.value.trim() || state.speechStats?.transcript?.trim() || "";
  if (!text) {
    showToast("Say or type something to start the conversation.");
    return;
  }
  state.conversationMessages.push({ role: "user", text });
  const reply = conversationReply(text, state.conversationMode);
  state.conversationMessages.push({ role: "assistant", text: reply.text, feedback: reply.feedback });
  state.speechStats = null;
  speechCoach.reset();
  renderConversation();
  speak(reply.text, { lang: state.profile.lang, enabled: state.profile.autoSpeak });
}

function finishConversationRecording() {
  if (state.busy) return;
  state.recording = false;
  speechCoach.stop();
  updateRecordingUI(state.speechStats || speechCoach.snapshot());
  state.busy = true;
  window.setTimeout(() => {
    state.busy = false;
    sendConversation();
  }, 260);
}

function toggleConversationRecording() {
  if (state.busy) return;
  if (state.recording) {
    finishConversationRecording();
    return;
  }
  speechCoach.reset();
  speechCoach.lang = state.profile.lang;
  const started = speechCoach.start();
  if (started) {
    state.recording = true;
    state.speechStats = speechCoach.snapshot();
    updateRecordingUI(state.speechStats);
  }
}

app.addEventListener("click", async (event) => {
  const button = event.target.closest("button, [data-route]");
  if (!button) return;
  const route = button.dataset.route;
  if (route) {
    stopSpeaking();
    clearTimers();
    state.recording = false;
    speechCoach.reset();
    state.busy = false;
    state.view = route;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (button.dataset.startSession) return startSession(button.dataset.startSession, button.dataset.topicId || null);
  if (button.dataset.conversationMode) {
    state.conversationMode = button.dataset.conversationMode;
    state.conversationMessages = [];
    state.recording = false;
    speechCoach.reset();
    renderConversation();
    return;
  }
  const action = button.dataset.action;
  if (action === "reload-app") return location.reload();
  if (action === "start-prep") return startPrep();
  if (action === "begin-answer") return beginAnswer();
  if (action === "toggle-record") return toggleRecording();
  if (action === "toggle-conversation-record") return toggleConversationRecording();
  if (action === "send-conversation") return sendConversation();
  if (action === "clear-conversation") {
    state.conversationMessages = [];
    state.recording = false;
    speechCoach.reset();
    renderConversation();
    return;
  }
  if (action === "submit-typed") return processCurrentAnswer(true);
  if (action === "next-question") return nextQuestion();
  if (action === "retry-question") return retryQuestion();
  if (action === "skip-question") return skipQuestion();
  if (action === "repeat-question") return announceQuestion();
  if (action === "exit-session") return exitSession();
  if (action === "export-data") return exportProgress();
  if (action === "clear-data") return resetAllData();
  if (button.dataset.toggleSetting) {
    const key = button.dataset.toggleSetting;
    state.profile[key] = !state.profile[key];
    await saveProfile(state.profile);
    localStorage.setItem("lumaHasProfile", "1");
    render();
  }
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "onboarding-form") {
    const data = new FormData(event.target);
    state.profile = {
      name: String(data.get("name")).trim(),
      targetBand: Number(data.get("targetBand")),
      dailyMinutes: Number(data.get("dailyMinutes")),
      testDate: String(data.get("testDate") || ""),
      planStart: todayISO(),
      completedDays: [],
      autoSpeak: true,
      strictTiming: true,
      lang: "en-GB",
      createdAt: new Date().toISOString(),
    };
    await saveProfile(state.profile);
    state.view = "dashboard";
    render();
    showToast("Your 30-day plan is ready. Start with an honest diagnostic.");
  }
  if (event.target.id === "settings-form") {
    const data = new FormData(event.target);
    state.profile = {
      ...state.profile,
      name: String(data.get("name")).trim(),
      targetBand: Number(data.get("targetBand")),
      dailyMinutes: Number(data.get("dailyMinutes")),
      testDate: String(data.get("testDate") || ""),
    };
    await saveProfile(state.profile);
    render();
    showToast("Plan settings saved.");
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id === "prep-notes" && state.session) state.session.notes = event.target.value;
  if (event.target.id === "bank-search") {
    state.bankQuery = event.target.value;
    renderBank();
  }
});

app.addEventListener("change", async (event) => {
  if (event.target.id === "bank-type") {
    state.bankType = event.target.value;
    renderBank();
  }
  if (event.target.id === "speech-lang") {
    state.profile.lang = event.target.value;
    speechCoach.lang = event.target.value;
    await saveProfile(state.profile);
    showToast("Speech language updated.");
  }
});

window.addEventListener("beforeunload", () => {
  speechCoach.stop();
  stopSpeaking();
});

async function migrateScoringData() {
  if (!state.attempts.some((attempt) => attempt.scoringVersion !== SCORING_VERSION)
      && !state.sessions.some((session) => session.scoringVersion !== SCORING_VERSION)) return;

  const rescoredAttempts = [];
  for (const attempt of state.attempts) {
    if (attempt.scoringVersion === SCORING_VERSION) {
      rescoredAttempts.push(attempt);
      continue;
    }
    const legacyConfidence = attempt.metrics?.confidence;
    // Version 1 inserted 60 when the browser supplied no confidence. Treat that
    // ambiguous value as unavailable instead of preserving a guessed score.
    const confidence = legacyConfidence != null && legacyConfidence !== 60 ? legacyConfidence / 100 : null;
    const rescored = {
      ...attempt,
      ...analyzeResponse({
        text: attempt.text || "",
        part: attempt.part,
        durationSeconds: attempt.metrics?.durationSeconds || 0,
        confidence,
        pauseCount: attempt.metrics?.pauseCount || 0,
        restarts: attempt.metrics?.recognizerRestarts || 0,
        inputMode: attempt.inputMode || "typed",
      }),
      rescoredAt: new Date().toISOString(),
    };
    await addAttempt(rescored);
    rescoredAttempts.push(rescored);
  }
  state.attempts = rescoredAttempts;

  const attemptsById = new Map(state.attempts.map((attempt) => [attempt.id, attempt]));
  const rescoredSessions = [];
  for (const session of state.sessions) {
    const analyses = (session.attemptIds || []).map((id) => attemptsById.get(id)).filter(Boolean);
    const updated = analyses.length
      ? { ...session, summary: combineSessionScores(analyses), scoringVersion: SCORING_VERSION }
      : { ...session, scoringVersion: SCORING_VERSION };
    await addSession(updated);
    rescoredSessions.push(updated);
  }
  state.sessions = rescoredSessions;
}

async function init() {
  try {
    // First-time learners should see useful UI immediately while IndexedDB opens.
    // Returning learners keep the short branded loader to avoid an onboarding flash.
    if (!localStorage.getItem("lumaHasProfile")) renderOnboarding();
    await openDatabase();
    await seedTopics();
    [state.profile, state.attempts, state.sessions, state.topics] = await Promise.all([getProfile(), getAttempts(), getSessions(), getTopics()]);
    await migrateScoringData();
    render();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<main class="boot-screen"><div class="brand-mark"><span></span><span></span><span></span></div><h1>Local storage is unavailable</h1><p>Please allow site storage or leave private browsing, then reload.</p><button class="btn btn-primary" data-action="reload-app">Try again</button></main>`;
  }
}

init();
