import test from "node:test";
import assert from "node:assert/strict";
import { analyzeResponse, combineSessionScores, createAdaptiveFollowUp, weakestCriterion } from "../src/scoring.js";

test("spoken analysis returns four bounded half-band estimates", () => {
  const result = analyzeResponse({
    text: "At the moment, I live in Lahore, which is a lively city. Although the centre can be hectic, my neighbourhood is fairly calm because there is a park nearby. For example, I walk there after work, so it gives me a useful break from traffic and screens.",
    part: 1,
    durationSeconds: 27,
    confidence: 0.82,
    pauseCount: 1,
    inputMode: "speech",
  });
  assert.equal(result.metrics.words > 35, true);
  for (const score of Object.values(result.criteria)) {
    assert.equal(score >= 3 && score <= 9, true);
    assert.equal((score * 2) % 1, 0);
  }
  assert.equal(result.reliability, "useful");
});

test("typed answers do not invent pronunciation evidence", () => {
  const result = analyzeResponse({ text: "I enjoy my neighbourhood because it is quiet and convenient.", part: 1, inputMode: "typed" });
  assert.equal(result.criteria.fluency, null);
  assert.equal(result.criteria.pronunciation, null);
  assert.equal(result.overall, null);
  assert.equal(result.metrics.wpm, null);
  assert.match(result.feedback.priorities.join(" "), /cannot provide fluency or pronunciation evidence/);
});

test("known grammar signals create specific corrective evidence", () => {
  const result = analyzeResponse({
    text: "I am agree because people is friendly, but yesterday I go to the market.",
    part: 1,
    durationSeconds: 14,
    confidence: 0.64,
    inputMode: "speech",
  });
  assert.equal(result.metrics.likelyErrors.length >= 2, true);
  assert.equal(result.criteria.grammar <= result.criteria.lexical, true);
});

test("session aggregation averages every available criterion", () => {
  const first = analyzeResponse({ text: "I like it because it is practical and easy to use.", part: 1, durationSeconds: 12, confidence: 0.72, inputMode: "speech" });
  const second = analyzeResponse({ text: "Although it can be expensive, it is beneficial because people save time and can focus on other priorities.", part: 3, durationSeconds: 22, confidence: 0.76, inputMode: "speech" });
  const combined = combineSessionScores([first, second]);
  assert.equal(combined.totalWords, first.metrics.words + second.metrics.words);
  assert.equal(combined.overall >= 3 && combined.overall <= 9, true);
});

test("adaptive follow-up uses answer evidence without scripting a response", () => {
  const followUp = createAdaptiveFollowUp("My neighbourhood has a beautiful community garden and I visit the garden every evening.", 1, "Why?");
  assert.match(followUp, /garden/i);
  assert.equal(followUp.endsWith("?"), true);
});

test("weakest criterion uses recent recorded scores", () => {
  const attempts = [
    { criteria: { fluency: 7, lexical: 6, grammar: 7, pronunciation: 7 } },
    { criteria: { fluency: 7.5, lexical: 6.5, grammar: 7, pronunciation: 7 } },
  ];
  assert.equal(weakestCriterion(attempts), "lexical");
});

test("calibration separates a hesitant basic answer from developed speech", () => {
  const basic = analyzeResponse({
    text: "Um I live Lahore and people is nice um very good place.",
    part: 1,
    durationSeconds: 19,
    confidence: 0.56,
    pauseCount: 3,
    inputMode: "speech",
  });
  const developed = analyzeResponse({
    text: "I live in Lahore, which is a fairly lively city. Although the centre can be hectic, my neighbourhood is relatively calm. For example, there is a small park nearby where I go for a walk after work, so it gives me a welcome break from traffic and screens.",
    part: 1,
    durationSeconds: 28,
    confidence: 0.84,
    pauseCount: 1,
    inputMode: "speech",
  });
  assert.equal(basic.overall <= 5.5, true);
  assert.equal(developed.overall > basic.overall, true);
  assert.equal(developed.overall <= 8.5, true);
});

test("content uses of like and actually are not counted as fillers", () => {
  const result = analyzeResponse({
    text: "I actually like classical music because it helps me focus while I am studying.",
    part: 1,
    durationSeconds: 9,
    confidence: 0.8,
    inputMode: "speech",
  });
  assert.equal(result.metrics.fillers, 0);
});

test("browser service restarts do not lower the learner's fluency score", () => {
  const answer = { text: "I enjoy reading because it helps me relax, and I often learn something useful as well.", part: 1, durationSeconds: 12, confidence: 0.8, inputMode: "speech" };
  const stable = analyzeResponse({ ...answer, restarts: 0 });
  const restarted = analyzeResponse({ ...answer, restarts: 4 });
  assert.equal(restarted.criteria.fluency, stable.criteria.fluency);
  assert.equal(restarted.metrics.recognizerRestarts, 4);
});

test("missing ASR confidence is reported instead of guessed", () => {
  const result = analyzeResponse({
    text: "I enjoy reading because it gives me a quiet way to learn about unfamiliar ideas.",
    part: 1,
    durationSeconds: 13,
    inputMode: "speech",
  });
  assert.equal(result.criteria.pronunciation, null);
  assert.equal(result.overall, null);
  assert.equal(result.limitations.pronunciationUnavailable, true);
});

test("adaptive follow-ups avoid empty adverbs", () => {
  const followUp = createAdaptiveFollowUp("I currently live in a peaceful neighbourhood with a community garden nearby.", 1, "Why?");
  assert.doesNotMatch(followUp, /currently/i);
  assert.match(followUp, /neighbourhood|community|garden/i);
});
