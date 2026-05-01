const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const SiteConfig = require('../../config/site-config');

class AnnouncementGenerator {
  constructor(siteId = null) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Site configuration (allows for custom site or defaults to global config)
    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;

    this.templates = {
      '1': { name: '製品・サービスリリース', file: 'product-release.md' },
      '2': { name: '外部記事・コンテンツ公開', file: 'article-announcement.md' },
      '3': { name: 'サービス・チャンネル開設', file: 'service-launch.md' },
      '4': { name: '一般的なお知らせ', file: 'general-announcement.md' }
    };
  }

  async question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  async showMenu() {
    console.log(`\n=== ${this.siteConfig.getCompanyNameShort()} お知らせ作成ツール ===\n`);
    console.log('作成するお知らせの種類を選択してください:');
    Object.entries(this.templates).forEach(([key, template]) => {
      console.log(`${key}. ${template.name}`);
    });
    console.log('');
  }

  async getTemplateChoice() {
    const choice = await this.question('選択してください (1-4): ');
    if (!this.templates[choice]) {
      console.log('無効な選択です。再度選択してください。');
      return await this.getTemplateChoice();
    }
    return choice;
  }

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

  async loadTemplate(templateFile) {
    const templatePath = path.join(__dirname, '../../templates', templateFile);
    return await fs.readFile(templatePath, 'utf8');
  }

  processTemplate(template, data) {
    // Merge SiteConfig template variables with user data
    const mergedData = {
      ...this.siteConfig.getTemplateVariables(),
      ...data
    };

    let result = template;

    // Handle arrays (each loops)
    Object.entries(mergedData).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        const listRegex = new RegExp(`{{#each ${key}}}([\\s\\S]*?){{/each}}`, 'g');
        result = result.replace(listRegex, (match, itemTemplate) => {
          return value.map(item => itemTemplate.replace(/{{this}}/g, item)).join('');
        });
      } else if (Array.isArray(value) && value.length === 0) {
        // Remove empty each blocks
        const listRegex = new RegExp(`{{#each ${key}}}([\\s\\S]*?){{/each}}`, 'g');
        result = result.replace(listRegex, '');
      }
    });

    // Handle if-else conditionals
    result = result.replace(/{{#if (\w+)}}([\\s\\S]*?){{else}}([\\s\\S]*?){{\/if}}/g, (match, condition, ifContent, elseContent) => {
      return mergedData[condition] && mergedData[condition].trim() ? ifContent : elseContent;
    });

    // Handle simple if conditionals
    result = result.replace(/{{#if (\w+)}}([\\s\\S]*?){{\/if}}/g, (match, condition, content) => {
      return mergedData[condition] && mergedData[condition].trim() ? content : '';
    });

    // Handle simple variable replacements
    Object.entries(mergedData).forEach(([key, value]) => {
      if (!Array.isArray(value)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value || '');
      }
    });

    // Clean up remaining template syntax
    result = result.replace(/{{[^}]+}}/g, '');

    // Clean up multiple empty lines
    result = result.replace(/\n\s*\n\s*\n+/g, '\n\n');

    // Clean up leading/trailing whitespace on each line
    result = result.split('\n').map(line => line.trimEnd()).join('\n');

    return result;
  }

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

  async run() {
    try {
      await this.showMenu();
      const choice = await this.getTemplateChoice();
      const template = this.templates[choice];
      
      let data;
      switch (choice) {
        case '1':
          data = await this.generateProductRelease();
          break;
        case '2':
          data = await this.generateArticleAnnouncement();
          break;
        case '3':
          data = await this.generateServiceLaunch();
          break;
        case '4':
          data = await this.generateGeneralAnnouncement();
          break;
      }
      
      const templateContent = await this.loadTemplate(template.file);
      const processedContent = this.processTemplate(templateContent, data);
      
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