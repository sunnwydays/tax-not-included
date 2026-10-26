// Pages with no prices (chat UIs, search results) must be left byte-identical:
// no retaxed numbers, no data-original-html markers, nothing.
const { sleep, loadPage } = require('./helpers');

let failures = 0;
const assertEq = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

async function run() {
    // 1. Claude-style chat page: numbers, token counts, timestamps split
    // across spans, and code blocks with shell "$" — but zero prices.
    const claudeHtml = `<!doctype html><html><body>
        <div id="app">
            <div class="sidebar">
                <p>You have hit the message limit.</p>
                <span>59</span>
            </div>
            <div class="chat">
                <p>Claude 3.5 Sonnet · 128,000 token context window</p>
                <div class="message"><p>Here are 3 examples. The diff has 142 insertions and 87 deletions.</p></div>
                <pre><code>$ npm install jsdom@24
awk '{ print $1 }' data.txt</code></pre>
                <span class="usage">12,847 tokens</span>
            </div>
        </div>
    </body></html>`;

    const claude = loadPage(claudeHtml, 'https://claude.ai/chat/abc123');
    await sleep(250);
    assertEq(claude.window.document.body.innerHTML, claude.before, 'claude-style page untouched on load');

    // New assistant message streams in (SPA mutation); still no prices,
    // so the added content and the rest of the page must stay untouched.
    const chat = claude.window.document.querySelector('.chat');
    const msg = claude.window.document.createElement('div');
    msg.className = 'message';
    msg.innerHTML = '<p>Processed 4,096 tokens with a latency of 0.42 s.</p><span>57</span>';
    chat.appendChild(msg);
    const expectedAfterAppend = claude.window.document.body.innerHTML;
    await sleep(700); // MutationObserver debounce is 500ms
    assertEq(claude.window.document.body.innerHTML, expectedAfterAppend, 'claude-style page untouched after new message streams in');

    // 2. ChatGPT-style page: ordered steps, versions, code with $VAR.
    const chatgptHtml = `<!doctype html><html><body>
        <main>
            <h1>ChatGPT 4o</h1>
            <div class="conversation">
                <p>Updated on June 12, 2026. Model temperature is 0.7 by default.</p>
                <ol><li>1. Install Node 22</li><li>2. Run the dev server on port 3000</li></ol>
                <pre><code>export PATH=$HOME/bin:$PATH
echo $1 $2</code></pre>
            </div>
            <span class="quota">25 of 40 messages used</span>
        </main>
    </body></html>`;

    const chatgpt = loadPage(chatgptHtml, 'https://chatgpt.com/c/xyz789');
    await sleep(250);
    assertEq(chatgpt.window.document.body.innerHTML, chatgpt.before, 'chatgpt-style page untouched on load');

    // 3. Google-search-style page: result stats with a bare decimal,
    // ratings, review counts, dates, phone numbers — no currency anywhere.
    const googleHtml = `<!doctype html><html><body>
        <div id="search">
            <div id="result-stats">About 1,234,567 results (0.42 seconds)</div>
            <div class="result">
                <span class="title">Best water bottles of 2026</span>
                <span class="meta">Jun 12, 2026 — 4.5 rating · 2,103 reviews</span>
            </div>
            <div class="result">
                <span class="title">Hardware store near me</span>
                <span class="meta">1600 Main St W · (416) 555-0192 · Open until 21:00</span>
            </div>
        </div>
    </body></html>`;

    const google = loadPage(googleHtml, 'https://www.google.com/search?q=water+bottle');
    await sleep(250);
    assertEq(google.window.document.body.innerHTML, google.before, 'google-search-style page untouched on load');
    assertEq(google.window.document.querySelector('#result-stats').textContent,
        'About 1,234,567 results (0.42 seconds)', 'result stats line keeps its original numbers');

    console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
