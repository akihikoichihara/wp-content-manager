# CLAUDE.md

This file provides guidance for Claude Code (claude.ai/code) when working in this project.

## Project Overview

**WordPress Multisite Content Management System**

A system for managing content across multiple WordPress sites via REST API, with Git version control. Write drafts in Markdown, validate before publishing, and push to WordPress through a unified workflow.

### Key Features
- WordPress REST API integration for content sync and publishing
- Structured data management (posts, pages, media)
- Git version control for all content changes
- Unified announcement creation tool
- Pre-publish validation (Markdown, SEO, links, images)
- Enhanced error handling (circuit breaker, auto-retry)
- Batch update and new post creation

## Project Structure

```
wp-content-manager/
├── content/               # Synced WordPress data (gitignored)
├── scripts/               # Management and update scripts
├── src/                   # API client
├── templates/             # Announcement templates
├── drafts/                # Draft Markdown files (gitignored)
├── logs/                  # Processing logs (gitignored)
└── config/                # Configuration files
```

## Commands

### Basic Operations
```bash
# Sync content (WordPress → local)
npm run sync

# Create announcement (interactive)
npm run create-announcement

# Test WordPress API connection
npm run test-wp-connection
```

### Post Management
```bash
# Create new post (Markdown → WordPress)
npm run create-post

# Update a single post
npm run update-post <post-id>

# Batch convert all posts to unified format (local only)
npm run batch-convert

# Batch update all posts to WordPress
npm run batch-update
```

### Pre-publish Validation
```bash
# Validate a draft (recommended before publishing)
npm run validate-draft <filename>

# Integrated workflow (validate → suggest fixes → publish)
npm run smart-publish <filename>

# Dry run (no actual post)
npm run smart-publish <filename> -- --dry-run

# Force publish (ignore warnings)
npm run smart-publish <filename> -- --force
```

### Error Handling and System Monitoring
```bash
# Sync with enhanced error handling
npm run enhanced-sync

# System health check
npm run test-error-handling
```

## Key File Paths

### Configuration
- `config/sites/index.json`: Site registry (list of managed sites)
- `config/sites/{site-id}.json`: Per-site config (API endpoint, branding, etc.)
- `config/site-config.js`: SiteConfig management class
- `config/validation-rules.json`: Validation rule settings
- `config/wordpress.json`: WordPress credentials **(gitignored — never commit)**

### Content Data (multisite structure)
- `content/sites/{site-id}/posts/by-id/`: Posts (by ID)
- `content/sites/{site-id}/pages/`: Fixed pages
- `content/sites/{site-id}/media/`: Media

### Templates
- `templates/article-announcement.md`: For article publication announcements
- `templates/product-release.md`: For product releases
- `templates/service-launch.md`: For service launches
- `templates/general-announcement.md`: For general announcements

## Post Title Format

Choose a prefix that matches the content type and use it consistently:
- **[Announcement]** or equivalent: External articles, general notices
- **[Release]**: Product or service releases
- **[Launch]**: New service or channel launches

Define your own conventions in `config/validation-rules.json`.

## Quality Control

### Pre-publish Validation
1. **Basic**: Title format, Markdown syntax, content structure
2. **SEO**: Heading structure, keyword density, title length
3. **Links**: External, internal, and anchor link checks
4. **Images**: Alt attributes, file size, format checks
5. **Auto-fix suggestions**: Detected issues with concrete improvement proposals

### Error Handling
- **Circuit breaker**: Auto-stop and recovery on consecutive errors
- **Exponential backoff**: Auto-retry for network failures
- **Comprehensive logging**: Detailed error records and analysis
- **Health check**: System-wide status monitoring

## WordPress API Authentication

### Configuration
Set credentials in `config/wordpress.json` (copy from `config/wordpress.example.json`):
```json
{
  "apiUrl": "https://your-site.com/wp-json/wp/v2",
  "endpoints": {
    "posts": "/posts",
    "pages": "/pages",
    "media": "/media",
    "categories": "/categories",
    "tags": "/tags"
  }
}
```

Set credentials in `.env` (copy from `.env.example`):
```
WP_USERNAME=your_wp_username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

Generate an Application Password in WordPress: **Users → Profile → Application Passwords**.

### Verify Access
```bash
npm run check-permissions
npm run debug-auth
```

## Adding a New Site

1. Create `config/sites/{site-id}.json`:
   ```json
   {
     "siteId": "your-site.com",
     "wordpress": { "apiUrl": "https://your-site.com/wp-json/wp/v2" },
     "branding": { "companyName": "Your Company" },
     "contact": { "inquiryUrl": "https://your-site.com/contact/" }
   }
   ```
2. Register in `config/sites/index.json`
3. Add credentials to `.env`:
   ```
   WP_YOUR_SITE_COM_USERNAME=username
   WP_YOUR_SITE_COM_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```
4. Switch site with: `npm run sync -- --site your-site.com`

## File Naming Conventions

### Draft Files
- Format: `YYYY-MM-DD-{slug}.md`
- Example: `2026-01-01-new-feature-announcement.md`
- Slugs must be **ASCII only** (alphanumeric + hyphens). Japanese slugs cause URL encoding issues.

### Log Files
- Format: `{action}-{timestamp}.json`
- Example: `validation-reports/2026-01-01-draft-validation-1234567890.json`

## Development Guidelines

### Commit Convention
```
<type>: <subject>

<body>

🤖 Generated with [Claude Code](https://claude.ai/code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

### Branch Strategy
- `main`: Stable production branch
- `develop`: Development branch
- `feature/*`: New feature branches

### Recommended Workflow

#### Creating a New Announcement
1. `npm run create-announcement` — generate from template
2. `npm run validate-draft <filename>` — pre-publish validation
3. `npm run smart-publish <filename>` — publish

#### Updating an Existing Post
1. Check `content/sites/{site-id}/posts/by-id/{id}.json`
2. `npm run update-post <post-id>` — update
3. Confirm result in logs

#### Troubleshooting
1. `npm run test-wp-connection` — check connection
2. `npm run test-error-handling` — check system state
3. Review `logs/` directory for error details

## Security

- Never hardcode credentials
- Keep config files separate (`config/wordpress.json`, `.env`)
- Respect API rate limits
- Mask sensitive data in error logs
- `config/wordpress.json` and `.env` are gitignored — **never force-add them**

## Troubleshooting

### WordPress API Connection Error
```bash
npm run test-wp-connection
npm run debug-auth
```

### Post Update Failure
```bash
npm run validate-draft <filename>
cat logs/validation-reports/<report-file>
```

### Content Sync Error
```bash
npm run enhanced-sync
cat logs/error-{date}.json
```
