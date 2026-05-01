const fs = require('fs').promises;
const path = require('path');
const SiteConfig = require('../config/site-config');

class BatchPostConverter {
  constructor(siteId = null) {
    // Site configuration (allows for custom site or defaults to global config)
    this.siteConfig = siteId ? new SiteConfig.SiteConfig(siteId) : SiteConfig;

    // Use paths from SiteConfig
    this.postsIndexPath = path.join(this.siteConfig.getPostsPath(), 'index.json');
    this.templatesDir = path.join(__dirname, '../templates');
    this.outputDir = path.join(this.siteConfig.getPostsPath(), 'by-id');
    this.draftsDir = this.siteConfig.getDraftsPath();
  }

  async loadPostsIndex() {
    const indexData = await fs.readFile(this.postsIndexPath, 'utf8');
    return JSON.parse(indexData);
  }

  async loadOriginalPost(postId) {
    const postPath = path.join(this.outputDir, `${postId}.json`);
    const postData = await fs.readFile(postPath, 'utf8');
    return JSON.parse(postData);
  }

  categorizePost(post) {
    const title = post.title.rendered;
    
    // アプリリリース系
    if (title.includes('リリース') || title.includes('SimpleCalc') || title.includes('Laboratory')) {
      return 'product-release';
    }
    
    // 外部記事・コンテンツ公開系
    if (title.includes('note') || title.includes('公開') || title.includes('ガイド') || 
        title.includes('資料') || title.includes('Techpedia')) {
      return 'article-announcement';
    }
    
    // サービス・チャンネル開設系
    if (title.includes('開設') || title.includes('YouTube') || title.includes('チャンネル')) {
      return 'service-launch';
    }
    
    // 一般的なお知らせ
    return 'general-announcement';
  }

  async convertToUnifiedFormat(post, category) {
    const title = post.title.rendered;
    const content = post.content.rendered;
    const date = new Date(post.date).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let newTitle = title;
    let newContent = content;

    // タイトルの統一フォーマット化
    if (!title.startsWith('【')) {
      if (category === 'product-release') {
        newTitle = `【リリース】${title.replace(/^(.*?)をリリース.*/, '$1をリリースしました')}`;
      } else if (category === 'article-announcement') {
        if (title.includes('note')) {
          newTitle = `【お知らせ】${title}`;
        } else if (title.includes('公開')) {
          newTitle = `【お知らせ】${title}`;
        } else {
          newTitle = `【お知らせ】${title}`;
        }
      } else if (category === 'service-launch') {
        newTitle = `【開設】${title}`;
      } else {
        newTitle = `【お知らせ】${title}`;
      }
    }

    // コンテンツの構造化（基本的な改善）
    let structuredContent = '';
    
    // 日付の追加（リリース系のみ）
    if (category === 'product-release' || category === 'service-launch') {
      structuredContent += `\n<p><strong>${date}</strong></p>\n\n`;
    }
    
    // 既存コンテンツを追加
    structuredContent += newContent;
    
    // 標準フッターがない場合は追加
    const companyName = this.siteConfig.getCompanyName();
    if (!content.includes(`${companyName}について`) &&
        !content.includes('お問い合わせ')) {
      structuredContent += `\n\n<hr />\n\n`;
      structuredContent += `<p><strong>${companyName}について</strong><br>\n`;
      structuredContent += `${this.siteConfig.getCompanyDescription('standard')}</p>\n\n`;
      structuredContent += `<p><strong>お問い合わせ</strong><br>\n`;
      structuredContent += `弊社ウェブサイトの<a href="${this.siteConfig.getInquiryUrl()}">お問い合わせフォーム</a>までお気軽にご連絡ください。</p>\n`;
    }

    // 変更履歴の作成
    const changes = [];
    if (newTitle !== title) {
      changes.push(`Title updated: "${title}" → "${newTitle}"`);
    }
    if (category === 'product-release' || category === 'service-launch') {
      changes.push('Added date prominence at the beginning');
    }
    if (!content.includes(`${this.siteConfig.getCompanyName()}について`)) {
      changes.push('Added standardized footer with contact information');
    }
    changes.push('Applied unified format standards for brand consistency');

    return {
      ...post,
      title: { rendered: newTitle },
      content: { rendered: structuredContent },
      excerpt: {
        rendered: `<p>${structuredContent.replace(/<[^>]*>/g, '').substring(0, 100)}...</p>\n`,
        protected: false
      },
      reformatted: {
        version: '1.0.0',
        date: new Date().toISOString(),
        template_type: category,
        changes: changes,
        original_title: title
      }
    };
  }

  async saveReformattedPost(post) {
    const outputPath = path.join(this.outputDir, `${post.id}-reformatted.json`);
    await fs.writeFile(outputPath, JSON.stringify(post, null, 2));
    
    // Markdown版も作成
    const markdownContent = this.convertToMarkdown(post);
    const mdPath = path.join(this.draftsDir, `${post.date.split('T')[0]}-${post.slug}-reformatted.md`);
    await fs.writeFile(mdPath, markdownContent);
    
    return { jsonPath: outputPath, mdPath: mdPath };
  }

  convertToMarkdown(post) {
    let content = post.content.rendered;
    
    // HTMLからMarkdownへの基本変換
    content = content
      .replace(/<h2[^>]*>(.*?)<\/h2>/g, '## $1')
      .replace(/<h3[^>]*>(.*?)<\/h3>/g, '### $1')
      .replace(/<p[^>]*>(.*?)<\/p>/g, '$1\n')
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
      .replace(/<hr\s*\/?>/g, '---')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return `${post.title.rendered}\n\n${content}`;
  }

  async processAllPosts() {
    console.log('=== 全投稿の統一フォーマット変換開始 ===\n');
    
    const index = await this.loadPostsIndex();
    const posts = index.posts.filter(p => p.id !== 6); // ID: 6は既に完了
    
    console.log(`処理対象: ${posts.length}件の投稿\n`);
    
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const postInfo of posts) {
      try {
        console.log(`処理中: ID ${postInfo.id} - ${postInfo.title}`);
        
        // 元投稿を読み込み
        const originalPost = await this.loadOriginalPost(postInfo.id);
        
        // カテゴリ分類
        const category = this.categorizePost(originalPost);
        console.log(`  カテゴリ: ${category}`);
        
        // 統一フォーマットに変換
        const reformattedPost = await this.convertToUnifiedFormat(originalPost, category);
        
        // 保存
        const paths = await this.saveReformattedPost(reformattedPost);
        
        results.push({
          id: postInfo.id,
          title: postInfo.title,
          newTitle: reformattedPost.title.rendered,
          category: category,
          changes: reformattedPost.reformatted.changes,
          paths: paths,
          success: true
        });
        
        successCount++;
        console.log(`  ✅ 完了\n`);
        
      } catch (error) {
        console.error(`  ❌ エラー: ${error.message}\n`);
        results.push({
          id: postInfo.id,
          title: postInfo.title,
          error: error.message,
          success: false
        });
        errorCount++;
      }
    }

    // 結果サマリー
    console.log('=== 変換結果サマリー ===');
    console.log(`成功: ${successCount}件`);
    console.log(`エラー: ${errorCount}件`);
    console.log(`合計: ${posts.length}件\n`);

    // 結果レポートを保存
    const reportPath = path.join(__dirname, '../logs', `batch-conversion-${new Date().toISOString().split('T')[0]}.json`);
    await fs.writeFile(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: { total: posts.length, success: successCount, errors: errorCount },
      results: results
    }, null, 2));

    console.log(`詳細レポート: ${reportPath}`);
    
    return results;
  }
}

if (require.main === module) {
  const converter = new BatchPostConverter();
  converter.processAllPosts().catch(console.error);
}

module.exports = BatchPostConverter;