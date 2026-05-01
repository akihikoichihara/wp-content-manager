class SEOChecker {
  constructor(rules = {}) {
    this.rules = {
      title: {
        minLength: 10,
        maxLength: 60,
        keywordDensity: 3
      },
      headings: {
        h1: { max: 1, required: true },
        h2: { min: 1, recommended: true },
        hierarchy: true
      },
      content: {
        minWordCount: 200,
        maxSentenceLength: 100,
        keywordDensity: { min: 1, max: 3 }
      },
      links: {
        minInternal: 1,
        maxExternal: 10,
        descriptiveText: true
      },
      ...rules
    };
  }

  async checkSEO(content, title = null) {
    const results = {
      score: 0,
      maxScore: 100,
      issues: [],
      recommendations: [],
      successes: [],
      details: {}
    };

    // Extract title from content if not provided
    if (!title) {
      const titleMatch = content.match(/^#\s+(.+)$/m);
      title = titleMatch ? titleMatch[1].trim() : '';
    }

    // Run SEO checks
    await this.checkTitle(title, results);
    await this.checkHeadingStructure(content, results);
    await this.checkContentQuality(content, results);
    await this.checkKeywordOptimization(content, title, results);
    await this.checkLinksAndStructure(content, results);
    await this.checkReadability(content, results);

    // Calculate final score
    results.score = this.calculateSEOScore(results);

    return results;
  }

  async checkTitle(title, results) {
    const titleSection = {
      title,
      length: title.length,
      issues: [],
      score: 0
    };

    // Length check
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

    // Descriptive check
    if (this.isDescriptiveTitle(title)) {
      titleSection.score += 20;
      results.successes.push({ category: 'title', message: '具体的で分かりやすいタイトル' });
    } else {
      titleSection.issues.push('より具体的で分かりやすいタイトルにしてください');
      results.recommendations.push({ category: 'title', message: titleSection.issues[titleSection.issues.length - 1] });
    }

    results.details.title = titleSection;
  }

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

    // H1 check
    if (structure.h1 === 0) {
      structure.issues.push('H1見出しが必要です');
      results.issues.push({ category: 'headings', severity: 'error', message: 'H1見出しが必要です' });
    } else if (structure.h1 > 1) {
      structure.issues.push('H1見出しは1つまでにしてください');
      results.recommendations.push({ category: 'headings', message: 'H1見出しは1つまでにしてください' });
    } else {
      results.successes.push({ category: 'headings', message: 'H1見出し適切' });
    }

    // H2 check
    if (structure.h2 < this.rules.headings.h2.min) {
      structure.issues.push(`H2見出しを追加してください（現在${structure.h2}個 < 推奨${this.rules.headings.h2.min}個）`);
      results.recommendations.push({ category: 'headings', message: structure.issues[structure.issues.length - 1] });
    } else {
      results.successes.push({ category: 'headings', message: `見出し構造良好（H2×${structure.h2}）` });
    }

    // Hierarchy check
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

    // Word count check
    if (words < this.rules.content.minWordCount) {
      quality.issues.push(`文字数が不足しています（${words}文字 < ${this.rules.content.minWordCount}文字）`);
      results.recommendations.push({ category: 'content', message: quality.issues[quality.issues.length - 1] });
    } else {
      results.successes.push({ category: 'content', message: `文字数適切（${words}文字）` });
    }

    // Sentence length check
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

  async checkKeywordOptimization(content, title, results) {
    const keywords = this.extractKeywords(title);
    const optimization = {
      primaryKeywords: keywords.slice(0, 3),
      keywordDensity: {},
      issues: []
    };

    // Calculate keyword density
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

  async checkLinksAndStructure(content, results) {
    const links = this.extractLinks(content);
    const structure = {
      totalLinks: links.length,
      internalLinks: links.filter(l => l.type === 'internal').length,
      externalLinks: links.filter(l => l.type === 'external').length,
      descriptiveLinks: links.filter(l => this.isDescriptiveLink(l.text)).length,
      issues: []
    };

    // Internal links check
    if (structure.internalLinks < this.rules.links.minInternal) {
      structure.issues.push(`内部リンクを追加してください（現在${structure.internalLinks}件 < 推奨${this.rules.links.minInternal}件）`);
      results.recommendations.push({ category: 'links', message: structure.issues[structure.issues.length - 1] });
    }

    // External links check
    if (structure.externalLinks > this.rules.links.maxExternal) {
      structure.issues.push(`外部リンクが多すぎます（${structure.externalLinks}件 > 推奨${this.rules.links.maxExternal}件）`);
      results.recommendations.push({ category: 'links', message: structure.issues[structure.issues.length - 1] });
    }

    // Descriptive link text check
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

  async checkReadability(content, results) {
    const readability = {
      avgSentenceLength: this.calculateAverageSentenceLength(content),
      complexSentences: this.countComplexSentences(content),
      passiveVoice: this.countPassiveVoice(content),
      readabilityScore: 0,
      issues: []
    };

    // Calculate readability score (simplified)
    readability.readabilityScore = this.calculateReadabilityScore(content);

    if (readability.readabilityScore < 60) {
      readability.issues.push('文章の読みやすさを改善してください');
      results.recommendations.push({ category: 'readability', message: readability.issues[readability.issues.length - 1] });
    } else {
      results.successes.push({ category: 'readability', message: '読みやすい文章' });
    }

    results.details.readability = readability;
  }

  // Helper methods
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

  countWords(content) {
    // Remove markdown syntax and count characters (for Japanese)
    const cleanContent = content.replace(/[#*\[\]()]/g, '').trim();
    return cleanContent.length;
  }

  countSentences(content) {
    return (content.match(/[。！？]/g) || []).length;
  }

  countParagraphs(content) {
    return content.split(/\n\s*\n/).filter(p => p.trim()).length;
  }

  findLongSentences(content, maxLength) {
    const sentences = content.split(/[。！？]/).filter(s => s.trim());
    return sentences.filter(s => s.length > maxLength);
  }

  extractKeywords(title) {
    // Simple keyword extraction (remove common words)
    const commonWords = ['の', 'は', 'が', 'を', 'に', 'で', 'と', 'から', 'まで', '【', '】'];
    const words = title.split(/[\s、。！？]+/).filter(word => 
      word.length > 1 && !commonWords.includes(word)
    );
    return words;
  }

  calculateKeywordDensity(content, keyword) {
    const total = this.countWords(content);
    const occurrences = (content.match(new RegExp(keyword, 'gi')) || []).length;
    return total > 0 ? ((occurrences / total) * 100).toFixed(2) : 0;
  }

  extractLinks(content) {
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    const links = [];
    let match;

    while ((match = linkPattern.exec(content)) !== null) {
      const url = match[2];
      links.push({
        text: match[1],
        url: url,
        type: this.getLinkType(url)
      });
    }

    return links;
  }

  getLinkType(url) {
    if (url.startsWith('#')) return 'anchor';
    if (url.startsWith('/') || url.includes(process.env.WP_DOMAIN || 'your-site.com')) return 'internal';
    if (url.match(/^https?:\/\//)) return 'external';
    return 'relative';
  }

  isDescriptiveLink(text) {
    const nonDescriptive = ['こちら', 'ここ', 'click here', 'read more', 'リンク'];
    return !nonDescriptive.some(word => text.toLowerCase().includes(word.toLowerCase()));
  }

  isDescriptiveTitle(title) {
    // Check if title contains specific, descriptive words
    const descriptiveWords = ['方法', '手順', '解説', '紹介', '実装', '構築', '開発', '作成'];
    return descriptiveWords.some(word => title.includes(word)) || title.length > 20;
  }

  calculateAverageSentenceLength(content) {
    const sentences = this.countSentences(content);
    const words = this.countWords(content);
    return sentences > 0 ? Math.round(words / sentences) : 0;
  }

  countComplexSentences(content) {
    // Count sentences with multiple clauses (simplified)
    return (content.match(/[、]/g) || []).length;
  }

  countPassiveVoice(content) {
    // Japanese passive voice patterns (simplified)
    return (content.match(/(られる|される|れる)/g) || []).length;
  }

  calculateReadabilityScore(content) {
    // Simplified readability score for Japanese content
    const avgSentenceLength = this.calculateAverageSentenceLength(content);
    const complexSentences = this.countComplexSentences(content);
    const totalSentences = this.countSentences(content);
    
    let score = 100;
    
    // Penalize long sentences
    if (avgSentenceLength > 50) score -= 20;
    else if (avgSentenceLength > 30) score -= 10;
    
    // Penalize complex sentences
    const complexRatio = totalSentences > 0 ? (complexSentences / totalSentences) : 0;
    if (complexRatio > 0.5) score -= 15;
    else if (complexRatio > 0.3) score -= 8;
    
    return Math.max(0, score);
  }

  calculateSEOScore(results) {
    let score = 0;
    const maxScore = 100;
    
    // Base score from successes
    score += results.successes.length * 8;
    
    // Penalties for issues
    score -= results.issues.filter(i => i.severity === 'error').length * 15;
    score -= results.recommendations.length * 5;
    
    return Math.max(0, Math.min(maxScore, score));
  }
}

module.exports = SEOChecker;