const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const utilsCode = fs.readFileSync(path.join(ROOT, 'scripts/utils.js'), 'utf8');
const repriceCode = fs.readFileSync(path.join(ROOT, 'scripts/reprice.js'), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Minimal chrome.storage stub with onChanged propagation
const makeChromeStub = (syncStore = { rates: { Tax: 1.13 } }) => {
    const localStore = {};
    const listeners = [];

    const pick = (store, keys) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in store) out[k] = store[k]; });
        return out;
    };

    const makeArea = (store, areaName) => ({
        get: (keys) => Promise.resolve(pick(store, keys)),
        set: (obj) => {
            const changes = {};
            for (const [k, v] of Object.entries(obj)) {
                changes[k] = { oldValue: store[k], newValue: v };
                store[k] = v;
            }
            setTimeout(() => listeners.forEach(fn => fn(changes, areaName)), 0);
            return Promise.resolve();
        }
    });

    return {
        storage: {
            local: makeArea(localStore, 'local'),
            sync: makeArea(syncStore, 'sync'),
            onChanged: { addListener: fn => listeners.push(fn) }
        }
    };
};

// Loads a page, runs the extension, and returns the live window plus the
// body HTML as it stood before the extension touched it.
const loadPage = (html, url = 'https://example.com/', syncStore) => {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    const before = window.document.body.innerHTML;
    window.chrome = makeChromeStub(syncStore);
    // Same as the browser does via manifest content_scripts
    window.eval(utilsCode + '\n' + repriceCode);
    return { window, before };
};

module.exports = { sleep, makeChromeStub, loadPage, utilsCode };
