require('dotenv').config();
const UnifiedWordPressClient = require('../src/unified-wordpress-client');

async function testConnection() {
  console.log('=== WordPress API Connection Test ===\n');
  
  // Check environment variables
  console.log('Environment Variables:');
  console.log(`WP_API_URL: ${process.env.WP_API_URL || 'Not set (using default)'}`);
  console.log(`WP_USERNAME: ${process.env.WP_USERNAME ? 'Set' : 'Not set'}`);
  console.log(`WP_APP_PASSWORD: ${process.env.WP_APP_PASSWORD ? 'Set (hidden)' : 'Not set'}`);
  console.log('');
  
  if (!process.env.WP_USERNAME || !process.env.WP_APP_PASSWORD) {
    console.log('❌ Missing credentials. Please set up your .env file:');
    console.log('1. Copy .env.example to .env');
    console.log('2. Add your WordPress username and application password');
    console.log('3. Run this test again');
    return;
  }
  
  try {
    const client = new UnifiedWordPressClient();
    
    console.log('Testing connection...');
    const connected = await client.testConnection();
    
    if (connected) {
      console.log('\n🎉 WordPress API connection successful!');
      console.log('You can now update posts using: npm run update-post <post-id>');
    } else {
      console.log('\n❌ Connection failed. Please check your credentials.');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.message.includes('credentials')) {
      console.log('\n💡 Make sure your application password is correct and has sufficient permissions.');
    }
  }
}

testConnection();