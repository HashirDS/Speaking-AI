import { analyzeResponse } from "../src/scoring.js";

const samples = [
  {
    label: "hesitant/basic",
    text: "Um I live in Lahore and it is nice. People is friendly and, um, I like this place.",
    part: 1,
    durationSeconds: 24,
    confidence: 0.56,
    pauseCount: 3,
    inputMode: "speech",
  },
  {
    label: "competent/developed",
    text: "I live in Lahore with my family, and I have been there for most of my life. I enjoy the area because it is convenient and most of the people are friendly. However, the roads become crowded in the evening, so travelling can sometimes take longer than expected.",
    part: 1,
    durationSeconds: 30,
    confidence: 0.76,
    pauseCount: 1,
    inputMode: "speech",
  },
  {
    label: "flexible/advanced",
    text: "I live in Lahore, which is a remarkably diverse city. What appeals to me most is the contrast: although the centre is extremely lively, my neighbourhood is relatively peaceful. For instance, there is a community garden nearby where residents meet in the evening, so it offers both a break from traffic and a genuine sense of connection.",
    part: 1,
    durationSeconds: 32,
    confidence: 0.87,
    pauseCount: 1,
    inputMode: "speech",
  },
];

console.table(samples.map((sample) => {
  const result = analyzeResponse(sample);
  return {
    sample: sample.label,
    overall: result.overall,
    range: result.bandRange ? `${result.bandRange.low}-${result.bandRange.high}` : "unavailable",
    fluency: result.criteria.fluency,
    lexical: result.criteria.lexical,
    grammar: result.criteria.grammar,
    pronunciation: result.criteria.pronunciation,
    evidence: result.reliability,
  };
}));
