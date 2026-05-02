/**
 * link-validator.js
 *
 * Validates all Markdown hyperlinks and in-page anchor links within a content
 * string. External URLs are checked via HTTP HEAD requests (avoids downloading
 * body content); internal anchors are verified against headings in the same file.
 *
 * Results are cached per URL within a single validator instance so that the
 * same URL appearing multiple times in a document is only fetched once.
 *
 * allowedDomains restricts which external domains the link checker will actually
 * reach out to. Domains outside the list are flagged as "blocked" rather than
 * "broken" — useful for preventing false positives on third-party sites that
 * block automated HEAD requests.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const SiteConfig = require('../../config/site-config');

class LinkValidator {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeout=5000]       - Request timeout in ms
   * @param {number} [options.retries=2]          - Retry attempts on timeout
   * @param {string[]} [options.allowedDomains]   - Domains to actively check;
   *   defaults to siteConfig.getAllowedDomains(). Pass [] to check all domains.
   * @param {Object|null} [siteConfig]
   */
  constructor(options = {}, siteConfig = null) {
    this.siteConfig = siteConfig || SiteConfig;
    this.timeout = options.timeout || 5000;
    this.retries = options.retries || 2;
    this.allowedDomains = options.allowedDomains || this.siteConfig.getAllowedDomains();
    // In-memory cache keyed by URL string; survives multiple validateLinks() calls
    this.cache = new Map();
  }

  /**
   * Extracts all Markdown links from content and checks each one.
   *
   * @param {string} content       - Full Markdown content string
   * @param {string|null} baseUrl  - Used to resolve relative URLs; defaults to
   *   the site's website URL from config
   * @returns {Promise<Object>} Aggregated results with totals and per-link details
   */
  async validateLinks(content, baseUrl = null) {
    baseUrl = baseUrl || this.siteConfig.getWebsiteUrl();
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    const links = [];
    let match;

    while ((match = linkPattern.exec(content)) !== null) {
      links.push({ text: match[1], url: match[2], original: match[0] });
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

    for (const link of links) {
      try {
        const result = await this.checkLink(link.url, baseUrl);
        result.text = link.text;
        result.original = link.original;
        results.details.push(result);

        if (result.status === 'valid') {
          results.validLinks++;
          // Flag slow but valid links as warnings (does not fail validation)
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

  /**
   * Checks a single URL and returns a detailed result object.
   * Uses the in-memory cache to avoid redundant HTTP requests.
   *
   * @param {string} url
   * @param {string} baseUrl - Base URL for resolving relative paths
   * @returns {Promise<Object>} Result with status, statusCode, responseTime, etc.
   */
  async checkLink(url, baseUrl) {
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
      const fullUrl = this.resolveUrl(url, baseUrl);
      result.resolvedUrl = fullUrl;

      if (!this.isValidUrl(fullUrl)) {
        result.status = 'invalid';
        result.error = 'Invalid URL format';
        return result;
      }

      // Skip HTTP check for domains not in the allowed list; report as "blocked"
      // rather than "broken" so callers can distinguish config-filtered URLs from
      // genuinely broken links.
      if (this.allowedDomains.length > 0 && !this.isDomainAllowed(fullUrl)) {
        result.status = 'blocked';
        result.error = 'Domain not in allowed list';
        return result;
      }

      const response = await this.makeRequest(fullUrl);
      result.responseTime = Date.now() - startTime;
      result.statusCode = response.statusCode;

      // Treat 2xx and 3xx as valid (3xx means redirect was followed successfully)
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

    this.cache.set(url, result);
    return result;
  }

  /**
   * Makes an HTTP/HTTPS HEAD request to the given URL.
   * HEAD is used instead of GET to avoid downloading the response body,
   * which keeps link checking fast even for large pages.
   * Redirects (3xx) are followed recursively up to the browser's implicit limit.
   *
   * @param {string} url
   * @returns {Promise<{statusCode: number, headers: Object}>}
   */
  makeRequest(url) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        timeout: this.timeout,
        headers: {
          'User-Agent': 'wp-content-manager/1.0'
        }
      };

      const req = client.request(options, (res) => {
        // Follow redirects by recursively calling makeRequest with the new location
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

  /**
   * Resolves a potentially-relative URL against a base URL.
   * Returns the original string unchanged if resolution fails (e.g. malformed URL).
   *
   * @param {string} url
   * @param {string} baseUrl
   * @returns {string}
   */
  resolveUrl(url, baseUrl) {
    try {
      return new URL(url, baseUrl).href;
    } catch (error) {
      return url;
    }
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Checks whether the URL's hostname matches any entry in allowedDomains.
   * Supports subdomain matching: 'itq.co.jp' matches 'www.itq.co.jp'.
   *
   * @param {string} url
   * @returns {boolean}
   */
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

  /**
   * Classifies a URL by its scheme/format for reporting purposes.
   *
   * @param {string} url
   * @returns {'anchor'|'internal'|'email'|'phone'|'external'|'relative'}
   */
  getLinkType(url) {
    if (url.startsWith('#')) return 'anchor';
    if (url.startsWith('/')) return 'internal';
    if (url.startsWith('mailto:')) return 'email';
    if (url.startsWith('tel:')) return 'phone';
    if (url.match(/^https?:\/\//)) return 'external';
    return 'relative';
  }

  /**
   * Validates in-page anchor links (e.g. [Section](#section-title)) by checking
   * that each target ID corresponds to an actual heading in the document.
   *
   * The heading ID generation follows the same algorithm used by most Markdown
   * processors: lowercase, strip non-word characters, replace spaces with hyphens.
   * Note: Japanese characters are stripped by this algorithm, so anchors pointing
   * to Japanese headings will always fail — this is a known limitation.
   *
   * @param {string} content - Markdown content string
   * @returns {Promise<Object>} Anchor validation results
   */
  async validateAnchors(content) {
    const anchorPattern = /\[([^\]]+)\]\(#([^)]+)\)/g;
    const headingPattern = /^#+\s+(.+)$/gm;
    const anchors = [];
    const headings = [];
    let match;

    while ((match = anchorPattern.exec(content)) !== null) {
      anchors.push({ text: match[1], anchor: match[2], original: match[0] });
    }

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

  /**
   * Generates the heading anchor ID that a Markdown processor would produce.
   * Mirrors the behaviour of GitHub Flavored Markdown: lowercase, strip
   * non-alphanumeric/hyphen characters, collapse hyphens.
   *
   * @param {string} heading - Plain-text heading content
   * @returns {string} Anchor ID string
   */
  generateHeadingId(heading) {
    return heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  /** Clears the URL result cache. Call between document validations if reusing the instance. */
  clearCache() {
    this.cache.clear();
  }

  /** @returns {{size: number, keys: string[]}} Cache statistics for debugging */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = LinkValidator;
