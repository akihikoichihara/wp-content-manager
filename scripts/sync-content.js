const UnifiedWordPressClient = require('../src/unified-wordpress-client');
const SiteConfig = require('../config/site-config');

async function syncContent() {
  // Parse site ID from CLI arguments
  const siteConfig = SiteConfig.fromArgs();

  console.log(`\n=== Syncing content for ${siteConfig.getSiteName()} ===\n`);

  const client = new UnifiedWordPressClient({}, siteConfig);
  
  try {
    // Fetch posts
    console.log('=== Fetching Posts ===');
    const posts = await client.getAllPosts();
    console.log(`Found ${posts.length} posts`);
    
    // Save posts
    for (const post of posts) {
      await client.savePostData(post);
    }
    
    // Update posts index
    await client.updatePostsIndex(posts);
    
    // Fetch pages
    console.log('\n=== Fetching Pages ===');
    const pages = await client.getAllPages();
    console.log(`Found ${pages.length} pages`);
    
    // Save pages
    for (const page of pages) {
      await client.savePageData(page);
    }
    
    // Update pages index
    await client.updatePagesIndex(pages);
    
    console.log('\n=== Sync Complete ===');
    console.log(`Posts: ${posts.length}`);
    console.log(`Pages: ${pages.length}`);
    
  } catch (error) {
    console.error('Error during sync:', error);
  }
}

syncContent();