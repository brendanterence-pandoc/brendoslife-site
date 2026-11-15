import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Hosted build: VITE_API_BASE is the site path the API lives under (for example
// "/meds") and the app asks for a passcode. Preview build: the placeholder below
// is rewritten to the sandbox proxy and there is no sign-in.
const SITE_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "";
export const AUTH_ENABLED = SITE_BASE !== "";
export const API_BASE = SITE_BASE || ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__");
export const SIGNED_OUT_EVENT = "medtrack:signed-out";

async function throwIfResNotOk(res: Response) {
  if (res.status === 401 && AUTH_ENABLED) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
