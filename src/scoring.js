const FILLERS = /\b(um+|uh+|erm+|ah+|hmm+|you know|i mean)\b/gi;
const BASIC_LINKERS = /\b(and|but|so|because|also|for example|for instance)\b/gi;
const ADVANCED_LINKERS = /\b(although|however|therefore|whereas|as a result|on the other hand|in contrast|that said|nevertheless|consequently|even so|in other words)\b/gi;
const COMPLEX_PATTERNS = [
  /\b(although|even though|whereas|unless)\b/i,
  /\b(because|since|so that|in order to)\b/i,
  /\b(which|who|whose|where)\b/i,
  /\b(if|whether|provided that|as long as)\b/i,
  /\b(despite|in spite of|having|given that)\b/i,
];
const PRECISE_WORDS = /\b(significant|particularly|consequently|beneficial|challenging|effective|efficient|essential|influence|perspective|considerable|practical|reliable|accessible|sustainable|alternative|priority|maintain|encourage|contribute|preserve|inevitable|subtle|widespread|reluctant|compelling|convenient|diverse|infrastructure|accountable|independent)\b/gi;
const VAGUE_WORDS = /\b(very good|very bad|nice|stuff|things? like that|a lot of things|and everything|whatever)\b/gi;
const COMMON = new Set("a an the and or but if to of in on at for from with by is am are was were be been being do does did have has had i you he she it we they my your our their this that these those very really just quite also so because as about can could would should will may might not yes no there here what when where who how which then than".split(" "));
const ADAPTIVE_SKIP = new Set("currently recently usually sometimes always never really fairly quite actually basically probably perhaps maybe important different thing things people someone something anything everything today yesterday tomorrow answer question example although because however therefore mentioned enjoyed useful learned first often still much many more most mainly especially generally personally definitely certainly".split(" "));

export const SCORING_VERSION = 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const half = (value) => Math.round(value * 2) / 2;

function tokensOf(text) {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function matches(text, regex) {
  return text.match(regex) || [];
}

function metricToBand(metric) {
  if (metric >= 92) return 9;
  if (metric >= 84) return 8.5;
  if (metric >= 77) return 8;
  if (metric >= 70) return 7.5;
  if (metric >= 63) return 7;
  if (metric >= 56) return 6.5;
  if (metric >= 49) return 6;
  if (metric >= 42) return 5.5;
  if (metric >= 35) return 5;
  if (metric >= 28) return 4.5;
  if (metric >= 21) return 4;
  if (metric >= 15) return 3.5;
  if (metric >= 10) return 3;
  if (metric >= 6) return 2.5;
  return metric > 0 ? 2 : 1;
}

function detectLikelyErrors(text) {
  const checks = [
    { regex: /\bi am agree\b/gi, label: "Use 'I agree', without 'am'." },
    { regex: /\bpeople is\b/gi, label: "Use 'people are'." },
    { regex: /\bthere have\b/gi, label: "Check 'there is/are' when describing existence." },
    { regex: /\b(?:he|she|it) have\b/gi, label: "Use 'has' with he, she or it." },
    { regex: /\b(?:he|she|it) don't\b/gi, label: "Use 'doesn't' with he, she or it." },
    { regex: /\bdidn['’]?t\s+\w+ed\b/gi, label: "After 'didn't', use the base form of the verb." },
    { regex: /\bmore (?:better|easier|faster|slower)\b/gi, label: "Avoid a double comparative such as 'more better'." },
    { regex: /\bdiscuss about\b/gi, label: "Use 'discuss something', without 'about'." },
    { regex: /\bdepend of\b/gi, label: "Use 'depend on'." },
    { regex: /\bmarried with\b/gi, label: "Use 'married to'." },
    { regex: /\b(?:one|each|every) (?:people|students|children|persons)\b/gi, label: "Check singular nouns after one, each or every." },
    { regex: /\b(?:yesterday|last (?:week|year|month|night))\b[^.!?]{0,55}\b(?:go|see|buy|meet|take|make|come)\b/gi, label: "Check past-tense verbs after a finished past-time marker." },
  ];
  return checks.flatMap(({ regex, label }) => matches(text, regex).map(() => label));
}

function responseLengthTarget(part) {
  if (Number(part) === 2) return { floor: 90, strong: 190 };
  if (Number(part) === 3) return { floor: 35, strong: 80 };
  return { floor: 18, strong: 42 };
}

function movingDiversity(tokens) {
  if (!tokens.length) return 0;
  const size = Math.min(25, tokens.length);
  if (tokens.length === size) return new Set(tokens).size / size;
  let total = 0;
  let windows = 0;
  for (let index = 0; index <= tokens.length - size; index += 5) {
    total += new Set(tokens.slice(index, index + size)).size / size;
    windows += 1;
  }
  return total / Math.max(windows, 1);
}

function paceQuality(wpm) {
  if (wpm >= 105 && wpm <= 170) return 1;
  if (wpm >= 90 && wpm <= 190) return 0.78;
  if (wpm >= 70 && wpm <= 210) return 0.5;
  return 0.24;
}

function evidenceCeiling(words, target, part) {
  if (words < 4) return 3;
  if (words < 8) return 4;
  if (words < target.floor) return 6;
  if (Number(part) === 1 && words < 28) return 7.5;
  if (words < target.strong) return 8;
  return 8.5;
}

function consecutiveRepetitions(tokens) {
  let count = 0;
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === tokens[index - 1] && tokens[index].length > 2) count += 1;
  }
  return count;
}

function bandRange(overall, reliability, sessionBreadth = false) {
  if (overall == null) return null;
  const margin = reliability === "useful" && sessionBreadth ? 0.5 : 1;
  return { low: half(clamp(overall - margin, 1, 9)), high: half(clamp(overall + margin, 1, 9)) };
}

export function analyzeResponse({
  text = "",
  durationSeconds = 0,
  part = 1,
  confidence = null,
  pauseCount = 0,
  restarts = 0,
  inputMode = "speech",
} = {}) {
  const clean = text.trim().replace(/\s+/g, " ");
  const tokens = tokensOf(clean);
  const words = tokens.length;
  const contentTokens = tokens.filter((token) => token.length > 2 && !COMMON.has(token));
  const uniqueContent = new Set(contentTokens);
  const fillers = matches(clean, FILLERS).length;
  const basicLinkers = matches(clean, BASIC_LINKERS).length;
  const advancedLinkers = matches(clean, ADVANCED_LINKERS).length;
  const linkers = basicLinkers + advancedLinkers;
  const complexTypes = COMPLEX_PATTERNS.filter((regex) => regex.test(clean)).length;
  const preciseWords = matches(clean, PRECISE_WORDS).length;
  const vagueWords = matches(clean, VAGUE_WORDS).length;
  const repetitions = consecutiveRepetitions(tokens);
  const likelyErrors = detectLikelyErrors(clean);
  const target = responseLengthTarget(part);
  const adequacy = clamp(words / target.floor, 0, 1);
  const development = clamp(words / target.strong, 0, 1);
  const hasAudioEvidence = inputMode === "speech" && durationSeconds >= 2;
  const wpm = hasAudioEvidence ? Math.round((words / Math.max(durationSeconds, 1)) * 60) : null;
  const pace = wpm == null ? 0 : paceQuality(wpm);
  const fillerRate = words ? (fillers / words) * 100 : 0;
  const pauseRate = hasAudioEvidence ? pauseCount / Math.max(durationSeconds / 60, 0.1) : 0;
  const cohesionQuality = clamp(basicLinkers * 0.11 + advancedLinkers * 0.24, 0, 1);

  const fluencyMetric = clamp(
    18 + adequacy * 22 + development * 10 + pace * 25 + cohesionQuality * 15
      - fillerRate * 1.2 - Math.max(0, pauseRate - 7) * 1.8 - repetitions * 2.5,
    2,
    96,
  );

  const diversity = movingDiversity(contentTokens);
  const diversityQuality = clamp((diversity - 0.45) / 0.45, 0, 1);
  const averageContentLength = contentTokens.length
    ? contentTokens.reduce((sum, word) => sum + word.length, 0) / contentTokens.length
    : 0;
  const specificity = clamp((averageContentLength - 4.2) / 3.8, 0, 1);
  const vagueRate = words ? (vagueWords / words) * 100 : 0;
  const excessContentRepetition = contentTokens.length
    ? [...contentTokens.reduce((map, word) => map.set(word, (map.get(word) || 0) + 1), new Map()).values()]
      .reduce((sum, count) => sum + Math.max(0, count - 2), 0) / contentTokens.length
    : 0;
  const lexicalMetric = clamp(
    18 + adequacy * 18 + development * 8
      + diversityQuality * 22 * (0.45 + development * 0.55) + specificity * 12
      + Math.min(preciseWords, 4) * 2 - vagueRate * 1.8 - excessContentRepetition * 22,
    2,
    94,
  );

  const tenseSignals = [
    /\b(was|were|had|did|went|made|felt|used to|[a-z]+ed)\b/i,
    /\b(is|are|have|has|usually|often|generally)\b/i,
    /\b(will|going to|might|may|could|would)\b/i,
  ].filter((regex) => regex.test(clean)).length;
  const accuracyBonus = likelyErrors.length === 0 ? 8 : likelyErrors.length === 1 ? 3 : 0;
  const grammarMetric = clamp(
    25 + adequacy * 20 + development * 6 + complexTypes * 5.5 + tenseSignals * 4.5
      + accuracyBonus - likelyErrors.length * 10,
    2,
    94,
  );

  // SpeechRecognition confidence is only a rough intelligibility signal. Some
  // browsers omit it; in that case an honest pronunciation estimate is absent.
  const hasConfidence = hasAudioEvidence && Number.isFinite(confidence) && confidence > 0 && confidence <= 1;
  const recognizerConfidence = hasConfidence ? confidence : null;
  const pronunciationMetric = hasConfidence
    ? clamp(22 + recognizerConfidence * 55 + pace * 10 - Math.max(0, pauseRate - 8) * 1.2, 5, 88)
    : null;

  const ceiling = evidenceCeiling(words, target, part);
  const cap = (metric, maximum = ceiling) => Math.min(metricToBand(metric), maximum);
  const criteria = {
    fluency: hasAudioEvidence ? cap(fluencyMetric) : null,
    lexical: cap(lexicalMetric),
    grammar: cap(grammarMetric),
    // ASR cannot observe the full pronunciation descriptor (sounds, stress,
    // rhythm and intonation), so it cannot justify a score above 7.5.
    pronunciation: pronunciationMetric == null ? null : cap(pronunciationMetric, Math.min(7.5, ceiling)),
  };
  const hasAllCriteria = Object.values(criteria).every((value) => value != null);
  const overall = hasAllCriteria ? half(Object.values(criteria).reduce((sum, value) => sum + value, 0) / 4) : null;
  const reliability = words < 8 ? "insufficient"
    : !hasAudioEvidence || !hasConfidence || words < target.floor ? "limited"
      : "useful";

  const result = {
    scoringVersion: SCORING_VERSION,
    text: clean,
    part: Number(part),
    criteria,
    overall,
    reliability,
    bandRange: bandRange(overall, reliability, false),
    limitations: {
      transcriptOnly: !hasAudioEvidence,
      pronunciationUnavailable: !hasConfidence,
      pronunciationCapped: hasConfidence,
    },
    metrics: {
      words,
      uniqueWords: uniqueContent.size,
      durationSeconds: Math.round(durationSeconds),
      wpm,
      fillers,
      fillerRate: Math.round(fillerRate * 10) / 10,
      linkers,
      basicLinkers,
      advancedLinkers,
      complexMarkers: complexTypes,
      likelyErrors,
      confidence: recognizerConfidence == null ? null : Math.round(recognizerConfidence * 100),
      pauseCount,
      pauseRate: Math.round(pauseRate * 10) / 10,
      recognizerRestarts: restarts,
      repetitions,
      vagueWords,
    },
  };
  result.feedback = buildFeedback({ ...result.metrics, target, part, hasAudioEvidence, hasConfidence });
  return result;
}

function buildFeedback({ words, wpm, fillers, fillerRate, basicLinkers, advancedLinkers, complexMarkers, likelyErrors, target, part, hasAudioEvidence, hasConfidence, confidence, repetitions, vagueWords }) {
  const strengths = [];
  const priorities = [];
  if (words >= target.floor) strengths.push("You extended the answer enough to provide meaningful language evidence.");
  if (hasAudioEvidence && wpm >= 105 && wpm <= 170) strengths.push("Your observed speaking rate was within a natural conversational range.");
  if (advancedLinkers >= 1) strengths.push("You made at least one more precise relationship between ideas explicit.");
  else if (basicLinkers >= 2) strengths.push("Your answer included clear basic links between ideas.");
  if (complexMarkers >= 2) strengths.push("You attempted more than one type of subordinate structure.");
  if (hasConfidence && confidence >= 78) strengths.push("The browser captured your words consistently, supporting provisional intelligibility evidence.");
  if (!strengths.length) strengths.push("You produced an answer that can now be developed with a reason and specific detail.");

  if (words < target.floor) {
    const frame = Number(part) === 3 ? "claim -> reason -> example -> consequence"
      : Number(part) === 2 ? "setting -> key details -> change/result -> reflection"
        : "answer -> reason -> specific detail";
    priorities.push(`Extend with ${frame}; do not memorise a script.`);
  }
  if (fillers >= 2 && fillerRate >= 3.5) priorities.push("Replace repeated um/uh-style fillers with one brief silent pause.");
  if (repetitions > 0) priorities.push("Avoid restarting the same word; pause, choose the phrase, and continue once.");
  if (hasAudioEvidence && wpm > 185) priorities.push("Slow slightly and group words around meaning; speed does not raise the band.");
  if (hasAudioEvidence && wpm > 0 && wpm < 85) priorities.push("Build momentum in short thought groups without rushing individual sounds.");
  if (basicLinkers + advancedLinkers === 0 && words >= 18) priorities.push("Show one clear cause, contrast or example instead of listing separate ideas.");
  if (complexMarkers < 2 && words >= 35) priorities.push("Use one accurate subordinate clause where the meaning genuinely needs it.");
  if (vagueWords > 0) priorities.push("Replace vague wording such as 'nice' or 'things' with one exact quality or example.");
  if (likelyErrors.length) priorities.push(likelyErrors[0]);
  if (!hasAudioEvidence) priorities.push("Typed text cannot provide fluency or pronunciation evidence; record the answer for a speaking estimate.");
  else if (!hasConfidence) priorities.push("This browser supplied no recognition confidence, so pronunciation is left unscored rather than guessed.");
  else if (confidence < 67) priorities.push("The recogniser found parts difficult to capture. Re-record with clearer stressed words and complete word endings.");
  if (!priorities.length) priorities.push("Re-answer with a different example to test flexible, unrehearsed language.");

  return { strengths: strengths.slice(0, 2), priorities: priorities.slice(0, 3) };
}

export function combineSessionScores(analyses = []) {
  if (!analyses.length) return null;
  const keys = ["fluency", "lexical", "grammar", "pronunciation"];
  const weightFor = (item) => {
    const partWeight = item.part === 2 ? 1.5 : item.part === 3 ? 1.25 : 1;
    return partWeight * (item.reliability === "useful" ? 1 : item.reliability === "limited" ? 0.7 : 0.4);
  };
  const criteria = Object.fromEntries(keys.map((key) => {
    const scored = analyses.filter((item) => item.criteria[key] != null).map((item) => ({ value: item.criteria[key], weight: weightFor(item) }));
    const weight = scored.reduce((sum, item) => sum + item.weight, 0);
    return [key, scored.length ? half(scored.reduce((sum, item) => sum + item.value * item.weight, 0) / weight) : null];
  }));
  const hasAllCriteria = Object.values(criteria).every((value) => value != null);
  const overall = hasAllCriteria ? half(Object.values(criteria).reduce((sum, value) => sum + value, 0) / 4) : null;
  const usefulAnswers = analyses.filter((item) => item.reliability === "useful").length;
  const partsCovered = new Set(analyses.map((item) => item.part)).size;
  const reliability = usefulAnswers >= Math.ceil(analyses.length / 2) && analyses.length >= 3 ? "useful" : "limited";
  const breadth = analyses.length >= 5 && partsCovered >= 2;
  return {
    criteria,
    overall,
    reliability,
    bandRange: bandRange(overall, reliability, breadth),
    totalWords: analyses.reduce((sum, item) => sum + item.metrics.words, 0),
    totalSeconds: analyses.reduce((sum, item) => sum + item.metrics.durationSeconds, 0),
    coverage: {
      answers: analyses.length,
      parts: partsCovered,
      usefulAnswers,
      pronunciationAnswers: analyses.filter((item) => item.criteria.pronunciation != null).length,
    },
  };
}

export function createAdaptiveFollowUp(answer, part, fallback) {
  const tokens = tokensOf(answer).filter((word) => word.length >= 5 && !COMMON.has(word) && !ADAPTIVE_SKIP.has(word) && !word.endsWith("ly"));
  if (tokens.length < 3) return "Could you tell me a little more about that?";
  const frequency = tokens.reduce((map, word) => map.set(word, (map.get(word) || 0) + 1), new Map());
  const keyword = [...frequency.entries()]
    .sort((a, b) => ((b[1] - 1) * 5 + Math.min(b[0].length, 12) * 0.2) - ((a[1] - 1) * 5 + Math.min(a[0].length, 12) * 0.2))[0]?.[0];
  if (!keyword) return fallback || "Why do you think that is?";
  if (Number(part) === 1) return `You mentioned ${keyword}. What makes that important to you?`;
  if (Number(part) === 3) return `Looking more widely, how might ${keyword} change in the future?`;
  return fallback || `Why does ${keyword} stand out in your memory?`;
}

export function weakestCriterion(attempts = []) {
  const keys = ["fluency", "lexical", "grammar", "pronunciation"];
  const averages = keys.map((key) => {
    const values = attempts.slice(-12).map((attempt) => attempt.criteria?.[key]).filter((value) => value != null);
    return { key, value: values.length ? values.reduce((sum, score) => sum + score, 0) / values.length : null };
  }).filter((item) => item.value != null);
  return averages.sort((a, b) => a.value - b.value)[0]?.key || "fluency";
}
