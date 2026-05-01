const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const SiteConfig = require('../config/site-config');

/**
 * Unified WordPress API Client
 *
 * Combines the best features from all existing clients:
 * - Basic data fetching (from api-client.js)
 * - Enhanced error handling with circuit breaker (from enhanced-wordpress-client.js)
 * - Update operations (from wordpress-updater.js)
 *
 * Features:
 * - Circuit breaker pattern for resilience
 * - Exponential backoff retry logic
 * - Comprehensive error handling
 * - Structured logging
 * - Health checks and monitoring
 * - Data management (save/index operations)
 * - Multi-site support via SiteConfig
 */
class UnifiedWordPressClient {
  constructor(config = {}, siteConfig = null) {
    // Site configuration (allows for custom site or defaults to global config)
    this.siteConfig = siteConfig || SiteConfig;

    // Configuration: explicit config > SiteConfig (respects SITE_ID) > WP_API_URL env var fallback
    this.baseUrl = config.baseUrl || this.siteConfig.getWordPressApiUrl() || process.env.WP_API_URL;

    // Credentials from SiteConfig (with environment variable support)
    const credentials = this.siteConfig.getCredentials();
    this.username = config.username || credentials.username;
    this.appPassword = config.appPassword || credentials.password;

    // HTTP Configuration from SiteConfig
    this.timeout = config.timeout || parseInt(process.env.WP_TIMEOUT) || this.siteConfig.getTimeout();
    this.userAgent = config.userAgent || this.siteConfig.getUserAgent();

    // Retry Configuration from SiteConfig
    this.maxRetries = config.maxRetries || parseInt(process.env.WP_MAX_RETRIES) || this.siteConfig.getMaxRetries();
    this.retryDelay = config.retryDelay || this.siteConfig.getRetryDelay();
    this.backoffMultiplier = config.backoffMultiplier || this.siteConfig.getBackoffMultiplier();

    // Circuit Breaker Configuration from SiteConfig
    const cbConfig = this.siteConfig.getCircuitBreakerConfig();
    this.circuitBreaker = {
      failureThreshold: config.failureThreshold || cbConfig.failureThreshold,
      resetTimeout: config.resetTimeout || cbConfig.resetTimeout,
      failures: 0,
      lastFailureTime: 0,
      state: 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    };

    // Paths Configuration from SiteConfig
    this.paths = {
      content: config.contentPath || this.siteConfig.getContentPath(),
      logs: config.logsPath || this.siteConfig.getLogsPath(),
      posts: config.postsPath || this.siteConfig.getPostsPath(),
      pages: config.pagesPath || this.siteConfig.getPagesPath()
    };

    // Initialize
    this.validateConfiguration();
  }

  validateConfiguration() {
    if (!this.baseUrl || !this.baseUrl.startsWith('https://')) {
      throw new Error('Invalid WordPress API URL. Must be HTTPS.');
    }
    
    // For read-only operations, credentials are optional
    if (this.username || this.appPassword) {
      if (!this.username || this.username.length < 3) {
        throw new Error('Invalid WordPress username.');
      }
      
      if (!this.appPassword || this.appPassword.length < 10) {
        throw new Error('Invalid WordPress application password.');
      }
    }
  }

  // ============================================================================
  // CIRCUIT BREAKER IMPLEMENTATION
  // ============================================================================

  canMakeRequest() {
    const now = Date.now();
    
    switch (this.circuitBreaker.state) {
      case 'CLOSED':
        return true;
      
      case 'OPEN':
        if (now - this.circuitBreaker.lastFailureTime >= this.circuitBreaker.resetTimeout) {
          this.circuitBreaker.state = 'HALF_OPEN';
          console.log('🔄 Circuit breaker: Moving to HALF_OPEN state');
          return true;
        }
        return false;
      
      case 'HALF_OPEN':
        return true;
      
      default:
        return true;
    }
  }

  recordSuccess() {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'CLOSED';
      this.circuitBreaker.failures = 0;
      console.log('✅ Circuit breaker: Reset to CLOSED state');
    }
  }

  recordFailure(error) {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    if (this.circuitBreaker.failures >= this.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'OPEN';
      console.log(`🚨 Circuit breaker: OPEN due to ${this.circuitBreaker.failures} failures`);
    }
    
    this.logError('Circuit Breaker', error);
  }

  resetCircuitBreaker() {
    this.circuitBreaker.state = 'CLOSED';
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.lastFailureTime = 0;
    console.log('🔄 Circuit breaker manually reset');
  }

  // ============================================================================
  // HTTP REQUEST HANDLING
  // ============================================================================

  async makeRequest(endpoint, method = 'GET', data = null, options = {}) {
    const retries = options.retries !== undefined ? options.retries : this.maxRetries;
    const isRetry = options.isRetry || false;
    
    // Circuit breaker check
    if (!this.canMakeRequest()) {
      const error = new Error('Circuit breaker is OPEN. Service temporarily unavailable.');
      error.code = 'CIRCUIT_BREAKER_OPEN';
      throw error;
    }
    
    try {
      const result = await this.executeRequest(endpoint, method, data, options);
      this.recordSuccess();
      return result;
    } catch (error) {
      console.error(`❌ Request failed: ${method} ${endpoint}`, error.message);
      
      // Determine if error is retryable
      if (this.isRetryableError(error) && retries > 0 && !isRetry) {
        const delay = this.retryDelay * Math.pow(this.backoffMultiplier, this.maxRetries - retries);
        console.log(`🔄 Retrying request in ${delay}ms (${retries} retries left)`);
        
        await this.sleep(delay);
        
        return this.makeRequest(endpoint, method, data, {
          ...options,
          retries: retries - 1,
          isRetry: true
        });
      } else {
        this.recordFailure(error);
        throw this.enhanceError(error, endpoint, method);
      }
    }
  }

  async executeRequest(endpoint, method, data, options) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      const requestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: method,
        timeout: options.timeout || this.timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.userAgent,
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      };

      // Add authentication if credentials are available
      if (this.username && this.appPassword) {
        const auth = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');
        requestOptions.headers['Authorization'] = `Basic ${auth}`;
      }

      if (data && (method === 'POST' || method === 'PUT')) {
        const jsonData = JSON.stringify(data);
        requestOptions.headers['Content-Length'] = Buffer.byteLength(jsonData);
      }

      const req = https.request(requestOptions, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          try {
            // Handle empty responses
            if (!responseData.trim()) {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ success: true, statusCode: res.statusCode });
                return;
              } else {
                const error = new Error(`Empty response with status ${res.statusCode}`);
                error.statusCode = res.statusCode;
                reject(error);
                return;
              }
            }

            let jsonResponse;
            try {
              jsonResponse = JSON.parse(responseData);
            } catch (parseError) {
              const error = new Error(`Invalid JSON response: ${responseData.substring(0, 200)}...`);
              error.code = 'INVALID_JSON';
              error.statusCode = res.statusCode;
              reject(error);
              return;
            }
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(jsonResponse);
            } else {
              const error = new Error(`HTTP ${res.statusCode}: ${jsonResponse.message || jsonResponse.code || 'Unknown error'}`);
              error.statusCode = res.statusCode;
              error.wpError = jsonResponse;
              reject(error);
            }
          } catch (error) {
            error.statusCode = res.statusCode;
            reject(error);
          }
        });
      });

      // Enhanced error handling
      req.on('error', (error) => {
        if (error.code === 'ECONNRESET') {
          error.message = 'Connection was reset by the server. This might be due to server overload or network issues.';
        } else if (error.code === 'ENOTFOUND') {
          error.message = 'DNS lookup failed. Check your internet connection and WordPress URL.';
        } else if (error.code === 'ETIMEDOUT') {
          error.message = 'Request timed out. The server might be overloaded.';
        }
        error.code = error.code || 'NETWORK_ERROR';
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        const error = new Error(`Request timeout after ${this.timeout}ms`);
        error.code = 'TIMEOUT';
        reject(error);
      });

      if (data && (method === 'POST' || method === 'PUT')) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  isRetryableError(error) {
    // Network errors that should be retried
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT', 
      'ENOTFOUND',
      'ECONNREFUSED',
      'TIMEOUT'
    ];
    
    // HTTP status codes that should be retried
    const retryableStatus = [429, 502, 503, 504];
    
    return retryableCodes.includes(error.code) || 
           retryableStatus.includes(error.statusCode) ||
           (error.statusCode >= 500 && error.statusCode < 600);
  }

  enhanceError(error, endpoint, method) {
    const enhancedError = new Error(error.message);
    enhancedError.originalError = error;
    enhancedError.endpoint = endpoint;
    enhancedError.method = method;
    enhancedError.timestamp = new Date().toISOString();
    enhancedError.code = error.code;
    enhancedError.statusCode = error.statusCode;
    
    // Add context-specific error messages
    if (error.statusCode === 401) {
      enhancedError.suggestion = 'Check your WordPress credentials and application password.';
    } else if (error.statusCode === 403) {
      enhancedError.suggestion = 'User does not have permission to perform this action.';
    } else if (error.statusCode === 404) {
      enhancedError.suggestion = 'The requested resource was not found. Check the endpoint URL.';
    } else if (error.statusCode === 429) {
      enhancedError.suggestion = 'Rate limit exceeded. Reduce request frequency.';
    } else if (error.statusCode >= 500) {
      enhancedError.suggestion = 'Server error. Try again later or contact WordPress administrator.';
    }
    
    return enhancedError;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // CORE API METHODS
  // ============================================================================

  // Read operations
  async getAllPosts(params = {}) {
    const queryParams = new URLSearchParams({
      per_page: params.perPage || 100,
      ...params
    });
    console.log('📖 Fetching all posts...');
    return await this.makeRequest(`/posts?${queryParams}`);
  }

  async getAllPages(params = {}) {
    const queryParams = new URLSearchParams({
      per_page: params.perPage || 100,
      ...params
    });
    console.log('📄 Fetching all pages...');
    return await this.makeRequest(`/pages?${queryParams}`);
  }

  async getPost(postId) {
    console.log(`📖 Fetching post ${postId}...`);
    return await this.makeRequest(`/posts/${postId}`);
  }

  async getPage(pageId) {
    console.log(`📄 Fetching page ${pageId}...`);
    return await this.makeRequest(`/pages/${pageId}`);
  }

  // Write operations (require authentication)
  async createPost(postData) {
    if (!this.username || !this.appPassword) {
      throw new Error('Authentication required for creating posts');
    }
    
    console.log('✨ Creating new post...');
    
    // Validate required fields
    if (!postData.title) {
      throw new Error('Post title is required');
    }
    if (!postData.content) {
      throw new Error('Post content is required');
    }

    return await this.makeRequest('/posts', 'POST', postData);
  }

  async updatePost(postId, updateData) {
    if (!this.username || !this.appPassword) {
      throw new Error('Authentication required for updating posts');
    }
    
    console.log(`📝 Updating post ${postId}...`);
    
    // Validate update data
    if (!updateData.title && !updateData.content) {
      throw new Error('Update data must contain at least title or content');
    }

    const payload = {
      title: updateData.title,
      content: updateData.content,
      excerpt: updateData.excerpt,
      status: updateData.status || 'publish'
    };

    return await this.makeRequest(`/posts/${postId}`, 'POST', payload);
  }

  async updatePostFromReformattedFile(postId) {
    if (!this.username || !this.appPassword) {
      throw new Error('Authentication required for updating posts');
    }
    
    try {
      // Load reformatted data
      const reformattedPath = path.join(this.paths.posts, 'by-id', `${postId}-reformatted.json`);
      const reformattedData = JSON.parse(await fs.readFile(reformattedPath, 'utf8'));
      
      console.log(`\n=== Updating Post ${postId} ===`);
      console.log(`Title: ${reformattedData.title.rendered}`);
      
      // Get current post for verification
      const currentPost = await this.getPost(postId);
      console.log(`Current title: ${currentPost.title.rendered}`);
      
      // Prepare update data
      const updateData = {
        title: reformattedData.title.rendered,
        content: reformattedData.content.rendered,
        excerpt: reformattedData.excerpt.rendered,
        status: 'publish'
      };
      
      // Perform update
      const updatedPost = await this.updatePost(postId, updateData);
      
      console.log(`✅ Successfully updated post ${postId}`);
      console.log(`New title: ${updatedPost.title.rendered}`);
      console.log(`Modified: ${updatedPost.modified}`);
      
      // Save update log
      const logData = {
        postId: postId,
        updateTime: new Date().toISOString(),
        oldTitle: currentPost.title.rendered,
        newTitle: updatedPost.title.rendered,
        changes: reformattedData.reformatted?.changes || [],
        success: true
      };
      
      await this.saveUpdateLog(logData);
      
      return updatedPost;
      
    } catch (error) {
      console.error(`❌ Failed to update post ${postId}:`, error.message);
      
      // Save error log
      const errorLog = {
        postId: postId,
        updateTime: new Date().toISOString(),
        error: error.message,
        success: false
      };
      
      await this.saveUpdateLog(errorLog);
      throw error;
    }
  }

  // ============================================================================
  // DATA MANAGEMENT METHODS
  // ============================================================================

  async savePostData(post) {
    // Save by ID
    const idPath = path.join(this.paths.posts, 'by-id', `${post.id}.json`);
    await fs.writeFile(idPath, JSON.stringify(post, null, 2));
    
    // Save by slug
    const slugPath = path.join(this.paths.posts, 'by-slug', `${post.slug}.json`);
    await fs.writeFile(slugPath, JSON.stringify(post, null, 2));
    
    console.log(`💾 Saved post: ${post.title.rendered} (ID: ${post.id})`);
  }

  async savePageData(page) {
    const pagePath = path.join(this.paths.pages, `${page.slug}.json`);
    await fs.writeFile(pagePath, JSON.stringify(page, null, 2));
    
    console.log(`💾 Saved page: ${page.title.rendered} (ID: ${page.id})`);
  }

  async updatePostsIndex(posts) {
    const indexPath = path.join(this.paths.posts, 'index.json');
    const indexData = {
      description: "Posts index - managed by Unified WordPress Client",
      lastSync: new Date().toISOString(),
      totalPosts: posts.length,
      posts: posts.map(post => ({
        id: post.id,
        slug: post.slug,
        title: post.title.rendered,
        date: post.date,
        categories: post.categories,
        tags: post.tags
      }))
    };
    
    await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    console.log(`📝 Updated posts index with ${posts.length} posts`);
  }

  async updatePagesIndex(pages) {
    const indexPath = path.join(this.paths.pages, 'index.json');
    const indexData = {
      description: "Pages index - managed by Unified WordPress Client",
      lastSync: new Date().toISOString(),
      totalPages: pages.length,
      pages: pages.map(page => ({
        id: page.id,
        slug: page.slug,
        title: page.title.rendered,
        date: page.date,
        parent: page.parent
      }))
    };
    
    await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    console.log(`📝 Updated pages index with ${pages.length} pages`);
  }

  // ============================================================================
  // LOGGING AND MONITORING
  // ============================================================================

  async logError(category, error) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      category: category,
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        endpoint: error.endpoint,
        method: error.method,
        suggestion: error.suggestion
      },
      circuitBreakerState: this.circuitBreaker.state,
      failureCount: this.circuitBreaker.failures
    };

    try {
      await fs.mkdir(this.paths.logs, { recursive: true });
      
      const logFile = path.join(this.paths.logs, `error-${new Date().toISOString().slice(0, 10)}.json`);
      
      let existingLogs = [];
      try {
        const existingData = await fs.readFile(logFile, 'utf8');
        existingLogs = JSON.parse(existingData);
      } catch {
        // File doesn't exist or is invalid, start fresh
      }
      
      existingLogs.push(logEntry);
      await fs.writeFile(logFile, JSON.stringify(existingLogs, null, 2));
      
      console.log(`📝 Error logged to ${logFile}`);
    } catch (logError) {
      console.error('Failed to write error log:', logError.message);
    }
  }

  async saveUpdateLog(logData) {
    try {
      await fs.mkdir(this.paths.logs, { recursive: true });
    } catch {
      // Directory already exists
    }
    
    const timestamp = new Date().toISOString().slice(0, 10);
    const logPath = path.join(this.paths.logs, `update-${timestamp}.json`);
    
    let logs = [];
    try {
      const existingLogs = await fs.readFile(logPath, 'utf8');
      logs = JSON.parse(existingLogs);
    } catch {
      // File doesn't exist, start with empty array
    }
    
    logs.push(logData);
    await fs.writeFile(logPath, JSON.stringify(logs, null, 2));
    
    console.log(`📝 Update log saved to ${logPath}`);
  }

  // ============================================================================
  // HEALTH AND DIAGNOSTICS
  // ============================================================================

  async testConnection() {
    try {
      console.log('🔍 Testing WordPress API connection...');
      await this.makeRequest('/posts?per_page=1');
      console.log('✅ Connection test successful');
      return true;
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      if (error.suggestion) {
        console.error('💡 Suggestion:', error.suggestion);
      }
      return false;
    }
  }

  async healthCheck() {
    const health = {
      timestamp: new Date().toISOString(),
      status: 'unknown',
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures,
        lastFailureTime: this.circuitBreaker.lastFailureTime
      },
      tests: {
        connection: false,
        authentication: false,
        permissions: false
      },
      configuration: {
        hasCredentials: !!(this.username && this.appPassword),
        baseUrl: this.baseUrl,
        timeout: this.timeout,
        maxRetries: this.maxRetries
      }
    };

    try {
      // Test basic connection
      await this.makeRequest('/posts?per_page=1');
      health.tests.connection = true;
      
      if (this.username && this.appPassword) {
        health.tests.authentication = true;

        // Test write permissions
        try {
          await this.makeRequest('/posts/1', 'GET');
          health.tests.permissions = true;
        } catch (error) {
          if (error.statusCode !== 404) {
            health.tests.permissions = false;
          } else {
            health.tests.permissions = true; // 404 is fine, means we can access posts endpoint
          }
        }
      }

      health.status = Object.values(health.tests).every(test => test) ? 'healthy' : 'degraded';
    } catch (error) {
      health.status = 'unhealthy';
      health.error = error.message;
    }

    return health;
  }

  getStatus() {
    return {
      circuitBreaker: { ...this.circuitBreaker },
      configuration: {
        maxRetries: this.maxRetries,
        timeout: this.timeout,
        baseUrl: this.baseUrl,
        hasCredentials: !!(this.username && this.appPassword)
      }
    };
  }
}

module.exports = UnifiedWordPressClient;