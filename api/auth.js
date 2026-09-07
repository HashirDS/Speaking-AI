const supabaseUrl = () => process.env.SUPABASE_URL;
const anonKey = () => process.env.SUPABASE_ANON_KEY;

function configError() {
  return !supabaseUrl() || !anonKey();
}

async function request(path, options = {}, token = "") {
  const headers = {
    apikey: anonKey(),
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  return fetch(`${supabaseUrl()}${path}`, { ...options, headers });
}

async function responseBody(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return { error: text }; }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (configError()) return res.status(503).json({ error: "Cloud database is not configured." });
  if (!['GET', 'POST'].includes(req.method || 'GET')) return res.status(405).json({ error: "Method not allowed." });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (req.method === "GET") {
    if (!token) return res.status(401).json({ error: "Authentication required." });
    const response = await request("/auth/v1/user", {}, token);
    return res.status(response.status).json(await responseBody(response));
  }

  const body = req.body || {};
  const action = body.action;
  if (!["signup", "login"].includes(action)) return res.status(400).json({ error: "Unknown auth action." });
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || password.length < 8) return res.status(400).json({ error: "Use a valid email and a password with at least 8 characters." });

  const path = action === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
  const response = await request(path, { method: "POST", body: JSON.stringify({ email, password }) });
  return res.status(response.status).json(await responseBody(response));
}
