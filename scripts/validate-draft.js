#!/usr/bin/env node
/**
 * validate-draft.js
 *
 * CLI entry point for the pre-publish validation pipeline. Accepts a single
 * filename or the special keyword "all" to validate every *.md file in drafts/.
 *
 * Each validation run:
 *  1. Runs MarkdownValidator (title format, structure, SEO, links, images)
 *  2. Prints a coloured console report via ValidationReporter
 *  3. Saves a full JSON report to logs/validation-reports/
 *
 * Exit codes:
 *  0 - No errors (warnings are OK)
 *  1 - One or more errors detected (or unexpected exception)
 *
 * Usage:
 *   npm run validate-draft <filename>
 *   npm run validate-draft all
 *   node scripts/validate-draft.js /absolute/path/to/file.md
 */

const path = require('path');
const fs = require('fs').promises;
const MarkdownValidator = require('./validation/markdown-validator');
const ValidationReporter = require('./validation/validation-reporter');

class DraftValidator {
  constructor() {
    this.validator = new MarkdownValidator();
    this.reporter = new ValidationReporter();
    this.draftsDir = path.join(__dirname, '../drafts');
    this.reportsDir = path.join(__dirname, '../logs/validation-reports');
  }

  /** Creates the reports directory on first run if it does not exist yet. */
  async ensureDirectories() {
    try {
      await fs.mkdir(this.reportsDir, { recursive: true });
    } catch (error) {
      // Directory already exists — safe to ignore
    }
  }

  /**
   * Validates a single draft file and saves the JSON report.
   *
   * Accepts both an absolute path and a bare filename (resolved relative to
   * drafts/ so callers can omit the directory prefix).
   *
   * @param {string} filename - Absolute path or filename relative to drafts/
   * @returns {Promise<Object>} Validation result object
   */
  async validateDraft(filename) {
    const filePath = path.isAbsolute(filename) ? filename : path.join(this.draftsDir, filename);

    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`ファイルが見つかりません: ${filePath}`);
    }

    console.log(`🔍 検証開始: ${path.basename(filePath)}`);
    console.log(`ファイルパス: ${filePath}\n`);

    try {
      const result = await this.validator.validateFile(filePath);

      const consoleReport = this.reporter.generateConsoleReport(result);
      console.log(consoleReport);

      // Timestamp in the filename prevents overwriting previous reports for the
      // same draft, which is useful when comparing before/after fix iterations.
      await this.ensureDirectories();
      const reportFilename = `${path.basename(filePath, '.md')}-validation-${Date.now()}.json`;
      const reportPath = path.join(this.reportsDir, reportFilename);
      await this.reporter.saveReport(result, reportPath);

      return result;
    } catch (error) {
      console.error(`❌ 検証エラー: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validates all *.md files in drafts/ that match the given glob pattern.
   * Reports a one-line summary per file so the output stays readable at scale.
   *
   * @param {string} [pattern='*.md'] - Glob pattern relative to drafts/
   * @returns {Promise<Array<Object>>} Array of validation results
   */
  async validateMultiple(pattern = '*.md') {
    const glob = require('glob');
    const files = glob.sync(path.join(this.draftsDir, pattern));

    if (files.length === 0) {
      console.log(`❌ 検証対象ファイルが見つかりません: ${pattern}`);
      return [];
    }

    console.log(`🔍 一括検証開始: ${files.length}件のファイル\n`);

    const results = [];
    for (const file of files) {
      try {
        console.log(`\n📝 検証中: ${path.basename(file)}`);
        const result = await this.validator.validateFile(file);
        results.push(result);

        // Concise per-file summary for batch output
        const status = result.errors.length === 0 ? '✅' : '❌';
        const score = result.score;
        console.log(`${status} ${path.basename(file)}: ${score}点`);
      } catch (error) {
        console.error(`❌ ${path.basename(file)}: ${error.message}`);
      }
    }

    if (results.length > 0) {
      const summaryReport = await this.reporter.generateSummaryReport(results);
      console.log(summaryReport);
    }

    return results;
  }

  /** Prints usage information to stdout. */
  displayUsage() {
    console.log(`
📋 投稿前検証ツール - 使用方法

基本的な使用方法:
  npm run validate-draft <ファイル名>
  node scripts/validate-draft.js <ファイル名>

使用例:
  npm run validate-draft note-article-example.md
  npm run validate-draft /path/to/article.md
  node scripts/validate-draft.js all              # 全ファイル検証

オプション:
  --help, -h     このヘルプを表示
  --all          draftsディレクトリ内の全.mdファイルを検証
  --verbose      詳細な出力モード
  --rules        使用する検証ルールファイルのパス

検証項目:
  ✅ タイトル形式（統一フォーマット準拠）
  ✅ Markdown構文
  ✅ 文章構造（導入文、本文、会社情報等）
  ✅ コンテンツ品質（文字数、文体統一等）
  ✅ フォーマット準拠

出力:
  • コンソール: 詳細な検証レポート
  • ファイル: logs/validation-reports/ に JSON レポート保存

次のステップ:
  • 問題なし → npm run create-post でWordPress投稿
  • 要修正 → Markdownファイルを修正後、再検証
`);
  }
}

// CLI execution
if (require.main === module) {
  const validator = new DraftValidator();
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    validator.displayUsage();
    process.exit(0);
  }

  const filename = args[0];

  if (filename === 'all' || args.includes('--all')) {
    validator.validateMultiple()
      .then(results => {
        const hasErrors = results.some(r => r.errors.length > 0);
        process.exit(hasErrors ? 1 : 0);
      })
      .catch(error => {
        console.error(`❌ 一括検証エラー: ${error.message}`);
        process.exit(1);
      });
  } else {
    validator.validateDraft(filename)
      .then(result => {
        const hasErrors = result.errors.length > 0;
        process.exit(hasErrors ? 1 : 0);
      })
      .catch(error => {
        console.error(`❌ 検証失敗: ${error.message}`);
        process.exit(1);
      });
  }
}

module.exports = DraftValidator;
