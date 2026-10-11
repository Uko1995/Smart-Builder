import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PAGES = new Set(["/login", "/welcome"]);

export function middleware(request: NextRequest) {
  const session = request.cookies.get("spl_session")?.value;
  const { pathname } = request.nextUrl;
  if (!session) {
    if (pathname === "/") return NextResponse.rewrite(new URL("/welcome", request.url));
    if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (PUBLIC_PAGES.has(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|icon.svg).*)"],
};
