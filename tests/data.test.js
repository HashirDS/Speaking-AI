import test from "node:test";
import assert from "node:assert/strict";
import { ALL_TOPICS, CUE_CARDS, PART_ONE_TOPICS, PLAN_DAYS } from "../src/data.js";

test("the local plan has exactly 30 progressive days", () => {
  assert.equal(PLAN_DAYS.length, 30);
  assert.deepEqual(PLAN_DAYS.map((item) => item.day), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(PLAN_DAYS[0].phase, "Foundation");
  assert.equal(PLAN_DAYS[29].phase, "Perform");
});

test("topic IDs are unique and every topic has enough prompts", () => {
  assert.equal(new Set(ALL_TOPICS.map((topic) => topic.id)).size, ALL_TOPICS.length);
  assert.equal(PART_ONE_TOPICS.length >= 15, true);
  assert.equal(CUE_CARDS.length >= 15, true);
  PART_ONE_TOPICS.forEach((topic) => assert.equal(topic.questions.length >= 4, true));
  CUE_CARDS.forEach((topic) => {
    assert.equal(topic.bullets.length, 4);
    assert.equal(topic.part3.length >= 4, true);
    assert.equal(Boolean(topic.followUp), true);
  });
});
