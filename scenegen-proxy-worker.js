/**
 * SceneGen media proxy — Cloudflare Worker
 * ------------------------------------------------------------------
 * This holds your Pixabay, Pexels, and Freesound keys server-side so
 * they never appear in the HTML that visitors download. index.html
 * calls THIS worker instead of calling those APIs directly.
 *
 * It also has a /media endpoint that fetches the actual video/audio
 * FILE BYTES (not just search results) on the site's behalf, so the
 * "Merge & Download" scene builder can read them even if Pixabay,
 * Pexels, or Freesound's own servers don't allow direct browser
 * fetches. Only their known CDN domains are allowed through this
 * endpoint — it can't be used to fetch arbitrary sites.
 *
 * DEPLOY (free, ~3 minutes, no command line needed):
 *   1. Go to https://dash.cloudflare.com → sign up / log in (free plan).
 *   2. Left sidebar → "Workers & Pages" → "Create" → "Create Worker".
 *   3. Give it any name (e.g. "scenegen-proxy") → "Deploy" the default.
 *   4. Click "Edit code" and replace everything with this whole file.
 *      Click "Deploy" again.
 *   5. Go to the worker's "Settings" → "Variables and Secrets" → add:
 *        PIXABAY_KEY   = 57653838-186c12c2db1ea7d34a156dd62
 *        PEXELS_KEY    = 2nE4Em75LoSUzBa0vBqbThvMPeoFvqR2q2I3DLVZEgR14WKA4YKZ7ezB
 *        FREESOUND_KEY = iAdjALyG7KHqHEMn8A8cVDc7bA93DqONJF3MWmAo
 *      Mark each as "Encrypt" / secret, then save + redeploy.
 *   6. Copy the worker's URL (looks like
 *      https://scenegen-proxy.YOUR-SUBDOMAIN.workers.dev).
 *   7. Paste that URL into the three ENDPOINT placeholders in
 *      index.html's CONFIG (see the matching comment there).
 *
 * After this, the real keys live only in step 5's dashboard — never
 * in a file anyone can download or view-source.
 * ------------------------------------------------------------------
 * Optional hardening once your site has a real domain: change the
 * '*' in ALLOWED_ORIGIN below to your exact site URL, so only your
 * page (not just anyone) can call this worker.
 */

const ALLOWED_ORIGIN = '*';

// Domains the /media endpoint is allowed to fetch from. Keeps this
// worker from being usable as an open proxy for arbitrary URLs.
const ALLOWED_MEDIA_HOST_PATTERNS = [
  /(^|\.)pixabay\.com$/,
  /(^|\.)pexels\.com$/,
  /(^|\.)freesound\.org$/
];

function corsHeaders(){
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

async function passthrough(targetUrl, extraHeaders){
  const res = await fetch(targetUrl, { headers: extraHeaders || {} });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);

    if(request.method === 'OPTIONS'){
      return new Response(null, { headers: corsHeaders() });
    }

    try{
      if(url.pathname === '/pixabay'){
        const q = url.searchParams.get('q') || '';
        const perPage = url.searchParams.get('per_page') || '12';
        const target = `https://pixabay.com/api/videos/?key=${env.PIXABAY_KEY}&q=${encodeURIComponent(q)}&per_page=${encodeURIComponent(perPage)}`;
        return await passthrough(target);
      }

      if(url.pathname === '/pexels'){
        const q = url.searchParams.get('query') || '';
        const perPage = url.searchParams.get('per_page') || '12';
        const target = `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${encodeURIComponent(perPage)}`;
        return await passthrough(target, { Authorization: env.PEXELS_KEY });
      }

      if(url.pathname === '/freesound'){
        const params = new URLSearchParams({
          query: url.searchParams.get('query') || '',
          token: env.FREESOUND_KEY,
          fields: url.searchParams.get('fields') || 'id,name,url,license,duration,username,previews,images',
          page_size: url.searchParams.get('page_size') || '12'
        });
        const filter = url.searchParams.get('filter');
        if(filter) params.set('filter', filter);
        const target = `https://freesound.org/apiv2/search/text/?${params.toString()}`;
        return await passthrough(target);
      }

      if(url.pathname === '/media'){
        const target = url.searchParams.get('url');
        if(!target){
          return new Response(JSON.stringify({ error: 'missing_url' }), {
            status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
          });
        }
        let parsed;
        try{ parsed = new URL(target); } catch(e){
          return new Response(JSON.stringify({ error: 'invalid_url' }), {
            status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
          });
        }
        const isAllowed = ALLOWED_MEDIA_HOST_PATTERNS.some(p => p.test(parsed.hostname));
        if(!isAllowed){
          return new Response(JSON.stringify({ error: 'host_not_allowed' }), {
            status: 403, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
          });
        }
        const res = await fetch(target);
        if(!res.ok || !res.body){
          return new Response(JSON.stringify({ error: 'upstream_failed' }), {
            status: 502, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
          });
        }
        return new Response(res.body, {
          status: 200,
          headers: {
            ...corsHeaders(),
            'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream'
          }
        });
      }

      return new Response(JSON.stringify({ error: 'unknown_endpoint' }), {
        status: 404,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    } catch(err){
      return new Response(JSON.stringify({ error: 'proxy_failed' }), {
        status: 502,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }
  }
};
