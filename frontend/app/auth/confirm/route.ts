import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["signup", "email", "recovery", "email_change", "invite", "magiclink"];

/** Email links (sent through Resend) land here with a one-time token hash. Unlike the PKCE code flow, this
 * works even when the link is opened on a different device or browser from the one that requested it. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await getServerSupabase();
    const { error } = (await supabase?.auth.verifyOtp({ type, token_hash: tokenHash })) ?? { error: new Error("Auth not configured") };
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("This link is invalid or has expired. Request a new one.")}`);
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Invalid confirmation link")}`);
}
