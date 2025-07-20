const axios = require('axios');
const fs = require('fs');
const path = require('path');
const GRAPHQL_URL = 'https://leetcode.com/graphql/';
const HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Referer: 'https://leetcode.com/discuss/',
};
// Query 1: Get all discussions by LeetCode account
const USER_DISCUSSIONS_QUERY = `
query getUserDiscussTopics($orderBy: ArticleOrderByEnum, $username: String!, $skip: Int, $first: Int) {
  ugcArticleUserDiscussionArticles(
    orderBy: $orderBy
    username: $username
    skip: $skip
    first: $first
  ) {
    pageInfo {
      hasNextPage
    }
    edges {
      node {
        topicId
        title
        slug
        createdAt
      }
    }
  }
}
`;
// Query 2: Fetch comments
const COMMENT_QUERY = `
query questionDiscussComments($topicId: Int!, $orderBy: String = "newest_to_oldest", $pageNo: Int = 1, $numPerPage: Int = 20) {
  topicComments(topicId: $topicId, orderBy: $orderBy, pageNo: $pageNo, numPerPage: $numPerPage) {
    data {
      post {
        id
        content
        creationDate
        author {
          username
        }
      }
    }
    totalNum
  }
}
`;
async function fetchLeetcodeDiscussions() {
    let skip = 0;
    const first = 30;
    let hasNextPage = true;
    const contests = [];
    while (hasNextPage) {
        const res = await axios.post(
            GRAPHQL_URL,
            {
                operationName: 'getUserDiscussTopics',
                query: USER_DISCUSSIONS_QUERY,
                variables: {
                    username: 'leetcode',
                    orderBy: 'MOST_RECENT',
                    skip,
                    first,
                },
            },
            { headers: HEADERS }
        );
        const articles =
            res.data?.data?.ugcArticleUserDiscussionArticles?.edges || [];
        for (const { node } of articles) {
            if (/^(weekly|biweekly)-contest-\d+/.test(node.slug)) {
                contests.push({
                    title: node.title,
                    slug: node.slug,
                    topicId: node.topicId,
                    createdAt: node.createdAt,
                });
            }
        }
        hasNextPage =
            res.data?.data?.ugcArticleUserDiscussionArticles?.pageInfo?.hasNextPage;
        skip += first;
        console.log(`:mag_right: Fetched ${contests.length} contest discussions so far...`);
    }
    return contests;
}
async function fetchAllComments(topicId, slug) {
    const comments = [];
    let page = 1;
    const numPerPage = 20;
    while (true) {
        const res = await axios.post(
            GRAPHQL_URL,
            {
                operationName: 'questionDiscussComments',
                query: COMMENT_QUERY,
                variables: { topicId, pageNo: page, numPerPage },
            },
            {
                headers: {
                    ...HEADERS,
                    Referer: `https://leetcode.com/discuss/${slug}`,
                },
            }
        );
        const pageData = res.data?.data?.topicComments?.data || [];
        for (const item of pageData) {
            comments.push({
                author: item.post?.author?.username || 'anonymous',
                content: item.post?.content,
                createdAt: item.post?.creationDate,
            });
        }
        if (pageData.length < numPerPage) break;
        page++;
    }
    return comments;
}
async function scrapeAllContests() {
    const contests = await fetchLeetcodeDiscussions();
    console.log(`:package: Total contest discussions to scrape: ${contests.length}`);
    for (const contest of contests) {
        console.log(`:inbox_tray: Scraping: ${contest.title}`);
        const comments = await fetchAllComments(contest.topicId, contest.slug);
        const output = {
            title: contest.title,
            slug: contest.slug,
            topicId: contest.topicId,
            createdAt: contest.createdAt,
            commentCount: comments.length,
            comments,
        };
        const filename = `${contest.slug}-comments.json`;
        fs.writeFileSync(
            path.join(process.cwd(), filename),
            JSON.stringify(output, null, 2)
        );
        console.log(`:white_check_mark: Saved ${comments.length} comments to ${filename}`);
        await new Promise((r) => setTimeout(r, 400)); // throttling
    }
}
scrapeAllContests();