import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const APP_PATHS = ["/dashboard", "/transactions", "/import", "/forecast", "/alerts", "/simulator", "/recovery",
  "/inventory", "/reports", "/copilot", "/settings", "/learn", "/onboarding", "/budget", "/goals", "/controls", "/actions",
  "/team", "/invite", "/workspaces"];

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.NEXT_PUBLIC_AUTH_MODE === "dev" || !url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Refreshes the session cookie when needed and verifies the user's token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const isApp = APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (isApp && !signedIn) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;  // keeps e.g. an invitation token
    return NextResponse.redirect(to);
  }
  if ((path === "/login" || path === "/signup") && signedIn) {
    const to = request.nextUrl.clone();
    to.pathname = "/workspaces";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|api/|templates/|robots.txt|sitemap.xml|manifest.webmanifest|opengraph-image|twitter-image|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|csv|ico|xml|txt|webmanifest)$).*)"],
};
