require('dotenv').config();
const UnifiedWordPressClient = require('../src/unified-wordpress-client');

async function updatePost() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node scripts/update-post.js <post-id>');
    console.log('Example: node scripts/update-post.js 6');
    process.exit(1);
  }

  const postId = args[0];
  
  try {
    const client = new UnifiedWordPressClient();
    
    // Test connection first
    const connected = await client.testConnection();
    if (!connected) {
      console.error('Failed to connect to WordPress API. Please check your credentials.');
      process.exit(1);
    }
    
    // Update the post
    const result = await client.updatePostFromReformattedFile(postId);
    
    console.log('\n=== Update Summary ===');
    console.log(`Post ID: ${result.id}`);
    console.log(`Title: ${result.title.rendered}`);
    console.log(`Modified: ${result.modified}`);
    console.log(`URL: ${result.link}`);
    console.log('\n✅ Post updated successfully!');
    
  } catch (error) {
    console.error('\n❌ Update failed:', error.message);
    
    if (error.message.includes('credentials')) {
      console.log('\n💡 Setup instructions:');
      console.log('1. Copy .env.example to .env');
      console.log('2. Set your WordPress username and application password');
      console.log('3. Run the script again');
    }
    
    process.exit(1);
  }
}

updatePost();