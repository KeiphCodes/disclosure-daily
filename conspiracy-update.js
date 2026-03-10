// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PASTE THIS FUNCTION INTO disclosure-daily-engine.js
// Place it BEFORE the findAndSaveSightings() function
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generateDailyConspiracy() {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Check if we already generated a conspiracy today
    const { data: existing } = await supabase
      .from("conspiracies")
      .select("id")
      .eq("published_date", today)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log("  Conspiracy already generated for today, skipping.");
      return;
    }

    // Fetch all previously used conspiracy topics to avoid repeats
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

Choose from this rich library — or invent a credible lesser-known one:
- Roswell 1947 crash & body recovery
- MJ-12 documents & shadow government
- Bob Lazar & S-4 reverse engineering
- Skinwalker Ranch & NIDS investigations
- The Nimitz Tic Tac encounter
- Rendlesham Forest incident 1980
- Phoenix Lights mass sighting 1997
- Malmstrom AFB nuclear missile shutdowns
- Project Blue Book suppression
- Admiral Wilson & Eric Davis leak
- The Galindo Memo / UAP crash retrieval
- Kecksburg Pennsylvania crash 1965
- Belgian UFO wave & F-16 intercepts 1989
- Colares island Brazil abductions 1977
- The Paulding Light mystery
- Gary McKinnon NASA hack revelations
- The Kelly-Hopkinsville encounter 1955
- Mogul balloon vs Roswell debris coverup
- AATIP secret Pentagon program
- The Wilson-Davis memo
- Dulce Base underground facility claims
- Operation Paperclip & UFO tech
- Australian Westall school sighting 1966
- Zimbabwe Ariel School encounter 1994
- The Orford Ness lighthouse incident
- Frederick Valentich disappearance 1978
- Russian Voronezh landing 1989
- The Men In Black phenomenon
- NASA astronaut UFO testimonies (Cooper, Mitchell, etc.)
- Jimmy Carter UFO sighting
- Chile Colbun Lake incident 2010
- The Shag Harbour crash 1967

Search the web for the most compelling recent discussions, documents, or new evidence about your chosen topic. Then write a punchy, well-researched conspiracy deep-dive.

Return ONLY valid JSON:
{
  "title": "Compelling headline for this conspiracy piece",
  "topic_slug": "short-kebab-case-unique-id (e.g. roswell-1947, bob-lazar-s4)",
  "deck": "One-sentence hook that makes readers click",
  "summary": "2-3 sentence overview of the conspiracy/coverup",
  "body": "Full deep-dive article, 400-600 words. Cover: what happened, who was involved, what the official explanation is, what believers claim, and any new evidence or developments. Write in clean plain paragraphs, no markdown, no bullet points in the body.",
  "keyPoints": ["3-5 key bullet point facts about this conspiracy"],
  "believabilityScore": 7,
  "category": "coverup|crash-retrieval|witness|technology|government|phenomenon",
  "sources": ["list of sources or links used"]
}

The believabilityScore is 1-10 where 1 = wild speculation, 10 = nearly confirmed. Be honest.
Return ONLY valid JSON, nothing else.`,
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
// REPLACE your existing findAndSaveSightings() with this one
// Change: searches for 1 sighting (not 2), prioritises media
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function findAndSaveSightings() {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Check if we already saved a sighting today
    const { data: existing } = await supabase
      .from("sightings")
      .select("id")
      .gte("sighted_date", today)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log("  Sighting already saved for today, skipping.");
      return;
    }

    const response = await withRetry(() =>
      anthropic.messages.create({
        model: CONFIG.model,
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          {
            role: "user",
            content: `Search for the single most recent AND most credible UFO or UAP sighting reported in the last 14 days.

Credibility criteria (in order of priority):
1. Has real photo or video evidence
2. Multiple witnesses
3. Sourced from NUFORC, MUFON, credible news outlet, or military source
4. Not already debunked (avoid balloon sightings, Chinese lanterns, Starlink, obvious CGI)

Return ONLY a JSON object for the single best sighting:
{
  "title": "Short punchy title describing the sighting",
  "date": "YYYY-MM-DD (date of the actual sighting)",
  "location": "City, State/Country",
  "description": "2-3 sentence factual description of what was seen, by whom, and any notable details",
  "shape": "orb|triangle|cylinder|disc|light|chevron|unknown|other",
  "source": "Name of publication or database (e.g. NUFORC, MUFON, Reuters, BBC)",
  "source_url": "https://... (direct link to the full report)",
  "image_url": "https://... or null if no image found",
  "video_url": "https://youtube.com/... or null if no video found",
  "has_media": true or false,
  "witness_count": number or null,
  "credibility_notes": "Brief note on why this is credible"
}

Prioritise sightings with real photos or video. Return ONLY valid JSON.`,
          },
        ],
      })
    );

    const text = extractText(response);
    const sighting = safeParseJSON(text);

    if (!sighting || !sighting.title) {
      console.log("  ⚠️  No sightings data returned");
      return;
    }

    // Handle both single object and array response
    const s = Array.isArray(sighting) ? sighting[0] : sighting;

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
      has_media: s.has_media || false,
      witness_count: s.witness_count || null,
      credibility_notes: s.credibility_notes || null,
    });

    if (error) {
      console.error("  ❌ Failed to save sighting:", error.message);
    } else {
      console.log(`  ✅ Sighting saved: "${s.title}" — ${s.location}`);
    }
  } catch (err) {
    console.error("  ❌ findAndSaveSightings error:", err.message);
    throw err;
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REPLACE your runDailyPipeline() try block with this:
// New order: conspiracy → sighting → news → articles → save
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*  PIPELINE (inside runDailyPipeline try block):

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
      articles.push(deepDive);
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
*/
