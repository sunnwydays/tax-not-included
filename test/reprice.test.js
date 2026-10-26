const { sleep, loadPage } = require('./helpers');

let failures = 0;
const assertEq = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

async function run() {
    // A simple product page with one inline price and one split price
    // ($15 | . | 99 in separate spans, as seen on many retail sites)
    const html = `<!doctype html><html><body>
        <div id="product"><span id="price">$10.00</span></div>
        <div id="sep"><span>$</span><span id="sw">15</span><span>.</span><span id="sf">99</span></div>
        <div id="euro-whole">1.234 EUR</div>
        <div id="euro-full">$1.234,56</div>
        <div id="us-thousands">$1,234</div>
        <div id="half-cent">$10.50</div>
        <div><span id="own-title" title="Sale price">$5.00</span></div>
    </body></html>`;

    const { window } = loadPage(html);
    const chrome = window.chrome;
    await sleep(100); // applyRates is async; let it settle

    const $ = sel => window.document.querySelector(sel);

    // 1. Basic taxing on load (rate 1.13)
    assertEq($('#price').textContent, '$11.30', 'initial price taxed');
    // 15.99 * 1.13 = 18.0687 -> 18.07
    assertEq($('#sw').textContent, '18', 'split whole taxed');
    assertEq($('#sf').textContent, '07', 'split fraction taxed');

    // 1b. Dot-as-thousands-separator amounts must not be misread as decimals
    // (1.234 EUR is 1234, not 1.234; regression for a 1000x-too-small bug)
    assertEq($('#euro-whole').textContent, '1.394,42 EUR', 'euro whole-number thousands sep taxed');
    assertEq($('#euro-full').textContent, '$1.395,05', 'euro full-format (dot thousands, comma decimal) taxed');
    assertEq($('#us-thousands').textContent, '$1,394.42', 'US comma-thousands taxed');

    // 1c. A half cent rounds up even when float maths lands just under it
    // (10.50 * 1.13 is 11.864999... in floating point, not 11.865)
    assertEq($('#half-cent').textContent, '$11.87', 'half cent rounds up');

    // 1d. Hovering a taxed price shows what it was before tax
    assertEq($('#price').title, 'Before tax: $10.00', 'tooltip shows the original price');
    assertEq($('#sep').title, 'Before tax: $15.99', 'split price tooltip on the element holding every piece');
    assertEq($('#own-title').title, 'Sale price', "site's own tooltip left alone");

    // 2. Toggle off restores original prices
    await chrome.storage.local.set({ taxOn: false });
    await sleep(100);
    assertEq($('#price').textContent, '$10.00', 'price restored after toggle off');
    assertEq($('#sw').textContent, '15', 'split whole restored');
    assertEq($('#sf').textContent, '99', 'split fraction restored');
    assertEq($('#price').hasAttribute('title') || $('#sep').hasAttribute('title'), false, 'tooltips removed after toggle off');
    assertEq($('#own-title').title, 'Sale price', "site's own tooltip kept after toggle off");

    // 3. Toggle on re-taxes
    await chrome.storage.local.set({ taxOn: true });
    await sleep(100);
    assertEq($('#price').textContent, '$11.30', 'price re-taxed after toggle on');

    // 4. Site replaces the element's HTML (colour/style swap) while the extension is on
    const product = $('#product');
    product.innerHTML = '<span id="price2">$20.00</span>';
    await sleep(700); // MutationObserver debounce is 500ms
    assertEq($('#price2').textContent, '$22.60', 'swapped-in variant price taxed');

    // 5. Toggle off must restore the *new* variant's price, not the old markup (#32)
    await chrome.storage.local.set({ taxOn: false });
    await sleep(100);
    assertEq(product.textContent.trim(), '$20.00', '#32: no revert to old variant on toggle off');
    await chrome.storage.local.set({ taxOn: true });
    await sleep(100);
    assertEq($('#price2').textContent, '$22.60', 'variant price taxed again after toggle on');

    // 6. In-place text-node update (React / SPA price change without element swap)
    const textNode = $('#price2').firstChild;
    textNode.nodeValue = '$30.00';
    await sleep(700);
    assertEq($('#price2').textContent, '$33.90', 'in-place price update re-taxed');
    await chrome.storage.local.set({ taxOn: false });
    await sleep(100);
    assertEq($('#price2').textContent, '$30.00', 'in-place update restores to newest original');
    await chrome.storage.local.set({ taxOn: true });
    await sleep(100);
    assertEq($('#price2').textContent, '$33.90', 'taxed again before site-disable test');

    // 7. Per-site disable (#30)
    await chrome.storage.sync.set({ disabledSites: ['example.com'] });
    await sleep(100);
    assertEq($('#price2').textContent, '$30.00', '#30: disabled site shows original');
    assertEq($('#sw').textContent, '15', '#30: split whole restored on disabled site');
    await chrome.storage.sync.set({ disabledSites: [] });
    await sleep(100);
    assertEq($('#price2').textContent, '$33.90', '#30: re-enabled site taxed again');

    // 8. Fresh install: no rates saved yet, so the popup's default applies
    const fresh = loadPage('<!doctype html><html><body><span id="p">$10.00</span></body></html>', 'https://example.com/', {});
    await sleep(100);
    assertEq(fresh.window.document.querySelector('#p').textContent, '$11.30', 'default rate applied before any rates are saved');

    // 9. Stacked taxes add up (5% GST + 7% PST is 12%), they don't compound to 12.35%
    const stacked = loadPage('<!doctype html><html><body><span id="p">$10.00</span></body></html>', 'https://example.com/', {
        taxRates: { GST: 5, PST: 7 }
    });
    await sleep(100);
    assertEq(stacked.window.document.querySelector('#p').textContent, '$11.20', 'stacked rates are added');

    // 10. Multipliers saved by an older version are converted to percentages
    const legacy = loadPage('<!doctype html><html><body><span id="p">$10.00</span></body></html>', 'https://example.com/', {
        rates: { GST: 1.05, PST: 1.07 }
    });
    await sleep(100);
    assertEq(legacy.window.document.querySelector('#p').textContent, '$11.20', 'legacy multipliers read as percentages and added');

    console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
