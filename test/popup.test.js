// The popup: rates shown as percentages, and typed rates saved once typing pauses
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { sleep, makeChromeStub } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const popupHtml = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
const utilsCode = fs.readFileSync(path.join(ROOT, 'scripts/utils.js'), 'utf8');
const popupCode = fs.readFileSync(path.join(ROOT, 'popup/popup.js'), 'utf8');

let failures = 0;
const assertEq = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// Opens the popup on a tab showing tabUrl, with the given synced settings
const openPopup = async (syncStore, tabUrl = 'https://shop.example/') => {
    const dom = new JSDOM(popupHtml, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.chrome = {
        ...makeChromeStub(syncStore),
        commands: { getAll: async () => [{ name: 'toggle-tax', shortcut: 'Ctrl+Shift+F' }] },
        tabs: { query: async () => [{ url: tabUrl }], create: () => {} },
    };
    window.eval(utilsCode + '\n' + popupCode);
    await sleep(50);
    return window;
};

const typeInto = (window, input, value) => {
    input.value = value;
    input.dispatchEvent(new window.Event('input'));
};

async function run() {
    // 1. Rates are shown as percentages and the total adds them up
    const syncStore = { taxRates: { GST: 5, PST: 7 } };
    const popup = await openPopup(syncStore);
    const $ = sel => popup.document.querySelector(sel);
    const $$ = sel => [...popup.document.querySelectorAll(sel)];
    assertEq($$('#rate-list .rate').map(el => el.textContent).join(' '), '5% 7%', 'rates shown as percentages');
    assertEq($('#total-rate').textContent, 'Total tax: 12%', 'total adds the rates');

    // 2. Typing updates the total right away but saves once typing pauses
    const pstInput = $$('#rate-list .rate-input')[1];
    typeInto(popup, pstInput, '7.5');
    typeInto(popup, pstInput, '7.25');
    assertEq($('#total-rate').textContent, 'Total tax: 12.25%', 'total updates while typing');
    assertEq(syncStore.taxRates.PST, 7, 'not saved mid-typing');
    await sleep(400);
    assertEq(syncStore.taxRates.PST, 7.25, 'saved once typing pauses');

    // 3. Leaving the field saves straight away
    typeInto(popup, pstInput, '8');
    pstInput.dispatchEvent(new popup.Event('blur'));
    await sleep(10);
    assertEq(syncStore.taxRates.PST, 8, 'saved on blur without waiting');

    // 4. Multipliers saved by an older version are shown as percentages
    const legacy = await openPopup({ rates: { HST: 1.13 } });
    assertEq(legacy.document.querySelector('#rate-list .rate').textContent, '13%', 'legacy multiplier shown as a percentage');

    console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
