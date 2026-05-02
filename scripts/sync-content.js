/**
 * sync-content.js
 *
 * Fetches all posts and pages from a WordPress site via REST API and saves them
 * as JSON files under content/sites/{siteId}/. Serves as the primary data-pull
 * step; run this before batch-update or any local diff operations.
 *
 * Usage:
 *   npm run sync
 *   npm run sync -- --site lab.itq.co.jp
 */

const UnifiedWordPressClient = require('../src/unified-wordpress-client');
const SiteConfig = require('../config/site-config');

async function syncContent() {
  // Resolve site from --site CLI flag, SITE_ID env var, or config default
  const siteConfig = SiteConfig.fromArgs();

  console.log(`\n=== Syncing content for ${siteConfig.getSiteName()} ===\n`);

  const client = new UnifiedWordPressClient({}, siteConfig);

  try {
    // --- Posts ---
    console.log('=== Fetching Posts ===');
    const posts = await client.getAllPosts();
    console.log(`Found ${posts.length} posts`);

    // Save each post as content/sites/{siteId}/posts/by-id/{id}.json
    for (const post of posts) {
      await client.savePostData(post);
    }

    // Regenerate the flat index file (posts/index.json) from the saved posts
    await client.updatePostsIndex(posts);

    // --- Pages ---
    console.log('\n=== Fetching Pages ===');
    const pages = await client.getAllPages();
    console.log(`Found ${pages.length} pages`);

    // Save each page as content/sites/{siteId}/pages/{slug}.json
    for (const page of pages) {
      await client.savePageData(page);
    }

    // Regenerate pages/index.json
    await client.updatePagesIndex(pages);

    console.log('\n=== Sync Complete ===');
    console.log(`Posts: ${posts.length}`);
    console.log(`Pages: ${pages.length}`);

  } catch (error) {
    console.error('Error during sync:', error);
  }
}

syncContent();
