require('dotenv').config();
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const SiteConfig = require('../config/site-config');

class PageUpdater {
  constructor(siteId = null) {
    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;
    this.baseUrl = process.env.WP_API_URL || this.siteConfig.getWordPressApiUrl();
    this.username = process.env.WP_USERNAME;
    this.appPassword = process.env.WP_APP_PASSWORD;
    this.pagesDir = this.siteConfig.getPagesPath();
  }

  async makeRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${endpoint}`);

      const auth = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');

      const options = {
        method: method,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'User-Agent': this.siteConfig.getUserAgent()
        }
      };

      const req = https.request(url, options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve(body);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', reject);

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  async getPage(pageId) {
    return await this.makeRequest('GET', `/pages/${pageId}`);
  }

  async updatePage(pageId, updateData) {
    return await this.makeRequest('POST', `/pages/${pageId}`, updateData);
  }

  async removeAdSenseFromPrivacyPolicy() {
    console.log('\n=== プライバシーポリシーからAdSense記述を削除 ===\n');

    const pageId = 8; // Privacy Policy ID
    const page = await this.getPage(pageId);

    console.log(`📄 現在のページ: ${page.title.rendered}`);

    let content = page.content.rendered;

    // AdSense関連のセクションを削除
    const adSenseSection = /<h2[^>]*>広告について<\/h2>[\s\S]*?(?=<h2|$)/i;
    const beforeLength = content.length;

    content = content.replace(adSenseSection, '');

    // AdMobの記述も削除
    content = content.replace(/Google AdSense[,、]?\s*/gi, '');
    content = content.replace(/Google AdMob[,、]?\s*/gi, '');
    content = content.replace(/AdSense[,、]?\s*/gi, '');
    content = content.replace(/AdMob[,、]?\s*/gi, '');

    // 広告サービスの記述を修正
    content = content.replace(
      /第三者配信の広告サービス（[^）]*）/gi,
      '第三者配信のサービス'
    );

    const afterLength = content.length;
    console.log(`✂️  削除された文字数: ${beforeLength - afterLength}文字`);

    // 更新
    const result = await this.updatePage(pageId, {
      content: content
    });

    console.log(`✅ 更新完了: ${result.link}`);
    console.log(`📅 最終更新: ${result.modified}`);

    // ローカルファイルも更新
    const filepath = path.join(this.pagesDir, 'privacy-policy.json');
    await fs.writeFile(filepath, JSON.stringify(result, null, 2));
    console.log(`💾 ローカルファイル保存: privacy-policy.json`);

    return result;
  }

  async removeAdSenseFromCookiePolicy() {
    console.log('\n=== Cookie PolicyからAdSense記述を削除 ===\n');

    const pageId = 3005; // Cookie Policy (EU) ID
    const page = await this.getPage(pageId);

    console.log(`📄 現在のページ: ${page.title.rendered}`);

    let content = page.content.rendered;
    const beforeLength = content.length;

    // AdSense関連の記述を削除
    content = content.replace(/Google AdSense/gi, 'third-party services');
    content = content.replace(/AdSense/gi, 'advertising services');

    const afterLength = content.length;
    console.log(`✂️  修正された文字数: ${beforeLength - afterLength}文字`);

    // 更新
    const result = await this.updatePage(pageId, {
      content: content
    });

    console.log(`✅ 更新完了: ${result.link}`);
    console.log(`📅 最終更新: ${result.modified}`);

    // ローカルファイルも更新
    const filepath = path.join(this.pagesDir, 'cookie-policy-eu.json');
    await fs.writeFile(filepath, JSON.stringify(result, null, 2));
    console.log(`💾 ローカルファイル保存: cookie-policy-eu.json`);

    return result;
  }

  async run() {
    try {
      console.log('🔄 AdSense記述削除処理を開始します...\n');

      // プライバシーポリシー更新
      await this.removeAdSenseFromPrivacyPolicy();

      // Cookie Policy更新
      await this.removeAdSenseFromCookiePolicy();

      console.log('\n🎉 全ての更新が完了しました！');
      console.log('\n次のステップ:');
      console.log('1. WordPress管理画面で変更内容を確認');
      console.log('2. 必要に応じて手動で微調整');
      console.log('3. npm run sync で最新データを取得');

    } catch (error) {
      console.error('\n❌ エラーが発生しました:', error.message);
      process.exit(1);
    }
  }
}

// 実行
const updater = new PageUpdater();
updater.run();
