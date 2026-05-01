require('dotenv').config();
const UnifiedWordPressClient = require('../src/wordpress-client');

async function checkPermissions() {
  console.log('=== WordPress User Permissions Check ===\n');
  
  try {
    const client = new UnifiedWordPressClient();
    
    // Check current user info
    console.log('1. Checking current user information...');
    const userInfo = await client.makeRequest('/users/me');
    
    console.log(`User ID: ${userInfo.id}`);
    console.log(`Username: ${userInfo.username}`);
    console.log(`Name: ${userInfo.name}`);
    console.log(`Email: ${userInfo.email}`);
    console.log(`Roles: ${userInfo.roles.join(', ')}`);
    console.log(`Capabilities: ${Object.keys(userInfo.capabilities || {}).slice(0, 10).join(', ')}...`);
    
    // Check specific post
    console.log('\n2. Checking post 6 information...');
    const post = await client.makeRequest('/posts/6');
    
    console.log(`Post ID: ${post.id}`);
    console.log(`Post Author: ${post.author}`);
    console.log(`Post Status: ${post.status}`);
    console.log(`Post Title: ${post.title.rendered}`);
    
    // Check if user is the author
    console.log('\n3. Permission analysis:');
    if (userInfo.id === post.author) {
      console.log('✅ User is the author of this post');
    } else {
      console.log('❌ User is NOT the author of this post');
      console.log(`Post author ID: ${post.author}, Current user ID: ${userInfo.id}`);
    }
    
    // Check user capabilities
    const caps = userInfo.capabilities || {};
    const relevantCaps = [
      'edit_posts', 'edit_others_posts', 'edit_published_posts',
      'publish_posts', 'delete_posts', 'edit_private_posts'
    ];
    
    console.log('\n4. Relevant capabilities:');
    relevantCaps.forEach(cap => {
      const hasCapability = caps[cap] === true;
      console.log(`${hasCapability ? '✅' : '❌'} ${cap}: ${hasCapability}`);
    });
    
    // Suggest solutions
    console.log('\n5. Recommendations:');
    if (userInfo.id !== post.author) {
      if (!caps.edit_others_posts) {
        console.log('⚠️  User needs "edit_others_posts" capability or higher role (Editor/Administrator)');
      }
    }
    
    if (!caps.edit_published_posts) {
      console.log('⚠️  User needs "edit_published_posts" capability');
    }
    
    if (userInfo.roles.includes('subscriber') || userInfo.roles.includes('contributor')) {
      console.log('⚠️  User role is too low. Need Editor or Administrator role for editing published posts.');
    }
    
  } catch (error) {
    console.error('❌ Error checking permissions:', error.message);
  }
}

checkPermissions();