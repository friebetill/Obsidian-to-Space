# Obsidian-to-Space Plugin Launch Plan

## Goal
Maximize user acquisition for Space through the Obsidian-to-Space plugin launch.

## Key Context
- **Space pricing**: Free app with Pro tier for AI features (don't emphasize Pro - AI features are early stage)
- **Timeline**: Wait for Obsidian Community Plugins approval (~1-2 weeks)
- **Community**: Small existing user base (can't rely on organic engagement)
- **Content**: Can create GIF/video demo + text post

---

## Phase 1: Pre-Launch Preparation

### 1.1 Code Readiness
- [ ] Commit pending changes in `parser.ts` and `sync.ts` (deck tracking improvements)
- [ ] Bump version if needed (currently 0.1.0)
- [ ] Create GitHub Release with changelog

### 1.2 Submit to Obsidian Community Plugins
**Process**: Submit PR to https://github.com/obsidianmd/obsidian-releases

Requirements:
- [ ] Ensure `manifest.json` has all required fields (already complete)
- [ ] Add plugin to community-plugins.json in obsidian-releases repo
- [ ] Wait for review (typically 1-2 weeks)

### 1.3 Prepare Demo Assets
- [ ] Create a short GIF/video showing the sync workflow (write Q:/A: → sync → show in Space app)
- [ ] Screenshot of multi-deck feature with TARGET DECK directive
- [ ] Before/after showing cards in Obsidian vs Space

---

## Phase 2: Reddit Post Strategy

### 2.1 Target Subreddits (in order of priority)
1. **r/ObsidianMD** (~200k members) - Primary target, highly relevant
2. **r/Anki** (~100k members) - Spaced repetition users, potential converts
3. **r/medicalschoolanki** (~90k members) - Heavy flashcard users
4. **r/productivity** (~2.4M members) - Broader audience
5. **r/learnprogramming** / **r/cscareerquestions** - If targeting developers

### 2.2 Optimal Posting Time
**Best times for Reddit engagement:**
- **Tuesday-Thursday, 9-11 AM EST** (highest engagement)
- Avoid weekends (lower traffic for productivity/tool subreddits)
- Post to r/ObsidianMD first, wait 24-48h before cross-posting

### 2.3 Reddit Post Draft (r/ObsidianMD)

**Title options** (test which resonates):
- "I built a plugin to sync Obsidian flashcards to Space for cross-device spaced repetition"
- "New plugin: Write flashcards in Obsidian, study them anywhere with Space"
- "Obsidian to Space - finally a way to use spaced repetition without leaving your PKM workflow"

**Post structure:**
```
## The Problem
I wanted to write flashcards in Obsidian but study them on my phone with proper spaced repetition. Anki's desktop app felt clunky for editing, and I wanted my cards to live in my notes.

## The Solution
[GIF/video demo here]

I built Obsidian to Space - a free plugin that syncs your flashcards to the Space app.

**How it works:**
- Write cards with simple Q:/A: syntax in any note
- One-click sync to Space (free app for iOS, Android, Mac, Windows, Linux)
- Organize into decks with `TARGET DECK: Deck Name`
- Smart change detection - only syncs modified cards

## Example
[screenshot or code block showing Q:/A: syntax with TARGET DECK]

## Install
Search "Space" in Community Plugins, or see GitHub for manual install.

Links: [GitHub] | [Space app](https://getspace.app)

Would love feedback - what features would make this more useful for your workflow?
```

**Key messaging points:**
- Lead with "free" (Space is free, plugin is free)
- Position as Anki alternative (familiar to audience)
- End with engagement question (boosts comments)

### 2.4 Post Engagement Strategy
- Respond to every comment within first 2 hours (critical for algorithm)
- Ask for feedback: "What features would make this more useful?"
- Upvote from secondary accounts is against TOS - avoid

---

## Phase 3: Additional Growth Tactics

### 3.1 Obsidian Community
- [ ] Post in Obsidian Discord #plugins-showcase channel
- [ ] Submit to Obsidian Hub (obsidian.md community site)
- [ ] Reach out to Obsidian YouTubers (Nicole van der Hoeven, Danny Hatcher, etc.)

### 3.2 Content Marketing
- [ ] Write a blog post on getspace.app about the integration
- [ ] Create a YouTube tutorial (5-10 min) showing full workflow
- [ ] Post on Twitter/X with demo GIF, tag @obaborin (Obsidian creator)

### 3.3 Cross-Promotion
- [ ] Add prominent link in Space app settings: "Import from Obsidian"
- [ ] Add to Space website features page
- [ ] Consider Product Hunt launch (separate from Reddit timing)

### 3.4 SEO/Discoverability
- [ ] Ensure README has keywords: "obsidian flashcards", "spaced repetition obsidian", "anki alternative"
- [ ] Add to awesome-obsidian list on GitHub

---

## Phase 4: Metrics to Track

- GitHub stars/forks
- Plugin download count (once in Community Plugins)
- Space app signups with Obsidian referral
- Reddit post upvotes/engagement
- Discord mentions

---

## Recommended Launch Timeline

| Day | Action |
|-----|--------|
| **Now** | Commit pending code changes, create GitHub release |
| **Now** | Submit PR to obsidian-releases repo for Community Plugins |
| **Week 1** | Create demo GIF (15-30 sec showing write → sync → Space app) |
| **Week 1** | Draft Reddit post, prepare all links |
| **Week 1-2** | Wait for Community Plugins approval |
| **Approval Day** | Update README to remove "coming soon" |
| **Post Day (Tue-Thu 10 AM EST)** | Post to r/ObsidianMD |
| **Post Day** | Engage heavily with comments (first 2 hours critical) |
| **Post Day +1** | Post to Obsidian Discord #plugins-showcase |
| **Post Day +3** | Cross-post to r/Anki if doing well |

---

## Immediate Action Items

1. **Commit code**: `git add . && git commit -m "Add deck tracking in sync comments"`
2. **Create release**: Tag v0.1.0 on GitHub with changelog
3. **Submit to Community Plugins**: Fork obsidian-releases, add to community-plugins.json
4. **Create GIF**: Record screen showing full workflow (Obsidian → sync → Space mobile app)
5. **Draft post**: Use template above, refine based on what resonates
