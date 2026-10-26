// Sites marked as grocery stores use their own rate (default 0%, exempt)
// instead of the combined rate.
const { sleep, loadPage } = require('./helpers');

let failures = 0;
const assertEq = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const html = '<!doctype html><html><body><p id="price">$100.00</p></body></html>';
const priceOf = page => page.window.document.querySelector('#price').textContent;

async function run() {
    // 1. Grocery site with the default rate (0%) is left untouched
    const exempt = loadPage(html, 'https://grocer.example/', {
        taxRates: { Tax: 13 }, grocerySites: ['grocer.example']
    });
    await sleep(150);
    assertEq(priceOf(exempt), '$100.00', 'grocery site with default rate left untouched');

    // 2. An explicit grocery rate of 0% is also left untouched
    const exemptExplicit = loadPage(html, 'https://grocer.example/', {
        taxRates: { Tax: 13 }, grocerySites: ['grocer.example'], groceryTaxRate: 0
    });
    await sleep(150);
    assertEq(priceOf(exemptExplicit), '$100.00', 'grocery site with groceryTaxRate 0 left untouched');

    // 3. A reduced grocery rate is used instead of the combined rate
    const reduced = loadPage(html, 'https://grocer.example/', {
        taxRates: { Tax: 13 }, grocerySites: ['grocer.example'], groceryTaxRate: 5
    });
    await sleep(150);
    assertEq(priceOf(reduced), '$105.00', 'grocery site uses groceryTaxRate 5, not the combined rate');

    // 4. A site that is not marked still uses the combined rate
    const other = loadPage(html, 'https://shop.example/', {
        taxRates: { Tax: 13 }, grocerySites: ['grocer.example'], groceryTaxRate: 5
    });
    await sleep(150);
    assertEq(priceOf(other), '$113.00', 'non-grocery site still uses the combined rate');

    // 5. Marking a site at runtime re-applies the rates, and unmarking restores them
    const syncStore = { taxRates: { Tax: 13 } };
    const live = loadPage(html, 'https://grocer.example/', syncStore);
    await sleep(150);
    assertEq(priceOf(live), '$113.00', 'unmarked site taxed before the toggle');

    await live.window.chrome.storage.sync.set({ grocerySites: ['grocer.example'] });
    await sleep(150);
    assertEq(priceOf(live), '$100.00', 'marking the site as grocery restores the original price');

    await live.window.chrome.storage.sync.set({ groceryTaxRate: 5 });
    await sleep(150);
    assertEq(priceOf(live), '$105.00', 'changing groceryTaxRate re-applies the rates');

    await live.window.chrome.storage.sync.set({ grocerySites: [] });
    await sleep(150);
    assertEq(priceOf(live), '$113.00', 'unmarking the site goes back to the combined rate');

    // 6. A grocery multiplier saved by an older version is read as a percentage
    const legacy = loadPage(html, 'https://grocer.example/', {
        taxRates: { Tax: 13 }, grocerySites: ['grocer.example'], groceryRate: 1.05
    });
    await sleep(150);
    assertEq(priceOf(legacy), '$105.00', 'legacy groceryRate 1.05 read as 5%');

    console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
