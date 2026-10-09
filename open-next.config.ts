import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

/*
 * How OpenNext runs Jessy on Cloudflare Workers (https://opennext.js.org/cloudflare/caching).
 *
 * Every page but /api/ask is built ahead and nothing is revalidated, so the "SSG site" setup
 * fits: the built pages are read back from the Worker's own static assets, which is free and
 * needs no R2 bucket, KV namespace, queue or tag cache. Cache interception answers those pages
 * without loading Next's server, which keeps the Worker's CPU time per request low. The cache
 * is read-only: a new build is the only way to change a page.
 *
 * `opennextjs-cloudflare deploy` copies the built pages into the static assets before it hands
 * over to Wrangler, so the deploy command is that one, never a bare `wrangler deploy`.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
