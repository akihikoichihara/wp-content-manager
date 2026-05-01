# wp-content-manager

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
