/**
 * seo-checker.js
 *
 * SEO quality checks for Japanese WordPress announcement content.
 * Scores the following dimensions and returns a combined SEO score:
 *
 *  - Title length and descriptiveness
 *  - Heading structure (H1 uniqueness, H2 presence, hierarchy)
 *  - Content quality (word count, sentence length)
 *  - Keyword density (extracted from the title, checked in the body)
 *  - Link structure (internal vs external counts, descriptive link text)
 *  - Readability (average sentence length, complex sentence ratio)
 *
 * Scoring formula (calculateSEOScore):
 *   base 0 + (successes × 8) − (errors × 15) − (recommendations × 5)
 *   Clamped to [0, 100].
 *
 * Note on Japanese "word count":
 *   Standard word-count metrics assume space-delimited words (English).
 *   For Japanese, countWords() returns the character count of the content
 *   after stripping Markdown syntax, which correlates better with reading time.
 */

class SEOChecker {
  /**
   * @param {Object} [rules] - Override default rule thresholds
   */
  constructor(rules = {}) {
    this.rules = {
      title: {
        minLength: 10,
        maxLength: 60,
        keywordDensity: 3  // max occurrences in title (not currently enforced)
      },
      headings: {
        h1: { max: 1, required: true },
        h2: { min: 1, recommended: true },
        hierarchy: true  // warn when heading levels skip (e.g. H1 → H3)
      },
      content: {
        minWordCount: 200,
        maxSentenceLength: 100,  // characters; Japanese sentences tend to be longer
        keywordDensity: { min: 1, max: 3 }  // percentage range for primary keywords
      },
      links: {
        minInternal: 1,
        maxExternal: 10,
        descriptiveText: true
      },
      ...rules
    };
  }

  /**
   * Runs all SEO checks and returns a consolidated result.
   *
   * @param {string} content  - Markdown content string
   * @param {string} [title]  - H1 title text; extracted from content if omitted
   * @returns {Promise<Object>} Result with score, issues, recommendations, successes
   */
  async checkSEO(content, title = null) {
    const results = {
      score: 0,
      maxScore: 100,
      issues: [],
      recommendations: [],
      successes: [],
      details: {}
    };

    if (!title) {
      const titleMatch = content.match(/^#\s+(.+)$/m);
      title = titleMatch ? titleMatch[1].trim() : '';
    }

    await this.checkTitle(title, results);
    await this.checkHeadingStructure(content, results);
    await this.checkContentQuality(content, results);
    await this.checkKeywordOptimization(content, title, results);
    await this.checkLinksAndStructure(content, results);
    await this.checkReadability(content, results);

    results.score = this.calculateSEOScore(results);

    return results;
  }

  /**
   * Checks title length and descriptiveness.
   * A title is considered descriptive if it contains action/subject words
   * (方法, 解説, etc.) or is longer than 20 characters — the assumption being
   * that longer titles tend to be more specific.
   *
   * @param {string} title
   * @param {Object} results - Mutable results object
   */
  async checkTitle(title, results) {
    const titleSection = { title, length: title.length, issues: [], score: 0 };

    if (title.length < this.rules.title.minLength) {
      titleSection.issues.push(`タイトルが短すぎます（${title.length}文字 < ${this.rules.title.minLength}文字）`);
      results.issues.push({ category: 'title', severity: 'error', message: titleSection.issues[titleSection.issues.length - 1] });
    } else if (title.length > this.rules.title.maxLength) {
      titleSection.issues.push(`タイトルが長すぎます（${title.length}文字 > ${this.rules.title.maxLength}文字）`);
      results.issues.push({ category: 'title', severity: 'error', message: titleSection.issues[titleSection.issues.length - 1] });
    } else {
      titleSection.score += 30;
      results.successes.push({ category: 'title', message: `タイトル長適切（${title.length}文字）` });
    }

    if (this.isDescriptiveTitle(title)) {
      titleSection.score += 20;
      results.successes.push({ category: 'title', message: '具体的で分かりやすいタイトル' });
    } else {
      titleSection.issues.push('より具体的で分かりやすいタイトルにしてください');
      results.recommendations.push({ category: 'title', message: titleSection.issues[titleSection.issues.length - 1] });
    }

    results.details.title = titleSection;
  }

  /**
   * Validates heading count and structural hierarchy.
   * Hierarchy check warns when a level is skipped (e.g. H1 directly to H3),
   * which can confuse screen readers and search engine parsers.
   *
   * @param {string} content
   * @param {Object} results
   */
  async checkHeadingStructure(content, results) {
    const headings = this.extractHeadings(content);
    const structure = {
      h1: headings.filter(h => h.level === 1).length,
      h2: headings.filter(h => h.level === 2).length,
      h3: headings.filter(h => h.level === 3).length,
      total: headings.length,
      hierarchy: true,
      issues: []
    };

    if (structure.h1 === 0) {
      structure.issues.push('H1見出しが必要です');
      results.issues.push({ category: 'headings', severity: 'error', message: 'H1見出しが必要です' });
    } else if (structure.h1 > 1) {
      structure.issues.push('H1見出しは1つまでにしてください');
      results.recommendations.push({ category: 'headings', message: 'H1見出しは1つまでにしてください' });
    } else {
      results.successes.push({ category: 'headings', message: 'H1見出し適切' });
    }

    if (structure.h2 < this.rules.headings.h2.min) {
      structure.issues.push(`H2見出しを追加してください（現在${structure.h2}個 < 推奨${this.rules.headings.h2.min}個）`);
      results.recommendations.push({ category: 'headings', message: structure.issues[structure.issues.length - 1] });
    } else {
      results.successes.push({ category: 'headings', message: `見出し構造良好（H2×${structure.h2}）` });
    }

    if (this.rules.headings.hierarchy) {
      const hierarchyIssues = this.checkHeadingHierarchy(headings);
      if (hierarchyIssues.length > 0) {
        structure.hierarchy = false;
        structure.issues.push(...hierarchyIssues);
        hierarchyIssues.forEach(issue => {
          results.recommendations.push({ category: 'headings', message: issue });
        });
      }
    }

    results.details.headings = structure;
  }

  /**
   * Checks word count and flags sentences longer than maxSentenceLength characters.
   * Long Japanese sentences are harder to read; splitting them improves both
   * readability scores and search engine comprehension.
   *
   * @param {string} content
   * @param {Object} results
   */
  async checkContentQuality(content, results) {
    const words = this.countWords(content);
    const sentences = this.countSentences(content);
    const paragraphs = this.countParagraphs(content);

    const quality = {
      wordCount: words,
      sentenceCount: sentences,
      paragraphCount: paragraphs,
      avgWordsPerSentence: sentences > 0 ? Math.round(words / sentences) : 0,
      issues: []
    };

    if (words < this.rules.content.minWordCount) {
      quality.issues.push(`文字数が不足しています（${words}文字 < ${this.rules.content.minWordCount}文字）`);
      results.recommendations.push({ category: 'content', message: quality.issues[quality.issues.length - 1] });
    } else {
      results.successes.push({ category: 'content', message: `文字数適切（${words}文字）` });
    }

    const longSentences = this.findLongSentences(content, this.rules.content.maxSentenceLength);
    if (longSentences.length > 0) {
      quality.issues.push(`長すぎる文があります（${longSentences.length}件）`);
      results.recommendations.push({
        category: 'content',
        message: `文を短くしてください（${this.rules.content.maxSentenceLength}文字以内推奨）`
      });
    }

    results.details.content = quality;
  }

  /**
   * Extracts keywords from the title and calculates how often each appears
   * in the body content (keyword density = occurrences / total_chars × 100).
   *
   * Density too low → content may not be topically focused.
   * Density too high → may read as keyword stuffing.
   *
   * Common Japanese particles (の, は, が, etc.) are excluded from keywords
   * because they appear in almost every sentence and provide no SEO signal.
   *
   * @param {string} content
   * @param {string} title
   * @param {Object} results
   */
  async checkKeywordOptimization(content, title, results) {
    const keywords = this.extractKeywords(title);
    const optimization = {
      primaryKeywords: keywords.slice(0, 3),
      keywordDensity: {},
      issues: []
    };

    keywords.forEach(keyword => {
      const density = this.calculateKeywordDensity(content, keyword);
      optimization.keywordDensity[keyword] = density;

      if (density < this.rules.content.keywordDensity.min) {
        optimization.issues.push(`キーワード「${keyword}」の使用頻度が低いです（${density}%）`);
        results.recommendations.push({ category: 'keywords', message: optimization.issues[optimization.issues.length - 1] });
      } else if (density > this.rules.content.keywordDensity.max) {
        optimization.issues.push(`キーワード「${keyword}」の使用頻度が高すぎます（${density}%）`);
        results.recommendations.push({ category: 'keywords', message: optimization.issues[optimization.issues.length - 1] });
      } else {
        results.successes.push({ category: 'keywords', message: `キーワード「${keyword}」適切な使用頻度` });
      }
    });

    results.details.keywords = optimization;
  }

  /**
   * Checks internal/external link balance and link text quality.
   * Generic link texts ("こちら", "ここ") provide no SEO value and are flagged.
   *
   * Internal links are identified by a leading "/" or by matching the WP_DOMAIN
   * env variable (for absolute internal URLs).
   *
   * @param {string} content
   * @param {Object} results
   */
  async checkLinksAndStructure(content, results) {
    const links = this.extractLinks(content);
    const structure = {
      totalLinks: links.length,
      internalLinks: links.filter(l => l.type === 'internal').length,
      externalLinks: links.filter(l => l.type === 'external').length,
      descriptiveLinks: links.filter(l => this.isDescriptiveLink(l.text)).length,
      issues: []
    };

    if (structure.internalLinks < this.rules.links.minInternal) {
      structure.issues.push(`内部リンクを追加してください（現在${structure.internalLinks}件 < 推奨${this.rules.links.minInternal}件）`);
      results.recommendations.push({ category: 'links', message: structure.issues[structure.issues.length - 1] });
    }

    if (structure.externalLinks > this.rules.links.maxExternal) {
      structure.issues.push(`外部リンクが多すぎます（${structure.externalLinks}件 > 推奨${this.rules.links.maxExternal}件）`);
      results.recommendations.push({ category: 'links', message: structure.issues[structure.issues.length - 1] });
    }

    const nonDescriptiveLinks = structure.totalLinks - structure.descriptiveLinks;
    if (nonDescriptiveLinks > 0) {
      structure.issues.push(`リンクテキストをより具体的にしてください（${nonDescriptiveLinks}件）`);
      results.recommendations.push({ category: 'links', message: structure.issues[structure.issues.length - 1] });
    }

    if (structure.issues.length === 0) {
      results.successes.push({ category: 'links', message: 'リンク構造良好' });
    }

    results.details.links = structure;
  }

  /**
   * Computes a simplified readability score for Japanese content.
   *
   * Scoring heuristic (starts at 100):
   *  - avgSentenceLength > 50 chars: −20
   *  - avgSentenceLength > 30 chars: −10
   *  - complexSentences / totalSentences > 0.5: −15
   *  - complexSentences / totalSentences > 0.3: −8
   *
   * "Complex sentence" is approximated by counting 読点 (、) as a clause separator.
   * This is intentionally rough — a full dependency parser is not warranted here.
   *
   * Scores below 60 are flagged as recommendations (not errors).
   *
   * @param {string} content
   * @param {Object} results
   */
  async checkReadability(content, results) {
    const readability = {
      avgSentenceLength: this.calculateAverageSentenceLength(content),
      complexSentences: this.countComplexSentences(content),
      passiveVoice: this.countPassiveVoice(content),
      readabilityScore: 0,
      issues: []
    };

    readability.readabilityScore = this.calculateReadabilityScore(content);

    if (readability.readabilityScore < 60) {
      readability.issues.push('文章の読みやすさを改善してください');
      results.recommendations.push({ category: 'readability', message: readability.issues[readability.issues.length - 1] });
    } else {
      results.successes.push({ category: 'readability', message: '読みやすい文章' });
    }

    results.details.readability = readability;
  }

  // ─── Helper methods ───────────────────────────────────────────────────────

  /**
   * Extracts all headings with their level and line number.
   *
   * @param {string} content
   * @returns {Array<{level: number, text: string, line: number}>}
   */
  extractHeadings(content) {
    const headingPattern = /^(#+)\s+(.+)$/gm;
    const headings = [];
    let match;

    while ((match = headingPattern.exec(content)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: content.substring(0, match.index).split('\n').length
      });
    }

    return headings;
  }

  /**
   * Detects non-sequential heading levels (e.g. H1 → H3 without H2).
   *
   * @param {Array<{level: number}>} headings
   * @returns {string[]} Issue messages
   */
  checkHeadingHierarchy(headings) {
    const issues = [];
    let lastLevel = 0;

    for (const heading of headings) {
      if (heading.level > lastLevel + 1) {
        issues.push(`見出しレベルが飛んでいます: H${lastLevel} → H${heading.level}`);
      }
      lastLevel = heading.level;
    }

    return issues;
  }

  /**
   * Counts meaningful characters in the content (used as a proxy for "words"
   * in Japanese where spaces don't separate words).
   *
   * @param {string} content
   * @returns {number} Character count after stripping Markdown syntax
   */
  countWords(content) {
    const cleanContent = content.replace(/[#*\[\]()]/g, '').trim();
    return cleanContent.length;
  }

  /**
   * Counts sentences by looking for Japanese sentence-ending punctuation.
   *
   * @param {string} content
   * @returns {number}
   */
  countSentences(content) {
    return (content.match(/[。！？]/g) || []).length;
  }

  /** @param {string} content @returns {number} */
  countParagraphs(content) {
    return content.split(/\n\s*\n/).filter(p => p.trim()).length;
  }

  /**
   * Returns sentences that exceed maxLength characters.
   *
   * @param {string} content
   * @param {number} maxLength
   * @returns {string[]}
   */
  findLongSentences(content, maxLength) {
    const sentences = content.split(/[。！？]/).filter(s => s.trim());
    return sentences.filter(s => s.length > maxLength);
  }

  /**
   * Extracts meaningful words from the title for keyword density analysis.
   * Filters out single-character tokens and common Japanese particles/brackets
   * that carry no SEO weight.
   *
   * @param {string} title
   * @returns {string[]}
   */
  extractKeywords(title) {
    const commonWords = ['の', 'は', 'が', 'を', 'に', 'で', 'と', 'から', 'まで', '【', '】'];
    const words = title.split(/[\s、。！？]+/).filter(word =>
      word.length > 1 && !commonWords.includes(word)
    );
    return words;
  }

  /**
   * Calculates keyword density as (occurrences / total_characters) × 100.
   *
   * @param {string} content
   * @param {string} keyword
   * @returns {string} Percentage with 2 decimal places
   */
  calculateKeywordDensity(content, keyword) {
    const total = this.countWords(content);
    const occurrences = (content.match(new RegExp(keyword, 'gi')) || []).length;
    return total > 0 ? ((occurrences / total) * 100).toFixed(2) : 0;
  }

  /**
   * Extracts all Markdown links and classifies them.
   *
   * @param {string} content
   * @returns {Array<{text: string, url: string, type: string}>}
   */
  extractLinks(content) {
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    const links = [];
    let match;

    while ((match = linkPattern.exec(content)) !== null) {
      const url = match[2];
      links.push({ text: match[1], url: url, type: this.getLinkType(url) });
    }

    return links;
  }

  /**
   * Classifies a link URL as internal or external.
   * Uses WP_DOMAIN env var to identify absolute internal URLs.
   *
   * @param {string} url
   * @returns {'anchor'|'internal'|'external'|'relative'}
   */
  getLinkType(url) {
    if (url.startsWith('#')) return 'anchor';
    if (url.startsWith('/') || url.includes(process.env.WP_DOMAIN || 'your-site.com')) return 'internal';
    if (url.match(/^https?:\/\//)) return 'external';
    return 'relative';
  }

  /**
   * Returns false for generic link texts that provide no SEO or UX value.
   *
   * @param {string} text - Link anchor text
   * @returns {boolean}
   */
  isDescriptiveLink(text) {
    const nonDescriptive = ['こちら', 'ここ', 'click here', 'read more', 'リンク'];
    return !nonDescriptive.some(word => text.toLowerCase().includes(word.toLowerCase()));
  }

  /**
   * Returns true for titles that contain explicit subject/action words or
   * are long enough to be inherently specific (> 20 chars).
   *
   * @param {string} title
   * @returns {boolean}
   */
  isDescriptiveTitle(title) {
    const descriptiveWords = ['方法', '手順', '解説', '紹介', '実装', '構築', '開発', '作成'];
    return descriptiveWords.some(word => title.includes(word)) || title.length > 20;
  }

  /** @param {string} content @returns {number} */
  calculateAverageSentenceLength(content) {
    const sentences = this.countSentences(content);
    const words = this.countWords(content);
    return sentences > 0 ? Math.round(words / sentences) : 0;
  }

  /**
   * Approximates complex sentence count by counting 読点 (、).
   * Each 、 is assumed to introduce a subordinate clause.
   *
   * @param {string} content
   * @returns {number}
   */
  countComplexSentences(content) {
    return (content.match(/[、]/g) || []).length;
  }

  /**
   * Counts passive-voice patterns in Japanese (られる, される, れる).
   * High passive-voice usage correlates with harder-to-read text.
   *
   * @param {string} content
   * @returns {number}
   */
  countPassiveVoice(content) {
    return (content.match(/(られる|される|れる)/g) || []).length;
  }

  /**
   * Computes a simplified readability score for Japanese content (0–100).
   * See checkReadability() for the penalty schedule.
   *
   * @param {string} content
   * @returns {number}
   */
  calculateReadabilityScore(content) {
    const avgSentenceLength = this.calculateAverageSentenceLength(content);
    const complexSentences = this.countComplexSentences(content);
    const totalSentences = this.countSentences(content);

    let score = 100;

    if (avgSentenceLength > 50) score -= 20;
    else if (avgSentenceLength > 30) score -= 10;

    const complexRatio = totalSentences > 0 ? (complexSentences / totalSentences) : 0;
    if (complexRatio > 0.5) score -= 15;
    else if (complexRatio > 0.3) score -= 8;

    return Math.max(0, score);
  }

  /**
   * Aggregates the SEO sub-scores into a single 0–100 score.
   *
   * Formula: (successes × 8) − (errors × 15) − (recommendations × 5)
   *
   * @param {Object} results
   * @returns {number}
   */
  calculateSEOScore(results) {
    let score = 0;

    score += results.successes.length * 8;
    score -= results.issues.filter(i => i.severity === 'error').length * 15;
    score -= results.recommendations.length * 5;

    return Math.max(0, Math.min(100, score));
  }
}

module.exports = SEOChecker;
