require('dotenv').config();
const UnifiedWordPressClient = require('../src/wordpress-client');

class PageSlugUpdater {
  constructor() {
    this.client = new UnifiedWordPressClient();
  }

  async updatePageSlug(pageId, newSlug) {
    try {
      console.log(`Updating page ${pageId} slug to: ${newSlug}`);
      
      // Test connection first
      const connected = await this.client.testConnection();
      if (!connected) {
        throw new Error('WordPress API connection failed');
      }

      // Get current page data
      const currentPage = await this.client.makeRequest(`/pages/${pageId}`);
      console.log(`Current slug: ${currentPage.slug}`);
      console.log(`Current title: ${currentPage.title.rendered}`);

      // Update with new slug
      const updateData = {
        slug: newSlug
      };

      const updatedPage = await this.client.makeRequest(`/pages/${pageId}`, 'POST', updateData);
      
      console.log('✅ Page updated successfully');
      console.log(`New slug: ${updatedPage.slug}`);
      console.log(`Title remains: ${updatedPage.title.rendered}`);
      console.log(`Modified: ${updatedPage.modified}`);
      
      return updatedPage;
      
    } catch (error) {
      console.error('❌ Failed to update page:', error.message);
      throw error;
    }
  }
}

if (require.main === module) {
  const updater = new PageSlugUpdater();
  const pageId = 262; // Top page ID
  const newSlug = 'top-page';
  
  updater.updatePageSlug(pageId, newSlug)
    .then(result => {
      console.log('\n=== Page Update Complete ===');
      console.log(`Page ID: ${result.id}`);
      console.log(`New URL slug: ${result.slug}`);
      console.log(`Full URL: https://your-site.com/${result.slug}/`);
    })
    .catch(console.error);
}

module.exports = PageSlugUpdater;