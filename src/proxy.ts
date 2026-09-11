import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/env";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // The policy pages must render for a signed-out visitor: Google's OAuth
  // reviewer fetches them without a session, and a login redirect reads as
  // "no privacy policy". google*.html covers Search Console site verification,
  // which Google asks for when authorising a domain on the consent screen.
  const isPublic = path.startsWith("/login") || path.startsWith("/auth")
    || path.startsWith("/icons") || path === "/manifest.webmanifest"
    || path === "/privacy" || path === "/terms"
    || /^\/google[0-9a-f]+\.html$/.test(path);
  if (!user && !isPublic) {
    // API routes answer with JSON. Redirecting them to the login PAGE hands the
    // caller a 200 full of HTML, so fetch().json() yields nothing and the UI
    // shows an empty result with no error — which is how an expired session
    // looks like a broken feature.
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
