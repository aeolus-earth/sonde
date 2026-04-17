function agentConnectSources(): string[] {
  const raw = process.env.VITE_AGENT_WS_URL?.trim();
  if (!raw) return [];

  try {
    const wsUrl = new URL(raw.replace(/\/$/, ""));
    const httpUrl = new URL(raw.replace(/^ws/i, "http").replace(/\/$/, ""));
    return Array.from(new Set([httpUrl.origin, wsUrl.origin]));
  } catch {
    return [];
  }
}

function agentHttpBase(): string | null {
  const raw = process.env.VITE_AGENT_WS_URL?.trim();
  if (!raw) return null;

  try {
    return raw.replace(/^ws/i, "http").replace(/\/$/, "");
  } catch {
    return null;
  }
}

function buildConfig() {
  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    "https://api.github.com",
    "wss://*.supabase.co",
    ...agentConnectSources(),
  ].join(" ");
  const authProxyTarget = agentHttpBase();
  const rewrites = [];
  if (authProxyTarget) {
    rewrites.push({
      source: "/auth/device/:path*",
      destination: `${authProxyTarget}/auth/device/:path*`,
    });
    rewrites.push({
      source: "/auth/agent/:path*",
      destination: `${authProxyTarget}/auth/agent/:path*`,
    });
  }
  rewrites.push({ source: "/((?!.*\\.).*)", destination: "/index.html" });

  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: "vite",
    installCommand: "npm ci",
    buildCommand: "git fetch --tags --force --quiet || true; npm run build",
    outputDirectory: "dist",
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'sha256-R/guIIIfwBNMKTuvNTrvVOAlszaDjyjpfpXQXmnPS/I='; style-src 'self' 'unsafe-inline' https://rsms.me https://fonts.googleapis.com; font-src 'self' https://rsms.me https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src ${connectSrc}; frame-src 'self' blob: https://*.supabase.co https://view.officeapps.live.com; object-src 'self' blob: https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ],
    rewrites,
  };
}

export default buildConfig();
