/**
 * ============================================================
 *  DISCLOSURE DAILY — AI CONTENT ENGINE
 *  Runs daily via GitHub Actions / cron job
 *  Searches the web → writes stories → saves to Supabase → triggers newsletter
 * ============================================================
 *
 *  SETUP (one-time):
 *  1. npm install @anthropic-ai/sdk @supabase/supabase-js node-fetch dotenv
 *  2. Create a .env file with your keys (see .env.example below)
 *  3. Set up Supabase table (schema at bottom of this file)
 *  4. Add this script to GitHub Actions to run daily at 6am UTC
 *
 *  .env.example:
 *    ANTHROPIC_API_KEY=sk-ant-...
 *    SUPABASE_URL=https://your-project.supabase.co
 *    SUPABASE_KEY=your-service-role-key
 *    BEEHIIV_API_KEY=your-beehiiv-key       (optional - for newsletter)
 *    BEEHIIV_PUBLICATION_ID=pub_...          (optional - for newsletter)
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

// ─── CLIENTS ───────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Retry wrapper — handles 529 overloaded AND 429 rate limit errors
async function withRetry(fn, retries = 6, baseDelay = 15000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status;
      const isOverloaded = status === 529 || (err?.message && err.message.includes("overloaded"));
      const isRateLimit = status === 429 || (err?.message && err.message.includes("rate_limit"));

      if ((isOverloaded || isRateLimit) && attempt < retries) {
        // Honor retry-after header if present, otherwise use escalating backoff
        const retryAfterHeader = err?.headers?.["retry-after"];
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
        const delay = retryAfterSec ? Math.min(retryAfterSec + 5, 60) * 1000 : baseDelay * attempt; // cap at 60s max wait
        const reason = isRateLimit ? "rate limited" : "overloaded";
        console.log(`  ⏳ Anthropic ${reason} — retrying in ${delay / 1000}s (attempt ${attempt}/${retries})...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── CONFIG ────────────────────────────────────────────────
const CONFIG = {
  model: "claude-haiku-4-5",
  storiesPerDay: 3,         // Kept at 3 to minimize API costs
  featuredCount: 1,         // How many get "featured" / hero treatment
  deepDiveWeekly: true,     // Generate a longform piece every Friday
  timezone: "America/New_York",
};

// ─── SEARCH TOPICS ─────────────────────────────────────────
// The engine rotates through these to ensure broad coverage
const SEARCH_TOPICS = [
  "UAP UFO government disclosure news today",
  "Pentagon AARO unidentified aerial phenomena report",
  "UFO sighting military pilot testimony 2025 2026",
  "Congress UAP hearing whistleblower testimony",
  "NASA unidentified anomalous phenomena research",
  "FOIA declassified UFO documents released",
  "alien extraterrestrial intelligence scientific evidence",
  "UAP radar data sensor confirmation military",
  "David Grusch non-human intelligence program",
  "UFO sighting witnesses credible report",
  "government UAP program secret classified",
  "metamaterials recovered UFO craft analysis",
  "Japan China UK UAP military encounter",
  "astronomer SETI technosignature discovery",
  "UAP video footage analysis new",
];

// ─── EDITORIAL SYSTEM PROMPT ───────────────────────────────
const EDITORIAL_SYSTEM_PROMPT = `You are the lead editor and writer for Disclosure Daily, a serious, credible daily news publication covering UAP (Unidentified Aerial Phenomena), government disclosure, alien evidence, and related scientific developments.

Your editorial standards:
- SERIOUS and JOURNALISTIC. Write like the New York Times or Reuters — not like a tabloid or conspiracy blog.
- EVIDENCE-BASED. Only report on verifiable claims. Distinguish clearly between confirmed facts, credible allegations, and speculation.
- FAIR and ACCURATE. Present multiple perspectives. Note when claims are disputed or unverified.
- NEVER sensationalize. No "Bombshell!" or "EXCLUSIVE PROOF!" — let the facts speak.
- CREDIT sources inline using plain text only (e.g. 'according to Reuters', 'per the Pentagon report'). Never use HTML tags, XML tags, markdown, or any special formatting in article text.
- USE HEDGING LANGUAGE appropriately: "according to," "alleged," "claimed," "reportedly."
- COVER the full spectrum: government documents, scientific research, credible sighting reports, congressional activity, international developments.

Tone: Authoritative, measured, factual. Think serious science and national security journalism.`;

// ─── MAIN PIPELINE ─────────────────────────────────────────
async function runDailyPipeline() {
  console.log(`\n🛸 DISCLOSURE DAILY ENGINE — ${new Date().toISOString()}`);
  console.log("─".repeat(60));

  try {
    // 1. Find recent sightings FIRST while token bucket is full
    try {
      console.log("\n[1/5] Finding recent sightings...");
      await findAndSaveSightings();
      await sleep(15000);
    } catch (err) {
      console.log("  ⚠️  Sightings step skipped (rate limit or error) — continuing pipeline.");
    }

    // 2. Search for today's news
    console.log("\n[2/5] Searching for today's UAP news...");
    const rawNews = await searchForNews();

    // 3. Curate and rank the stories
    console.log("\n[3/5] Curating and ranking stories...");
    await sleep(15000);
    const curatedStories = await curateStories(rawNews);

    // 4. Write full articles for each story
    console.log("\n[4/5] Writing articles...");
    await sleep(15000);
    const articles = await writeArticles(curatedStories);

    // 4b. Generate deep dive (Fridays only)
    const today = new Date();
    if (CONFIG.deepDiveWeekly && today.getDay() === 5) {
      console.log("\n[4b] It's Friday — generating weekly deep dive...");
      const deepDive = await generateDeepDive(curatedStories);
      articles.push(deepDive);
    }

    // 5. Save everything to Supabase
    console.log("\n[5/5] Saving to database...");
    const saved = await saveToDatabase(articles);

    // 6. Trigger newsletter
    console.log("\n[6/6] Building newsletter digest...");
    await sleep(12000);
    await buildNewsletter(articles);

    // 7. Post to social media
    console.log("\n[7/7] Posting to social media...");
    await postToSocial(articles);

    console.log(`\n✅ Pipeline complete. ${saved} articles published.`);
    console.log("─".repeat(60));

    return { success: true, articlesPublished: saved };
  } catch (err) {
    console.error("\n❌ Pipeline failed:", err);
    throw err;
  }
}

// ─── STEP 1: SEARCH FOR NEWS ───────────────────────────────
async function searchForNews() {
  // Pick 5 random topics to search today (keeps coverage fresh)
  const todaysTopics = shuffleArray(SEARCH_TOPICS).slice(0, 3); // 3 topics to stay under rate limits
  const allResults = [];

  for (const topic of todaysTopics) {
    console.log(`  🔍 Searching: "${topic}"`);

    const response = await withRetry(() => anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Search for recent news about: "${topic}". 
          Focus on stories from the last 48 hours. 
          Return a JSON array of up to 5 results, each with:
          { "title": string, "summary": string, "source": string, "url": string, "date": string, "relevance": "high|medium|low" }
          Return ONLY valid JSON, nothing else.`,
        },
      ],
    }));

    const text = extractText(response);
    const results = safeParseJSON(text);
    if (results && Array.isArray(results)) {
      allResults.push(...results.filter((r) => r.relevance !== "low"));
    }

    // Rate limit buffer — 15s between searches to stay under 30k TPM
    await sleep(15000);
  }

  console.log(`  Found ${allResults.length} raw news items`);
  return allResults;
}

// ─── STEP 2: CURATE STORIES ────────────────────────────────
async function curateStories(rawNews) {
  if (rawNews.length === 0) {
    console.log("  ⚠️  No raw news found — using fallback sources");
    return await getFallbackStories();
  }

  const response = await withRetry(() => anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 2000,
    system: EDITORIAL_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here are today's raw news items from web searches:

${JSON.stringify(rawNews, null, 2)}

As editor of Disclosure Daily, select and rank the best ${CONFIG.storiesPerDay} stories for today's edition.

Criteria:
- Newsworthiness (breaking > developing > evergreen)
- Source credibility (government docs > major outlets > credible specialists > social)
- Evidence quality (documented > witnessed > alleged)  
- Reader interest and importance to the UAP/disclosure topic
- Variety (mix government, science, sightings, international)

Return a JSON array of selected stories, each with:
{
  "rank": number (1 = most important),
  "title": string (original title),
  "summary": string,
  "source": string,
  "url": string,
  "date": string,
  "category": "government|science|sighting|testimony|international|investigation",
  "isFeatured": boolean (true for rank 1 only),
  "isBreaking": boolean,
  "editorialNote": string (brief note on why this story matters)
}

Return ONLY valid JSON array.`,
      },
    ],
  }));

  const text = extractText(response);
  const curated = safeParseJSON(text);
  console.log(`  Selected ${curated?.length || 0} stories for publication`);
  return curated || [];
}

// ─── STEP 3: WRITE ARTICLES ────────────────────────────────
async function writeArticles(curatedStories) {
  const articles = [];

  for (const story of curatedStories) {
    console.log(`  ✍️  Writing: "${story.title?.slice(0, 50)}..."`);
    await sleep(20000); // 20s between articles to stay under rate limit

    const response = await withRetry(() => anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 800,
      system: EDITORIAL_SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Write a complete news article for Disclosure Daily based on this story:

Title: ${story.title}
Summary: ${story.summary}
Source: ${story.source}
Date: ${story.date}
Category: ${story.category}
Editorial note: ${story.editorialNote}

Search the web for any additional context or corroborating sources before writing.

Write a tight, punchy news article of NO MORE THAN 500 words. Be concise and direct. Include:
1. A compelling, accurate headline (can differ from original title)
2. A one-sentence "deck" (subheadline)
3. The full article body in inverted pyramid style
4. A "Key Facts" box (3-5 bullet points)

CRITICAL WRITING RULES — READ CAREFULLY:
- Write COMPLETE, SELF-CONTAINED sentences only. Every sentence must start with a capital letter and make full sense on its own.
- NEVER start any sentence or paragraph with a comma, period, semicolon, or lowercase conjunction like ", according to" or ". to replace" or ", establishing".
- NEVER use citation tags, XML tags, HTML tags, brackets, or any markup of any kind in the article body.
- Source attribution ALWAYS goes at the START of a sentence: Write "According to the Pentagon, ..." NOT "...according to the Pentagon."
- Each paragraph must be 2-4 complete sentences. No orphan fragments. No dangling clauses.
- The body field must be clean plain text paragraphs separated by newlines — nothing else.
- If a sentence doesn't start with a capital letter, rewrite it so it does.
- Read your output before returning it. If any paragraph starts with punctuation or a lowercase word, fix it.

Format your response as JSON:
{
  "headline": string,
  "deck": string,
  "body": string,
  "keyFacts": string[],
  "sourcesUsed": string[],
  "category": "${story.category}",
  "isFeatured": ${story.isFeatured},
  "isBreaking": ${story.isBreaking || false},
  "originalUrl": "${story.url}",
  "wordCount": number
}

Return ONLY valid JSON.`,
        },
      ],
    }));

    const text = extractText(response);
    const article = safeParseJSON(text);

    if (article) {
      article.publishedAt = new Date().toISOString();
      article.slug = slugify(article.headline);

      // Search for a relevant image for this article
      console.log(`  🖼️  Finding image for: "${article.headline?.slice(0, 40)}..."`);
      const imageData = await findArticleImage(article.headline, article.category, story.url);
      if (imageData) {
        article.imageUrl = imageData.url;
        article.imageCaption = imageData.caption;
        console.log(`  ✅ Image found: ${imageData.url.slice(0, 60)}...`);
      }

      articles.push(article);
    }

    await sleep(1500); // Respect rate limits
  }

  console.log(`  Wrote ${articles.length} articles`);
  return articles;
}

// ─── STEP 3b: WEEKLY DEEP DIVE ─────────────────────────────
async function generateDeepDive(curatedStories) {
  console.log("  📰 Generating longform deep dive...");

  // Pick the most significant story this week as the deep dive topic
  const topStory = curatedStories[0];

  const response = await withRetry(() => anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 2000,
    system: EDITORIAL_SYSTEM_PROMPT,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [
      {
        role: "user",
        content: `Write this week's Disclosure Daily DEEP DIVE — a 1200-word longform investigative piece.

Base topic: ${topStory?.title || "This week's most significant UAP development"}

Research this topic thoroughly using web search. Then write a comprehensive, deeply reported piece that:
- Provides full historical context
- Explains why this matters for the broader disclosure narrative
- Interviews/cites multiple experts or sources
- Explains the evidence and its limitations honestly
- Connects to other recent developments
- Ends with clear implications and what to watch for next

Format as JSON:
{
  "headline": string,
  "deck": string,
  "body": string,
  "keyFacts": string[],
  "sourcesUsed": string[],
  "category": "investigation",
  "isFeatured": false,
  "isDeepDive": true,
  "isBreaking": false,
  "wordCount": number
}

Return ONLY valid JSON.`,
      },
    ],
  }));

  const text = extractText(response);
  const deepDive = safeParseJSON(text);
  if (deepDive) {
    deepDive.publishedAt = new Date().toISOString();
    deepDive.slug = slugify(deepDive.headline);
    console.log("  Deep dive written:", deepDive.headline?.slice(0, 50));
  }
  return deepDive;
}

// ─── STEP 4: SAVE TO DATABASE ──────────────────────────────

// ─── RECENT SIGHTINGS ──────────────────────────────────────
async function findAndSaveSightings() {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Check if we already saved sightings today
    const { data: existing } = await supabase
      .from("sightings")
      .select("id")
      .gte("sighted_date", today)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log("  Sightings already saved for today, skipping.");
      return;
    }

    const response = await withRetry(() => anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Search for the 2 most recent and credible UFO or UAP sightings reported in the last 7 days. Look for real, sourced reports from news sites, MUFON, NUFORC, military sources, or credible media.

For each sighting find:
- A real image URL if one exists (from the news article, MUFON report, or official release)
- OR a real YouTube/video URL if video exists
- The direct link to the full report or article

Return ONLY a JSON array of exactly 2 objects:
[
  {
    "title": "Short punchy title describing the sighting",
    "date": "YYYY-MM-DD (date of the actual sighting)",
    "location": "City, State/Country",
    "description": "2-3 sentence factual description of what was seen, by whom, and any notable details",
    "shape": "orb|triangle|cylinder|disc|light|chevron|unknown|other",
    "source": "Name of publication or database (e.g. MUFON, Reuters, BBC)",
    "source_url": "https://... (direct link to the full report)",
    "image_url": "https://... or null if no image found",
    "video_url": "https://youtube.com/... or null if no video found",
    "has_media": true or false
  }
]

Prioritise sightings that have real photos or video. Return ONLY valid JSON.`,
        },
      ],
    }));

    const text = extractText(response);
    const sightings = safeParseJSON(text);

    if (!sightings || !Array.isArray(sightings)) {
      console.log("  ⚠️  No sightings data returned");
      return;
    }

    let saved = 0;
    for (const s of sightings.slice(0, 2)) {
      const { error } = await supabase.from("sightings").insert({
        title: s.title,
        sighted_date: s.date || today,
        location: s.location,
        description: s.description,
        shape: s.shape || "unknown",
        source: s.source,
        source_url: s.source_url || null,
        image_url: s.image_url || null,
        video_url: s.video_url || null,
        has_media: s.has_media || false,
        published_at: new Date().toISOString(),
      });

      if (error) {
        console.error("  ❌ Sighting save failed:", error.message);
      } else {
        saved++;
        console.log(`  ✅ Sighting saved: ${s.title?.slice(0, 50)}`);
      }
    }

    console.log(`  Saved ${saved} sightings`);
  } catch (err) {
    console.error("  ❌ Sightings step failed:", err.message);
  }
}


// ─── SOCIAL MEDIA AUTO-POSTING ─────────────────────────────
async function postToSocial(articles) {
  const featured = articles.find(a => a?.isFeatured) || articles[0];
  if (!featured) return;

  const siteUrl = 'https://ufofinders.com';

  // ── GENERATE SOCIAL COPY ──────────────────────────────────
  let socialCopy;
  try {
    const response = await withRetry(() => anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Write social media posts for this UFO/UAP news article.

Headline: ${featured.headline}
Summary: ${featured.deck}
Category: ${featured.category}

Write 3 versions. Return ONLY valid JSON:
{
  "twitter": "Tweet under 270 chars. Hook first. No hashtag spam — max 2 relevant tags like #UAP #UFO. End with: ${siteUrl}",
  "reddit_title": "Reddit post title under 200 chars. No clickbait. Factual and intriguing.",
  "reddit_body": "2-3 sentence Reddit post body. Factual tone. Invite discussion. End with: Full story + today's other UAP news: ${siteUrl}",
  "hashtags": ["#UAP", "#UFO", "2-3 more relevant tags as array"]
}`
      }]
    }));

    const text = extractText(response);
    socialCopy = safeParseJSON(text);
  } catch(err) {
    console.log('  ⚠️  Social copy generation failed:', err.message);
    return;
  }

  if (!socialCopy) { console.log('  ⚠️  No social copy generated'); return; }

  // ── POST TO X (TWITTER) ───────────────────────────────────
  if (process.env.X_API_KEY && process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET) {
    try {
      // Twitter API v2 with OAuth 1.0a
      const crypto = await import('crypto');
      const tweet  = socialCopy.twitter;

      const oauthParams = {
        oauth_consumer_key:     process.env.X_API_KEY,
        oauth_nonce:            crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp:        Math.floor(Date.now()/1000).toString(),
        oauth_token:            process.env.X_ACCESS_TOKEN,
        oauth_version:          '1.0',
      };

      const baseParams = { ...oauthParams, text: tweet };
      const paramStr = Object.keys(baseParams).sort()
        .map(k => encodeURIComponent(k)+'='+encodeURIComponent(baseParams[k]))
        .join('&');
      const baseStr = 'POST&'+encodeURIComponent('https://api.twitter.com/2/tweets')+'&'+encodeURIComponent(paramStr);
      const sigKey  = encodeURIComponent(process.env.X_API_SECRET)+'&'+encodeURIComponent(process.env.X_ACCESS_SECRET);
      oauthParams.oauth_signature = crypto.createHmac('sha1', sigKey).update(baseStr).digest('base64');

      const authHeader = 'OAuth ' + Object.keys(oauthParams).sort()
        .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
        .join(', ');

      const xRes = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: tweet })
      });

      const xData = await xRes.json();
      if (xRes.ok) {
        console.log('  ✅ X post published:', tweet.slice(0,60)+'...');
      } else {
        console.log('  ⚠️  X post failed:', JSON.stringify(xData));
      }
    } catch(err) {
      console.log('  ⚠️  X posting error:', err.message);
    }
  } else {
    console.log('  ℹ️  X credentials not set — skipping (add X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET to GitHub Secrets)');
  }

  // ── POST TO REDDIT ────────────────────────────────────────
  if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET &&
      process.env.REDDIT_USERNAME   && process.env.REDDIT_PASSWORD) {
    try {
      // Get Reddit access token
      const authStr = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
      const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + authStr,
          'Content-Type':  'application/x-www-form-urlencoded',
          'User-Agent':    'UFOFinders/1.0 by ' + process.env.REDDIT_USERNAME
        },
        body: `grant_type=password&username=${encodeURIComponent(process.env.REDDIT_USERNAME)}&password=${encodeURIComponent(process.env.REDDIT_PASSWORD)}`
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('No Reddit token: ' + JSON.stringify(tokenData));

      // Post to r/UFOs (most active UFO sub)
      const subreddits = ['UFOs', 'ufo'];
      for (const sub of subreddits) {
        await sleep(2000);
        const postRes = await fetch('https://oauth.reddit.com/api/submit', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + tokenData.access_token,
            'Content-Type':  'application/x-www-form-urlencoded',
            'User-Agent':    'UFOFinders/1.0 by ' + process.env.REDDIT_USERNAME
          },
          body: new URLSearchParams({
            kind:     'link',
            sr:       sub,
            title:    socialCopy.reddit_title,
            url:      siteUrl,
            nsfw:     'false',
            spoiler:  'false',
            resubmit: 'true',
          }).toString()
        });
        const postData = await postRes.json();
        if (postRes.ok && !postData.json?.errors?.length) {
          console.log(`  ✅ Reddit post submitted to r/${sub}`);
        } else {
          console.log(`  ⚠️  Reddit r/${sub} failed:`, JSON.stringify(postData.json?.errors || postData));
        }
      }
    } catch(err) {
      console.log('  ⚠️  Reddit posting error:', err.message);
    }
  } else {
    console.log('  ℹ️  Reddit credentials not set — skipping (add REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD to GitHub Secrets)');
  }

  // Log the generated copy regardless
  console.log('\n  📣 Social copy generated:');
  console.log('  X:', socialCopy.twitter?.slice(0,80)+'...');
  console.log('  Reddit title:', socialCopy.reddit_title?.slice(0,80));
}

// ─── IMAGE FINDER ──────────────────────────────────────────
async function findArticleImage(headline, category, sourceUrl) {
  try {
    // Build a search query from headline + category
    const categoryKeywords = {
      government: "pentagon military UFO",
      science: "space telescope NASA",
      sighting: "UFO sky phenomenon",
      testimony: "congress hearing witness",
      international: "UFO globe aircraft",
      investigation: "classified document government",
    };
    const extra = categoryKeywords[category] || "UFO UAP aerial phenomenon";
    const query = encodeURIComponent(`${headline} ${extra}`);

    // Unsplash Source API — free, no key needed, returns a real image
    const unsplashUrl = `https://source.unsplash.com/800x450/?${query}`;

    // Verify it resolves (Unsplash redirects to a real image)
    const testRes = await fetch(unsplashUrl, { method: "HEAD", redirect: "follow" });
    if (testRes.ok && testRes.url.includes("images.unsplash.com")) {
      return {
        url: testRes.url,
        caption: `Image related to: ${headline}`,
      };
    }

    // Fallback: generic UAP image
    const fallback = await fetch("https://source.unsplash.com/800x450/?UFO,sky,aircraft", { method: "HEAD", redirect: "follow" });
    if (fallback.ok) {
      return { url: fallback.url, caption: "UAP / UFO related imagery" };
    }

    return null;
  } catch (err) {
    console.log(`  ⚠️  Image lookup failed: ${err.message}`);
    return null;
  }
}

async function saveToDatabase(articles) {
  let savedCount = 0;

  for (const article of articles) {
    if (!article) continue;

    const { error } = await supabase.from("articles").insert({
      slug: article.slug,
      headline: article.headline,
      deck: article.deck,
      body: article.body,
      key_facts: article.keyFacts,
      sources_used: article.sourcesUsed,
      category: article.category,
      is_featured: article.isFeatured || false,
      is_breaking: article.isBreaking || false,
      is_deep_dive: article.isDeepDive || false,
      original_url: article.originalUrl,
      word_count: article.wordCount,
      image_url: article.imageUrl || null,
      image_caption: article.imageCaption || null,
      published_at: article.publishedAt,
    });

    if (error) {
      console.error(`  ❌ Failed to save: ${article.headline?.slice(0, 40)}`, error.message);
    } else {
      savedCount++;
    }
  }

  return savedCount;
}

// ─── STEP 5: BUILD NEWSLETTER ──────────────────────────────

// ─── EMAIL NEWSLETTER TO OWNER ─────────────────────────────
async function emailNewsletterToOwner(newsletter) {
  // Uses Gmail SMTP via nodemailer — free, no third party service needed
  // Requires GMAIL_USER and GMAIL_APP_PASSWORD in GitHub Secrets
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log("  ℹ️  Gmail not configured — skipping owner email (add GMAIL_USER + GMAIL_APP_PASSWORD to GitHub Secrets)");
    return;
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD, // Gmail App Password (not your real password)
      },
    });

    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    const emailBody = `
UFO FINDERS — NEWSLETTER READY TO SEND
${today}
${"=".repeat(50)}

SUBJECT LINE (copy this into Beehiiv):
${newsletter.subject}

PREVIEW TEXT:
${newsletter.preheader}

${"=".repeat(50)}
STEPS TO SEND:
1. Go to app.beehiiv.com → Posts → New Post
2. Paste the subject line above
3. Copy the content below into the editor
4. Hit Send

${"=".repeat(50)}
NEWSLETTER CONTENT:
${"─".repeat(50)}

${newsletter.openingGraph}

TODAY'S TOP STORY
─────────────────
${newsletter.topStorySummary}

ALSO TODAY
─────────────────
${(newsletter.alsoTodayItems || []).map((item, i) => (i+1) + ". " + item.headline + " — " + item.summary).join("\n\n")}

${"─".repeat(50)}
${newsletter.closing}

Read everything at ufofinders.com
${"=".repeat(50)}
    `;

    await transporter.sendMail({
      from: `"UFO Finders Engine" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `📧 Newsletter Ready: ${newsletter.subject}`,
      text: emailBody,
    });

    console.log("  ✅ Newsletter emailed to owner — check your inbox!");
  } catch (err) {
    console.log("  ⚠️  Owner email failed:", err.message);
  }
}

async function buildNewsletter(articles) {
  const featured = articles.find((a) => a?.isFeatured);
  const supporting = articles.filter((a) => a && !a.isFeatured && !a.isDeepDive).slice(0, 5);
  const deepDive = articles.find((a) => a?.isDeepDive);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const response = await withRetry(() => anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 2000,
    system: EDITORIAL_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Write today's Disclosure Daily newsletter digest.

Date: ${today}
Featured story: ${featured?.headline} — ${featured?.deck}
Supporting stories: ${supporting.map((s) => `• ${s.headline}`).join("\n")}
${deepDive ? `Deep dive: ${deepDive.headline}` : ""}

Write a newsletter with:
1. An engaging opening paragraph (2-3 sentences summarizing today's significance)
2. A "Today's Top Story" section with 3-4 sentence summary
3. A "Also Today" section listing supporting stories with 1-2 sentence summaries each
4. A closing line that teases what to watch for next

Tone: Smart, informed friend briefing you on the day's most important developments. Professional but not stiff.

Return as JSON: { "subject": string, "preheader": string, "openingGraph": string, "topStorySummary": string, "alsoTodayItems": [{headline, summary}], "closing": string }

Return ONLY valid JSON.`,
      },
    ],
  }));

  const text = extractText(response);
  const newsletter = safeParseJSON(text);

  if (!newsletter) {
    console.log("  ⚠️  Newsletter generation failed");
    return;
  }

  // Save newsletter to Supabase
  await supabase.from("newsletters").insert({
    date: new Date().toISOString().split("T")[0],
    subject: newsletter.subject,
    preheader: newsletter.preheader,
    content: newsletter,
    published_at: new Date().toISOString(),
  });

  console.log(`  📧 Newsletter ready: "${newsletter.subject}"`);

  // Email the newsletter to the owner for easy Beehiiv copy-paste
  await emailNewsletterToOwner(newsletter);

  // Send via Beehiiv (if configured)
  if (process.env.BEEHIIV_API_KEY && process.env.BEEHIIV_PUBLICATION_ID) {
    await sendViaBeehiiv(newsletter, articles);
  } else {
    console.log("  ℹ️  Beehiiv not configured — newsletter saved to DB only");
  }
}

// ─── BEEHIIV SENDER ────────────────────────────────────────
async function sendViaBeehiiv(newsletter, articles) {
  const html = buildNewsletterHTML(newsletter, articles);

  const response = await fetch(
    `https://api.beehiiv.com/v2/publications/${process.env.BEEHIIV_PUBLICATION_ID}/posts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BEEHIIV_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: newsletter.subject,
        preview_text: newsletter.preheader,
        content_html: html,
        status: "draft", // Change to "confirmed" to auto-send
        audience: "free",
      }),
    }
  );

  if (response.ok) {
    console.log("  ✅ Newsletter created in Beehiiv as draft");
  } else {
    console.error("  ❌ Beehiiv error:", await response.text());
  }
}

function buildNewsletterHTML(newsletter, articles) {
  const featured = articles.find((a) => a?.isFeatured);
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #f8f8f6; color: #1a1a1a; }
  .header { background: #080a0c; color: #00c8ff; padding: 24px; text-align: center; }
  .header h1 { font-family: monospace; font-size: 14px; letter-spacing: 4px; margin: 0; }
  .header .date { font-family: monospace; font-size: 10px; color: #4a6070; margin-top: 6px; }
  .content { background: white; padding: 32px; }
  .opening { font-size: 16px; line-height: 1.7; margin-bottom: 28px; color: #333; }
  .section-label { font-family: monospace; font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: #00c8ff; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; margin-bottom: 16px; }
  .featured-headline { font-size: 22px; font-weight: bold; line-height: 1.3; margin-bottom: 10px; }
  .featured-deck { font-size: 14px; color: #555; margin-bottom: 12px; font-style: italic; }
  .featured-body { font-size: 14px; line-height: 1.7; color: #333; }
  .read-more { display: inline-block; margin-top: 12px; font-family: monospace; font-size: 10px; letter-spacing: 2px; color: #00c8ff; text-decoration: none; }
  .story-item { border-top: 1px solid #eee; padding: 14px 0; }
  .story-headline { font-size: 15px; font-weight: bold; margin-bottom: 5px; }
  .story-summary { font-size: 13px; color: #555; line-height: 1.6; }
  .closing { font-size: 13px; color: #777; font-style: italic; margin-top: 28px; padding-top: 20px; border-top: 1px solid #eee; }
  .footer { background: #080a0c; color: #4a6070; padding: 20px; text-align: center; font-family: monospace; font-size: 10px; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="header">
  <h1>DISCLOSURE DAILY</h1>
  <div class="date">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
</div>
<div class="content">
  <p class="opening">${newsletter.openingGraph}</p>
  
  <div class="section-label">Today's Top Story</div>
  <div class="featured-headline">${featured?.headline || ""}</div>
  <div class="featured-deck">${featured?.deck || ""}</div>
  <div class="featured-body">${newsletter.topStorySummary}</div>
  <a href="https://disclosure-daily.com" class="read-more">Read Full Story →</a>
  
  <br><br>
  <div class="section-label">Also Today</div>
  ${(newsletter.alsoTodayItems || [])
    .map(
      (item) => `
  <div class="story-item">
    <div class="story-headline">${item.headline}</div>
    <div class="story-summary">${item.summary}</div>
  </div>`
    )
    .join("")}
  
  <div class="closing">${newsletter.closing}</div>
</div>
<div class="footer">
  DISCLOSURE DAILY · disclosure-daily.com<br>
  You're receiving this because you subscribed. <a href="{{unsubscribe_url}}" style="color:#4a6070">Unsubscribe</a>
</div>
</body>
</html>`;
}

// ─── FALLBACK STORIES ──────────────────────────────────────
// Used when web search returns nothing (rare)
async function getFallbackStories() {
  console.log("  Using AI to generate fallback story topics...");
  const response = await withRetry(() => anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 1000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [
      {
        role: "user",
        content: `Search for the most recent UAP, UFO, or alien-related news from any credible source. Return a JSON array of 5 stories with { title, summary, source, url, date, relevance: "high" }. Return ONLY valid JSON.`,
      },
    ],
  }));
  const text = extractText(response);
  return safeParseJSON(text) || [];
}

// ─── UTILITY FUNCTIONS ─────────────────────────────────────
function extractText(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function safeParseJSON(text) {
  try {
    // Strip markdown code fences if present
    const clean = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(clean);
  } catch {
    // Try to extract JSON from mixed text
    const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function slugify(str) {
  if (!str) return `article-${Date.now()}`;
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function shuffleArray(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// ─── ENTRY POINT ───────────────────────────────────────────
runDailyPipeline()
  .then((result) => {
    console.log("\n🟢 Done:", result);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n🔴 Fatal error:", err);
    process.exit(1);
  });

/*
═══════════════════════════════════════════════════════════════
  SUPABASE SCHEMA — Run this SQL in your Supabase SQL editor
═══════════════════════════════════════════════════════════════

-- Articles table
create table articles (
  id uuid default gen_random_uuid() primary key,
  slug text unique not null,
  headline text not null,
  deck text,
  body text,
  key_facts text[],
  sources_used text[],
  category text,
  is_featured boolean default false,
  is_breaking boolean default false,
  is_deep_dive boolean default false,
  original_url text,
  word_count integer,
  published_at timestamptz,
  created_at timestamptz default now()
);

-- Newsletters table
create table newsletters (
  id uuid default gen_random_uuid() primary key,
  date date unique not null,
  subject text,
  preheader text,
  content jsonb,
  published_at timestamptz,
  created_at timestamptz default now()
);

-- Enable public read access (for your website frontend)
alter table articles enable row level security;
create policy "Public read" on articles for select using (true);
alter table newsletters enable row level security;
create policy "Public read" on newsletters for select using (true);

═══════════════════════════════════════════════════════════════
  GITHUB ACTIONS — Save as .github/workflows/daily-engine.yml
═══════════════════════════════════════════════════════════════

name: Disclosure Daily Engine
on:
  schedule:
    - cron: '0 6 * * *'   # Every day at 6am UTC
  workflow_dispatch:        # Also allows manual trigger

jobs:
  run-engine:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: node disclosure-daily-engine.js
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          BEEHIIV_API_KEY: ${{ secrets.BEEHIIV_API_KEY }}
          BEEHIIV_PUBLICATION_ID: ${{ secrets.BEEHIIV_PUBLICATION_ID }}
*/
