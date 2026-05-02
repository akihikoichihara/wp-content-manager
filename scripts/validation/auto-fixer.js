/**
 * auto-fixer.js
 *
 * Analyses validation results and generates actionable fix suggestions.
 * Fixes fall into two types:
 *
 *  'auto'   - Can be applied programmatically without human review
 *             (whitespace normalization, duplicate punctuation removal)
 *  'manual' - Require human judgment (title rewording, broken link repair,
 *             image alt-text authoring)
 *
 * applyAutoFixes() applies only 'auto' fixes to the content string and returns
 * the modified content along with a list of what was changed.
 * 'manual' fixes are surfaced as suggestions in generateFixReport().
 */

const fs = require('fs').promises;

class AutoFixer {
  constructor() {
    this.fixes = {
      applied: [],
      suggestions: []
    };
  }

  /**
   * Walks the validation result's errors and warnings arrays and generates
   * a fix object for each issue that has a known remediation strategy.
   *
   * @param {string} content            - Original Markdown content
   * @param {Object} validationResult   - Result object from MarkdownValidator
   * @returns {Promise<{autoFixes: Object[], manualFixes: Object[], suggestions: Object[]}>}
   */
  async analyzeAndSuggestFixes(content, validationResult) {
    const fixes = {
      autoFixes: [],
      manualFixes: [],
      suggestions: []
    };

    for (const error of validationResult.errors) {
      const fix = this.generateFix(error, content);
      if (fix) {
        if (fix.type === 'auto') {
          fixes.autoFixes.push(fix);
        } else {
          fixes.manualFixes.push(fix);
        }
      }
    }

    for (const warning of validationResult.warnings) {
      const suggestion = this.generateSuggestion(warning, content);
      if (suggestion) {
        fixes.suggestions.push(suggestion);
      }
    }

    return fixes;
  }

  /**
   * Maps a single validation error to a fix descriptor. Returns null when no
   * known fix strategy exists for the error type.
   *
   * Fix type is 'manual' for all content-level issues (title wording, link URLs,
   * image alt text) because those require editorial judgment that cannot be
   * automated safely.
   *
   * @param {Object} error   - Error object with { category, message }
   * @param {string} content - Current content (may be used for context in future)
   * @returns {Object|null}  Fix descriptor or null
   */
  generateFix(error, content) {
    const category = error.category;
    const message = error.message;

    if (category === 'title') {
      if (message.includes('統一フォーマット')) {
        return {
          type: 'manual',
          category: 'title',
          issue: message,
          suggestion: 'タイトルを【お知らせ】、【リリース】、【開設】のいずれかで始めてください',
          example: '例: # 【お知らせ】新機能リリースのお知らせ'
        };
      }

      if (message.includes('長すぎます')) {
        return {
          type: 'manual',
          category: 'title',
          issue: message,
          suggestion: 'タイトルを60文字以内に短縮してください',
          tips: [
            '不要な修飾語を削除',
            '「について」「に関して」などの表現を削減',
            '具体的で簡潔な表現に変更'
          ]
        };
      }
    }

    if (category === 'links') {
      if (message.includes('リンク切れ')) {
        const url = this.extractUrlFromMessage(message);
        return {
          type: 'manual',
          category: 'links',
          issue: message,
          suggestion: `リンクを確認して修正してください: ${url}`,
          actions: [
            'URLが正しいか確認',
            'リンク先が存在するか確認',
            'HTTPSに変更可能か確認'
          ]
        };
      }
    }

    if (category === 'images') {
      if (message.includes('Alt属性')) {
        return {
          type: 'manual',
          category: 'images',
          issue: message,
          suggestion: '画像に意味のあるAlt属性を追加してください',
          examples: [
            '❌ alt=""',
            '❌ alt="画像"',
            '✅ alt="WordPress管理画面のスクリーンショット"'
          ]
        };
      }
    }

    return null;
  }

  /**
   * Maps a single validation warning to an improvement suggestion.
   * Suggestions are lower-priority than fixes; they improve quality but
   * do not block publication.
   *
   * @param {Object} warning  - Warning object with { category, message }
   * @param {string} content
   * @returns {Object|null}
   */
  generateSuggestion(warning, content) {
    const category = warning.category;
    const message = warning.message;

    if (category === 'structure' && message.includes('導入文')) {
      return {
        type: 'content',
        priority: 'medium',
        issue: message,
        suggestion: '導入文を50文字以上に拡充してください',
        template: `
例:
ITクオリティ株式会社では、[具体的な内容]について[背景・理由]により、
以下の通りお知らせいたします。
        `.trim()
      };
    }

    if (category === 'seo' && message.includes('H2見出し')) {
      return {
        type: 'structure',
        priority: 'medium',
        issue: message,
        suggestion: 'H2見出しを追加してコンテンツを構造化してください',
        examples: [
          '## 概要',
          '## 主な特徴',
          '## 利用方法',
          '## 今後の予定'
        ]
      };
    }

    if (category === 'content' && message.includes('文を短く')) {
      return {
        type: 'readability',
        priority: 'low',
        issue: message,
        suggestion: '長い文を複数の短い文に分割してください',
        tips: [
          '一文一意を心がける',
          '接続詞で文を分割',
          '箇条書きの活用'
        ]
      };
    }

    if (category === 'images' && message.includes('画像を追加')) {
      return {
        type: 'enhancement',
        priority: 'low',
        issue: message,
        suggestion: '適切な画像を追加してコンテンツを豊かにしてください',
        recommendations: [
          'スクリーンショット',
          '図解・チャート',
          'ロゴやアイコン',
          '実装例の画像'
        ]
      };
    }

    return null;
  }

  /**
   * Applies all 'auto' type fixes to the content string sequentially.
   * Skips a fix silently if it throws (rather than aborting the whole run),
   * so a buggy fix implementation does not prevent valid fixes from applying.
   *
   * @param {string} content                    - Original content
   * @param {{autoFixes: Object[]}} fixes       - From analyzeAndSuggestFixes()
   * @returns {Promise<{content: string, appliedFixes: Object[], totalFixes: number}>}
   */
  async applyAutoFixes(content, fixes) {
    let fixedContent = content;
    const appliedFixes = [];

    for (const fix of fixes.autoFixes) {
      try {
        const result = await this.applyFix(fixedContent, fix);
        if (result.success) {
          fixedContent = result.content;
          appliedFixes.push(fix);
        }
      } catch (error) {
        console.warn(`自動修正失敗: ${fix.issue} - ${error.message}`);
      }
    }

    return {
      content: fixedContent,
      appliedFixes,
      totalFixes: appliedFixes.length
    };
  }

  /**
   * Dispatches a single auto-fix by type.
   * Returns { success: false } for unimplemented types so callers can
   * distinguish "attempted but failed" from "not supported".
   *
   * @param {string} content
   * @param {Object} fix - Fix descriptor with a `type` field
   * @returns {Promise<{success: boolean, content: string, reason?: string}>}
   */
  async applyFix(content, fix) {
    switch (fix.type) {
      case 'whitespace':
        return { success: true, content: this.fixWhitespace(content) };

      case 'punctuation':
        return { success: true, content: this.fixPunctuation(content) };

      default:
        return {
          success: false,
          content: content,
          reason: 'Auto-fix not implemented for this type'
        };
    }
  }

  /**
   * Normalizes whitespace in Markdown content:
   *  - Collapses 3+ consecutive blank lines to 2 (Markdown standard)
   *  - Removes trailing whitespace on each line
   *  - Removes leading whitespace (preserves intentional code indentation
   *    only if the caller excludes code blocks before calling this)
   *
   * @param {string} content
   * @returns {string}
   */
  fixWhitespace(content) {
    return content
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/^[ \t]+/gm, '')
      .trim();
  }

  /**
   * Fixes common Japanese punctuation issues:
   *  - Duplicate 。or 、 (e.g. "です。。" → "です。")
   *  - Space before Japanese sentence-ending punctuation
   *  - Ensures a newline follows sentence-ending characters (。！？)
   *    for cleaner paragraph splitting in downstream processors
   *
   * @param {string} content
   * @returns {string}
   */
  fixPunctuation(content) {
    return content
      .replace(/。\s*。/g, '。')
      .replace(/、\s*、/g, '、')
      .replace(/\s+([。、！？])/g, '$1')
      .replace(/([。！？])\s*\n/g, '$1\n');
  }

  /**
   * Extracts the first HTTP/HTTPS URL from a validation message string.
   *
   * @param {string} message
   * @returns {string} URL string, or empty string if none found
   */
  extractUrlFromMessage(message) {
    const urlMatch = message.match(/https?:\/\/[^\s)]+/);
    return urlMatch ? urlMatch[0] : '';
  }

  /**
   * Builds a human-readable fix report string for console output.
   *
   * @param {Object} fixes       - From analyzeAndSuggestFixes()
   * @param {Object[]} appliedFixes - From applyAutoFixes()
   * @returns {string}
   */
  generateFixReport(fixes, appliedFixes) {
    let report = '\n🔧 修正提案レポート\n';
    report += '========================\n\n';

    if (appliedFixes.length > 0) {
      report += `✅ 自動修正完了: ${appliedFixes.length}件\n`;
      appliedFixes.forEach((fix, index) => {
        report += `  ${index + 1}. ${fix.issue}\n`;
      });
      report += '\n';
    }

    if (fixes.manualFixes.length > 0) {
      report += `🔧 手動修正が必要: ${fixes.manualFixes.length}件\n`;
      fixes.manualFixes.forEach((fix, index) => {
        report += `  ${index + 1}. ${fix.issue}\n`;
        report += `     💡 ${fix.suggestion}\n`;
        if (fix.example) {
          report += `     📝 ${fix.example}\n`;
        }
      });
      report += '\n';
    }

    if (fixes.suggestions.length > 0) {
      report += `💡 改善提案: ${fixes.suggestions.length}件\n`;
      fixes.suggestions.forEach((suggestion, index) => {
        report += `  ${index + 1}. ${suggestion.suggestion}\n`;
        if (suggestion.examples) {
          suggestion.examples.forEach(example => {
            report += `     ${example}\n`;
          });
        }
      });
      report += '\n';
    }

    return report;
  }

  /**
   * Generates suggested npm commands for the most common fix categories.
   * Link and SEO commands are placeholders for features not yet implemented.
   *
   * @param {Object} fixes - From analyzeAndSuggestFixes()
   * @returns {string[]} Array of command strings
   */
  generateQuickFixCommands(fixes) {
    const commands = [];

    if (fixes.manualFixes.some(f => f.category === 'title')) {
      commands.push('# タイトル修正後、再検証');
      commands.push('npm run validate-draft <filename>');
    }

    if (fixes.manualFixes.some(f => f.category === 'links')) {
      commands.push('# リンク修正後、リンクのみ再検証');
      commands.push('# (将来実装予定: npm run validate-links <filename>)');
    }

    if (fixes.suggestions.some(s => s.type === 'structure')) {
      commands.push('# 構造改善後、SEOチェック');
      commands.push('# (将来実装予定: npm run validate-seo <filename>)');
    }

    return commands;
  }
}

module.exports = AutoFixer;
