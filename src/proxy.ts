import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

function isAllowedOrigin(origin: string, requestOrigin: string): boolean {
  if (origin === requestOrigin) return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (appUrl && origin === appUrl) return true;
  if (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin)) {
    return true;
  }
  return false;
}

export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || randomUUID();

  // Reject oversized request bodies early
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 5 MB limit" } },
      { status: 413, headers: { "x-request-id": requestId } },
    );
  }

  // Reject cross-origin browser requests to /api/* (native mobile apps send no Origin header → allowed)
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin, request.nextUrl.origin)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
