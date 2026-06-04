export interface Env {
  ASSETS: Fetcher;
  MARCELA_USERNAME: string;
  MARCELA_PASSWORD: string;
  MEDIA_USERNAME: string;
  MEDIA_PASSWORD: string;
}

interface ProtectedArea {
  matches: (pathname: string) => boolean;
  realm: string;
  usernameKey: keyof Env;
  passwordKey: keyof Env;
}

// Add new trackers here. Each entry binds a URL pattern to a realm name
// and the env-var pair that holds its username/password secrets.
const PROTECTED_AREAS: ProtectedArea[] = [
  {
    matches: (p) => p === "/marcela" || p.startsWith("/marcela/"),
    realm: "Marcela Area",
    usernameKey: "MARCELA_USERNAME",
    passwordKey: "MARCELA_PASSWORD",
  },
  {
    matches: (p) =>
      p === "/media" ||
      p === "/media.html" ||
      p.startsWith("/media/"),
    realm: "Media Tracker",
    usernameKey: "MEDIA_USERNAME",
    passwordKey: "MEDIA_PASSWORD",
  },
];

function unauthorized(realm: string) {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${realm}"`,
      "Content-Type": "text/plain; charset=UTF-8",
    },
  });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function findProtectedArea(pathname: string): ProtectedArea | undefined {
  return PROTECTED_AREAS.find((area) => area.matches(pathname));
}

async function isAuthorized(
  request: Request,
  area: ProtectedArea,
  env: Env
): Promise<boolean> {
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

  const expectedUsername = env[area.usernameKey] as string;
  const expectedPassword = env[area.passwordKey] as string;

  if (!expectedUsername || !expectedPassword) return false;

  return (
    timingSafeEqual(username, expectedUsername) &&
    timingSafeEqual(password, expectedPassword)
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    const area = findProtectedArea(url.pathname);
    if (area) {
      const authorized = await isAuthorized(request, area, env);
      if (!authorized) return unauthorized(area.realm);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
