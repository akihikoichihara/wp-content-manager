/**
 * create-announcement.js
 *
 * Interactive CLI wizard that generates a Markdown draft from one of the
 * four pre-defined announcement templates. Prompts the user for the required
 * fields, merges the answers into the template, and saves the result to drafts/.
 *
 * Template engine (processTemplate) supports a Handlebars-like syntax:
 *   {{variable}}           - Simple value substitution
 *   {{#each list}}...{{/each}}  - Repeat block for arrays
 *   {{#if cond}}...{{/if}}      - Conditional block
 *   {{#if cond}}...{{else}}...{{/if}} - If-else block
 *
 * Usage:
 *   npm run create-announcement
 *   npm run create-announcement -- --site lab.itq.co.jp
 */

const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const SiteConfig = require('../../config/site-config');

class AnnouncementGenerator {
  /**
   * @param {string|null} siteId - Target site ID. Defaults to global config site.
   */
  constructor(siteId = null) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;

    // Template registry: maps menu choices to template filenames
    this.templates = {
      '1': { name: '製品・サービスリリース', file: 'product-release.md' },
      '2': { name: '外部記事・コンテンツ公開', file: 'article-announcement.md' },
      '3': { name: 'サービス・チャンネル開設', file: 'service-launch.md' },
      '4': { name: '一般的なお知らせ', file: 'general-announcement.md' }
    };
  }

  /**
   * Wraps readline.question in a Promise for use with async/await.
   *
   * @param {string} prompt
   * @returns {Promise<string>} User's input
   */
  async question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  /** Prints the template selection menu. */
  async showMenu() {
    console.log(`\n=== ${this.siteConfig.getCompanyNameShort()} お知らせ作成ツール ===\n`);
    console.log('作成するお知らせの種類を選択してください:');
    Object.entries(this.templates).forEach(([key, template]) => {
      console.log(`${key}. ${template.name}`);
    });
    console.log('');
  }

  /**
   * Prompts for a menu choice and recurses on invalid input.
   *
   * @returns {Promise<string>} Valid choice key ('1'–'4')
   */
  async getTemplateChoice() {
    const choice = await this.question('選択してください (1-4): ');
    if (!this.templates[choice]) {
      console.log('無効な選択です。再度選択してください。');
      return await this.getTemplateChoice();
    }
    return choice;
  }

  /**
   * Collects all fields needed by the product-release.md template.
   * features is gathered as a repeating prompt (empty line = done) because
   * the number of bullet points varies per product.
   *
   * @returns {Promise<Object>} Template data object
   */
  async generateProductRelease() {
    console.log('\n=== 製品・サービスリリース ===');

    const data = {};
    data.productName = await this.question('製品名: ');
    data.productDescription = await this.question('製品の概要: ');
    data.environment = await this.question('対応環境: ');
    data.price = await this.question('価格: ');
    data.mainFeatures = await this.question('主な機能: ');

    console.log('\n特長を入力してください (空行で終了):');
    data.features = [];
    while (true) {
      const feature = await this.question('- ');
      if (!feature.trim()) break;
      data.features.push(feature);
    }

    data.downloadUrl = await this.question('ダウンロードURL (任意): ');
    data.date = await this.question('発表日 (任意): ');
    data.companyDescription = await this.question('会社説明 (任意): ') ||
      this.siteConfig.getCompanyDescription('extended');

    return data;
  }

  /** @returns {Promise<Object>} Template data for article-announcement.md */
  async generateArticleAnnouncement() {
    console.log('\n=== 外部記事・コンテンツ公開 ===');

    const data = {};
    data.articleTitle = await this.question('記事タイトル: ');
    data.mediaName = await this.question('掲載媒体名: ');
    data.articleUrl = await this.question('記事URL: ');
    data.background = await this.question('記事の背景・目的: ');
    data.articleSummary = await this.question('記事の要旨: ');
    data.additionalContent = await this.question('追加説明 (任意): ');
    data.closingMessage = await this.question('締めのメッセージ (任意): ');

    return data;
  }

  /** @returns {Promise<Object>} Template data for service-launch.md */
  async generateServiceLaunch() {
    console.log('\n=== サービス・チャンネル開設 ===');

    const data = {};
    data.serviceName = await this.question('サービス名: ');
    data.serviceUrl = await this.question('サービスURL: ');
    data.date = await this.question('開設日: ');
    data.purpose = await this.question('開設目的: ');
    data.futureExpansion = await this.question('今後の展開: ');

    console.log('\n提供内容を入力してください (空行で終了):');
    data.content = [];
    while (true) {
      const item = await this.question('- ');
      if (!item.trim()) break;
      data.content.push(item);
    }

    data.companyDescription = await this.question('会社説明 (任意): ') ||
      this.siteConfig.getCompanyDescription('standard');

    return data;
  }

  /** @returns {Promise<Object>} Template data for general-announcement.md */
  async generateGeneralAnnouncement() {
    console.log('\n=== 一般的なお知らせ ===');

    const data = {};
    data.title = await this.question('お知らせタイトル: ');
    data.date = await this.question('日付 (任意): ');
    data.introduction = await this.question('導入文: ');
    data.mainContent = await this.question('主な内容: ');
    data.additionalInfo = await this.question('追加情報 (任意): ');
    data.companyDescription = await this.question('会社説明 (任意): ') ||
      this.siteConfig.getCompanyDescription('standard');

    return data;
  }

  /**
   * Reads a template file from templates/.
   *
   * @param {string} templateFile - Filename (e.g. 'product-release.md')
   * @returns {Promise<string>} Raw template string
   */
  async loadTemplate(templateFile) {
    const templatePath = path.join(__dirname, '../../templates', templateFile);
    return await fs.readFile(templatePath, 'utf8');
  }

  /**
   * Processes a Handlebars-like template string against a data object.
   *
   * Processing order matters:
   *  1. {{#each}} blocks  — must be expanded before variable substitution so
   *     that {{this}} inside the block is replaced correctly
   *  2. {{#if}}…{{else}}…{{/if}} blocks
   *  3. {{#if}}…{{/if}} blocks (no else branch)
   *  4. Simple {{variable}} substitutions
   *  5. Cleanup: remove any leftover {{…}} tokens, collapse blank lines,
   *     strip trailing whitespace per line
   *
   * SiteConfig template variables (companyName, inquiryUrl, etc.) are merged
   * with user-provided data so templates can reference them without the caller
   * having to pass them explicitly.
   *
   * @param {string} template - Raw template string
   * @param {Object} data     - User-supplied field values
   * @returns {string} Rendered Markdown string
   */
  processTemplate(template, data) {
    // Merge site-level variables (lower priority) with user input (higher priority)
    const mergedData = {
      ...this.siteConfig.getTemplateVariables(),
      ...data
    };

    let result = template;

    // --- Step 1: Expand {{#each array}}…{{/each}} blocks ---
    Object.entries(mergedData).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        const listRegex = new RegExp(`{{#each ${key}}}([\\s\\S]*?){{/each}}`, 'g');
        result = result.replace(listRegex, (match, itemTemplate) => {
          return value.map(item => itemTemplate.replace(/{{this}}/g, item)).join('');
        });
      } else if (Array.isArray(value) && value.length === 0) {
        // Remove the block entirely when the array is empty
        const listRegex = new RegExp(`{{#each ${key}}}([\\s\\S]*?){{/each}}`, 'g');
        result = result.replace(listRegex, '');
      }
    });

    // --- Step 2: {{#if}}…{{else}}…{{/if}} ---
    result = result.replace(/{{#if (\w+)}}([\\s\\S]*?){{else}}([\\s\\S]*?){{\/if}}/g, (match, condition, ifContent, elseContent) => {
      return mergedData[condition] && mergedData[condition].trim() ? ifContent : elseContent;
    });

    // --- Step 3: {{#if}}…{{/if}} (no else) ---
    result = result.replace(/{{#if (\w+)}}([\\s\\S]*?){{\/if}}/g, (match, condition, content) => {
      return mergedData[condition] && mergedData[condition].trim() ? content : '';
    });

    // --- Step 4: Simple {{variable}} replacements ---
    Object.entries(mergedData).forEach(([key, value]) => {
      if (!Array.isArray(value)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value || '');
      }
    });

    // --- Step 5: Cleanup ---
    result = result.replace(/{{[^}]+}}/g, '');          // Remove unused tokens
    result = result.replace(/\n\s*\n\s*\n+/g, '\n\n'); // Collapse 3+ blank lines to 2
    result = result.split('\n').map(line => line.trimEnd()).join('\n');

    return result;
  }

  /**
   * Saves the generated Markdown content to drafts/.
   *
   * @param {string} content  - Rendered Markdown string
   * @param {string} filename - Target filename
   * @returns {Promise<string>} Absolute path to the saved file
   */
  async saveAnnouncement(content, filename) {
    const outputDir = path.join(__dirname, '../../drafts');

    try {
      await fs.access(outputDir);
    } catch {
      await fs.mkdir(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, content, 'utf8');

    return outputPath;
  }

  /**
   * Main flow: show menu → collect data → render template → save → preview.
   * The filename is built from the current date and the primary name field;
   * non-ASCII characters and repeated hyphens are sanitized so the slug is
   * safe for use in WordPress URLs.
   */
  async run() {
    try {
      await this.showMenu();
      const choice = await this.getTemplateChoice();
      const template = this.templates[choice];

      let data;
      switch (choice) {
        case '1': data = await this.generateProductRelease(); break;
        case '2': data = await this.generateArticleAnnouncement(); break;
        case '3': data = await this.generateServiceLaunch(); break;
        case '4': data = await this.generateGeneralAnnouncement(); break;
      }

      const templateContent = await this.loadTemplate(template.file);
      const processedContent = this.processTemplate(templateContent, data);

      // Produce a YYYY-MM-DD-{slug}.md filename using the first non-empty name field
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `${timestamp}-${data.productName || data.serviceName || data.title || 'announcement'}.md`
        .replace(/[^a-zA-Z0-9\-\.]/g, '-')
        .replace(/-+/g, '-');

      const outputPath = await this.saveAnnouncement(processedContent, filename);

      console.log('\n=== 生成完了 ===');
      console.log(`ファイル: ${outputPath}`);
      console.log('\n--- プレビュー ---');
      console.log(processedContent);

    } catch (error) {
      console.error('エラーが発生しました:', error.message);
    } finally {
      this.rl.close();
    }
  }
}

if (require.main === module) {
  const generator = new AnnouncementGenerator();
  generator.run();
}

module.exports = AnnouncementGenerator;
