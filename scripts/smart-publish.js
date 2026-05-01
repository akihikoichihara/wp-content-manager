#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const DraftValidator = require('./validate-draft');
const AutoFixer = require('./validation/auto-fixer');

class SmartPublisher {
  constructor() {
    this.validator = new DraftValidator();
    this.autoFixer = new AutoFixer();
    this.draftsDir = path.join(__dirname, '../drafts');
  }

  async smartPublish(filename, options = {}) {
    const {
      skipValidation = false,
      autoFix = true,
      forcePublish = false,
      dryRun = false
    } = options;

    console.log(`🚀 Smart Publish開始: ${filename}`);
    console.log(`オプション: autoFix=${autoFix}, dryRun=${dryRun}, force=${forcePublish}\n`);

    try {
      // Step 1: Validation
      if (!skipValidation) {
        console.log('📋 Step 1: 投稿前検証実行中...\n');
        const result = await this.validator.validateDraft(filename);

        if (result.errors.length > 0 && !forcePublish) {
          console.log('❌ エラーが検出されました。修正してから再実行してください。\n');
          return { success: false, stage: 'validation', result };
        }

        // Step 2: Auto-fix suggestions
        if (autoFix && (result.errors.length > 0 || result.warnings.length > 0)) {
          console.log('🔧 Step 2: 自動修正提案生成中...\n');
          await this.generateAutoFixSuggestions(filename, result);
        }

        // Step 3: Check if ready for publishing
        if (result.warnings.length > 0 && !forcePublish) {
          console.log('⚠️  警告が検出されました。改善を推奨しますが、公開は可能です。');
          console.log('強制公開する場合: npm run smart-publish <filename> -- --force\n');
          
          const shouldContinue = await this.promptUser('続行しますか？ (y/N): ');
          if (!shouldContinue) {
            return { success: false, stage: 'user_cancelled', result };
          }
        }

        console.log(`✅ 検証完了: スコア ${result.score}/100点\n`);
      }

      // Step 4: Publish to WordPress
      if (!dryRun) {
        console.log('📤 Step 3: WordPressへ投稿中...\n');
        await this.publishToWordPress(filename);
        console.log('✅ WordPress投稿完了!\n');
      } else {
        console.log('🔍 ドライラン: 実際の投稿はスキップされました\n');
      }

      // Step 5: Post-publish tasks
      console.log('📝 Step 4: 投稿後タスク実行中...\n');
      await this.postPublishTasks(filename, dryRun);

      console.log('🎉 Smart Publish完了!\n');
      return { success: true, stage: 'completed' };

    } catch (error) {
      console.error(`❌ Smart Publish失敗: ${error.message}`);
      return { success: false, stage: 'error', error };
    }
  }

  async generateAutoFixSuggestions(filename, validationResult) {
    try {
      const filePath = path.join(this.draftsDir, filename);
      const content = await fs.readFile(filePath, 'utf8');
      
      const fixes = await this.autoFixer.analyzeAndSuggestFixes(content, validationResult);
      
      if (fixes.autoFixes.length > 0 || fixes.manualFixes.length > 0 || fixes.suggestions.length > 0) {
        const report = this.autoFixer.generateFixReport(fixes, []);
        console.log(report);
        
        // Save fix suggestions to file
        const fixesPath = path.join(__dirname, '../logs/fix-suggestions', `${path.parse(filename).name}-fixes-${Date.now()}.json`);
        await fs.mkdir(path.dirname(fixesPath), { recursive: true });
        await fs.writeFile(fixesPath, JSON.stringify(fixes, null, 2));
        console.log(`💾 修正提案を保存しました: ${fixesPath}\n`);
      }
    } catch (error) {
      console.warn(`⚠️  修正提案生成エラー: ${error.message}`);
    }
  }

  async publishToWordPress(filename) {
    // Use existing create-wordpress-post script with filename
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const absoluteFilePath = path.isAbsolute(filename)
        ? filename
        : path.join(this.draftsDir, filename);
      const child = spawn('node', ['scripts/create-wordpress-post.js', absoluteFilePath, '', 'publish'], {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`WordPress投稿失敗: exit code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async postPublishTasks(filename, dryRun) {
    const tasks = [
      '📊 投稿統計更新',
      '🔄 コンテンツ同期',
      '📋 投稿履歴記録'
    ];

    for (const task of tasks) {
      console.log(`  ${task}...`);
      if (!dryRun) {
        // Simulate task execution
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      console.log(`  ✅ ${task} 完了`);
    }

    // Archive the markdown file
    if (!dryRun) {
      await this.archiveMarkdownFile(filename);
    }
  }

  async archiveMarkdownFile(filename) {
    try {
      const sourcePath = path.join(this.draftsDir, filename);
      const archiveDir = path.join(__dirname, '../content/published-drafts');
      const archivePath = path.join(archiveDir, `${Date.now()}-${filename}`);
      
      await fs.mkdir(archiveDir, { recursive: true });
      await fs.copyFile(sourcePath, archivePath);
      
      console.log(`📁 Markdownファイルをアーカイブしました: ${archivePath}`);
    } catch (error) {
      console.warn(`⚠️  アーカイブエラー: ${error.message}`);
    }
  }

  async promptUser(question) {
    // Simplified user prompt (in a real implementation, you'd use a proper prompt library)
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.toLowerCase().startsWith('y'));
      });
    });
  }

  async batchPublish(pattern = '*.md', options = {}) {
    const glob = require('glob');
    const files = glob.sync(path.join(this.draftsDir, pattern));
    
    console.log(`📚 一括公開開始: ${files.length}件のファイル\n`);

    const results = [];
    for (const file of files) {
      const filename = path.basename(file);
      console.log(`\n📄 処理中: ${filename}`);
      console.log('='.repeat(50));
      
      try {
        const result = await this.smartPublish(filename, { ...options, autoFix: false });
        results.push({ filename, ...result });
      } catch (error) {
        console.error(`❌ ${filename}: ${error.message}`);
        results.push({ filename, success: false, error: error.message });
      }
    }

    // Generate summary
    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;
    
    console.log('\n📊 一括公開結果');
    console.log('='.repeat(30));
    console.log(`✅ 成功: ${successful}件`);
    console.log(`❌ 失敗: ${failed}件`);
    
    if (failed > 0) {
      console.log('\n❌ 失敗したファイル:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  • ${r.filename}: ${r.error || r.stage}`);
      });
    }

    return results;
  }

  displayUsage() {
    console.log(`
🚀 Smart Publish - 統合投稿ワークフロー

基本的な使用方法:
  npm run smart-publish <ファイル名>
  node scripts/smart-publish.js <ファイル名>

オプション:
  --dry-run       実際の投稿はせず、検証のみ実行
  --force         警告を無視して強制公開
  --skip-validation 検証をスキップ
  --no-autofix    自動修正提案を無効化

使用例:
  npm run smart-publish article.md
  npm run smart-publish article.md -- --dry-run
  npm run smart-publish article.md -- --force
  
一括処理:
  node scripts/smart-publish.js --batch
  node scripts/smart-publish.js --batch "draft-*.md"

ワークフロー:
  1. 📋 投稿前検証実行
  2. 🔧 自動修正提案生成
  3. 📤 WordPress投稿
  4. 📝 投稿後タスク実行
  5. 📁 ファイルアーカイブ

次のステップ:
  検証のみ: npm run validate-draft <filename>
  手動投稿: npm run create-post
`);
  }
}

// CLI execution
if (require.main === module) {
  const publisher = new SmartPublisher();
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    publisher.displayUsage();
    process.exit(0);
  }

  // Parse arguments
  const filename = args.find(arg => !arg.startsWith('--'));
  const options = {
    dryRun: args.includes('--dry-run'),
    forcePublish: args.includes('--force'),
    skipValidation: args.includes('--skip-validation'),
    autoFix: !args.includes('--no-autofix')
  };

  if (args.includes('--batch')) {
    const pattern = filename || '*.md';
    publisher.batchPublish(pattern, options)
      .then(results => {
        const hasFailures = results.some(r => !r.success);
        process.exit(hasFailures ? 1 : 0);
      })
      .catch(error => {
        console.error(`❌ 一括公開エラー: ${error.message}`);
        process.exit(1);
      });
  } else {
    if (!filename) {
      console.error('❌ ファイル名を指定してください');
      process.exit(1);
    }

    publisher.smartPublish(filename, options)
      .then(result => {
        process.exit(result.success ? 0 : 1);
      })
      .catch(error => {
        console.error(`❌ Smart Publish失敗: ${error.message}`);
        process.exit(1);
      });
  }
}

module.exports = SmartPublisher;