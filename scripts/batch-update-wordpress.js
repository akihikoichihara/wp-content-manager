/**
 * batch-update-wordpress.js
 *
 * Pushes all locally-reformatted posts to WordPress in one pass.
 * Reads every file matching content/sites/{siteId}/posts/by-id/*-reformatted.json
 * (produced by batch-convert-posts.js) and calls the WordPress REST API to
 * update each post's title, content, and excerpt.
 *
 * Typical workflow:
 *   1. npm run batch-convert   → creates *-reformatted.json locally
 *   2. npm run batch-update    → pushes each reformatted post to WordPress
 */

require('dotenv').config();
const UnifiedWordPressClient = require('../src/unified-wordpress-client');
const SiteConfig = require('../config/site-config');
const fs = require('fs').promises;
const path = require('path');

class BatchWordPressUpdater {
  /**
   * @param {string|null} siteId - Target site ID (e.g. 'www.itq.co.jp').
   *   Omit to use the default site from config/sites/index.json.
   */
  constructor(siteId = null) {
    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;
    this.client = new UnifiedWordPressClient({}, this.siteConfig);
    this.outputDir = path.join(this.siteConfig.getPostsPath(), 'by-id');
    this.logsDir = this.siteConfig.getLogsPath();
  }

  /**
   * Discovers all *-reformatted.json files in the posts/by-id directory.
   * The naming convention "{id}-reformatted.json" is set by BatchPostConverter
   * to distinguish reformatted drafts from the original synced JSON files.
   *
   * @returns {Promise<Array<{id: string, data: Object}>>}
   */
  async getReformattedPosts() {
    const files = await fs.readdir(this.outputDir);
    const reformattedFiles = files.filter(f => f.endsWith('-reformatted.json'));

    const posts = [];
    for (const file of reformattedFiles) {
      const postId = file.replace('-reformatted.json', '');
      const filePath = path.join(this.outputDir, file);
      const postData = JSON.parse(await fs.readFile(filePath, 'utf8'));
      posts.push({ id: postId, data: postData });
    }

    return posts;
  }

  /**
   * Iterates over all reformatted posts and updates each one via the
   * WordPress REST API. A 1-second delay between requests avoids hitting
   * WordPress's built-in API rate limit.
   *
   * @returns {Promise<Array<Object>>} Per-post success/failure results
   */
  async updateAllPosts() {
    console.log('=== WordPress一括更新開始 ===\n');

    const connected = await this.client.testConnection();
    if (!connected) {
      throw new Error('WordPress API接続に失敗しました');
    }

    const posts = await this.getReformattedPosts();
    console.log(`更新対象: ${posts.length}件の投稿\n`);

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const post of posts) {
      try {
        console.log(`更新中: ID ${post.id} - ${post.data.title.rendered}`);

        const updateData = {
          title: post.data.title.rendered,
          content: post.data.content.rendered,
          excerpt: post.data.excerpt.rendered,
          status: 'publish'
        };

        const updatedPost = await this.client.updatePost(post.id, updateData);

        results.push({
          id: post.id,
          oldTitle: post.data.reformatted?.original_title || 'Unknown',
          newTitle: updatedPost.title.rendered,
          modified: updatedPost.modified,
          changes: post.data.reformatted?.changes || [],
          success: true
        });

        successCount++;
        console.log(`  ✅ 更新完了 - ${updatedPost.modified}\n`);

        // 1-second pause to respect WordPress API rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`  ❌ 更新失敗: ${error.message}\n`);
        results.push({
          id: post.id,
          title: post.data.title.rendered,
          error: error.message,
          success: false
        });
        errorCount++;
      }
    }

    console.log('=== 一括更新結果サマリー ===');
    console.log(`成功: ${successCount}件`);
    console.log(`エラー: ${errorCount}件`);
    console.log(`合計: ${posts.length}件\n`);

    const timestamp = new Date().toISOString().split('T')[0];
    const reportPath = path.join(this.logsDir, `batch-update-${timestamp}.json`);
    await fs.writeFile(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: { total: posts.length, success: successCount, errors: errorCount },
      results: results
    }, null, 2));

    console.log(`詳細レポート: ${reportPath}`);

    return results;
  }
}

if (require.main === module) {
  const updater = new BatchWordPressUpdater();
  updater.updateAllPosts().catch(console.error);
}

module.exports = BatchWordPressUpdater;
