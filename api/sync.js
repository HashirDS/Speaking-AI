const supabaseUrl = () => process.env.SUPABASE_URL;
const anonKey = () => process.env.SUPABASE_ANON_KEY;

async function request(path, options = {}, token) {
  const headers = {
    apikey: anonKey(),
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  return fetch(`${supabaseUrl()}${path}`, { ...options, headers });
}

async function bodyOf(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return { error: text }; }
}

async function currentUser(token) {
  const response = await request("/auth/v1/user", {}, token);
  return response.ok ? bodyOf(response) : null;
}

async function readTable(table, userId, token) {
  const query = table === "profiles"
    ? `/${table}?id=eq.${encodeURIComponent(userId)}&select=payload`
    : `/${table}?user_id=eq.${encodeURIComponent(userId)}&select=id,payload,created_at&order=created_at.asc`;
  const response = await request(`/rest/v1${query}`, {}, token);
  if (!response.ok) throw new Error(`Could not read ${table}.`);
  return bodyOf(response);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!supabaseUrl() || !anonKey()) return res.status(503).json({ error: "Cloud database is not configured." });
  if (!['GET', 'POST'].includes(req.method || 'GET')) return res.status(405).json({ error: "Method not allowed." });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required." });
  const user = await currentUser(token);
  if (!user?.id) return res.status(401).json({ error: "Your session has expired. Please sign in again." });

  try {
    if (req.method === "GET") {
      const [profiles, attempts, sessions] = await Promise.all([
        readTable("profiles", user.id, token),
        readTable("attempts", user.id, token),
        readTable("sessions", user.id, token),
      ]);
      return res.status(200).json({
        profile: profiles[0]?.payload || null,
        attempts: attempts.map((item) => item.payload),
        sessions: sessions.map((item) => item.payload),
      });
    }

    const body = req.body || {};
    const profile = body.profile || null;
    const attempts = Array.isArray(body.attempts) ? body.attempts : [];
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    if (profile) {
      const response = await request("/rest/v1/profiles?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: user.id, payload: profile, updated_at: new Date().toISOString() }),
      }, token);
      if (!response.ok) throw new Error("Could not save profile.");
    }
    for (const [table, records] of [["attempts", attempts], ["sessions", sessions]]) {
      if (!records.length) continue;
      const rows = records.map((payload) => ({
        id: payload.id,
        user_id: user.id,
        payload,
        created_at: payload.createdAt || new Date().toISOString(),
      }));
      const response = await request(`/rest/v1/${table}?on_conflict=id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      }, token);
      if (!response.ok) throw new Error(`Could not save ${table}.`);
    }
    return res.status(200).json({ synced: true });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: error.message || "Cloud sync failed." });
  }
}
