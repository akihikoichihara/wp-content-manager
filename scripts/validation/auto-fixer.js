const fs = require('fs').promises;

class AutoFixer {
  constructor() {
    this.fixes = {
      applied: [],
      suggestions: []
    };
  }

  async analyzeAndSuggestFixes(content, validationResult) {
    const fixes = {
      autoFixes: [],
      manualFixes: [],
      suggestions: []
    };

    // Analyze validation issues and generate fixes
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

  generateFix(error, content) {
    const category = error.category;
    const message = error.message;

    // Title fixes
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

    // Link fixes
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

    // Image fixes
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

  async applyFix(content, fix) {
    // This is a placeholder for auto-fix implementation
    // In a real implementation, you'd have specific fix logic for each type
    
    switch (fix.type) {
      case 'whitespace':
        return {
          success: true,
          content: this.fixWhitespace(content)
        };
      
      case 'punctuation':
        return {
          success: true,
          content: this.fixPunctuation(content)
        };
      
      default:
        return {
          success: false,
          content: content,
          reason: 'Auto-fix not implemented for this type'
        };
    }
  }

  fixWhitespace(content) {
    // Fix common whitespace issues
    return content
      .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
      .replace(/[ \t]+$/gm, '')    // Remove trailing whitespace
      .replace(/^[ \t]+/gm, '')    // Remove leading whitespace (except intended indentation)
      .trim();
  }

  fixPunctuation(content) {
    // Fix common punctuation issues in Japanese
    return content
      .replace(/。\s*。/g, '。')    // Remove duplicate periods
      .replace(/、\s*、/g, '、')    // Remove duplicate commas
      .replace(/\s+([。、！？])/g, '$1')  // Remove space before punctuation
      .replace(/([。！？])\s*\n/g, '$1\n'); // Ensure newline after sentence end
  }

  extractUrlFromMessage(message) {
    const urlMatch = message.match(/https?:\/\/[^\s)]+/);
    return urlMatch ? urlMatch[0] : '';
  }

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

  generateQuickFixCommands(fixes) {
    const commands = [];
    
    // Generate npm script suggestions for common fixes
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