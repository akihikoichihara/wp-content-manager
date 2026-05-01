require('dotenv').config();
const UnifiedWordPressClient = require('../src/unified-wordpress-client');
const WordPressConfig = require('../config/wordpress/index.js');
const SiteConfig = require('../config/site-config');
const fs = require('fs').promises;
const path = require('path');

class WordPressPostCreator {
  constructor(siteId = null) {
    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;
    this.client = new UnifiedWordPressClient({}, this.siteConfig);
    this.wpConfig = WordPressConfig;
  }

  async createPost(postData) {
    console.log('Creating new WordPress post...');
    
    // Test connection first
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

  convertMarkdownToHtml(markdown) {
    // Simple markdown to HTML conversion
    let html = markdown;
    
    // Headers
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    
    // Links
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    
    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    
    // Clean up
    html = html.replace(/<p><h/g, '<h');
    html = html.replace(/<\/h([1-6])><\/p>/g, '</h$1>');
    html = html.replace(/<p><ul>/g, '<ul>');
    html = html.replace(/<\/ul><\/p>/g, '</ul>');
    html = html.replace(/<p><\/p>/g, '');
    
    return html;
  }

  async createAnnouncementPost(filePath, options = {}) {
    try {
      // Read the announcement markdown
      let announcementPath;
      if (filePath) {
        // Check if it's an absolute path
        if (path.isAbsolute(filePath)) {
          announcementPath = filePath;
        } else {
          // Assume it's relative to drafts directory
          announcementPath = path.join(this.siteConfig.getDraftsPath(), filePath);
        }
      } else {
        announcementPath = path.join(this.siteConfig.getDraftsPath(), 'note-article-announcement.md');
      }
      
      const markdown = await fs.readFile(announcementPath, 'utf8');
      
      // Extract title (first line after removing #)
      const lines = markdown.split('\n');
      const title = lines[0].replace(/^# /, '');
      
      // Convert body to HTML (skip title line)
      const bodyMarkdown = lines.slice(2).join('\n');
      const content = this.convertMarkdownToHtml(bodyMarkdown);
      
      // Determine post type from options or filename
      const postType = options.type || this.detectPostType(filePath);
      
      // Get category and tags based on post type
      const categoryId = this.getCategoryForType(postType);
      const tagIds = this.getTagsForType(postType);
      
      // Generate English slug from filename (YYYY-MM-DD-slug.md → slug)
      const basename = path.basename(filePath, '.md');
      const slug = basename.replace(/^\d{4}-\d{2}-\d{2}-/, '');

      // Create post data with configuration-based taxonomy
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
      
      // Create the post
      const result = await this.createPost(postData);
      
      // Save post info to local system
      await this.savePostInfo(result);
      
      return result;
      
    } catch (error) {
      console.error('Failed to create announcement post:', error.message);
      throw error;
    }
  }

  detectPostType(filePath) {
    if (!filePath) return 'general-announcement';
    
    const filename = path.basename(filePath).toLowerCase();
    
    if (filename.includes('note')) return 'note-announcement';
    if (filename.includes('release')) return 'product-release';
    if (filename.includes('service') || filename.includes('launch')) return 'service-launch';
    if (filename.includes('techpedia')) return 'note-announcement';
    
    return 'general-announcement';
  }

  getCategoryForType(postType) {
    // First try to get mapped category
    const mappedCategory = this.wpConfig.getCategoryMapping(postType);
    if (mappedCategory) return mappedCategory.id;
    
    // Fall back to default category
    return this.wpConfig.getDefaultCategoryId();
  }

  getTagsForType(postType) {
    // First try to get mapped tags
    const mappedTags = this.wpConfig.getTagMapping(postType);
    if (mappedTags && mappedTags.length > 0) return mappedTags;
    
    // Fall back to default tags
    return this.wpConfig.getDefaultTagIds();
  }

  async savePostInfo(postResult) {
    // Save the new post information locally
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

    // Also create a log entry
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
    type: process.argv[3], // Optional: specify post type
    status: process.argv[4] || 'publish' // Optional: specify status
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