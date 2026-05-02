/**
 * markdown-validator.js
 *
 * Orchestrates the full pre-publish validation pipeline for a Markdown draft.
 * Validation runs in two phases:
 *
 *  Phase 1 – Local checks (no network, fast):
 *    - Title format (must start with 【…】)
 *    - Markdown heading/link/image syntax
 *    - Content structure (introduction, body paragraphs, company footer)
 *    - Format compliance (title prefix, company name, contact info)
 *    - Content quality (word count, polite/casual tone consistency)
 *
 *  Phase 2 – External checks (network, slower):
 *    - Live link validation via LinkValidator (HEAD requests)
 *    - SEO scoring via SEOChecker
 *    - Image validation via ImageValidator
 *
 * Scoring formula (calculateScore):
 *   base 100 − (errors × 20) − (warnings × 5) + (successes × 10)
 *   Clamped to [0, 100].
 *   ≥ 90: recommended to publish
 *   ≥ 70: publish with caution / fix warnings
 *   < 70: significant issues present
 *
 * Validation rules are loaded from config/validation-rules.json so thresholds
 * can be tuned per-project without changing code.
 */

const fs = require('fs').promises;
const path = require('path');
const LinkValidator = require('./link-validator');
const SEOChecker = require('./seo-checker');
const ImageValidator = require('./image-validator');

class MarkdownValidator {
  /**
   * @param {string|null} rulesPath - Path to validation-rules.json.
   *   Defaults to config/validation-rules.json.
   */
  constructor(rulesPath = null) {
    this.rulesPath = rulesPath || path.join(__dirname, '../../config/validation-rules.json');
    this.rules = null;
    this.errors = [];
    this.warnings = [];
    this.score = 0;
    this.maxScore = 100;

    this.linkValidator = new LinkValidator({ timeout: 5000, retries: 2 });
    this.seoChecker = new SEOChecker();
    this.imageValidator = new ImageValidator();
  }

  /**
   * Loads and caches validation rules from JSON config.
   * Called at the start of each validateFile() call so rule file changes
   * take effect without restarting the process.
   */
  async loadRules() {
    try {
      const rulesContent = await fs.readFile(this.rulesPath, 'utf8');
      this.rules = JSON.parse(rulesContent);
    } catch (error) {
      throw new Error(`Failed to load validation rules: ${error.message}`);
    }
  }

  /**
   * Validates a Markdown file on disk.
   *
   * @param {string} markdownPath - Absolute path to the .md file
   * @returns {Promise<Object>} Validation result with errors, warnings, score
   */
  async validateFile(markdownPath) {
    await this.loadRules();
    this.errors = [];
    this.warnings = [];
    this.score = 0;

    try {
      const content = await fs.readFile(markdownPath, 'utf8');
      return await this.validate(content, path.basename(markdownPath));
    } catch (error) {
      throw new Error(`Failed to read markdown file: ${error.message}`);
    }
  }

  /**
   * Runs all validation checks on a content string.
   * Can also be called directly with raw content (useful for testing).
   *
   * @param {string} markdownContent
   * @param {string} [filename='content'] - Used in the result and report filenames
   * @returns {Promise<Object>} Validation result
   */
  async validate(markdownContent, filename = 'content') {
    const lines = markdownContent.split('\n');
    const result = {
      filename,
      isValid: true,
      score: 0,
      errors: [],
      warnings: [],
      sections: {},
      timestamp: new Date().toISOString()
    };

    // Phase 1: local checks (fast, no network)
    await this.validateTitle(lines, result);
    await this.validateMarkdownSyntax(markdownContent, result);
    await this.validateStructure(markdownContent, result);
    await this.validateFormat(markdownContent, result);
    await this.validateContent(markdownContent, result);

    // Phase 2: external checks (network calls; results are appended to same result)
    await this.validateLinks(markdownContent, result);
    await this.validateSEO(markdownContent, result);
    await this.validateImages(markdownContent, result, filename);

    result.score = this.calculateScore(result);
    result.isValid = result.errors.length === 0;

    return result;
  }

  /**
   * Validates the H1 title line against the format pattern and length limits
   * defined in validation-rules.json (title.formatPattern, minLength, maxLength).
   *
   * @param {string[]} lines  - Content split by newline
   * @param {Object}   result - Mutable result object
   */
  async validateTitle(lines, result) {
    const titleLine = lines.find(line => line.trim().startsWith('# '));

    if (!titleLine) {
      this.addError(result, 'title', 'H1タイトルが見つかりません');
      return;
    }

    const title = titleLine.replace(/^#\s*/, '').trim();
    const titleRules = this.rules.title;

    if (title.length < titleRules.minLength) {
      this.addError(result, 'title', `タイトルが短すぎます（${title.length}文字 < ${titleRules.minLength}文字）`);
    }
    if (title.length > titleRules.maxLength) {
      this.addError(result, 'title', `タイトルが長すぎます（${title.length}文字 > ${titleRules.maxLength}文字）`);
    }

    // Pattern from config, e.g. "^【(お知らせ|リリース|開設)】"
    const formatRegex = new RegExp(titleRules.formatPattern);
    if (!formatRegex.test(title)) {
      this.addError(result, 'title', '統一フォーマット【カテゴリ】形式に従っていません');
    } else {
      this.addSuccess(result, 'title', `統一フォーマット準拠: ${title.substring(0, 30)}...`);
    }

    result.sections.title = { content: title, length: title.length, valid: true };
  }

  /**
   * Counts headings, links, and images using regexes and compares counts
   * against the thresholds in validation-rules.json.
   *
   * @param {string} content
   * @param {Object} result
   */
  async validateMarkdownSyntax(content, result) {
    const headingRules = this.rules.markdown.headings;

    const headings = {
      h1: (content.match(/^# /gm) || []).length,
      h2: (content.match(/^## /gm) || []).length,
      h3: (content.match(/^### /gm) || []).length
    };

    if (headings.h1 > headingRules.h1.max) {
      this.addWarning(result, 'markdown', `H1見出しが多すぎます（${headings.h1}個 > ${headingRules.h1.max}個）`);
    }

    if (headings.h2 < headingRules.h2.min && headingRules.h2.recommended) {
      this.addWarning(result, 'markdown', `H2見出しを追加してください（現在${headings.h2}個 < 推奨${headingRules.h2.min}個）`);
    }

    const linkPattern = new RegExp(this.rules.markdown.links.format, 'g');
    const links = content.match(linkPattern) || [];

    const imagePattern = new RegExp(this.rules.markdown.images.format, 'g');
    const images = content.match(imagePattern) || [];

    result.sections.markdown = {
      headings,
      links: links.length,
      images: images.length,
      valid: true
    };

    if (headings.h2 >= headingRules.h2.min) {
      this.addSuccess(result, 'markdown', `見出し構造良好: H2×${headings.h2}, H3×${headings.h3}`);
    }
  }

  /**
   * Checks for required structural sections: introduction paragraph, sufficient
   * body paragraphs, company info, and contact info.
   *
   * Introduction detection skips date lines (starting with digits) and headings
   * to find the first real prose paragraph after the H1 title.
   *
   * The body paragraph count uses +2 as an offset to exclude the title line and
   * introduction from the body count.
   *
   * @param {string} content
   * @param {Object} result
   */
  async validateStructure(content, result) {
    const structureRules = this.rules.structure.requiredSections;
    const sections = {
      introduction: false,
      body: false,
      companyInfo: false,
      contact: false
    };

    const lines = content.split('\n').filter(line => line.trim());
    const titleIndex = lines.findIndex(line => line.startsWith('# '));

    if (titleIndex !== -1 && lines.length > titleIndex + 1) {
      let introText = '';
      for (let i = titleIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip date strings (YYYY年MM月, 2026-05-01, etc.) and sub-headings
        if (line && !line.match(/^\d{4}/) && !line.startsWith('#')) {
          introText = line;
          break;
        }
      }

      if (introText.length >= structureRules.introduction.minLength) {
        sections.introduction = true;
        this.addSuccess(result, 'structure', '導入文あり');
      } else if (introText.length > 0) {
        this.addWarning(result, 'structure', `導入文が短すぎます（${introText.length}文字 < ${structureRules.introduction.minLength}文字）`);
      } else {
        this.addWarning(result, 'structure', '導入文が見つかりません');
      }
    }

    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
    if (paragraphs.length >= structureRules.body.minParagraphs + 2) {
      sections.body = true;
      this.addSuccess(result, 'structure', `本文段落数: ${paragraphs.length - 2}段落`);
    } else {
      this.addWarning(result, 'structure', '本文の段落数が不足しています');
    }

    // Keyword-based checks for required footer sections
    structureRules.companyInfo.keywords.forEach(keyword => {
      if (content.includes(keyword)) sections.companyInfo = true;
    });

    structureRules.contact.keywords.forEach(keyword => {
      if (content.includes(keyword)) sections.contact = true;
    });

    if (!sections.companyInfo) this.addWarning(result, 'structure', '会社情報が見つかりません');
    if (!sections.contact) this.addWarning(result, 'structure', 'お問い合わせ情報が見つかりません');

    result.sections.structure = sections;
  }

  /**
   * Verifies that the three mandatory unified-format elements are present:
   * correct title prefix, company name mention, and contact info.
   * This check is intentionally stricter than validateStructure's keyword search —
   * it requires the exact company name string used in the footer template.
   *
   * @param {string} content
   * @param {Object} result
   */
  async validateFormat(content, result) {
    const titleMatch = content.match(/^#\s*【(お知らせ|リリース|開設)】/m);
    const hasProperTitle = !!titleMatch;
    const hasCompanyInfo = content.includes('ITクオリティ株式会社');
    const hasContact = content.includes('お問い合わせ') || content.includes('inquiry');

    if (hasProperTitle && hasCompanyInfo && hasContact) {
      this.addSuccess(result, 'format', '統一フォーマット準拠');
    } else {
      const missing = [];
      if (!hasProperTitle) missing.push('タイトル形式');
      if (!hasCompanyInfo) missing.push('会社情報');
      if (!hasContact) missing.push('お問い合わせ');

      if (missing.length > 0) {
        this.addWarning(result, 'format', `フォーマット要素不足: ${missing.join(', ')}`);
      }
    }

    result.sections.format = {
      titleFormat: hasProperTitle,
      companyInfo: hasCompanyInfo,
      contact: hasContact,
      valid: hasProperTitle && hasCompanyInfo && hasContact
    };
  }

  /**
   * Checks word count and writing-style consistency (です/ます vs である).
   * Word count is a character count of stripped Markdown (suitable for Japanese
   * where words are not space-delimited).
   *
   * @param {string} content
   * @param {Object} result
   */
  async validateContent(content, result) {
    const contentRules = this.rules.content;

    // Strip Markdown syntax characters; count remaining characters as "words"
    const wordCount = content.replace(/[#\*\[\]()]/g, '').trim().length;
    if (wordCount < contentRules.readability.minWordCount) {
      this.addWarning(result, 'content', `文字数が不足しています（${wordCount}文字 < ${contentRules.readability.minWordCount}文字）`);
    } else {
      this.addSuccess(result, 'content', `文字数: ${wordCount}文字`);
    }

    // Determine dominant voice by counting sentence endings
    const politeEndings = content.match(/(です|ます)。/g) || [];
    const casualEndings = content.match(/(である|だ)。/g) || [];

    if (politeEndings.length > casualEndings.length) {
      this.addSuccess(result, 'content', 'です・ます調で統一');
    } else if (casualEndings.length > 0) {
      this.addWarning(result, 'content', 'です・ます調に統一してください');
    }

    result.sections.content = {
      wordCount,
      politeForm: politeEndings.length > casualEndings.length,
      valid: wordCount >= contentRules.readability.minWordCount
    };
  }

  /**
   * Delegates to LinkValidator. Network errors during link checking are caught
   * and surfaced as warnings rather than errors to avoid failing the entire
   * validation run due to transient connectivity issues.
   *
   * @param {string} content
   * @param {Object} result
   */
  async validateLinks(content, result) {
    try {
      const linkResults = await this.linkValidator.validateLinks(content);

      result.sections.links = {
        total: linkResults.totalLinks,
        valid: linkResults.validLinks,
        broken: linkResults.brokenLinks,
        slow: linkResults.slowLinks,
        details: linkResults.details
      };

      if (linkResults.brokenLinks > 0) {
        linkResults.errors.forEach(error => this.addError(result, 'links', error));
      }
      if (linkResults.slowLinks > 0) {
        linkResults.warnings.forEach(warning => this.addWarning(result, 'links', warning));
      }
      if (linkResults.validLinks > 0) {
        this.addSuccess(result, 'links', `リンク: ${linkResults.validLinks}/${linkResults.totalLinks}件 正常`);
      }

      const anchorResults = await this.linkValidator.validateAnchors(content);
      if (anchorResults.brokenAnchors > 0) {
        anchorResults.errors.forEach(error => this.addError(result, 'links', error));
      }

    } catch (error) {
      this.addWarning(result, 'links', `リンク検証エラー: ${error.message}`);
    }
  }

  /** @param {string} content @param {Object} result */
  async validateSEO(content, result) {
    try {
      const titleLine = content.match(/^#\s+(.+)$/m);
      const title = titleLine ? titleLine[1].trim() : '';

      const seoResults = await this.seoChecker.checkSEO(content, title);

      result.sections.seo = { score: seoResults.score, details: seoResults.details };

      seoResults.issues.forEach(issue => {
        if (issue.severity === 'error') {
          this.addError(result, 'seo', issue.message);
        } else {
          this.addWarning(result, 'seo', issue.message);
        }
      });

      seoResults.recommendations.forEach(rec => this.addWarning(result, 'seo', rec.message));
      seoResults.successes.forEach(success => this.addSuccess(result, 'seo', success.message));

    } catch (error) {
      this.addWarning(result, 'seo', `SEO検証エラー: ${error.message}`);
    }
  }

  /** @param {string} content @param {Object} result @param {string} filename */
  async validateImages(content, result, filename) {
    try {
      const basePath = path.dirname(this.getFilePath(filename));
      const imageResults = await this.imageValidator.validateImages(content, basePath);

      result.sections.images = {
        total: imageResults.totalImages,
        valid: imageResults.validImages,
        details: imageResults.details
      };

      imageResults.issues.forEach(issue => this.addError(result, 'images', issue));
      imageResults.warnings.forEach(warning => this.addWarning(result, 'images', warning));
      imageResults.successes.forEach(success => this.addSuccess(result, 'images', success));

      const suggestions = this.imageValidator.generateOptimizationSuggestions(imageResults);
      suggestions.forEach(suggestion => this.addWarning(result, 'images', suggestion));

    } catch (error) {
      this.addWarning(result, 'images', `画像検証エラー: ${error.message}`);
    }
  }

  /**
   * Resolves a filename to an absolute path for image base-path calculation.
   *
   * @param {string} filename
   * @returns {string}
   */
  getFilePath(filename) {
    if (path.isAbsolute(filename)) return filename;
    return path.join(process.cwd(), 'drafts', filename);
  }

  /**
   * Calculates the overall validation score.
   *
   * Formula: 100 − (errors × 20) − (warnings × 5) + (successes × 10)
   * Clamped to [0, 100].
   *
   * Weights reflect severity: an error is 4× more impactful than a warning.
   * Successes are counted positively to reward well-structured content.
   *
   * @param {Object} result
   * @returns {number} Integer score 0–100
   */
  calculateScore(result) {
    const errorPenalty = result.errors.length * 20;
    const warningPenalty = result.warnings.length * 5;
    const successBonus = this.getSuccessCount(result) * 10;

    const score = Math.max(0, Math.min(100, 100 - errorPenalty - warningPenalty + successBonus));
    return Math.round(score);
  }

  /** @param {Object} result @returns {number} */
  getSuccessCount(result) {
    return (result.successes || []).length;
  }

  /** @param {Object} result @param {string} category @param {string} message */
  addError(result, category, message) {
    result.errors.push({ category, message, severity: 'error' });
  }

  /** @param {Object} result @param {string} category @param {string} message */
  addWarning(result, category, message) {
    result.warnings.push({ category, message, severity: 'warning' });
  }

  /** @param {Object} result @param {string} category @param {string} message */
  addSuccess(result, category, message) {
    if (!result.successes) result.successes = [];
    result.successes.push({ category, message, severity: 'success' });
  }
}

module.exports = MarkdownValidator;
