/**
 * Site Configuration Manager
 *
 * Centralized configuration for multi-site WordPress CMS management
 * Eliminates hardcoding of site-specific settings
 *
 * Usage:
 *   const SiteConfig = require('./config/site-config');
 *   console.log(SiteConfig.getCompanyName()); // Default site
 *
 *   const customSite = new SiteConfig.SiteConfig('tech.itq.jp');
 *   console.log(customSite.getCompanyName());
 */

const fs = require('fs');
const path = require('path');

class SiteConfig {
  constructor(siteId = null) {
    this.configDir = path.join(__dirname, 'sites');

    // Load site registry
    this.registry = this.loadConfig('index.json');

    // Determine which site to use
    this.siteId = siteId || process.env.SITE_ID || this.registry.defaultSite;

    if (!this.siteId) {
      throw new Error('No site ID specified. Set SITE_ID environment variable or pass siteId to constructor.');
    }

    // Load site configuration
    const siteInfo = this.registry.sites?.[this.siteId];
    if (!siteInfo) {
      throw new Error(`Site '${this.siteId}' not found in registry. Available sites: ${Object.keys(this.registry.sites || {}).join(', ')}`);
    }

    const configFile = siteInfo.configFile || `${this.siteId}.json`;
    this.config = this.loadConfig(configFile);

    // Validate configuration
    this.validateConfig();

    console.log(`✅ SiteConfig loaded: ${this.siteId} (${siteInfo.name})`);
  }

  loadConfig(filename) {
    try {
      const filepath = path.join(this.configDir, filename);
      const content = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load config file ${filename}:`, error.message);
      throw error;
    }
  }

  validateConfig() {
    const required = ['wordpress', 'branding', 'companyInfo', 'contact', 'http', 'paths'];
    const missing = required.filter(key => !this.config[key]);

    if (missing.length > 0) {
      throw new Error(`Site configuration missing required keys: ${missing.join(', ')}`);
    }
  }

  // ============================================================================
  // SITE IDENTIFICATION
  // ============================================================================

  getSiteId() {
    return this.siteId;
  }

  getSiteName() {
    return this.registry.sites[this.siteId]?.name || this.config.siteName || this.siteId;
  }

  // ============================================================================
  // WORDPRESS CONFIGURATION
  // ============================================================================

  getWordPressApiUrl() {
    return this.config.wordpress.apiUrl;
  }

  getWordPressEndpoint(type) {
    return this.config.wordpress.endpoints?.[type] || `/${type}`;
  }

  getSyncInterval() {
    return this.config.wordpress.syncInterval || 3600;
  }

  getMaxPerPage() {
    return this.config.wordpress.maxPerPage || 100;
  }

  // ============================================================================
  // BRANDING
  // ============================================================================

  getCompanyName() {
    return this.config.branding.companyName;
  }

  getCompanyNameShort() {
    return this.config.branding.companyNameShort || this.config.branding.companyName;
  }

  getCompanyNameEn() {
    return this.config.branding.companyNameEn || this.config.branding.companyName;
  }

  // ============================================================================
  // COMPANY INFO
  // ============================================================================

  getCompanyDescription(type = 'standard') {
    return this.config.companyInfo.descriptions?.[type] ||
           this.config.companyInfo.descriptions?.standard ||
           '';
  }

  getAllCompanyDescriptions() {
    return this.config.companyInfo.descriptions || {};
  }

  // ============================================================================
  // CONTACT INFORMATION
  // ============================================================================

  getInquiryUrl() {
    return this.config.contact.inquiryUrl;
  }

  getWebsiteUrl() {
    return this.config.contact.websiteUrl || this.config.wordpress.apiUrl.replace('/wp-json/wp/v2', '');
  }

  // ============================================================================
  // HTTP CONFIGURATION
  // ============================================================================

  getUserAgent() {
    return this.config.http.userAgent || 'WordPress-CMS-Client/1.0';
  }

  getTimeout() {
    return this.config.http.timeout || 30000;
  }

  getMaxRetries() {
    return this.config.http.maxRetries || 3;
  }

  getRetryDelay() {
    return this.config.http.retryDelay || 1000;
  }

  getBackoffMultiplier() {
    return this.config.http.backoffMultiplier || 2;
  }

  getAllowedDomains() {
    return this.config.http.allowedDomains || [];
  }

  getCircuitBreakerConfig() {
    return this.config.http.circuitBreaker || {
      failureThreshold: 5,
      resetTimeout: 60000
    };
  }

  // ============================================================================
  // PATHS
  // ============================================================================

  getContentPath() {
    return this.resolvePath(this.config.paths.content);
  }

  getDraftsPath() {
    return this.resolvePath(this.config.paths.drafts || './drafts');
  }

  getLogsPath() {
    return this.resolvePath(this.config.paths.logs || './logs');
  }

  getPostsPath() {
    return this.resolvePath(this.config.paths.posts || path.join(this.config.paths.content, 'posts'));
  }

  getPagesPath() {
    return this.resolvePath(this.config.paths.pages || path.join(this.config.paths.content, 'pages'));
  }

  getMediaPath() {
    return this.resolvePath(this.config.paths.media || path.join(this.config.paths.content, 'media'));
  }

  resolvePath(relativePath) {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    // Resolve relative to project root (one level up from config directory)
    return path.resolve(__dirname, '..', relativePath);
  }

  // ============================================================================
  // CREDENTIALS
  // ============================================================================

  getCredentials() {
    const envPrefix = this.config.credentials?.envPrefix || 'WP';

    // Try site-specific credentials first
    const siteSpecificUsername = process.env[`${envPrefix}_USERNAME`];
    const siteSpecificPassword = process.env[`${envPrefix}_APP_PASSWORD`];

    // Fallback to generic credentials
    const username = siteSpecificUsername || process.env.WP_USERNAME;
    const password = siteSpecificPassword || process.env.WP_APP_PASSWORD;

    return {
      username,
      password,
      hasCredentials: !!(username && password)
    };
  }

  // ============================================================================
  // TEMPLATE RENDERING
  // ============================================================================

  getTemplateVariables() {
    return {
      // Branding
      companyName: this.getCompanyName(),
      companyNameShort: this.getCompanyNameShort(),
      companyNameEn: this.getCompanyNameEn(),

      // Descriptions
      companyDescription: this.getCompanyDescription('standard'),
      companyDescriptionExtended: this.getCompanyDescription('extended'),

      // Contact
      inquiryUrl: this.getInquiryUrl(),
      websiteUrl: this.getWebsiteUrl(),

      // Site info
      siteId: this.getSiteId(),
      siteName: this.getSiteName()
    };
  }

  renderTemplate(template, additionalData = {}) {
    const variables = {
      ...this.getTemplateVariables(),
      ...additionalData
    };

    let result = template;

    // Replace all variables
    Object.entries(variables).forEach(([key, value]) => {
      if (value && !Array.isArray(value)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value);
      }
    });

    return result;
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  isValidDomain(url) {
    try {
      const hostname = new URL(url).hostname;
      const allowedDomains = this.getAllowedDomains();

      if (allowedDomains.length === 0) {
        return true; // No restrictions
      }

      return allowedDomains.some(domain => hostname.includes(domain));
    } catch {
      return false;
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  reload() {
    this.registry = this.loadConfig('index.json');
    const siteInfo = this.registry.sites?.[this.siteId];
    const configFile = siteInfo?.configFile || `${this.siteId}.json`;
    this.config = this.loadConfig(configFile);
    this.validateConfig();
    console.log(`🔄 SiteConfig reloaded: ${this.siteId}`);
  }

  getFullConfig() {
    return {
      siteId: this.siteId,
      siteName: this.getSiteName(),
      config: this.config
    };
  }

  printConfig() {
    console.log('\n=== Site Configuration ===');
    console.log(`Site ID: ${this.getSiteId()}`);
    console.log(`Site Name: ${this.getSiteName()}`);
    console.log(`Company: ${this.getCompanyName()}`);
    console.log(`API URL: ${this.getWordPressApiUrl()}`);
    console.log(`Content Path: ${this.getContentPath()}`);
    console.log(`Inquiry URL: ${this.getInquiryUrl()}`);
    console.log(`User Agent: ${this.getUserAgent()}`);

    const creds = this.getCredentials();
    console.log(`Credentials: ${creds.hasCredentials ? '✅ Configured' : '❌ Missing'}`);
    console.log('===========================\n');
  }

  // ============================================================================
  // STATIC METHODS FOR MULTI-SITE MANAGEMENT
  // ============================================================================

  static listSites() {
    const indexPath = path.join(__dirname, 'sites', 'index.json');
    const registry = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Object.entries(registry.sites || {}).map(([id, info]) => ({
      id,
      ...info
    }));
  }

  static getDefaultSiteId() {
    const indexPath = path.join(__dirname, 'sites', 'index.json');
    const registry = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return registry.defaultSite;
  }

  // ============================================================================
  // CLI ARGUMENT PARSER
  // ============================================================================

  /**
   * Parse site ID from command line arguments
   *
   * Supports multiple formats:
   * - --site=www.itq.co.jp
   * - --site www.itq.co.jp
   * - Environment variable SITE_ID
   * - Falls back to default site
   *
   * @returns {string|null} Site ID or null for default
   */
  static parseSiteIdFromArgs() {
    const args = process.argv.slice(2);

    // Check for --site=value format
    const siteArg = args.find(arg => arg.startsWith('--site='));
    if (siteArg) {
      return siteArg.split('=')[1];
    }

    // Check for --site value format
    const siteIndex = args.indexOf('--site');
    if (siteIndex !== -1 && args[siteIndex + 1]) {
      return args[siteIndex + 1];
    }

    // Fall back to environment variable
    if (process.env.SITE_ID) {
      return process.env.SITE_ID;
    }

    // Return null to use default
    return null;
  }

  /**
   * Create a SiteConfig instance from CLI arguments
   *
   * @returns {SiteConfig} SiteConfig instance
   */
  static fromArgs() {
    const siteId = SiteConfig.parseSiteIdFromArgs();
    return new SiteConfig(siteId);
  }
}

// Export both the class and a default instance
const defaultInstance = new SiteConfig();

module.exports = defaultInstance;
module.exports.SiteConfig = SiteConfig;
module.exports.listSites = SiteConfig.listSites;
module.exports.getDefaultSiteId = SiteConfig.getDefaultSiteId;
module.exports.parseSiteIdFromArgs = SiteConfig.parseSiteIdFromArgs;
module.exports.fromArgs = SiteConfig.fromArgs;
