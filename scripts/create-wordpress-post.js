/**
 * create-wordpress-post.js
 *
 * Reads a Markdown draft file and publishes it as a new WordPress post via
 * the REST API. Handles Markdown-to-HTML conversion, taxonomy mapping
 * (categories/tags), slug generation, and local data archiving.
 *
 * Usage (CLI):
 *   node scripts/create-wordpress-post.js <file> [post-type] [status]
 *   npm run create-post                          # prompts for filename
 *
 * Arguments:
 *   file       - Path to the Markdown draft (absolute, or relative to drafts/)
 *   post-type  - Optional override: 'product-release', 'note-announcement', etc.
 *   status     - Optional: 'publish' (default) | 'draft'
 */

require('dotenv').config();
const UnifiedWordPressClient = require('../src/unified-wordpress-client');
const WordPressConfig = require('../config/wordpress/index.js');
const SiteConfig = require('../config/site-config');
const fs = require('fs').promises;
const path = require('path');

class WordPressPostCreator {
  /**
   * @param {string|null} siteId - Target site ID. Defaults to global config site.
   */
  constructor(siteId = null) {
    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;
    this.client = new UnifiedWordPressClient({}, this.siteConfig);
    this.wpConfig = WordPressConfig;
  }

  /**
   * Sends a post payload to WordPress and logs the result.
   *
   * @param {Object} postData - WordPress REST API post body
   * @returns {Promise<Object>} Created post object from the API response
   */
  async createPost(postData) {
    console.log('Creating new WordPress post...');

    const connected = await this.client.testConnection();
    if (!connected) {
      throw new Error('WordPress API connection failed');
    }

    try {
      const result = await this.client.createPost(postData);
      console.log(`✅ Post created successfully with ID: ${result.id}`);
      console.log(`Title: ${result.title.rendered}`);
      console.log(`URL: ${result.link}`);
      console.log(`Published: ${result.date}`);
      return result;
    } catch (error) {
      console.error('❌ Failed to create post:', error.message);
      throw error;
    }
  }

  /**
   * Converts a Markdown string to HTML suitable for the WordPress block editor.
   *
   * This is intentionally a minimal converter that handles only the subset of
   * Markdown used in announcement drafts (headings, bold, links, lists, paragraphs).
   * A full CommonMark parser is not used to avoid adding a heavy dependency.
   *
   * The "clean-up" section at the end is needed because the naive paragraph
   * wrapping (`<p>` around every double newline) produces invalid nesting like
   * `<p><h2>` — the cleanup passes strip those spurious wrappers.
   *
   * @param {string} markdown - Raw Markdown content (without the H1 title line)
   * @returns {string} HTML string
   */
  convertMarkdownToHtml(markdown) {
    let html = markdown;

    // Block-level headings must be converted before paragraph wrapping
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Wrap consecutive <li> items in a single <ul>
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

    // Wrap paragraphs; double newlines become </p><p> boundaries
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Remove invalid nesting created by the paragraph wrapper above
    html = html.replace(/<p><h/g, '<h');
    html = html.replace(/<\/h([1-6])><\/p>/g, '</h$1>');
    html = html.replace(/<p><ul>/g, '<ul>');
    html = html.replace(/<\/ul><\/p>/g, '</ul>');
    html = html.replace(/<p><\/p>/g, '');

    return html;
  }

  /**
   * Full pipeline: reads a Markdown draft, converts it to HTML, resolves
   * taxonomy IDs, creates the WordPress post, and archives the result locally.
   *
   * @param {string} filePath - Path to the Markdown draft file
   * @param {Object} [options]
   * @param {string} [options.type]   - Explicit post type override
   * @param {string} [options.status] - 'publish' or 'draft' (default: 'publish')
   * @returns {Promise<Object>} Created WordPress post object
   */
  async createAnnouncementPost(filePath, options = {}) {
    try {
      let announcementPath;
      if (filePath) {
        // Accept both absolute paths and paths relative to drafts/
        if (path.isAbsolute(filePath)) {
          announcementPath = filePath;
        } else {
          announcementPath = path.join(this.siteConfig.getDraftsPath(), filePath);
        }
      } else {
        // Fallback to the legacy single-file workflow
        announcementPath = path.join(this.siteConfig.getDraftsPath(), 'note-article-announcement.md');
      }

      const markdown = await fs.readFile(announcementPath, 'utf8');

      // The first line is always the H1 title; body starts after the blank line
      const lines = markdown.split('\n');
      const title = lines[0].replace(/^# /, '');
      const bodyMarkdown = lines.slice(2).join('\n');
      const content = this.convertMarkdownToHtml(bodyMarkdown);

      const postType = options.type || this.detectPostType(filePath);
      const categoryId = this.getCategoryForType(postType);
      const tagIds = this.getTagsForType(postType);

      // Strip the YYYY-MM-DD- date prefix from the filename to produce a clean slug.
      // Using the filename (rather than the title) ensures ASCII-only slugs even
      // when the title contains Japanese characters.
      const basename = path.basename(filePath, '.md');
      const slug = basename.replace(/^\d{4}-\d{2}-\d{2}-/, '');

      const postData = {
        title: title,
        content: content,
        slug: slug,
        status: options.status || 'publish',
        categories: categoryId ? [categoryId] : [],
        tags: tagIds
      };

      console.log('Creating post with title:', title);
      console.log('Category:', categoryId ? this.wpConfig.getCategoryById(categoryId)?.name : 'None');
      console.log('Tags:', tagIds.map(id => this.wpConfig.getTagById(id)?.name).join(', '));

      const result = await this.createPost(postData);
      await this.savePostInfo(result);

      return result;

    } catch (error) {
      console.error('Failed to create announcement post:', error.message);
      throw error;
    }
  }

  /**
   * Infers post type from filename keywords. This avoids requiring callers to
   * explicitly pass --type on the CLI for the common naming conventions used
   * in this project (e.g. "2026-01-01-release-foo.md" → 'product-release').
   *
   * @param {string} filePath
   * @returns {string} Post type string
   */
  detectPostType(filePath) {
    if (!filePath) return 'general-announcement';

    const filename = path.basename(filePath).toLowerCase();

    if (filename.includes('note')) return 'note-announcement';
    if (filename.includes('release')) return 'product-release';
    if (filename.includes('service') || filename.includes('launch')) return 'service-launch';
    if (filename.includes('techpedia')) return 'note-announcement';

    return 'general-announcement';
  }

  /**
   * @param {string} postType
   * @returns {number|null} WordPress category ID
   */
  getCategoryForType(postType) {
    const mappedCategory = this.wpConfig.getCategoryMapping(postType);
    if (mappedCategory) return mappedCategory.id;
    return this.wpConfig.getDefaultCategoryId();
  }

  /**
   * @param {string} postType
   * @returns {number[]} Array of WordPress tag IDs
   */
  getTagsForType(postType) {
    const mappedTags = this.wpConfig.getTagMapping(postType);
    if (mappedTags && mappedTags.length > 0) return mappedTags;
    return this.wpConfig.getDefaultTagIds();
  }

  /**
   * Archives the newly-created post data in two places:
   *  - content/sites/{siteId}/posts/by-id/{id}.json  (full WP API response)
   *  - logs/sites/{siteId}/new-post-{date}.json      (lightweight creation record)
   *
   * @param {Object} postResult - WordPress REST API response for the created post
   */
  async savePostInfo(postResult) {
    const postInfo = {
      id: postResult.id,
      slug: postResult.slug,
      title: postResult.title.rendered,
      date: postResult.date,
      link: postResult.link,
      categories: postResult.categories,
      tags: postResult.tags,
      created: new Date().toISOString()
    };

    const outputPath = path.join(this.siteConfig.getPostsPath(), 'by-id', `${postResult.id}.json`);
    await fs.writeFile(outputPath, JSON.stringify(postResult, null, 2));
    console.log(`📁 Post data saved to ${outputPath}`);

    const logDir = this.siteConfig.getLogsPath();
    try {
      await fs.access(logDir);
    } catch {
      await fs.mkdir(logDir, { recursive: true });
    }

    const logPath = path.join(logDir, `new-post-${new Date().toISOString().slice(0, 10)}.json`);
    await fs.writeFile(logPath, JSON.stringify(postInfo, null, 2));
    console.log(`📝 Post creation log saved to ${logPath}`);
  }
}

if (require.main === module) {
  const creator = new WordPressPostCreator();
  const filePath = process.argv[2];
  const options = {
    type: process.argv[3],
    status: process.argv[4] || 'publish'
  };

  creator.createAnnouncementPost(filePath, options)
    .then(result => {
      console.log('\n=== Post Creation Complete ===');
      console.log(`Post ID: ${result.id}`);
      console.log(`URL: ${result.link}`);
    })
    .catch(console.error);
}

module.exports = WordPressPostCreator;
