require('dotenv').config();
const https = require('https');

async function debugAuth() {
  console.log('=== WordPress REST API 認証デバッグ ===\n');
  
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;
  const apiUrl = process.env.WP_API_URL || 'https://your-site.com/wp-json/wp/v2';
  
  console.log(`API URL: ${apiUrl}`);
  console.log(`Username: ${username}`);
  console.log(`App Password: ${appPassword ? appPassword.substring(0, 4) + '****' : 'Not set'}\n`);
  
  // Test different authentication methods
  
  // 1. Basic test with posts endpoint
  console.log('1. Testing basic posts endpoint (no auth)...');
  try {
    await makeRequest('/posts?per_page=1');
    console.log('✅ Basic posts endpoint works\n');
  } catch (error) {
    console.log(`❌ Basic posts endpoint failed: ${error.message}\n`);
  }
  
  // 2. Test authenticated endpoint with different headers
  console.log('2. Testing authenticated endpoint (users/me)...');
  
  // Method A: Basic Auth header
  console.log('   Method A: Basic Authorization header');
  try {
    await makeRequest('/users/me', 'GET', null, {
      'Authorization': `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`
    });
    console.log('   ✅ Basic Auth works');
  } catch (error) {
    console.log(`   ❌ Basic Auth failed: ${error.message}`);
  }
  
  // Method B: Application Password header (alternative format)
  console.log('   Method B: Application Password header');
  try {
    await makeRequest('/users/me', 'GET', null, {
      'X-WP-Application-Password': `${username}:${appPassword}`
    });
    console.log('   ✅ Application Password header works');
  } catch (error) {
    console.log(`   ❌ Application Password header failed: ${error.message}`);
  }
  
  // 3. Test specific post endpoint
  console.log('\n3. Testing specific post endpoint (posts/6)...');
  try {
    const post = await makeRequest('/posts/6', 'GET', null, {
      'Authorization': `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`
    });
    console.log(`   ✅ Post retrieved: "${post.title.rendered}"`);
    console.log(`   Post author ID: ${post.author}`);
    console.log(`   Post status: ${post.status}`);
    
    // Check if we can get author info
    try {
      const author = await makeRequest(`/users/${post.author}`, 'GET', null, {
        'Authorization': `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`
      });
      console.log(`   Post author: ${author.name} (${author.username})`);
    } catch (authorError) {
      console.log(`   ❌ Could not fetch author info: ${authorError.message}`);
    }
    
  } catch (error) {
    console.log(`   ❌ Post retrieval failed: ${error.message}`);
  }
  
  // 4. Test update capability with a simple field
  console.log('\n4. Testing update capability (simple field test)...');
  try {
    const updateData = {
      meta: {
        test_field: 'test_value'
      }
    };
    
    await makeRequest('/posts/6', 'POST', updateData, {
      'Authorization': `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`,
      'Content-Type': 'application/json'
    });
    console.log('   ✅ Update capability confirmed');
  } catch (error) {
    console.log(`   ❌ Update failed: ${error.message}`);
    
    if (error.message.includes('401')) {
      console.log('   💡 Suggestion: アプリケーションパスワードの権限スコープを確認してください');
    }
    if (error.message.includes('403')) {
      console.log('   💡 Suggestion: WordPressのセキュリティプラグインやファイアウォールを確認してください');
    }
  }
}

function makeRequest(endpoint, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const apiUrl = process.env.WP_API_URL || 'https://your-site.com/wp-json/wp/v2';
    const url = new URL(`${apiUrl}${endpoint}`);
    
    const defaultHeaders = {
      'User-Agent': 'wp-content-manager/1.0'
    };
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: { ...defaultHeaders, ...headers }
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonResponse = JSON.parse(responseData);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(jsonResponse);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${jsonResponse.message || responseData}`));
          }
        } catch (error) {
          reject(new Error(`Parse error: ${error.message}, Response: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data && (method === 'POST' || method === 'PUT')) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

debugAuth();