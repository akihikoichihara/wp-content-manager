/**
 * x-daily-post.js
 *
 * WordPress pages → X (Twitter) daily auto-post script
 *
 * Flow:
 *   1. Get one unposted leaf page from x-post-status.json
 *   2. Generate post text via Google Gemini API (no URL in main post)
 *   3. Post to X: main tweet (summary + hashtags) → reply (URL)
 *   4. Update status to "posted"
 *
 * Usage:
 *   node scripts/x-daily-post.js                  # Auto-post (X API paid plan required)
 *   node scripts/x-daily-post.js --dry-run        # Preview without posting
 *   node scripts/x-daily-post.js --generate-only  # Generate text and copy to clipboard
 *   node scripts/x-daily-post.js --confirm-posted # Mark as posted after manual post
 *
 * Required env vars: GOOGLE_API_KEY, X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 * Required env vars: X_SITE_ID (site ID to post from, e.g. "example.com")
 */

'use strict';

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SITE_ID = process.env.X_SITE_ID || 'example.com';
const STATUS_FILE = path.join(__dirname, '..', 'content', 'sites', SITE_ID, 'x-post-status.json');
const PENDING_FILE = path.join(__dirname, '..', 'content', 'sites', SITE_ID, 'x-pending-post.json');
const PAGES_DIR = path.join(__dirname, '..', 'content', 'sites', SITE_ID, 'pages', 'by-id');
const LOG_DIR = path.join(__dirname, '..', 'logs', 'sites', SITE_ID);

const MODE = process.argv.includes('--generate-only') ? 'generate'
           : process.argv.includes('--confirm-posted') ? 'confirm'
           : process.argv.includes('--dry-run')        ? 'dry-run'
           : 'auto';

// ============================================================================
// Google Gemini API（無料枠：Gemini 2.5 Flash, 1500 req/day）
// ============================================================================

async function generateTweetText(hierarchyTitle, title, excerpt) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY が設定されていません（Google AI Studio で無料取得可能）');

  const siteName = process.env.X_SITE_NAME || SITE_ID;
  const hashtags = process.env.X_HASHTAGS || '';

  const prompt = `You are a social media manager for ${siteName}.

Write an X (Twitter) post for the following page that makes readers want to click and read more.

Page hierarchy: ${hierarchyTitle}
Page title: ${title}
Excerpt: ${excerpt.substring(0, 300)}

Requirements:
- Under 200 characters (including hashtags)
- Start with one emoji
- Include a hint of "why this is useful to know"
- End with: ${hashtags}
- Do NOT include a URL (it will be added as a reply)
- Friendly but professional tone

Output only the post text. No explanation needed.`;

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const json = JSON.parse(data);
          resolve(json.candidates[0].content.parts[0].text.trim());
        } else {
          reject(new Error(`Gemini API error ${res.statusCode}: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

// ============================================================================
// X (Twitter) API v2 — OAuth 1.0a
// ============================================================================

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28')
    .replace(/\)/g, '%29').replace(/\*/g, '%2A');
}

function buildOAuthHeader(method, url, params, credentials) {
  const oauthParams = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0'
  };

  // 署名ベース文字列を構築
  const allParams = { ...params, ...oauthParams };
  const sortedParams = Object.keys(allParams).sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams)
  ].join('&');

  // 署名キー
  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessTokenSecret)}`;

  // HMAC-SHA1署名
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauthParams['oauth_signature'] = signature;

  const headerValue = 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`).join(', ');

  return headerValue;
}

async function postTweet(text, replyToId = null) {
  const credentials = {
    apiKey: process.env.X_API_KEY,
    apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET
  };

  if (!credentials.apiKey || !credentials.apiSecret || !credentials.accessToken || !credentials.accessTokenSecret) {
    throw new Error('X API認証情報が不足しています。.env を確認してください。');
  }

  const tweetUrl = 'https://api.twitter.com/2/tweets';
  const body = { text };
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }
  const bodyJson = JSON.stringify(body);

  const oauthHeader = buildOAuthHeader('POST', tweetUrl, {}, credentials);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.twitter.com',
      path: '/2/tweets',
      method: 'POST',
      headers: {
        'Authorization': oauthHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyJson)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const json = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json.data);
        } else {
          reject(new Error(`X API error ${res.statusCode}: ${JSON.stringify(json)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyJson);
    req.end();
  });
}

// ============================================================================
// メイン処理
// ============================================================================

async function loadStatus() {
  const raw = await fs.readFile(STATUS_FILE, 'utf8');
  return JSON.parse(raw);
}

async function saveStatus(statusData) {
  await fs.writeFile(STATUS_FILE, JSON.stringify(statusData, null, 2));
}

async function saveLog(entry) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(LOG_DIR, `x-post-${date}.json`);
  let logs = [];
  try { logs = JSON.parse(await fs.readFile(logFile, 'utf8')); } catch { /* 新規作成 */ }
  logs.push(entry);
  await fs.writeFile(logFile, JSON.stringify(logs, null, 2));
}

function copyToClipboard(text) {
  try {
    execSync('pbcopy', { input: text });
    return true;
  } catch {
    return false;
  }
}

async function getNextPendingEntry(statusData) {
  return Object.values(statusData.pages)
    .filter(p => p.status === 'pending')
    .sort((a, b) => a.pageId - b.pageId)[0] || null;
}

async function fetchExcerpt(pendingEntry) {
  try {
    const pageFile = path.join(PAGES_DIR, `${pendingEntry.pageId}.json`);
    const pageData = JSON.parse(await fs.readFile(pageFile, 'utf8'));
    const raw = pageData.excerpt?.rendered || pageData.content?.rendered || '';
    return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
  } catch {
    return pendingEntry.excerpt || '';
  }
}

// ============================================================================
// モード別処理
// ============================================================================

async function runGenerate(statusData, now) {
  const pendingEntry = await getNextPendingEntry(statusData);
  if (!pendingEntry) { console.log('未投稿ページがありません。全件投稿完了です！'); process.exit(0); }

  console.log(`\n対象ページ: [${pendingEntry.pageId}] ${pendingEntry.hierarchyTitle}`);
  console.log(`URL: ${pendingEntry.url}\n`);

  console.log('投稿文を生成中...');
  const excerpt = await fetchExcerpt(pendingEntry);
  let tweetText;
  try {
    tweetText = await generateTweetText(pendingEntry.hierarchyTitle, pendingEntry.title, excerpt);
  } catch (e) {
    console.error('投稿文生成失敗:', e.message);
    await saveLog({ pageId: pendingEntry.pageId, status: 'error', error: e.message, timestamp: now });
    process.exit(1);
  }

  // pending-post.json に保存（confirm用）
  await fs.writeFile(PENDING_FILE, JSON.stringify({
    pageId: pendingEntry.pageId,
    hierarchyTitle: pendingEntry.hierarchyTitle,
    url: pendingEntry.url,
    tweetText,
    generatedAt: now
  }, null, 2));

  // クリップボードにコピー（メイン投稿文のみ）
  const copied = copyToClipboard(tweetText);

  console.log('━'.repeat(50));
  console.log(`【投稿文】(${tweetText.length}文字)${copied ? '  ← クリップボードにコピー済み' : ''}`);
  console.log('━'.repeat(50));
  console.log(tweetText);
  console.log('━'.repeat(50));
  console.log(`【リプライ用URL】`);
  console.log(pendingEntry.url);
  console.log('━'.repeat(50));
  console.log('\n手順:');
  console.log('  1. Xアプリで上の投稿文を貼り付けて投稿');
  console.log('  2. 同じ投稿にリプライでURLを投稿');
  console.log('  3. 投稿完了後に: npm run x-confirm');
}

async function runConfirm(statusData, now) {
  let pending;
  try {
    pending = JSON.parse(await fs.readFile(PENDING_FILE, 'utf8'));
  } catch {
    console.error('投稿待ちデータが見つかりません。先に npm run x-generate を実行してください。');
    process.exit(1);
  }

  const { pageId, hierarchyTitle, url, tweetText } = pending;

  statusData.pages[pageId].status = 'posted';
  statusData.pages[pageId].postedAt = now;
  statusData.pages[pageId].tweetText = tweetText;

  const postedCount = Object.values(statusData.pages).filter(p => p.status === 'posted').length;
  const pendingCount = Object.values(statusData.pages).filter(p => p.status === 'pending').length;
  statusData.postedCount = postedCount;
  statusData.pendingCount = pendingCount;

  await saveStatus(statusData);
  await fs.unlink(PENDING_FILE).catch(() => {});
  await saveLog({ pageId, hierarchyTitle, url, tweetText, status: 'posted-manual', timestamp: now });

  console.log(`✅ 投稿済みに記録しました: [${pageId}] ${hierarchyTitle}`);
  console.log(`   投稿済: ${postedCount}件 / 残り: ${pendingCount}件`);
}

async function runAutoPost(statusData, now) {
  const pendingEntry = await getNextPendingEntry(statusData);
  if (!pendingEntry) { console.log('未投稿ページがありません。全件投稿完了です！'); process.exit(0); }

  console.log(`対象ページ: [${pendingEntry.pageId}] ${pendingEntry.hierarchyTitle}`);
  console.log(`URL: ${pendingEntry.url}`);
  console.log('投稿文を生成中...');

  const excerpt = await fetchExcerpt(pendingEntry);
  let tweetText;
  try {
    tweetText = await generateTweetText(pendingEntry.hierarchyTitle, pendingEntry.title, excerpt);
  } catch (e) {
    console.error('投稿文生成失敗:', e.message);
    await saveLog({ pageId: pendingEntry.pageId, status: 'error', error: e.message, timestamp: now });
    process.exit(1);
  }

  console.log(`\n投稿文 (${tweetText.length}文字): ${tweetText.substring(0, 50)}...`);

  let mainTweet, replyTweet;
  try {
    console.log('Xにメイン投稿中...');
    mainTweet = await postTweet(tweetText);
    console.log(`メイン投稿完了: Tweet ID = ${mainTweet.id}`);

    await new Promise(r => setTimeout(r, 2000));
    replyTweet = await postTweet(`詳細はこちら👇\n${pendingEntry.url}`, mainTweet.id);
    console.log(`リプライ完了: Tweet ID = ${replyTweet.id}`);
  } catch (e) {
    console.error('X投稿失敗:', e.message);
    await saveLog({ pageId: pendingEntry.pageId, status: 'error', error: e.message, timestamp: now });
    process.exit(1);
  }

  statusData.pages[pendingEntry.pageId].status = 'posted';
  statusData.pages[pendingEntry.pageId].postedAt = now;
  statusData.pages[pendingEntry.pageId].tweetId = mainTweet.id;
  statusData.pages[pendingEntry.pageId].replyId = replyTweet.id;
  statusData.pages[pendingEntry.pageId].tweetText = tweetText;

  const postedCount = Object.values(statusData.pages).filter(p => p.status === 'posted').length;
  const pendingCount = Object.values(statusData.pages).filter(p => p.status === 'pending').length;
  statusData.postedCount = postedCount;
  statusData.pendingCount = pendingCount;

  await saveStatus(statusData);
  await saveLog({ pageId: pendingEntry.pageId, hierarchyTitle: pendingEntry.hierarchyTitle,
    url: pendingEntry.url, tweetId: mainTweet.id, replyId: replyTweet.id,
    tweetText, status: 'success', timestamp: now });

  console.log(`✅ 完了 (投稿済: ${postedCount}件 / 残り: ${pendingCount}件)`);
}

async function runDryRun(statusData, now) {
  const pendingEntry = await getNextPendingEntry(statusData);
  if (!pendingEntry) { console.log('未投稿ページがありません。全件投稿完了です！'); process.exit(0); }

  console.log(`対象ページ: [${pendingEntry.pageId}] ${pendingEntry.hierarchyTitle}`);
  console.log(`URL: ${pendingEntry.url}`);
  console.log('投稿文を生成中...');

  const excerpt = await fetchExcerpt(pendingEntry);
  const tweetText = await generateTweetText(pendingEntry.hierarchyTitle, pendingEntry.title, excerpt);

  console.log(`\n--- 生成された投稿文 (${tweetText.length}文字) ---`);
  console.log(tweetText);
  console.log(`--- リプライ ---`);
  console.log(pendingEntry.url);
  console.log('---\nDRY RUN: 投稿・ステータス更新はスキップされました。');
}

async function main() {
  const now = new Date().toISOString();
  const modeLabel = { generate: '生成モード', confirm: '確認モード', 'dry-run': 'DRY RUN', auto: '自動投稿' };
  console.log(`[${now}] X投稿スクリプト開始 (${modeLabel[MODE]})`);

  let statusData;
  try {
    statusData = await loadStatus();
  } catch {
    console.error('x-post-status.json が見つかりません。先に npm run x-techpedia-init を実行してください。');
    process.exit(1);
  }

  if (MODE === 'generate') { await runGenerate(statusData, now); return; }
  if (MODE === 'confirm')  { await runConfirm(statusData, now);  return; }
  if (MODE === 'dry-run')  { await runDryRun(statusData, now);   return; }

  // auto モード（完全自動投稿）
  await runAutoPost(statusData, now);
}

main();
