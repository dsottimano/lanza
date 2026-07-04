// Clear the session cookie and bounce to the login flow — lets the owner switch
// GitHub accounts. Exempt from the gate (it's under /admin/api/auth/*).
export const onRequest = async (context: { request: Request }): Promise<Response> => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL("/admin/api/auth/login", context.request.url).toString(),
      "Set-Cookie": "lanza_session=; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      "Cache-Control": "no-store",
    },
  });
};
