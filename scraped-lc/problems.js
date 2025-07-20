/**
 * main.js
 * Node.js LeetCode DSA scraper (no CSRF/auth needed)
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const csv   = require('csv-writer').createObjectCsvWriter;

// ──────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────
const REST_URL     = 'https://leetcode.com/api/problems/all/';
const GRAPHQL_URL  = 'https://leetcode.com/graphql';
const OUTPUT_JSON  = 'leetcode_data_dsa.json';
const OUTPUT_CSV   = 'leetcode_data_dsa.csv';
const FAILED_LOG   = 'failed_slugs.txt';
const DELAY_MS     = 1000;    // 1s between requests
const LIMIT        = 1500;    // or e.g. 50 for quick test

// Minimal headers – public GraphQL queries
const HEADERS = {
  'Content-Type': 'application/json',
  'Referer':      'https://leetcode.com',
  'User-Agent':   'Mozilla/5.0 (compatible; Node.js scraper)'
};

// ──────────────────────────────────────────────────────────────────────────────
// 1) Get all problem slugs
// ──────────────────────────────────────────────────────────────────────────────
async function fetchAllSlugs() {
  const res = await axios.get(REST_URL, { headers: HEADERS });
  const pairs = res.data.stat_status_pairs;
  let slugs = pairs.map(p => p.stat.question__title_slug);
  if (LIMIT) slugs = slugs.slice(0, LIMIT);
  console.log(`🧮 Total slugs fetched: ${slugs.length}`);
  console.log(`🔎 First few slugs:  ${slugs.slice(0, 5).join(', ')}`);
  return slugs;
}

// ──────────────────────────────────────────────────────────────────────────────
// 2) Fetch one problem’s data via GraphQL
// ──────────────────────────────────────────────────────────────────────────────
async function fetchProblem(slug) {
  const query = `
    query getQuestion($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        content
        difficulty
        sampleTestCase
        codeSnippets { lang code }
        topicTags { name }
      }
    }
  `;
  const payload = { query, variables: { titleSlug: slug } };

  try {
    const res = await axios.post(GRAPHQL_URL, payload, { headers: HEADERS });
    const node = res.data?.data?.question;
    if (!node) return null;  // locked/contest-only

    const tags = (node.topicTags || []).map(t => t.name);

    // skip pure Database problems (Database only)
    if (tags.length === 1 && tags[0] === 'Database') {
      return null;
    }

    const html = node.content || '';
    if (!html.trim()) {
      // no real description
      return null;
    }

    return {
      slug,
      title:            node.title,
      difficulty:       node.difficulty,
      sampleTestCase:   node.sampleTestCase || '',
      tags,
      codeSnippets:     (node.codeSnippets || []).reduce((o, c) => {
                          o[c.lang] = c.code; return o;
                        }, {}),
      description_html: html
    };

  } catch (err) {
    console.error(`❌ Error fetching '${slug}':`, err.response?.status || err.message);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 3) Main crawl
// ──────────────────────────────────────────────────────────────────────────────
async function crawlAll() {
  const slugs = await fetchAllSlugs();
  const results = [];
  const failed = [];

  for (const slug of slugs) {
    const data = await fetchProblem(slug);
    if (data === false)      failed.push(slug);
    else if (data !== null)  results.push(data);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`✅ Scraped ${results.length} DSA problems; ${failed.length} failures.`);
  return { results, failed };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4) Save JSON & CSV
// ──────────────────────────────────────────────────────────────────────────────
function saveJSON(data) {
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Saved JSON to ${OUTPUT_JSON}`);
}

async function saveCSV(data) {
  const writer = csv({
    path: OUTPUT_CSV,
    header: [
      {id: 'slug',           title: 'slug'},
      {id: 'title',          title: 'title'},
      {id: 'difficulty',     title: 'difficulty'},
      {id: 'sampleTestCase', title: 'sample_test_case'},
      {id: 'tags',           title: 'tags'},
    ]
  });

  const records = data.map(d => ({
    slug:           d.slug,
    title:          d.title,
    difficulty:     d.difficulty,
    sampleTestCase: d.sampleTestCase.replace(/\n/g, '\\n'),
    tags:           d.tags.join(';')
  }));

  await writer.writeRecords(records);
  console.log(`✅ Saved CSV to   ${OUTPUT_CSV}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ──────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('🚀 Starting DSA scrape…');
    const { results, failed } = await crawlAll();

    if (results.length) {
      // Preview first 3
      console.log('\n--- Preview (first 3 DSA problems) ---');
      results.slice(0,3).forEach(it => {
        console.log(`\n${it.slug} — ${it.title} [${it.difficulty}]`);
        console.log(`Sample: ${it.sampleTestCase.split('\n')[0]}…`);
      });

      saveJSON(results);
      await saveCSV(results);
    } else {
      console.warn('⚠️  No DSA problems scraped.');
    }

    if (failed.length) {
      fs.writeFileSync(FAILED_LOG, failed.join('\n'), 'utf-8');
      console.warn(`⚠️  Logged ${failed.length} failures to ${FAILED_LOG}`);
    }
  } catch (err) {
    console.error('💥 Fatal error:', err);
  }
})();
