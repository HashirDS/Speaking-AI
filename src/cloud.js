const SESSION_KEY = "luma-cloud-session";

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

function writeSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.error || "Cloud request failed.");
  return body;
}

async function authRequest(options = {}) {
  const response = await fetch("/api/auth", {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return readResponse(response);
}

export function cloudSession() {
  return readSession();
}

export async function signUp(email, password) {
  const data = await authRequest({ method: "POST", body: JSON.stringify({ action: "signup", email, password }) });
  if (data.access_token) writeSession(data);
  return data;
}

export async function signIn(email, password) {
  const data = await authRequest({ method: "POST", body: JSON.stringify({ action: "login", email, password }) });
  writeSession(data);
  return data;
}

export function signOut() {
  writeSession(null);
}

export async function syncCloudData(localData) {
  const session = readSession();
  if (!session?.access_token) throw new Error("Sign in to sync your progress.");
  const headers = { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
  const remoteResponse = await fetch("/api/sync", { headers });
  const remote = await readResponse(remoteResponse);
  const attempts = mergeById(localData.attempts, remote.attempts);
  const sessions = mergeById(localData.sessions, remote.sessions);
  const profile = localData.profile || remote.profile;
  const saveResponse = await fetch("/api/sync", {
    method: "POST",
    headers,
    body: JSON.stringify({ profile, attempts, sessions }),
  });
  await readResponse(saveResponse);
  return { profile, attempts, sessions };
}

function mergeById(localItems = [], remoteItems = []) {
  const merged = new Map(remoteItems.map((item) => [item.id, item]));
  localItems.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}
