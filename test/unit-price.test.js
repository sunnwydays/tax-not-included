// Grocery store sites show the after-tax price per unit next to products
// whose title gives a quantity (#14).
const vm = require('vm');
const { sleep, loadPage, utilsCode } = require('./helpers');

let failures = 0;
const assertEq = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// Quantity parsing and formatting are pure, so they run without a page
const utils = vm.runInNewContext(`${utilsCode}\n({ parseQuantity, formatUnitPrice, parsePriceText, hasUnitPrice })`);
const quantity = text => {
    const q = utils.parseQuantity(text);
    return q && `${+q.amount.toFixed(6)} ${q.unit}`;
};

const GROCER = 'https://grocer.example/';
const grocerStore = (extra = {}) => ({ rates: { Tax: 1.13 }, grocerySites: ['grocer.example'], ...extra });
const card = (title, price) => `<!doctype html><html><body><div class="card"><h3>${title}</h3>${price}</div></body></html>`;
const unitSpans = page => [...page.window.document.querySelectorAll('[data-tni-unit-price]')];
const unitText = page => unitSpans(page).map(s => s.textContent).join('|');
const priceOf = page => page.window.document.querySelector('.price').textContent;

async function run() {
    // Quantity parsing
    assertEq(quantity('Cheerios 435 g'), '435 g', 'quantity: grams');
    assertEq(quantity('Rice 2 kg'), '2000 g', 'quantity: kg becomes g');
    assertEq(quantity('Spice 500 mg'), '0.5 g', 'quantity: mg becomes g');
    assertEq(quantity('Cola 355 mL'), '355 mL', 'quantity: mL');
    assertEq(quantity('Milk 2 L'), '2000 mL', 'quantity: L becomes mL');
    assertEq(quantity('Juice 33 cl'), '330 mL', 'quantity: cl becomes mL');
    assertEq(quantity('Beef 1.5 lb'), '1.5 lb', 'quantity: lb');
    assertEq(quantity('Beef 2 lbs'), '2 lb', 'quantity: lbs');
    assertEq(quantity('Chips 8 oz'), '8 oz', 'quantity: oz');
    assertEq(quantity('Soda 12 fl oz'), '12 fl oz', 'quantity: fl oz');
    assertEq(quantity('Lait 1,5 L'), '1500 mL', 'quantity: comma decimal');
    assertEq(quantity('Cola 6 x 355 mL'), '2130 mL', 'quantity: multipack with x');
    assertEq(quantity('Bars 12 × 30 g'), '360 g', 'quantity: multipack with ×');
    assertEq(quantity('Eggs 24 ct'), '24 ea', 'quantity: ct');
    assertEq(quantity('Water 12 pack'), '12 ea', 'quantity: pack');
    assertEq(quantity('12 large eggs'), null, 'quantity: "l" inside a word is not litres');
    assertEq(quantity('Brand 2000 Cereal'), null, 'quantity: bare number is not a quantity');

    const fmt = (priceText, title) =>
        utils.formatUnitPrice(utils.parsePriceText(priceText), utils.parseQuantity(title));
    assertEq(fmt('$5.49', '435 g'), '$1.26/100 g', 'format: per 100 g');
    assertEq(fmt('$3.00', '2 L'), '$0.15/100 mL', 'format: per 100 mL');
    assertEq(fmt('$10.00', '2 lb'), '$5.00/lb', 'format: per lb');
    assertEq(fmt('$4.00', '8 oz'), '$0.50/oz', 'format: per oz');
    assertEq(fmt('$6.00', '12 ct'), '$0.50/ea', 'format: per item');
    assertEq(fmt('5,49 €', '435 g'), '1,26 €/100 g', 'format: keeps comma separator and trailing symbol');
    assertEq(utils.hasUnitPrice('$1.26/100 g'), true, 'unit price detected: /100 g');
    assertEq(utils.hasUnitPrice('$2.99 / lb'), true, 'unit price detected: / lb');
    assertEq(utils.hasUnitPrice('$4 per kg'), true, 'unit price detected: per kg');
    assertEq(utils.hasUnitPrice('Cheerios 435 g $5.49'), false, 'no unit price in a plain card');

    // 1. A grocery card gets the after-tax unit price (exempt, so rate x1)
    const exempt = loadPage(card('Cheerios 435 g', '<span class="price">$5.49</span>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitText(exempt), '($1.26/100 g)', 'exempt grocery card gets a unit price');
    assertEq(priceOf(exempt), '$5.49', 'exempt price itself is untouched');
    assertEq(exempt.window.document.querySelector('.price').nextElementSibling, unitSpans(exempt)[0],
        'span sits right after the price element');

    // 2. With a grocery rate the unit price uses the after-tax value
    const taxed = loadPage(card('Cheerios 435 g', '<span class="price">$5.49</span>'), GROCER, grocerStore({ groceryRate: 1.05 }));
    await sleep(150);
    assertEq(priceOf(taxed), '$5.76', 'price is taxed with groceryRate');
    assertEq(unitText(taxed), '($1.33/100 g)', 'unit price is after tax (5.49 x 1.05 / 435 x 100)');

    // 3. A non-grocery page gets none
    const other = loadPage(card('Cheerios 435 g', '<span class="price">$5.49</span>'), 'https://shop.example/', grocerStore());
    await sleep(150);
    assertEq(unitSpans(other).length, 0, 'non-grocery page gets no unit price');
    assertEq(priceOf(other), '$6.20', 'non-grocery page is still taxed');

    // 4. A card that already shows a unit price is skipped
    const hasUnit = loadPage(card('Cheerios 435 g', '<span class="price">$5.49</span> <small>$1.26/100 g</small>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitSpans(hasUnit).length, 0, 'card with its own unit price is skipped');
    const hasPerKg = loadPage(card('Rice 2 kg', '<span class="price">$9.99</span> <small>$5.00 per kg</small>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitSpans(hasPerKg).length, 0, 'card with a "per kg" unit price is skipped');

    // 5. Sale + was price uses the sale price
    const sale = loadPage(card('Cheerios 435 g', '<s>$7.99</s> <span class="price">$5.49</span>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitText(sale), '($1.26/100 g)', 'sale card uses the sale price, not the was price');

    // 6. More than one current price in the card gives up
    const twoPrices = loadPage(card('Cheerios 435 g', '<span class="price">$5.49</span> or 2 for <span>$10.00</span>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitSpans(twoPrices).length, 0, 'card with two current prices is skipped');

    // 7. A list of products does not pair a price with a neighbour's quantity
    const list = loadPage(`<!doctype html><html><body><ul>
        <li><b>Cheerios 435 g</b> <span>$5.49</span></li>
        <li><b>Gift card</b> <span>$25.00</span></li>
    </ul></body></html>`, GROCER, grocerStore());
    await sleep(150);
    assertEq(unitText(list), '($1.26/100 g)', 'only the product with a quantity gets a unit price');

    // 8. Split prices are skipped on purpose
    const splitSymbol = loadPage(card('Cheese 200 g', '<span class="price"><span>$</span><span>3</span><sup>97</sup></span>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitSpans(splitSymbol).length, 0, 'split price ($ | 3 | 97) gets no unit price');
    const splitCents = loadPage(card('Cheese 200 g', '<span class="price">$3<sup>97</sup></span>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitSpans(splitCents).length, 0, 'split price ($3 | 97) gets no unit price');

    // 9. Comma decimal sites keep their separator and symbol placement
    const euro = loadPage(card('Lait 1,5 L', '<span class="price">3,00 €</span>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitText(euro), '(0,20 €/100 mL)', 'comma decimal and trailing symbol are kept');

    // 10. Multipack
    const multi = loadPage(card('Cola 6 x 355 mL', '<span class="price">$4.26</span>'), GROCER, grocerStore());
    await sleep(150);
    assertEq(unitText(multi), '($0.20/100 mL)', 'multipack quantities are multiplied');

    // 11. Turning the extension off removes the spans and restores the HTML
    const syncStore = grocerStore({ groceryRate: 1.05 });
    const live = loadPage(card('Cheerios 435 g', '<span class="price">$5.49</span>'), GROCER, syncStore);
    await sleep(150);
    assertEq(unitSpans(live).length, 1, 'unit price shown before toggling off');
    await live.window.chrome.storage.local.set({ taxOn: false });
    await sleep(150);
    assertEq(unitSpans(live).length, 0, 'taxOn off removes the unit price');
    assertEq(live.window.document.body.innerHTML, live.before, 'taxOn off restores the HTML exactly');

    await live.window.chrome.storage.local.set({ taxOn: true });
    await sleep(150);
    assertEq(unitText(live), '($1.33/100 g)', 'taxOn back on shows the unit price again');

    // 12. Changing the rate leaves one span with the new value
    await live.window.chrome.storage.sync.set({ groceryRate: 1.13 });
    await sleep(150);
    assertEq(unitSpans(live).length, 1, 'rate change leaves a single span');
    assertEq(unitText(live), '($1.43/100 g)', 'rate change updates the unit price');

    // 13. Un-marking the site removes the spans
    await live.window.chrome.storage.sync.set({ grocerySites: [] });
    await sleep(150);
    assertEq(unitSpans(live).length, 0, 'unmarking the site removes the unit price');
    assertEq(priceOf(live), '$6.20', 'unmarked site is taxed with the combined rate');

    // 14. Disabling the site also removes them
    const disabled = loadPage(card('Cheerios 435 g', '<span class="price">$5.49</span>'), GROCER, grocerStore());
    await sleep(150);
    await disabled.window.chrome.storage.sync.set({ disabledSites: ['grocer.example'] });
    await sleep(150);
    assertEq(unitSpans(disabled).length, 0, 'disabling the site removes the unit price');
    assertEq(disabled.window.document.body.innerHTML, disabled.before, 'disabling the site restores the HTML exactly');

    // 15. Products added later (lazy-loaded grids) get unit prices
    const lazy = loadPage('<!doctype html><html><body><div id="grid"></div></body></html>', GROCER, grocerStore({ groceryRate: 1.05 }));
    await sleep(150);
    lazy.window.document.getElementById('grid').innerHTML =
        '<div class="card"><h3>Cheerios 435 g</h3><span class="price">$5.49</span></div>';
    await sleep(900);
    assertEq(unitText(lazy), '($1.33/100 g)', 'lazily added product gets a unit price');
    assertEq(priceOf(lazy), '$5.76', 'lazily added price is taxed once');

    // 16. Prices are never taxed twice because of the injected span, even
    // when the site changes the card later
    lazy.window.document.querySelector('.card h3').firstChild.nodeValue = 'Cheerios 500 g';
    await sleep(900);
    assertEq(priceOf(lazy), '$5.76', 'price not taxed twice after the card changes');
    assertEq(unitText(lazy), '($1.15/100 g)', 'unit price updates for the new quantity and is not taxed');
    assertEq(unitSpans(lazy).length, 1, 'still a single span');
    lazy.window.document.querySelector('.price').firstChild.nodeValue = '$10.00';
    await sleep(900);
    assertEq(priceOf(lazy), '$10.50', 'site price change is taxed once');
    assertEq(unitText(lazy), '($2.10/100 g)', 'unit price follows the new price');

    console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
