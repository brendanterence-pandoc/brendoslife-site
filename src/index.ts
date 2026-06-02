export interface Env {
  ASSETS: Fetcher;
  MARCELA_USERNAME: string;
  MARCELA_PASSWORD: string;
}

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Marcela Area"',
      "Content-Type": "text/plain; charset=UTF-8",
    },
  });
}

function isProtectedPath(pathname: string) {
  return pathname === "/marcela" || pathname.startsWith("/marcela/");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  const encoded = authHeader.slice(6).trim();

  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return (
    timingSafeEqual(username, env.MARCELA_USERNAME) &&
    timingSafeEqual(password, env.MARCELA_PASSWORD)
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (isProtectedPath(url.pathname)) {
      const authorized = await isAuthorized(request, env);
      if (!authorized) return unauthorized();
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
