// Checkout summaries already add tax, so their subtotal/tax/total lines must
// not be taxed again (#15), while ordinary item prices still are.
const { sleep, loadPage } = require('./helpers');

let failures = 0;
const assertEq = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const clean = s => s.replace(/\s+/g, ' ').trim();

// One "Label: $amount" line of Amazon's order summary
const amazonLine = (label, amount) => `
    <li class="a-spacing-mini"><span class="a-list-item"><div class="order-summary-grid">
        <div class="order-summary-line-term"><span class="break-word">${label}</span></div>
        <div class="order-summary-line-definition"><span class="aok-nowrap a-nowrap"><span>${amount}</span></span></div>
    </div></span></li>`;

async function run() {
    // 1. Amazon.ca checkout (trimmed from a real page): line item with a split
    // price (#18), the summary card, and the repeated total by the button
    const amazonHtml = `<!doctype html><html><body>
        <div id="item">
            <span class="a-text-bold">Under Armour Men's Tech 2.0 1/2 Zip-Up Long Sleeve T-Shirt</span>
            <span class="a-price"><span class="a-offscreen" id="item-offscreen">$63.90</span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole" id="item-whole">63<span class="a-price-decimal">.</span></span><span class="a-price-fraction" id="item-fraction">90</span></span></span>
            <div class="a-row"><a class="a-link-normal">Choose 3 monthly payments of <span>$21.30</span></a></div>
        </div>
        <div id="subtotals">
            <span>Place your order</span>
            <span>By placing your order, you agree to Amazon's privacy notice and conditions of use.</span>
            <ul id="subtotals-marketplace-table">
                ${amazonLine('Items:', '$63.90')}
                ${amazonLine('Shipping &amp; Handling:', '$0.00')}
                ${amazonLine('Estimated GST/HST:', '$8.31')}
                ${amazonLine('Estimated PST/RST/QST:', '$0.00')}
                ${amazonLine('Order Total:', '$72.21')}
            </ul>
        </div>
        <div id="checkout-pyo-button-block">
            <span>Place your order</span>
            <ul id="bottom-total"><li><span class="a-list-item"><div class="grand-total-cell">
                <span class="break-word">Order Total:</span> <span>$72.21</span>
            </div></span></li></ul>
            <span>By placing your order, you agree to Amazon's privacy notice and conditions of use.</span>
        </div>
    </body></html>`;

    const amazon = loadPage(amazonHtml, 'https://www.amazon.ca/checkout/p/p-123/spc');
    await sleep(150);
    const a$ = sel => amazon.window.document.querySelector(sel);
    assertEq(clean(a$('#subtotals-marketplace-table').textContent),
        'Items: $63.90 Shipping & Handling: $0.00 Estimated GST/HST: $8.31 Estimated PST/RST/QST: $0.00 Order Total: $72.21',
        'amazon summary left untouched');
    assertEq(clean(a$('#bottom-total').textContent), 'Order Total: $72.21', 'amazon total beside button left untouched');
    // 63.90 * 1.13 = 72.207 -> 72.21
    assertEq(a$('#item-offscreen').textContent, '$72.21', 'amazon line item still taxed');
    assertEq(a$('#item-whole').firstChild.nodeValue, '72', 'amazon split whole still taxed (#18)');
    assertEq(a$('#item-fraction').textContent, '21', 'amazon split fraction still taxed (#18)');

    // 2. Decathlon.ca checkout: "Total taxes" is the tax line, and the total
    // says "(taxes included)" itself
    const decathlonHtml = `<!doctype html><html><body>
        <div class="cart-item"><span class="name">Kids' Hiking Socks</span><span id="dec-item">CA $15.98</span></div>
        <div id="dec-summary">
            <div class="row"><span>Subtotal</span><span>1 item</span><span>CA $15.98</span></div>
            <div class="row"><div><span>Delivery</span><span>Shipped by Decathlon</span></div><span>CA $19.98</span></div>
            <div class="row"><span>Taxes</span><div><span>Total taxes</span><span>CA $4.68</span></div></div>
            <div class="row total"><span>Total (taxes included)</span><span>CA $40.64</span></div>
        </div>
    </body></html>`;

    const decathlon = loadPage(decathlonHtml, 'https://www.decathlon.ca/en/checkout');
    await sleep(150);
    const d$ = sel => decathlon.window.document.querySelector(sel);
    const decAmounts = [...d$('#dec-summary').querySelectorAll('span')]
        .map(s => s.textContent).filter(t => t.includes('$'));
    assertEq(decAmounts.join(' | '), 'CA $15.98 | CA $19.98 | CA $4.68 | CA $40.64', 'decathlon summary left untouched');
    // 15.98 * 1.13 = 18.0574 -> 18.06
    assertEq(d$('#dec-item').textContent, 'CA $18.06', 'decathlon cart item still taxed');

    // 3. Cart page where tax is not known yet: the total is pre-tax, so it is taxed
    const cartHtml = `<!doctype html><html><body>
        <div id="cart-summary">
            <div><span>Estimated total</span><span id="cart-total">$59.00 CAD</span></div>
            <p>Taxes, discounts and shipping calculated at checkout.</p>
        </div>
    </body></html>`;

    const cart = loadPage(cartHtml, 'https://shop.example.com/cart');
    await sleep(150);
    assertEq(cart.window.document.querySelector('#cart-total').textContent, '$66.67 CAD', 'pre-tax cart total still taxed');

    // 4. Product prices labelled as already including tax are left alone,
    // without affecting other prices on the page
    const productHtml = `<!doctype html><html><body>
        <div class="product"><span id="vat-price">€19.99</span> <small>incl. VAT</small></div>
        <div class="product"><span id="incl-price">CA$29.99</span><span>Taxes included</span></div>
        <div class="product"><span id="plain-price">$10.00</span></div>
    </body></html>`;

    const product = loadPage(productHtml, 'https://shop.example.com/products');
    await sleep(150);
    const p$ = sel => product.window.document.querySelector(sel);
    assertEq(p$('#vat-price').textContent, '€19.99', '"incl. VAT" price left untouched');
    assertEq(p$('#incl-price').textContent, 'CA$29.99', '"Taxes included" price left untouched');
    assertEq(p$('#plain-price').textContent, '$11.30', 'unlabelled price still taxed');

    // 5. Summary rendered after the page loaded (Amazon fills it in with
    // AJAX): an Order Total taxed before then is put back once the tax shows up
    const lateHtml = `<!doctype html><html><body>
        <div id="late-bottom"><span>Order Total:</span> <span id="late-bottom-amount">$72.21</span></div>
        <div id="late-card"></div>
    </body></html>`;

    const late = loadPage(lateHtml, 'https://www.amazon.ca/checkout/p/p-456/spc');
    await sleep(150);
    const l$ = sel => late.window.document.querySelector(sel);
    assertEq(l$('#late-bottom-amount').textContent, '$81.60', 'lone total taxed before summary exists');
    l$('#late-card').innerHTML = `<ul>${amazonLine('Items:', '$63.90')}${amazonLine('Estimated GST/HST:', '$8.31')}${amazonLine('Order Total:', '$72.21')}</ul>`;
    await sleep(700); // MutationObserver debounce is 500ms
    assertEq(clean(l$('#late-card').textContent), 'Items: $63.90 Estimated GST/HST: $8.31 Order Total: $72.21', 'late summary left untouched');
    assertEq(l$('#late-bottom-amount').textContent, '$72.21', 'earlier-taxed total restored once summary appears');

    // Toggling off and on keeps the summary and total correct
    await late.window.chrome.storage.local.set({ taxOn: false });
    await sleep(100);
    await late.window.chrome.storage.local.set({ taxOn: true });
    await sleep(100);
    assertEq(l$('#late-bottom-amount').textContent, '$72.21', 'total still untouched after toggle off and on');

    console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
