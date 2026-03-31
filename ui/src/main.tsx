import "./index.css";

function renderConfigError(title: string, body: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const outer = document.createElement("div");
  outer.style.cssText =
    "min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,sans-serif;background:#ede9e0;color:#1b1a18;";
  const card = document.createElement("div");
  card.style.cssText =
    "max-width:440px;border:1px solid #d4cfc4;border-radius:10px;background:#f5f2eb;padding:28px;box-shadow:0 1px 2px rgba(0,0,0,0.04);";
  const h1 = document.createElement("h1");
  h1.style.cssText = "margin:0 0 12px;font-size:1.25rem;font-weight:600;";
  h1.textContent = title;
  const p = document.createElement("p");
  p.style.cssText = "margin:0;font-size:13px;line-height:1.55;color:#5b5954;white-space:pre-wrap;";
  p.textContent = body;
  card.append(h1, p);
  outer.append(card);
  root.append(outer);
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  renderConfigError(
    "Sonde UI — configuration needed",
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.\n\n" +
      "Copy ui/.env.example to ui/.env, fill in your Supabase project URL and anon key, then restart the dev server (npm run dev)."
  );
} else {
  void import("./mount-app").then(({ mountApp }) => {
    mountApp();
  });
}
