/**
 * batch-convert-posts.js
 *
 * Converts all locally-synced WordPress posts to a unified format and saves
 * them as *-reformatted.json files (+ Markdown drafts) without touching
 * the live WordPress site.
 *
 * Run batch-update-wordpress.js afterwards to push the reformatted posts back.
 *
 * Unified format rules:
 *  - Titles must begin with 【お知らせ】, 【リリース】, or 【開設】
 *  - Product/service releases prepend a bold date to the content body
 *  - A standard company footer is appended if not already present
 */

const fs = require('fs').promises;
const path = require('path');
const SiteConfig = require('../config/site-config');

class BatchPostConverter {
  /**
   * @param {string|null} siteId - Target site ID. Defaults to the global config site.
   */
  constructor(siteId = null) {
    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;

    this.postsIndexPath = path.join(this.siteConfig.getPostsPath(), 'index.json');
    this.templatesDir = path.join(__dirname, '../templates');
    this.outputDir = path.join(this.siteConfig.getPostsPath(), 'by-id');
    this.draftsDir = this.siteConfig.getDraftsPath();
  }

  /** @returns {Promise<Object>} Parsed posts/index.json */
  async loadPostsIndex() {
    const indexData = await fs.readFile(this.postsIndexPath, 'utf8');
    return JSON.parse(indexData);
  }

  /**
   * @param {number} postId
   * @returns {Promise<Object>} Parsed post JSON from by-id/{postId}.json
   */
  async loadOriginalPost(postId) {
    const postPath = path.join(this.outputDir, `${postId}.json`);
    const postData = await fs.readFile(postPath, 'utf8');
    return JSON.parse(postData);
  }

  /**
   * Classifies a post into one of four template categories based on keywords
   * in the rendered title. The categories drive both the title prefix and
   * whether a publication date is injected at the top of the body.
   *
   * @param {Object} post - WordPress post object with title.rendered
   * @returns {'product-release'|'article-announcement'|'service-launch'|'general-announcement'}
   */
  categorizePost(post) {
    const title = post.title.rendered;

    // App releases, product launches, and sub-brand content (Laboratory = tech blog)
    if (title.includes('リリース') || title.includes('SimpleCalc') || title.includes('Laboratory')) {
      return 'product-release';
    }

    // External article announcements: note posts, content publications, knowledge base pages
    if (title.includes('note') || title.includes('公開') || title.includes('ガイド') ||
        title.includes('資料') || title.includes('Techpedia')) {
      return 'article-announcement';
    }

    // New service or channel launches (e.g. YouTube channel opening)
    if (title.includes('開設') || title.includes('YouTube') || title.includes('チャンネル')) {
      return 'service-launch';
    }

    return 'general-announcement';
  }

  /**
   * Applies the unified format to a post:
   *  1. Wraps bare titles in the appropriate 【prefix】
   *  2. Prepends a bold date for release/launch posts (makes the date prominent
   *     in the WordPress listing view without editing the post date field)
   *  3. Appends a standard company + contact footer when absent
   *
   * @param {Object} post     - Original WordPress post object
   * @param {string} category - From categorizePost()
   * @returns {Promise<Object>} Post with updated title, content, excerpt, and
   *   a `reformatted` metadata block recording what changed
   */
  async convertToUnifiedFormat(post, category) {
    const title = post.title.rendered;
    const content = post.content.rendered;
    const date = new Date(post.date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let newTitle = title;
    let newContent = content;

    // --- Title normalization ---
    // Only wrap if not already prefixed (idempotent re-runs are safe)
    if (!title.startsWith('【')) {
      if (category === 'product-release') {
        newTitle = `【リリース】${title.replace(/^(.*?)をリリース.*/, '$1をリリースしました')}`;
      } else if (category === 'article-announcement') {
        newTitle = `【お知らせ】${title}`;
      } else if (category === 'service-launch') {
        newTitle = `【開設】${title}`;
      } else {
        newTitle = `【お知らせ】${title}`;
      }
    }

    let structuredContent = '';

    // Prepend publication date only for releases/launches; general announcements
    // do not need a date header because the WordPress date metadata is sufficient.
    if (category === 'product-release' || category === 'service-launch') {
      structuredContent += `\n<p><strong>${date}</strong></p>\n\n`;
    }

    structuredContent += newContent;

    // Append company + contact footer if neither block is present yet.
    // Checking both strings prevents the footer from being doubled on reruns.
    const companyName = this.siteConfig.getCompanyName();
    if (!content.includes(`${companyName}について`) &&
        !content.includes('お問い合わせ')) {
      structuredContent += `\n\n<hr />\n\n`;
      structuredContent += `<p><strong>${companyName}について</strong><br>\n`;
      structuredContent += `${this.siteConfig.getCompanyDescription('standard')}</p>\n\n`;
      structuredContent += `<p><strong>お問い合わせ</strong><br>\n`;
      structuredContent += `弊社ウェブサイトの<a href="${this.siteConfig.getInquiryUrl()}">お問い合わせフォーム</a>までお気軽にご連絡ください。</p>\n`;
    }

    // Build a human-readable change log that is stored in reformatted.changes
    const changes = [];
    if (newTitle !== title) {
      changes.push(`Title updated: "${title}" → "${newTitle}"`);
    }
    if (category === 'product-release' || category === 'service-launch') {
      changes.push('Added date prominence at the beginning');
    }
    if (!content.includes(`${this.siteConfig.getCompanyName()}について`)) {
      changes.push('Added standardized footer with contact information');
    }
    changes.push('Applied unified format standards for brand consistency');

    return {
      ...post,
      title: { rendered: newTitle },
      content: { rendered: structuredContent },
      // Strip all HTML tags for the excerpt (WordPress truncates this in listing views)
      excerpt: {
        rendered: `<p>${structuredContent.replace(/<[^>]*>/g, '').substring(0, 100)}...</p>\n`,
        protected: false
      },
      reformatted: {
        version: '1.0.0',
        date: new Date().toISOString(),
        template_type: category,
        changes: changes,
        original_title: title
      }
    };
  }

  /**
   * Saves the reformatted post as both:
   *  - {id}-reformatted.json  (consumed by batch-update-wordpress.js)
   *  - drafts/{date}-{slug}-reformatted.md  (human-readable preview)
   *
   * @param {Object} post - Reformatted post object
   * @returns {Promise<{jsonPath: string, mdPath: string}>}
   */
  async saveReformattedPost(post) {
    const outputPath = path.join(this.outputDir, `${post.id}-reformatted.json`);
    await fs.writeFile(outputPath, JSON.stringify(post, null, 2));

    const markdownContent = this.convertToMarkdown(post);
    const mdPath = path.join(this.draftsDir, `${post.date.split('T')[0]}-${post.slug}-reformatted.md`);
    await fs.writeFile(mdPath, markdownContent);

    return { jsonPath: outputPath, mdPath: mdPath };
  }

  /**
   * Converts WordPress HTML content to a Markdown representation for the
   * human-readable draft file. This is a lossy one-way conversion intended
   * for review only; the JSON file is the authoritative source for updates.
   *
   * @param {Object} post - Post object with content.rendered (HTML)
   * @returns {string} Markdown string
   */
  convertToMarkdown(post) {
    let content = post.content.rendered;

    // Basic tag-to-Markdown substitutions. The <p> replacement intentionally
    // appends a newline rather than wrapping in blank lines to keep the output
    // compact; triple-newline cleanup at the end handles any excess spacing.
    content = content
      .replace(/<h2[^>]*>(.*?)<\/h2>/g, '## $1')
      .replace(/<h3[^>]*>(.*?)<\/h3>/g, '### $1')
      .replace(/<p[^>]*>(.*?)<\/p>/g, '$1\n')
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
      .replace(/<hr\s*\/?>/g, '---')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return `${post.title.rendered}\n\n${content}`;
  }

  /**
   * Entry point: loads the posts index, iterates over every post (except ID 6
   * which was already manually converted), converts each to unified format,
   * saves the result, and writes a summary report to logs/.
   *
   * @returns {Promise<Array<Object>>} Per-post results array
   */
  async processAllPosts() {
    console.log('=== 全投稿の統一フォーマット変換開始 ===\n');

    const index = await this.loadPostsIndex();
    // Post ID 6 (kick-off post) was manually formatted and must not be overwritten
    const posts = index.posts.filter(p => p.id !== 6);

    console.log(`処理対象: ${posts.length}件の投稿\n`);

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const postInfo of posts) {
      try {
        console.log(`処理中: ID ${postInfo.id} - ${postInfo.title}`);

        const originalPost = await this.loadOriginalPost(postInfo.id);
        const category = this.categorizePost(originalPost);
        console.log(`  カテゴリ: ${category}`);

        const reformattedPost = await this.convertToUnifiedFormat(originalPost, category);
        const paths = await this.saveReformattedPost(reformattedPost);

        results.push({
          id: postInfo.id,
          title: postInfo.title,
          newTitle: reformattedPost.title.rendered,
          category: category,
          changes: reformattedPost.reformatted.changes,
          paths: paths,
          success: true
        });

        successCount++;
        console.log(`  ✅ 完了\n`);

      } catch (error) {
        console.error(`  ❌ エラー: ${error.message}\n`);
        results.push({
          id: postInfo.id,
          title: postInfo.title,
          error: error.message,
          success: false
        });
        errorCount++;
      }
    }

    console.log('=== 変換結果サマリー ===');
    console.log(`成功: ${successCount}件`);
    console.log(`エラー: ${errorCount}件`);
    console.log(`合計: ${posts.length}件\n`);

    const reportPath = path.join(__dirname, '../logs', `batch-conversion-${new Date().toISOString().split('T')[0]}.json`);
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
  const converter = new BatchPostConverter();
  converter.processAllPosts().catch(console.error);
}

module.exports = BatchPostConverter;
