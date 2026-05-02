# wp-content-manager

[English](#english) | [日本語](#日本語)

---

<a name="english"></a>

WordPress multisite content management system using Claude Code and REST API.

Manage multiple WordPress sites via REST API, version-control content with Git, and streamline the publish workflow with validation and automated formatting.

## Features

- **Multi-site support**: Manage unlimited WordPress sites via config files
- **Markdown-first workflow**: Write drafts in Markdown, publish to WordPress
- **Pre-publish validation**: Title format, Markdown syntax, SEO, broken links, image alt attributes
- **Smart publish**: Validate → suggest fixes → publish in one command
- **Batch operations**: Bulk sync and update across all managed sites
- **Error handling**: Circuit breaker, exponential backoff, comprehensive logging
- **X.com integration**: Automated post scheduling from WordPress content

## Requirements

- Node.js v14+
- WordPress site with REST API enabled
- WordPress Application Password (Settings > Users > Application Passwords)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/akihikoichihara/wp-content-manager.git
   cd wp-content-manager
   npm install
   ```

2. Copy and configure credentials:
   ```bash
   cp .env.example .env
   # Edit .env with your WordPress credentials
   ```

3. Copy and configure site settings:
   ```bash
   cp config/wordpress.example.json config/wordpress.json
   cp config/sites/example.com.json config/sites/your-site.com.json
   # Edit both files with your site details
   ```

4. Update `config/sites/index.json` to register your site.

5. Test the connection:
   ```bash
   npm run test-wp-connection
   ```

## Usage

### Sync content from WordPress

```bash
npm run sync
# With site selection
npm run sync -- --site your-site.com
```

### Create and publish a post

```bash
# Create a draft from template
npm run create-announcement

# Validate the draft
npm run validate-draft drafts/your-draft.md

# Publish (validate + auto-fix suggestions + post)
npm run smart-publish drafts/your-draft.md

# Dry run (no actual post)
npm run smart-publish drafts/your-draft.md -- --dry-run
```

### Batch operations

```bash
npm run batch-convert   # Convert local posts to unified format
npm run batch-update    # Push all local changes to WordPress
npm run enhanced-sync   # Sync with enhanced error handling
```

### Diagnostics

```bash
npm run test-wp-connection
npm run check-permissions
npm run debug-auth
npm run test-error-handling
```

## Project Structure

```
wp-content-manager/
├── config/
│   ├── site-config.js          # Site config manager class
│   ├── validation-rules.json   # Validation rule settings
│   ├── wordpress.json          # WP credentials (gitignored)
│   └── sites/
│       ├── index.json          # Site registry
│       └── example.com.json    # Per-site config (template)
├── scripts/
│   ├── generators/             # Content creation tools
│   ├── validation/             # Pre-publish validators
│   ├── sync-content.js         # WordPress → local sync
│   ├── smart-publish.js        # Integrated publish workflow
│   └── ...
├── src/
│   └── unified-wordpress-client.js  # WordPress REST API client
├── templates/                  # Announcement templates (Markdown)
├── drafts/                     # Working drafts (gitignored)
├── content/                    # Synced WordPress content (gitignored)
└── logs/                       # Operation logs (gitignored)
```

## Adding a New Site

1. Create `config/sites/your-site.com.json`:
   ```json
   {
     "siteId": "your-site.com",
     "wordpress": { "apiUrl": "https://your-site.com/wp-json/wp/v2" },
     "branding": { "companyName": "Your Company" },
     "contact": { "inquiryUrl": "https://your-site.com/contact/" }
   }
   ```

2. Register it in `config/sites/index.json`

3. Add credentials to `.env`:
   ```
   WP_YOUR_SITE_COM_USERNAME=username
   WP_YOUR_SITE_COM_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```

## License

MIT

---

<a name="日本語"></a>

# wp-content-manager（日本語）

WordPress REST APIとClaude Codeを使ったマルチサイト コンテンツ管理システムです。

複数のWordPressサイトをREST API経由で管理し、コンテンツをGitでバージョン管理しながら、投稿前検証・自動フォーマット調整を含む統一ワークフローで公開作業を効率化します。

## 主な機能

- **マルチサイト対応**：設定ファイルを追加するだけで管理サイトを無制限に追加可能
- **Markdownファースト**：Markdownで下書きを書き、WordPressへ公開
- **投稿前検証**：タイトル形式・Markdown構文・SEO・リンク切れ・画像alt属性を自動チェック
- **スマートパブリッシュ**：検証→修正提案→投稿をワンコマンドで実行
- **バッチ処理**：全管理サイトの一括同期・更新
- **エラーハンドリング**：サーキットブレーカー・指数バックオフ・詳細ログ
- **X.com連携**：WordPressコンテンツからの定期自動投稿

## 動作要件

- Node.js v14以上
- REST APIが有効なWordPressサイト
- WordPressアプリケーションパスワード（ユーザー → プロフィール → アプリケーションパスワード）

## セットアップ

1. リポジトリをクローン：
   ```bash
   git clone https://github.com/akihikoichihara/wp-content-manager.git
   cd wp-content-manager
   npm install
   ```

2. 認証情報を設定：
   ```bash
   cp .env.example .env
   # .envを編集してWordPressの認証情報を入力
   ```

3. サイト設定を作成：
   ```bash
   cp config/wordpress.example.json config/wordpress.json
   cp config/sites/example.com.json config/sites/your-site.com.json
   # 両ファイルを編集してサイト情報を入力
   ```

4. `config/sites/index.json` にサイトを登録する。

5. 接続テスト：
   ```bash
   npm run test-wp-connection
   ```

## 使い方

### WordPressからコンテンツを同期

```bash
npm run sync
# サイトを指定する場合
npm run sync -- --site your-site.com
```

### 投稿の作成と公開

```bash
# テンプレートから下書きを作成
npm run create-announcement

# 下書きを検証
npm run validate-draft drafts/your-draft.md

# 公開（検証→修正提案→投稿）
npm run smart-publish drafts/your-draft.md

# ドライラン（実際には投稿しない）
npm run smart-publish drafts/your-draft.md -- --dry-run
```

### バッチ処理

```bash
npm run batch-convert   # ローカル投稿を統一フォーマットに変換
npm run batch-update    # ローカルの変更をWordPressへ一括反映
npm run enhanced-sync   # エラーハンドリング強化版の同期
```

### 診断・デバッグ

```bash
npm run test-wp-connection
npm run check-permissions
npm run debug-auth
npm run test-error-handling
```

## ディレクトリ構成

```
wp-content-manager/
├── config/
│   ├── site-config.js          # サイト設定管理クラス
│   ├── validation-rules.json   # 検証ルール設定
│   ├── wordpress.json          # WP認証情報（gitignore対象）
│   └── sites/
│       ├── index.json          # サイトレジストリ
│       └── example.com.json    # サイト設定テンプレート
├── scripts/
│   ├── generators/             # コンテンツ作成ツール
│   ├── validation/             # 投稿前検証スクリプト
│   ├── sync-content.js         # WordPress → ローカル同期
│   ├── smart-publish.js        # 統合公開ワークフロー
│   └── ...
├── src/
│   └── unified-wordpress-client.js  # WordPress REST APIクライアント
├── templates/                  # お知らせテンプレート（Markdown）
├── drafts/                     # 作業中の下書き（gitignore対象）
├── content/                    # 同期済みWordPressコンテンツ（gitignore対象）
└── logs/                       # 操作ログ（gitignore対象）
```

## 新しいサイトの追加手順

1. `config/sites/your-site.com.json` を作成：
   ```json
   {
     "siteId": "your-site.com",
     "wordpress": { "apiUrl": "https://your-site.com/wp-json/wp/v2" },
     "branding": { "companyName": "Your Company" },
     "contact": { "inquiryUrl": "https://your-site.com/contact/" }
   }
   ```

2. `config/sites/index.json` に登録する

3. `.env` に認証情報を追加：
   ```
   WP_YOUR_SITE_COM_USERNAME=username
   WP_YOUR_SITE_COM_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```

## ライセンス

MIT
