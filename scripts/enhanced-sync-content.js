require('dotenv').config();
const UnifiedWordPressClient = require('../src/unified-wordpress-client');
const fs = require('fs').promises;
const path = require('path');

class EnhancedContentSync {
  constructor() {
    this.client = new UnifiedWordPressClient();
    this.outputDir = path.join(__dirname, '../content');
    this.logsDir = path.join(__dirname, '../logs');
    this.syncStartTime = Date.now();
    this.stats = {
      posts: { attempted: 0, succeeded: 0, failed: 0, errors: [] },
      pages: { attempted: 0, succeeded: 0, failed: 0, errors: [] }
    };
  }

  async syncAll() {
    console.log('🔄 Starting Enhanced Content Sync with Error Recovery\n');
    
    try {
      // Health check before starting
      const health = await this.client.healthCheck();
      if (health.status === 'unhealthy') {
        throw new Error(`WordPress API is unhealthy: ${health.error}`);
      }
      console.log(`✅ Health check passed (${health.status})\n`);

      // Ensure output directories exist
      await this.ensureDirectories();

      // Sync posts with error recovery
      console.log('📝 Syncing Posts...');
      await this.syncPostsWithRecovery();

      // Sync pages with error recovery
      console.log('\n📄 Syncing Pages...');
      await this.syncPagesWithRecovery();

      // Generate sync report
      await this.generateSyncReport();

      console.log('\n✅ Enhanced sync completed successfully!');
      return this.stats;
      
    } catch (error) {
      console.error('❌ Sync failed:', error.message);
      await this.logSyncError(error);
      throw error;
    }
  }

  async syncPostsWithRecovery() {
    try {
      // Get posts list
      const posts = await this.fetchWithRetry('/posts?per_page=100', 'posts list');
      console.log(`Found ${posts.length} posts to sync`);
      
      const results = await this.processItemsWithRecovery(posts, 'posts', this.syncPost.bind(this));
      
      // Update posts index
      await this.updatePostsIndex(posts.filter((_, index) => results[index].success));
      
      console.log(`Posts sync completed: ${this.stats.posts.succeeded}/${this.stats.posts.attempted} successful`);
      
    } catch (error) {
      console.error('❌ Posts sync failed:', error.message);
      this.stats.posts.errors.push({ 
        type: 'SYNC_FAILURE', 
        message: error.message, 
        timestamp: new Date().toISOString() 
      });
      throw error;
    }
  }

  async syncPagesWithRecovery() {
    try {
      // Get pages list
      const pages = await this.fetchWithRetry('/pages?per_page=100', 'pages list');
      console.log(`Found ${pages.length} pages to sync`);
      
      const results = await this.processItemsWithRecovery(pages, 'pages', this.syncPage.bind(this));
      
      // Update pages index
      await this.updatePagesIndex(pages.filter((_, index) => results[index].success));
      
      console.log(`Pages sync completed: ${this.stats.pages.succeeded}/${this.stats.pages.attempted} successful`);
      
    } catch (error) {
      console.error('❌ Pages sync failed:', error.message);
      this.stats.pages.errors.push({ 
        type: 'SYNC_FAILURE', 
        message: error.message, 
        timestamp: new Date().toISOString() 
      });
      throw error;
    }
  }

  async processItemsWithRecovery(items, type, processor) {
    const results = [];
    const batchSize = 5; // Process in smaller batches to avoid overwhelming the server
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      console.log(`Processing ${type} batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(items.length/batchSize)}`);
      
      // Process batch items in parallel with individual error handling
      const batchPromises = batch.map(async (item) => {
        this.stats[type].attempted++;
        try {
          await processor(item);
          this.stats[type].succeeded++;
          return { success: true, item: item };
        } catch (error) {
          console.error(`❌ Failed to sync ${type.slice(0, -1)} ${item.id}: ${error.message}`);
          this.stats[type].failed++;
          this.stats[type].errors.push({
            id: item.id,
            title: item.title?.rendered || 'Unknown',
            error: error.message,
            timestamp: new Date().toISOString()
          });
          return { success: false, item: item, error: error };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Brief pause between batches to be respectful to the server
      if (i + batchSize < items.length) {
        await this.sleep(500);
      }
    }
    
    return results;
  }

  async fetchWithRetry(endpoint, description) {
    const maxAttempts = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`🔍 Fetching ${description} (attempt ${attempt}/${maxAttempts})`);
        return await this.client.makeRequest(endpoint);
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`🕐 Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }
    }
    
    throw new Error(`Failed to fetch ${description} after ${maxAttempts} attempts: ${lastError.message}`);
  }

  async syncPost(post) {
    // Save post by ID
    const postPath = path.join(this.outputDir, 'posts', 'by-id', `${post.id}.json`);
    await this.saveWithBackup(postPath, post);
    
    // Save post by slug
    const slugPath = path.join(this.outputDir, 'posts', 'by-slug', `${post.slug}.json`);
    await this.saveWithBackup(slugPath, post);
    
    console.log(`✅ Synced post: ${post.title.rendered} (ID: ${post.id})`);
  }

  async syncPage(page) {
    // Save page by ID
    const pagePath = path.join(this.outputDir, 'pages', `${page.slug}.json`);
    await this.saveWithBackup(pagePath, page);
    
    console.log(`✅ Synced page: ${page.title.rendered} (ID: ${page.id})`);
  }

  async saveWithBackup(filePath, data) {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      
      // Create backup if file exists
      if (await this.fileExists(filePath)) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        await fs.copyFile(filePath, backupPath);
      }
      
      // Save new data
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      
    } catch (error) {
      console.error(`❌ Failed to save ${filePath}:`, error.message);
      throw error;
    }
  }

  async updatePostsIndex(posts) {
    const indexData = {
      description: "Posts index - manages all blog posts from WordPress API",
      lastSync: new Date().toISOString(),
      totalPosts: posts.length,
      syncStats: {
        attempted: this.stats.posts.attempted,
        succeeded: this.stats.posts.succeeded,
        failed: this.stats.posts.failed
      },
      posts: posts.map(post => ({
        id: post.id,
        slug: post.slug,
        title: post.title.rendered,
        date: post.date,
        categories: post.categories,
        tags: post.tags
      }))
    };

    const indexPath = path.join(this.outputDir, 'posts', 'index.json');
    await this.saveWithBackup(indexPath, indexData);
    console.log(`📋 Updated posts index with ${posts.length} posts`);
  }

  async updatePagesIndex(pages) {
    const indexData = {
      description: "Pages index - manages all static pages from WordPress API",
      lastSync: new Date().toISOString(),
      totalPages: pages.length,
      syncStats: {
        attempted: this.stats.pages.attempted,
        succeeded: this.stats.pages.succeeded,
        failed: this.stats.pages.failed
      },
      pages: pages.map(page => ({
        id: page.id,
        slug: page.slug,
        title: page.title.rendered,
        date: page.date,
        parent: page.parent
      }))
    };

    const indexPath = path.join(this.outputDir, 'pages', 'index.json');
    await this.saveWithBackup(indexPath, indexData);
    console.log(`📋 Updated pages index with ${pages.length} pages`);
  }

  async generateSyncReport() {
    const syncDuration = Date.now() - this.syncStartTime;
    const report = {
      timestamp: new Date().toISOString(),
      duration: syncDuration,
      durationFormatted: this.formatDuration(syncDuration),
      summary: {
        totalItems: this.stats.posts.attempted + this.stats.pages.attempted,
        successful: this.stats.posts.succeeded + this.stats.pages.succeeded,
        failed: this.stats.posts.failed + this.stats.pages.failed,
        successRate: this.calculateSuccessRate()
      },
      details: {
        posts: { ...this.stats.posts },
        pages: { ...this.stats.pages }
      },
      circuitBreakerStatus: this.client.getStatus().circuitBreaker
    };

    // Save report
    const reportPath = path.join(this.logsDir, `sync-report-${new Date().toISOString().slice(0, 10)}.json`);
    await fs.mkdir(this.logsDir, { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n📊 Sync Report:');
    console.log(`   Duration: ${report.durationFormatted}`);
    console.log(`   Success Rate: ${report.summary.successRate}%`);
    console.log(`   Total Items: ${report.summary.totalItems}`);
    console.log(`   Successful: ${report.summary.successful}`);
    console.log(`   Failed: ${report.summary.failed}`);
    
    if (this.stats.posts.errors.length > 0 || this.stats.pages.errors.length > 0) {
      console.log(`\n⚠️  ${this.stats.posts.errors.length + this.stats.pages.errors.length} errors occurred - check log file for details`);
    }
    
    console.log(`📝 Full report saved to: ${reportPath}`);
  }

  calculateSuccessRate() {
    const total = this.stats.posts.attempted + this.stats.pages.attempted;
    const successful = this.stats.posts.succeeded + this.stats.pages.succeeded;
    return total > 0 ? Math.round((successful / total) * 100) : 0;
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async logSyncError(error) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      type: 'SYNC_ERROR',
      message: error.message,
      stack: error.stack,
      stats: this.stats
    };

    try {
      await fs.mkdir(this.logsDir, { recursive: true });
      const errorPath = path.join(this.logsDir, `sync-error-${new Date().toISOString().slice(0, 10)}.json`);
      await fs.writeFile(errorPath, JSON.stringify(errorLog, null, 2));
      console.log(`📝 Error logged to: ${errorPath}`);
    } catch (logError) {
      console.error('Failed to write error log:', logError.message);
    }
  }

  async ensureDirectories() {
    const dirs = [
      path.join(this.outputDir, 'posts', 'by-id'),
      path.join(this.outputDir, 'posts', 'by-slug'),
      path.join(this.outputDir, 'pages'),
      this.logsDir
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Recovery methods for partial failures
  async recoverFailedItems() {
    console.log('\n🔧 Starting recovery for failed items...');
    
    const failedPosts = this.stats.posts.errors.filter(error => error.id);
    const failedPages = this.stats.pages.errors.filter(error => error.id);
    
    if (failedPosts.length === 0 && failedPages.length === 0) {
      console.log('✅ No items need recovery');
      return;
    }
    
    console.log(`🔄 Attempting to recover ${failedPosts.length} posts and ${failedPages.length} pages`);
    
    // Retry failed posts
    for (const failedPost of failedPosts) {
      try {
        console.log(`🔄 Retrying post ${failedPost.id}...`);
        const post = await this.client.getPost(failedPost.id);
        await this.syncPost(post);
        console.log(`✅ Recovered post ${failedPost.id}`);
      } catch (error) {
        console.error(`❌ Failed to recover post ${failedPost.id}: ${error.message}`);
      }
    }
    
    // Similar recovery for pages would go here
  }
}

if (require.main === module) {
  const sync = new EnhancedContentSync();
  
  sync.syncAll()
    .then(stats => {
      if (stats.posts.failed > 0 || stats.pages.failed > 0) {
        console.log('\n🔧 Some items failed. Attempting recovery...');
        return sync.recoverFailedItems();
      }
    })
    .then(() => {
      console.log('\n🎉 Sync process completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Sync process failed:', error.message);
      process.exit(1);
    });
}

module.exports = EnhancedContentSync;