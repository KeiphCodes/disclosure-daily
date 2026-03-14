// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISCLOSURE DAILY ENGINE
// ufofinders.com — automated daily UAP news pipeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// ─── CLIENTS ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── RETRY WRAPPER ───────────────────────────────────────────────────────────
async function withRetry(fn, retries = 5, baseDelay = 10000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isOverloaded =
        err?.status === 529 ||
        (err?.message && err.message.includes("overloaded"));
      const isRateLimited =
        err?.status === 429 ||
        (err?.message && err.message.includes("rate_limit"));

      if ((isOverloaded || isRateLimited) && attempt < retries) {
        const retryAfterSec = parseInt(err?.headers?.["retry-after"] || "0");
        const delay = retryAfterSec > 0
          ? Math.min(retryAfterSec + 5, 60) * 1000
          : baseDelay * attempt;
        console.log(`  ⏳ API limit hit — retrying in ${delay / 1000}s (attempt ${attempt}/${retries})...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  model: "claude-haiku-4-5",
  storiesPerDay: 3,
  featuredCount: 1,
  deepDiveWeekly: true,
  timezone: "America/Chicago",
};

// ─── SEARCH TOPICS ───────────────────────────────────────────────────────────
const SEARCH_TOPICS = [
  "UAP UFO government disclosure news today",
  "Pentagon AARO unidentified aerial phenomena report",
  "UFO sighting military pilot testimony 2025 2026",
  "Congress UAP hearing whistleblower testimony",
  "NASA unidentified anomalous phenomena research",
  "UFO crash retrieval non-human intelligence",
  "AARO UAP report new evidence 2026",
  "UFO sighting witnesses credible report",
];

// ─── EDITORIAL SYSTEM PROMPT ─────────────────────────────────────────────────
const EDITORIAL_SYSTEM_PROMPT = `You are the editor of Disclosure Daily, a serious and credible UAP/UFO news publication at ufofinders.com.

Your editorial standards:
- ACCURACY first. Never sensationalise. Never make claims beyond what the evidence supports.
- CREDIBILITY. Cite real sources. Acknowledge uncertainty honestly.
- CLARITY. Write for an intelligent general audience, not insiders.
- FAIRNESS. Cover skeptical perspectives alongside believer perspectives.
- COVER the full spectrum: government documents, scientific research, credible sighting reports, congressional activity, international developments.

Tone: Authoritative, measured, factual. Think serious science and national security journalism.`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PIPELINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runDailyPipeline() {
  console.log(`\n🛸 DISCLOSURE DAILY ENGINE — ${new Date().toISOString()}`);
  console.log("─".repeat(60));

  try {
    // 1. Generate today's conspiracy deep-dive (never repeats)
    console.log("\n[1/7] Generating daily conspiracy...");
    await generateDailyConspiracy();
    await sleep(15000);

    // 2. Find today's best credible sighting with media
    try {
      console.log("\n[2/7] Finding today's best sighting...");
      await findAndSaveSightings();
      await sleep(15000);
    } catch (err) {
      console.log("  ⚠️  Sighting step skipped — continuing pipeline.");
    }

    // 3. Search for today's UAP news
    console.log("\n[3/7] Searching for today's UAP news...");
    const rawNews = await searchForNews();

    // 4. Curate and rank the stories
    console.log("\n[4/7] Curating and ranking stories...");
    await sleep(15000);
    const curatedStories = await curateStories(rawNews);

    // 5. Write full articles
    console.log("\n[5/7] Writing articles...");
    await sleep(15000);
    const articles = await writeArticles(curatedStories);

    // 5b. Friday deep dive
    const today = new Date();
    if (CONFIG.deepDiveWeekly && today.getDay() === 5) {
      console.log("\n[5b] It's Friday — generating weekly deep dive...");
      const deepDive = await generateDeepDive(curatedStories);
      if (deepDive) articles.push(deepDive);
    }

    // 6. Save articles to Supabase
    console.log("\n[6/7] Saving to database...");
    const saved = await saveToDatabase(articles);

    // 7. Newsletter + social
    console.log("\n[7/7] Building newsletter and posting to social...");
    await sleep(12000);
    await buildNewsletter(articles);
    await postToSocial(articles);

    console.log(`\n✅ Pipeline complete. ${saved} articles published.`);
    console.log("─".repeat(60));
    return { success: true, articlesPublished: saved };
  } catch (err) {
    console.error("\n❌ Pipeline failed:", err);
    throw err;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 0: DAILY CONSPIRACY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generateDailyConspiracy() {
  try {
    const today = new Date().toISOString().split("T")[0];

    const { data: existing } = await supabase
      .from("conspiracies")
      .select("id")
      .eq("published_date", today)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log("  Conspiracy already generated for today, skipping.");
      return;
    }

    const { data: usedTopics } = await supabase
      .from("conspiracies")
      .select("topic_slug")
      .order("published_date", { ascending: false });

    const usedSlugs = (usedTopics || []).map((t) => t.topic_slug).join(", ");
    console.log(`  📚 Already covered ${usedTopics?.length || 0} topics — picking a fresh one...`);

    const response = await withRetry(() =>
      anthropic.messages.create({
        model: CONFIG.model,
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          {
            role: "user",
            content: `You are the conspiracy editor for UFO Finders. Pick ONE UAP/UFO conspiracy theory or coverup topic to deep-dive today.

ALREADY COVERED TOPICS (do NOT repeat these slugs): ${usedSlugs || "none yet"}

Choose from this library or pick a compelling lesser-known one:
Roswell 1947, MJ-12 documents, Bob Lazar S-4, Skinwalker Ranch, Nimitz Tic Tac, Rendlesham Forest 1980, Phoenix Lights 1997, Malmstrom AFB nuclear shutdowns, Project Blue Book suppression, Admiral Wilson Eric Davis leak, Kecksburg Pennsylvania crash 1965, Belgian UFO wave 1989, Colares Brazil 1977, Gary McKinnon NASA hack, Kelly-Hopkinsville 1955, Dulce Base underground, Operation Paperclip UFO tech, Westall school sighting 1966, Zimbabwe Ariel School 1994, Frederick Valentich disappearance 1978, Shag Harbour crash 1967, The Men In Black phenomenon, NASA astronaut UFO testimonies, Jimmy Carter UFO sighting, AATIP secret Pentagon program, Wilson-Davis memo

Search the web for the most compelling recent discussions or new evidence about your chosen topic. Write a punchy well-researched deep-dive.

Return ONLY valid JSON:
{
  "title": "Compelling headline for this conspiracy piece",
  "topic_slug": "short-kebab-case-unique-id",
  "deck": "One-sentence hook",
  "summary": "2-3 sentence overview",
  "body": "Full deep-dive 400-600 words. Cover: what happened, who was involved, official explanation, what believers claim, any new evidence. Clean plain paragraphs, no markdown, no bullet points.",
  "keyPoints": ["3-5 key facts"],
  "believabilityScore": 7,
  "category": "coverup|crash-retrieval|witness|technology|government|phenomenon",
  "sources": ["sources used"]
}

believabilityScore is 1-10 where 1=wild speculation, 10=nearly confirmed. Be honest.
Return ONLY valid JSON.`,
          },
        ],
      })
    );

    const text = extractText(response);
    const conspiracy = safeParseJSON(text);

    if (!conspiracy || !conspiracy.title || !conspiracy.topic_slug) {
      console.log("  ⚠️  No valid conspiracy data returned");
      return;
    }

    const { error } = await supabase.from("conspiracies").insert({
      title: conspiracy.title,
      topic_slug: conspiracy.topic_slug,
      deck: conspiracy.deck,
      summary: conspiracy.summary,
      body: conspiracy.body,
      key_points: conspiracy.keyPoints,
      believability_score: conspiracy.believabilityScore,
      category: conspiracy.category,
      sources: conspiracy.sources,
      published_date: today,
      published_at: new Date().toISOString(),
    });

    if (error) {
      console.error("  ❌ Failed to save conspiracy:", error.message);
    } else {
      console.log(`  ✅ Conspiracy saved: "${conspiracy.title}"`);
    }
  } catch (err) {
    console.error("  ❌ generateDailyConspiracy error:", err.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 1: FIND TODAY'S BEST SIGHTING (MEDIA ONLY)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function findAndSaveSightings() {
  try {
    // Only replace the current sighting if we find one with better evidence
    const response = await withRetry(() =>
      anthropic.messages.create({
        model: CONFIG.model,
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          {
            role: "user",
            content: `Search for the single most recent AND most credible UFO or UAP sighting reported in the last 14 days.

STRICT REQUIREMENTS — only return a result if ALL of these are true:
1. Has a REAL photo or video URL (not just "photos were taken" — must have an actual link)
2. Multiple witnesses OR official source (NUFORC, MUFON, military, credible news outlet)
3. NOT already debunked (no balloons, Chinese lanterns, Starlink, obvious CGI)

If no sighting meets ALL these criteria, return: { "skip": true }

Otherwise return ONLY a JSON object:
{
  "skip": false,
  "title": "Short punchy title",
  "date": "YYYY-MM-DD",
  "location": "City, State/Country",
  "description": "2-3 sentence factual description",
  "shape": "orb|triangle|cylinder|disc|light|chevron|unknown|other",
  "source": "Name of source (e.g. NUFORC, MUFON, BBC)",
  "source_url": "https://...",
  "image_url": "https://... (REQUIRED — must be a real working image URL)",
  "video_url": "https://youtube.com/... or null",
  "has_media": true,
  "witness_count": number or null,
  "credibility_notes": "Brief note on why this is credible"
}

Return ONLY valid JSON.`,
          },
        ],
      })
    );

    const text = extractText(response);
    const parsed = safeParseJSON(text);

    // If AI found nothing worthy, skip — don't replace existing sighting
    if (!parsed || parsed.skip === true || !parsed.title) {
      console.log("  ℹ️  No high-quality sighting with media found today — keeping existing.");
      return;
    }

    // Must have actual media
    if (!parsed.image_url && !parsed.video_url) {
      console.log("  ℹ️  Sighting has no verified media URL — skipping to preserve quality.");
      return;
    }

    const s = parsed;
    const today = new Date().toISOString().split("T")[0];

    // Delete old sightings and replace with the new high-quality one
    await supabase.from("sightings").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error } = await supabase.from("sightings").insert({
      title: s.title,
      sighted_date: s.date || today,
      location: s.location,
      description: s.description,
      shape: s.shape,
      source: s.source,
      source_url: s.source_url,
      image_url: s.image_url || null,
      video_url: s.video_url || null,
      has_media: true,
      witness_count: s.witness_count || null,
      credibility_notes: s.credibility_notes || null,
      published_at: new Date().toISOString(),
    });

    if (error) {
      console.error("  ❌ Failed to save sighting:", error.message);
    } else {
      console.log(`  ✅ Sighting updated: "${s.title}" — ${s.location}`);
    }
  } catch (err) {
    console.error("  ❌ findAndSaveSightings error:", err.message);
    throw err;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2: SEARCH FOR NEWS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function searchForNews() {
  const todaysTopics = SEARCH_TOPICS.sort(() => Math.random() - 0.5).slice(0, 3);
  const allResults = [];

  for (const topic of todaysTopics) {
    console.log(`  🔍 Searching: "${topic}"`);

    const response = await withRetry(() =>
      anthropic.messages.create({
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
      })
    );

    const text = extractText(response);
    const results = safeParseJSON(text);
    if (results && Array.isArray(results)) {
      allResults.push(...results.filter((r) => r.relevance !== "low"));
    }

    await sleep(1000);
  }

  console.log(`  Found ${allResults.length} raw news items`);
  return allResults;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3: CURATE STORIES (NO DUPLICATES)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function curateStories(rawNews) {
  // Fetch recent headlines from database to avoid duplicates
  const { data: recentArticles } = await supabase
    .from("articles")
    .select("headline, original_url")
    .order("published_at", { ascending: false })
    .limit(60);

  const recentHeadlines = (recentArticles || []).map((a) => a.headline?.toLowerCase() || "");
  const recentUrls = (recentArticles || []).map((a) => a.original_url || "");

  if (rawNews.length === 0) {
    console.log("  ⚠️  No raw news found — using fallback sources");
    return await getFallbackStories(recentHeadlines, recentUrls);
  }

  const response = await withRetry(() =>
    anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 2000,
      system: EDITORIAL_SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `As editor of Disclosure Daily, select and rank the best ${CONFIG.storiesPerDay} stories for today's edition.

Here are the raw stories found:
${JSON.stringify(rawNews, null, 2)}

ALREADY PUBLISHED — do NOT select stories that cover the same event or topic as these recent headlines:
${recentHeadlines.slice(0, 20).join("\n")}

ALREADY PUBLISHED URLs — do NOT select stories from these URLs:
${recentUrls.slice(0, 20).join("\n")}

Only include a story about a previously covered topic if there is significant NEW information or development.

Criteria:
- Newsworthiness and significance to UAP/disclosure community
- Source credibility
- Variety (mix government, science, sightings, international)
- Avoid duplicates or very similar stories to what's already been published

Return a JSON array of exactly ${CONFIG.storiesPerDay} curated stories:
[
  {
    "title": string,
    "summary": string,
    "source": string,
    "url": string,
    "date": string,
    "category": "government|science|sighting|testimony|international|investigation",
    "isFeatured": boolean (true for #1 story only),
    "isBreaking": boolean,
    "editorialNote": "Why this story matters and why it is NOT a duplicate"
  }
]

Return ONLY valid JSON.`,
        },
      ],
    })
  );

  const text = extractText(response);
  const curated = safeParseJSON(text);

  if (!curated || !Array.isArray(curated) || curated.length === 0) {
    console.log("  ⚠️  Curation failed — using fallback");
    return await getFallbackStories(recentHeadlines, recentUrls);
  }

  console.log(`  Curated ${curated.length} stories`);
  return curated;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 4: WRITE ARTICLES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function writeArticles(curatedStories) {
  const articles = [];

  for (const story of curatedStories) {
    console.log(`  ✍️  Writing: "${story.title?.slice(0, 50)}..."`);
    await sleep(20000);

    const publishDate = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const response = await withRetry(() =>
      anthropic.messages.create({
        model: CONFIG.model,
        max_tokens: 1200,
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
Published: ${publishDate}
Category: ${story.category}
Editorial note: ${story.editorialNote}

Search the web for any additional context or corroborating sources before writing.

Write a tight, punchy news article of NO MORE THAN 500 words. Be concise and direct. Include:
1. A compelling, accurate headline (can differ from original title)
2. A one-sentence "deck" (subheadline)
3. The full article body in inverted pyramid style — the FIRST sentence of the article must include the date and location of the event (e.g. "On March 12, 2026, Pentagon officials announced...")
4. A "Key Facts" box (3-5 bullet points, each including relevant dates where applicable)

CRITICAL WRITING RULES:
- Always include the specific date the event occurred in the opening sentence
- Write COMPLETE, SELF-CONTAINED sentences only. Every sentence must start with a capital letter.
- NEVER start any sentence or paragraph with a comma, period, semicolon, or lowercase word.
- NEVER use citation tags, XML tags, HTML tags, brackets, or any markup in the article body.
- Source attribution ALWAYS goes at the START of a sentence: "According to the Pentagon, ..." NOT "...according to the Pentagon."
- Each paragraph must be 2-4 complete sentences. No orphan fragments.
- The body field must be clean plain text paragraphs separated by newlines — nothing else.

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
      })
    );

    const text = extractText(response);
    const article = safeParseJSON(text);

    if (article && article.headline) {
      article.publishedAt = new Date().toISOString();
      article.slug = slugify(article.headline);
      articles.push(article);
      console.log(`  ✅ Written: "${article.headline?.slice(0, 50)}"`);
    } else {
      console.log(`  ⚠️  Skipping malformed article — response may have been truncated`);
    }

    await sleep(1500);
  }

  console.log(`  Wrote ${articles.length} articles`);
  return articles;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 4b: WEEKLY DEEP DIVE (Fridays only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generateDeepDive(curatedStories) {
  console.log("  📰 Generating longform deep dive...");
  const topStory = curatedStories[0];

  const response = await withRetry(() =>
    anthropic.messages.create({
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
- Opens with the specific date and context of the central event or development
- Provides full historical context with dates for all key events
- Explains why this matters for the broader disclosure narrative
- Cites multiple experts or sources
- Explains the evidence and its limitations honestly
- Connects to other recent developments (with their dates)
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
    })
  );

  const text = extractText(response);
  const deepDive = safeParseJSON(text);

  if (deepDive && deepDive.headline) {
    deepDive.publishedAt = new Date().toISOString();
    deepDive.slug = slugify(deepDive.headline);
    console.log("  Deep dive written:", deepDive.headline?.slice(0, 50));
    return deepDive;
  }

  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 5: SAVE TO DATABASE (NO DUPLICATES)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function saveToDatabase(articles) {
  let savedCount = 0;

  // Get existing slugs and headlines to prevent duplicates
  const { data: existing } = await supabase
    .from("articles")
    .select("slug, headline")
    .order("published_at", { ascending: false })
    .limit(100);

  const existingSlugs = new Set((existing || []).map((a) => a.slug));
  const existingHeadlines = new Set((existing || []).map((a) => a.headline?.toLowerCase()));

  for (const article of articles) {
    if (!article || !article.headline) continue;

    // Skip if same slug or very similar headline already exists
    if (existingSlugs.has(article.slug)) {
      console.log(`  ⏭  Skipping duplicate slug: "${article.headline?.slice(0, 40)}"`);
      continue;
    }
    if (existingHeadlines.has(article.headline?.toLowerCase())) {
      console.log(`  ⏭  Skipping duplicate headline: "${article.headline?.slice(0, 40)}"`);
      continue;
    }

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
      existingSlugs.add(article.slug);
      existingHeadlines.add(article.headline?.toLowerCase());
      console.log(`  ✅ Saved: "${article.headline?.slice(0, 50)}"`);
    }
  }

  return savedCount;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 6: BUILD NEWSLETTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function buildNewsletter(articles) {
  if (!articles || articles.length === 0) {
    console.log("  ⚠️  No articles to build newsletter from");
    return;
  }

  const featured = articles.find((a) => a.isFeatured) || articles[0];
  const supporting = articles.filter((a) => !a.isFeatured && !a.isDeepDive);
  const deepDive = articles.find((a) => a.isDeepDive);

  const response = await withRetry(() =>
    anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 1000,
      system: EDITORIAL_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write today's Disclosure Daily newsletter digest.

Featured story: ${featured?.headline} — ${featured?.deck}
Supporting stories: ${supporting.map((s) => `• ${s.headline}`).join("\n")}
${deepDive ? `Deep dive: ${deepDive.headline}` : ""}

Write a compelling newsletter with:
- A punchy subject line
- A short preheader (preview text)
- An opening paragraph (2-3 sentences, engaging hook)
- A top story summary (3-4 sentences)
- Also today items (headline + 1 sentence each)
- A closing line

Return as JSON: { "subject": string, "preheader": string, "openingGraph": string, "topStorySummary": string, "alsoTodayItems": [{headline, summary}], "closing": string }
Return ONLY valid JSON.`,
        },
      ],
    })
  );

  const text = extractText(response);
  const newsletter = safeParseJSON(text);

  if (!newsletter) {
    console.log("  ⚠️  Newsletter generation failed");
    return;
  }

  const html = buildNewsletterHTML(newsletter, featured, supporting, deepDive);
  await emailNewsletterToOwner({ ...newsletter, html });
  console.log("  ✅ Newsletter built and sent");
}

function buildNewsletterHTML(newsletter, featured, supporting, deepDive) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${newsletter.subject}</title>
<style>
  body { font-family: Georgia, serif; background: #0a0a0f; color: #e0e0e0; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 30px; text-align: center; border-bottom: 2px solid #00d4ff; }
  .header h1 { color: #00d4ff; font-size: 28px; margin: 0; letter-spacing: 2px; }
  .header p { color: #8888aa; font-size: 12px; margin: 5px 0 0; }
  .section { padding: 25px; border-bottom: 1px solid #2a2a3e; }
  .featured-headline { font-size: 22px; font-weight: bold; line-height: 1.3; margin-bottom: 10px; }
  .featured-headline a { color: #00d4ff; text-decoration: none; }
  .deck { color: #aaaacc; font-style: italic; margin-bottom: 15px; }
  .body-text { line-height: 1.7; color: #ccccdd; }
  .also-today h3 { color: #00d4ff; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
  .story-item { padding: 10px 0; border-bottom: 1px solid #1a1a2e; }
  .story-item a { color: #e0e0e0; font-weight: bold; text-decoration: none; }
  .story-summary { color: #aaaacc; font-size: 14px; margin: 3px 0 0; }
  .footer { padding: 20px; text-align: center; color: #555577; font-size: 12px; }
  .footer a { color: #00d4ff; }
  .tag { display: inline-block; background: #00d4ff22; color: #00d4ff; font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🛸 DISCLOSURE DAILY</h1>
    <p>${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
  </div>
  <div class="section">
    <p class="body-text">${newsletter.openingGraph}</p>
  </div>
  <div class="section">
    <div class="tag">Top Story</div>
    <div class="featured-headline">
      <a href="${featured?.originalUrl || "https://ufofinders.com"}">${featured?.headline}</a>
    </div>
    <div class="deck">${featured?.deck}</div>
    <div class="body-text">${newsletter.topStorySummary}</div>
  </div>
  ${supporting.length > 0 ? `
  <div class="section also-today">
    <h3>Also Today</h3>
    ${(newsletter.alsoTodayItems || []).map((item, i) => `
    <div class="story-item">
      <a href="${supporting[i]?.originalUrl || "https://ufofinders.com"}">${item.headline}</a>
      <div class="story-summary">${item.summary}</div>
    </div>`).join("")}
  </div>` : ""}
  ${deepDive ? `
  <div class="section">
    <div class="tag">Deep Dive</div>
    <div class="featured-headline">
      <a href="https://ufofinders.com">${deepDive.headline}</a>
    </div>
    <div class="deck">${deepDive.deck}</div>
  </div>` : ""}
  <div class="section">
    <p class="body-text">${newsletter.closing}</p>
    <p class="body-text" style="text-align:center; margin-top: 20px;">
      <a href="https://ufofinders.com" style="background:#00d4ff; color:#000; padding:12px 24px; border-radius:5px; text-decoration:none; font-weight:bold;">Read Full Stories →</a>
    </p>
  </div>
  <div class="footer">
    <p>You're receiving this because you subscribed to Disclosure Daily.</p>
    <p><a href="https://ufofinders.com">ufofinders.com</a></p>
  </div>
</div>
</body>
</html>`;
}

async function emailNewsletterToOwner(newsletter) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log("  ⚠️  Gmail not configured — GMAIL_USER or GMAIL_APP_PASSWORD secret missing");
    return;
  }

  console.log(`  📧 Sending email to ${process.env.GMAIL_USER}...`);

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.verify();
    console.log("  ✅ Gmail connection verified");
  } catch (verifyErr) {
    console.error("  ❌ Gmail verification failed:", verifyErr.message);
    console.error("  → Check GMAIL_USER and GMAIL_APP_PASSWORD secrets in GitHub");
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Disclosure Daily" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: newsletter.subject,
      html: newsletter.html,
    });
    console.log("  ✅ Email sent! Message ID:", info.messageId);
  } catch (sendErr) {
    console.error("  ❌ Email send failed:", sendErr.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 7: POST TO SOCIAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function postToSocial(articles) {
  const featured = articles.find((a) => a.isFeatured) || articles[0];
  if (!featured) return;

  const response = await withRetry(() =>
    anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Write social media posts for this UFO/UAP news article.

Headline: ${featured.headline}
Deck: ${featured.deck}
Category: ${featured.category}

Write:
1. An X (Twitter) post — max 280 chars, punchy, include 3-4 relevant hashtags, end with "ufofinders.com"
2. A longer Facebook/Instagram post — 2-3 sentences, more context, same hashtags

Return as JSON: { "twitter": string, "instagram": string }
Return ONLY valid JSON.`,
        },
      ],
    })
  );

  const text = extractText(response);
  const socialCopy = safeParseJSON(text);

  if (socialCopy) {
    console.log("\n  📣 Social copy ready:");
    console.log("  X:", socialCopy.twitter);
    console.log("  IG:", socialCopy.instagram);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FALLBACK STORIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getFallbackStories(recentHeadlines = [], recentUrls = []) {
  const response = await withRetry(() =>
    anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Search for the most significant recent UAP/UFO news from the past week. Find ${CONFIG.storiesPerDay} credible stories.

Do NOT include stories similar to these already published headlines:
${recentHeadlines.slice(0, 15).join("\n")}

Return a JSON array:
[
  {
    "title": string,
    "summary": string,
    "source": string,
    "url": string,
    "date": string,
    "category": "government|science|sighting|testimony|international|investigation",
    "isFeatured": boolean,
    "isBreaking": false,
    "editorialNote": string
  }
]

Return ONLY valid JSON.`,
        },
      ],
    })
  );

  const text = extractText(response);
  return safeParseJSON(text) || [];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function extractText(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function safeParseJSON(text) {
  try {
    const clean = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(clean);
  } catch {
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
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTRY POINT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

runDailyPipeline()
  .then((result) => {
    console.log("\n🟢 Done:", result);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n🔴 Fatal error:", err);
    process.exit(1);
  });
