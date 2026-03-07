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
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── CONFIG ────────────────────────────────────────────────
const CONFIG = {
  model: "claude-opus-4-5",
  storiesPerDay: 8,         // How many articles to publish each day
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
    // 1. Search for today's news
    console.log("\n[1/5] Searching for today's UAP news...");
    const rawNews = await searchForNews();

    // 2. Curate and rank the stories
    console.log("\n[2/5] Curating and ranking stories...");
    const curatedStories = await curateStories(rawNews);

    // 3. Write full articles for each story
    console.log("\n[3/5] Writing articles...");
    const articles = await writeArticles(curatedStories);

    // 4. Generate deep dive (Fridays only)
    const today = new Date();
    if (CONFIG.deepDiveWeekly && today.getDay() === 5) {
      console.log("\n[3b] It's Friday — generating weekly deep dive...");
      const deepDive = await generateDeepDive(curatedStories);
      articles.push(deepDive);
    }

    // 5. Save everything to Supabase
    console.log("\n[4/5] Saving to database...");
    const saved = await saveToDatabase(articles);

    // 6. Trigger newsletter
    console.log("\n[5/5] Building newsletter digest...");
    await buildNewsletter(articles);

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
  const todaysTopics = shuffleArray(SEARCH_TOPICS).slice(0, 5);
  const allResults = [];

  for (const topic of todaysTopics) {
    console.log(`  🔍 Searching: "${topic}"`);

    const response = await anthropic.messages.create({
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
    });

    const text = extractText(response);
    const results = safeParseJSON(text);
    if (results && Array.isArray(results)) {
      allResults.push(...results.filter((r) => r.relevance !== "low"));
    }

    // Rate limit buffer
    await sleep(1000);
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

  const response = await anthropic.messages.create({
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
  });

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

    const wordCount = story.isFeatured ? 500 : 250;

    const response = await anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 1500,
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

Write a ${wordCount}-word article with:
1. A compelling, accurate headline (can differ from original title)
2. A one-sentence "deck" (subheadline) 
3. The full article body in inverted pyramid style
4. A "Key Facts" box (3-5 bullet points)

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
    });

    const text = extractText(response);
    const article = safeParseJSON(text);

    if (article) {
      article.publishedAt = new Date().toISOString();
      article.slug = slugify(article.headline);
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

  const response = await anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 4000,
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
  });

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
async function buildNewsletter(articles) {
  const featured = articles.find((a) => a?.isFeatured);
  const supporting = articles.filter((a) => a && !a.isFeatured && !a.isDeepDive).slice(0, 5);
  const deepDive = articles.find((a) => a?.isDeepDive);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const response = await anthropic.messages.create({
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
  });

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
  const response = await anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 1000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [
      {
        role: "user",
        content: `Search for the most recent UAP, UFO, or alien-related news from any credible source. Return a JSON array of 5 stories with { title, summary, source, url, date, relevance: "high" }. Return ONLY valid JSON.`,
      },
    ],
  });
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
