import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/** OAuth (Google) and email-link callback: exchange the PKCE code for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/workspaces";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/workspaces";
  if (code) {
    const supabase = await getServerSupabase();
    const { error } = (await supabase?.auth.exchangeCodeForSession(code)) ?? { error: new Error("Auth not configured") };
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }
  const err = searchParams.get("error_description") ?? "Sign-in was cancelled";
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(err)}`);
}
