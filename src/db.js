import { ALL_TOPICS } from "./data.js";

const DB_NAME = "ielts-speaking-coach";
const DB_VERSION = 1;
let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("topics")) db.createObjectStore("topics", { keyPath: "id" });
      if (!db.objectStoreNames.contains("attempts")) {
        const attempts = db.createObjectStore("attempts", { keyPath: "id" });
        attempts.createIndex("createdAt", "createdAt");
        attempts.createIndex("topicId", "topicId");
      }
      if (!db.objectStoreNames.contains("sessions")) {
        const sessions = db.createObjectStore("sessions", { keyPath: "id" });
        sessions.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function store(name, mode = "readonly") {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

export async function seedTopics() {
  const count = await requestToPromise((await store("topics")).count());
  if (count >= ALL_TOPICS.length) return count;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("topics", "readwrite");
    const topicStore = transaction.objectStore("topics");
    ALL_TOPICS.forEach((topic) => topicStore.put(topic));
    transaction.oncomplete = () => resolve(ALL_TOPICS.length);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Topic seeding was aborted"));
  });
}

export async function getTopics() {
  return requestToPromise((await store("topics")).getAll());
}

export async function getProfile() {
  const result = await requestToPromise((await store("settings")).get("profile"));
  return result?.value || null;
}

export async function saveProfile(profile) {
  await requestToPromise((await store("settings", "readwrite")).put({ key: "profile", value: profile }));
  return profile;
}

export async function addAttempt(attempt) {
  await requestToPromise((await store("attempts", "readwrite")).put(attempt));
  return attempt;
}

export async function getAttempts() {
  const results = await requestToPromise((await store("attempts")).getAll());
  return results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function addSession(session) {
  await requestToPromise((await store("sessions", "readwrite")).put(session));
  return session;
}

export async function getSessions() {
  const results = await requestToPromise((await store("sessions")).getAll());
  return results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function exportAllData() {
  const [profile, attempts, sessions, topics] = await Promise.all([getProfile(), getAttempts(), getSessions(), getTopics()]);
  return { exportedAt: new Date().toISOString(), version: DB_VERSION, profile, attempts, sessions, topics };
}

export async function clearProgress() {
  const db = await openDatabase();
  await Promise.all(["attempts", "sessions", "settings"].map((name) => new Promise((resolve, reject) => {
    const request = db.transaction(name, "readwrite").objectStore(name).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  })));
}
