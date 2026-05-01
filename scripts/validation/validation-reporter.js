const fs = require('fs').promises;
const path = require('path');

class ValidationReporter {
  constructor() {
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m'
    };
  }

  generateConsoleReport(result) {
    const { colors } = this;
    let report = '';

    // Header
    report += `\n${colors.cyan}${colors.bright}📋 投稿前検証レポート: ${result.filename}${colors.reset}\n`;
    report += `${'='.repeat(48 + result.filename.length)}\n`;

    // Overall score
    const scoreColor = this.getScoreColor(result.score);
    report += `${scoreColor}📊 総合評価: ${result.score}/100点${colors.reset}`;
    
    if (result.score >= 90) {
      report += ` ${colors.green}(公開推奨)${colors.reset}\n`;
    } else if (result.score >= 70) {
      report += ` ${colors.yellow}(要修正)${colors.reset}\n`;
    } else {
      report += ` ${colors.red}(要大幅修正)${colors.reset}\n`;
    }

    report += '\n';

    // Errors
    if (result.errors.length > 0) {
      report += `${colors.red}❌ エラー (${result.errors.length}件)${colors.reset}\n`;
      result.errors.forEach((error, index) => {
        report += `  ${index + 1}. ${error.message}\n`;
      });
      report += '\n';
    }

    // Warnings  
    if (result.warnings.length > 0) {
      report += `${colors.yellow}⚠️  警告 (${result.warnings.length}件)${colors.reset}\n`;
      result.warnings.forEach((warning, index) => {
        report += `  ${index + 1}. ${warning.message}\n`;
      });
      report += '\n';
    }

    // Successes
    if (result.successes && result.successes.length > 0) {
      report += `${colors.green}✅ 検証OK (${result.successes.length}件)${colors.reset}\n`;
      result.successes.forEach((success, index) => {
        report += `  ${index + 1}. ${success.message}\n`;
      });
      report += '\n';
    }

    // Section details
    report += this.generateSectionDetails(result);

    // Recommendations
    report += this.generateRecommendations(result);

    // Footer
    report += `\n${'='.repeat(48 + result.filename.length)}\n`;
    report += `${colors.cyan}検証完了時刻: ${new Date(result.timestamp).toLocaleString('ja-JP')}${colors.reset}\n`;

    return report;
  }

  generateSectionDetails(result) {
    const { colors } = this;
    let details = `${colors.bright}📝 詳細結果${colors.reset}\n`;

    // Title section
    if (result.sections.title) {
      const title = result.sections.title;
      details += `${colors.blue}📌 タイトル${colors.reset}\n`;
      details += `  文字数: ${title.length}文字\n`;
      details += `  内容: "${title.content.substring(0, 40)}..."\n\n`;
    }

    // Markdown section
    if (result.sections.markdown) {
      const md = result.sections.markdown;
      details += `${colors.blue}📝 Markdown構造${colors.reset}\n`;
      details += `  見出し: H1×${md.headings.h1}, H2×${md.headings.h2}, H3×${md.headings.h3}\n`;
      details += `  リンク: ${md.links}件\n`;
      details += `  画像: ${md.images}件\n\n`;
    }

    // Content section
    if (result.sections.content) {
      const content = result.sections.content;
      details += `${colors.blue}📄 コンテンツ${colors.reset}\n`;
      details += `  文字数: ${content.wordCount}文字\n`;
      details += `  文体: ${content.politeForm ? 'です・ます調' : 'である調/混在'}\n\n`;
    }

    return details;
  }

  generateRecommendations(result) {
    const { colors } = this;
    let recommendations = '';

    if (result.errors.length > 0 || result.warnings.length > 0) {
      recommendations += `${colors.bright}🔧 推奨アクション${colors.reset}\n`;

      if (result.errors.length > 0) {
        recommendations += `${colors.red}🔴 優先修正項目:${colors.reset}\n`;
        result.errors.slice(0, 3).forEach((error, index) => {
          recommendations += `  ${index + 1}. ${error.message}\n`;
        });
        recommendations += '\n';
      }

      if (result.warnings.length > 0) {
        recommendations += `${colors.yellow}🟡 改善提案:${colors.reset}\n`;
        result.warnings.slice(0, 3).forEach((warning, index) => {
          recommendations += `  ${index + 1}. ${warning.message}\n`;
        });
        recommendations += '\n';
      }

      // Add quick fix suggestions
      recommendations += this.generateQuickFixes(result);

      recommendations += `${colors.cyan}✏️  修正後、再度検証してください:${colors.reset}\n`;
      recommendations += `npm run validate-draft ${result.filename}\n\n`;
    } else {
      recommendations += `${colors.green}🎉 素晴らしい！すべての検証をクリアしました。${colors.reset}\n`;
      recommendations += `${colors.cyan}WordPressへの投稿準備完了:${colors.reset}\n`;
      recommendations += `npm run create-post\n\n`;
    }

    return recommendations;
  }

  generateQuickFixes(result) {
    const { colors } = this;
    let quickFixes = '';

    // Check for common fixable issues
    const hasStructureIssues = result.warnings.some(w => w.category === 'structure');
    const hasSEOIssues = result.warnings.some(w => w.category === 'seo');
    const hasImageIssues = result.warnings.some(w => w.category === 'images');
    const hasLinkIssues = result.errors.some(e => e.category === 'links');

    if (hasStructureIssues || hasSEOIssues || hasImageIssues || hasLinkIssues) {
      quickFixes += `${colors.cyan}💡 クイック修正ガイド:${colors.reset}\n`;

      if (hasStructureIssues) {
        quickFixes += `  📝 構造改善: H2見出しを追加、導入文を拡充\n`;
      }
      
      if (hasSEOIssues) {
        quickFixes += `  🔍 SEO改善: キーワード追加、見出し階層を整理\n`;
      }
      
      if (hasImageIssues) {
        quickFixes += `  🖼️  画像改善: Alt属性追加、適切な画像を挿入\n`;
      }
      
      if (hasLinkIssues) {
        quickFixes += `  🔗 リンク修正: URLを確認、リンク切れを修正\n`;
      }

      quickFixes += '\n';
    }

    return quickFixes;
  }

  getScoreColor(score) {
    const { colors } = this;
    if (score >= 90) return colors.green;
    if (score >= 70) return colors.yellow;
    return colors.red;
  }

  async saveReport(result, reportPath) {
    try {
      const jsonReport = {
        ...result,
        generatedAt: new Date().toISOString(),
        reportVersion: '1.0.0'
      };

      await fs.writeFile(reportPath, JSON.stringify(jsonReport, null, 2));
      console.log(`📄 検証レポートを保存しました: ${reportPath}`);
    } catch (error) {
      console.error(`❌ レポート保存エラー: ${error.message}`);
    }
  }

  async generateSummaryReport(results) {
    const { colors } = this;
    let summary = `\n${colors.cyan}${colors.bright}📊 検証サマリーレポート${colors.reset}\n`;
    summary += `${'='.repeat(40)}\n`;

    const totalFiles = results.length;
    const passedFiles = results.filter(r => r.errors.length === 0).length;
    const averageScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / totalFiles);

    summary += `📁 検証ファイル数: ${totalFiles}件\n`;
    summary += `✅ エラーなし: ${passedFiles}件\n`;
    summary += `📊 平均スコア: ${averageScore}点\n\n`;

    // Top issues
    const allErrors = results.flatMap(r => r.errors);
    const allWarnings = results.flatMap(r => r.warnings);
    
    if (allErrors.length > 0) {
      summary += `${colors.red}🔴 主なエラー:${colors.reset}\n`;
      const errorCounts = this.countIssues(allErrors);
      Object.entries(errorCounts).slice(0, 3).forEach(([msg, count]) => {
        summary += `  • ${msg} (${count}件)\n`;
      });
      summary += '\n';
    }

    if (allWarnings.length > 0) {
      summary += `${colors.yellow}🟡 主な警告:${colors.reset}\n`;
      const warningCounts = this.countIssues(allWarnings);
      Object.entries(warningCounts).slice(0, 3).forEach(([msg, count]) => {
        summary += `  • ${msg} (${count}件)\n`;
      });
      summary += '\n';
    }

    return summary;
  }

  countIssues(issues) {
    return issues.reduce((counts, issue) => {
      const msg = issue.message;
      counts[msg] = (counts[msg] || 0) + 1;
      return counts;
    }, {});
  }
}

module.exports = ValidationReporter;