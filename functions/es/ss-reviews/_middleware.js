// /ss-reviews/* is only served through reviews.samservices.llc (ss-reviews-site worker adds X-SS-Proxy).
// Direct visits on samservices.llc are redirected to the subdomain so there is one public URL.
export async function onRequest({ request, env, next }) {
  if (env.PROXY_SECRET && request.headers.get('X-SS-Proxy') === env.PROXY_SECRET) return next();
  const es = new URL(request.url).pathname.startsWith('/es/');
  return Response.redirect(es ? 'https://reviews.samservices.llc/es/' : 'https://reviews.samservices.llc/', 301);
}
