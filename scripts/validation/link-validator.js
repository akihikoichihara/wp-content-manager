const https = require('https');
const http = require('http');
const { URL } = require('url');
const SiteConfig = require('../../config/site-config');

class LinkValidator {
  constructor(options = {}, siteConfig = null) {
    this.siteConfig = siteConfig || SiteConfig;
    this.timeout = options.timeout || 5000;
    this.retries = options.retries || 2;
    this.allowedDomains = options.allowedDomains || this.siteConfig.getAllowedDomains();
    this.cache = new Map(); // Cache for link check results
  }

  async validateLinks(content, baseUrl = null) {
    baseUrl = baseUrl || this.siteConfig.getWebsiteUrl();
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    const links = [];
    let match;

    // Extract all links
    while ((match = linkPattern.exec(content)) !== null) {
      const linkText = match[1];
      const linkUrl = match[2];
      links.push({ text: linkText, url: linkUrl, original: match[0] });
    }

    const results = {
      totalLinks: links.length,
      validLinks: 0,
      brokenLinks: 0,
      slowLinks: 0,
      warnings: [],
      errors: [],
      details: []
    };

    // Check each link
    for (const link of links) {
      try {
        const result = await this.checkLink(link.url, baseUrl);
        result.text = link.text;
        result.original = link.original;
        results.details.push(result);

        if (result.status === 'valid') {
          results.validLinks++;
          if (result.responseTime > 3000) {
            results.slowLinks++;
            results.warnings.push(`リンクの応答が遅いです: ${link.url} (${result.responseTime}ms)`);
          }
        } else {
          results.brokenLinks++;
          results.errors.push(`リンク切れ: ${link.url} (${result.error})`);
        }
      } catch (error) {
        results.brokenLinks++;
        results.errors.push(`リンクチェック失敗: ${link.url} (${error.message})`);
      }
    }

    return results;
  }

  async checkLink(url, baseUrl) {
    // Check cache first
    if (this.cache.has(url)) {
      return { ...this.cache.get(url), cached: true };
    }

    const result = {
      url,
      status: 'unknown',
      statusCode: null,
      responseTime: 0,
      error: null,
      type: this.getLinkType(url)
    };

    const startTime = Date.now();

    try {
      // Handle relative URLs
      const fullUrl = this.resolveUrl(url, baseUrl);
      result.resolvedUrl = fullUrl;

      // Validate URL format
      if (!this.isValidUrl(fullUrl)) {
        result.status = 'invalid';
        result.error = 'Invalid URL format';
        return result;
      }

      // Check if domain is allowed (if allowedDomains is specified)
      if (this.allowedDomains.length > 0 && !this.isDomainAllowed(fullUrl)) {
        result.status = 'blocked';
        result.error = 'Domain not in allowed list';
        return result;
      }

      // Perform HTTP check
      const response = await this.makeRequest(fullUrl);
      result.responseTime = Date.now() - startTime;
      result.statusCode = response.statusCode;

      if (response.statusCode >= 200 && response.statusCode < 400) {
        result.status = 'valid';
        result.contentType = response.headers['content-type'];
      } else {
        result.status = 'broken';
        result.error = `HTTP ${response.statusCode}`;
      }

    } catch (error) {
      result.responseTime = Date.now() - startTime;
      result.status = 'broken';
      result.error = error.message;
    }

    // Cache the result
    this.cache.set(url, result);
    return result;
  }

  makeRequest(url) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD', // Use HEAD to avoid downloading content
        timeout: this.timeout,
        headers: {
          'User-Agent': 'wp-content-manager/1.0'
        }
      };

      const req = client.request(options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = this.resolveUrl(res.headers.location, url);
          return this.makeRequest(redirectUrl).then(resolve).catch(reject);
        }
        
        resolve({
          statusCode: res.statusCode,
          headers: res.headers
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  resolveUrl(url, baseUrl) {
    try {
      return new URL(url, baseUrl).href;
    } catch (error) {
      return url;
    }
  }

  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  }

  isDomainAllowed(url) {
    try {
      const urlObj = new URL(url);
      return this.allowedDomains.some(domain => 
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
      );
    } catch (error) {
      return false;
    }
  }

  getLinkType(url) {
    if (url.startsWith('#')) return 'anchor';
    if (url.startsWith('/')) return 'internal';
    if (url.startsWith('mailto:')) return 'email';
    if (url.startsWith('tel:')) return 'phone';
    if (url.match(/^https?:\/\//)) return 'external';
    return 'relative';
  }

  async validateAnchors(content) {
    const anchorPattern = /\[([^\]]+)\]\(#([^)]+)\)/g;
    const headingPattern = /^#+\s+(.+)$/gm;
    const anchors = [];
    const headings = [];
    let match;

    // Extract anchor links
    while ((match = anchorPattern.exec(content)) !== null) {
      anchors.push({
        text: match[1],
        anchor: match[2],
        original: match[0]
      });
    }

    // Extract headings
    while ((match = headingPattern.exec(content)) !== null) {
      const heading = match[1].trim();
      const id = this.generateHeadingId(heading);
      headings.push({ text: heading, id });
    }

    const results = {
      totalAnchors: anchors.length,
      validAnchors: 0,
      brokenAnchors: 0,
      errors: []
    };

    // Check each anchor
    for (const anchor of anchors) {
      const exists = headings.some(h => h.id === anchor.anchor);
      if (exists) {
        results.validAnchors++;
      } else {
        results.brokenAnchors++;
        results.errors.push(`アンカーリンク切れ: #${anchor.anchor}`);
      }
    }

    return results;
  }

  generateHeadingId(heading) {
    // Simple heading ID generation (similar to most Markdown processors)
    return heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = LinkValidator;