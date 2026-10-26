/** Minimum and maximum number of rates allowed */
const MIN_RATES = 1;
const MAX_RATES = 15;

/** * @type {Object.<string, number>} 
 * @description Live dictionary of tax names and their corresponding multipliers.
 */
let rates = {};

/**
 * Returns a unique rate name by appending numbers to the provided name
 * @param {string} rateName Name of a rate
 * @returns {string} String to be used as a key for rates object
 */
const getUnusedName = (rateName) => {
    let finalName = rateName.trim();
    
    if (rates[finalName] !== undefined) {
        let suffix = 1;
        while (rates[`${finalName}${suffix}`] !== undefined) {
            suffix++;
        }
        finalName = `${finalName}${suffix}`;
    }
    
    return finalName;
}

/**
 * Updates the toggle tax button with Hide or Show depending on inOn
 * @param {boolean} isOn Is tax calculation enabled
 * @returns {void}
 */
const updateToggleButtonText = (isOn) => {
    const toggleTaxBtn = document.querySelector('#toggle-tax');
    if (!toggleTaxBtn) return;
    toggleTaxBtn.textContent = (isOn ? 'Hide' : 'Show') + ' real prices';
};

/**
 * Updates the Total Multiplier display
 */
const updateTotalDisplay = () => {
    const total = getCombinedRate(rates);
    const display = document.querySelector('#total-rate');
    if (display) {
        display.textContent = `Total Multiplier: x${total.toFixed(4)}`;
    }
};

/**
 * Enables or disables the add and remove buttons so the number of rates
 * stays between MIN_RATES and MAX_RATES
 */
const updateRateControls = () => {
    const count = Object.keys(rates).length;

    const newRateBtn = document.querySelector('#new-rate');
    if (newRateBtn) newRateBtn.disabled = count >= MAX_RATES;

    document.querySelectorAll('.remove-rate').forEach(btn => {
        btn.disabled = count <= MIN_RATES;
    });
};

/**
 * Creates an entry for a new rate with a unique name
 * @param {string} rateName Name of rate
 * @param {number} rate Rate
 */
const addNewRate = async (rateName, rate) => {
    if (Object.keys(rates).length >= MAX_RATES) return;

    const list = document.querySelector('#rate-list');
    const template = document.querySelector('#rate-template');

    const uniqueName = getUnusedName(rateName);
    rates[uniqueName] = rate;
    await chrome.storage.sync.set({ "rates": rates });
    list.appendChild(initRateEntry(template, uniqueName, rate));
    updateRateControls();
}

/**
 * Adds event listeners to an element so it becomes an input box on click
 * @param {HTMLElement} parent Clone of list item template with spans and hidden inputs
 * @param {string} className 'rate' or 'rate-name'
 * @param {string} rateName 
 * @param {number} rate 
 * @param {boolean} isName If this should process the rate name or the rate
 * @returns 
 */
const initEditableElement = (parent, className, rateName, rate, isName) => {
    const elem = parent.querySelector('.' + className);
    const input = parent.querySelector('.' + className + '-input');
    
    if (!elem || !input) return;
    
    elem.textContent = isName ? parent.dataset.currentKey : rate;
    input.value = isName ? parent.dataset.currentKey : rate;
    
    elem.addEventListener('click', () => {
        elem.classList.add('hidden');
        input.classList.remove('hidden');
        input.focus();
    });
    
    input.addEventListener('input', async (e) => {
        if (isName) return;
        
        const numericValue = parseFloat(e.target.value);
        if (isNaN(numericValue) || numericValue < 0) {
            input.classList.add('border-red-500', 'text-red-600', 'bg-red-50');
            return;
        }
        
        input.classList.remove('border-red-500', 'text-red-600', 'bg-red-50');
        rates[parent.dataset.currentKey] = numericValue;
        updateTotalDisplay();
        await chrome.storage.sync.set({ "rates": rates });
    });
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        }
    });
    
    input.addEventListener('blur', async (e) => {
        elem.textContent = isName ? parent.dataset.currentKey : rates[parent.dataset.currentKey];
        elem.classList.remove('hidden');
        input.classList.add('hidden');
        
        if (!isName) return;
        
        let newName = e.target.value.trim();
        // A cleared name keeps the old one rather than saving a blank key
        if (!newName) input.value = parent.dataset.currentKey;
        if (!newName || newName == parent.dataset.currentKey) return;
        
        const uniqueName = getUnusedName(newName);
        elem.textContent = uniqueName;
        
        const savedValue = rates[parent.dataset.currentKey];
        delete rates[parent.dataset.currentKey];
        rates[uniqueName] = savedValue ?? 1;
        
        parent.dataset.currentKey = uniqueName;
        await chrome.storage.sync.set({ "rates": rates });
    });
}

/**
 * Returns DOM element with editable rate name and rate texts, and delete button
 * @param {HTMLElement} template Rate template with spans and inputs for rate name and rate
 * @param {string} rateName 
 * @param {number} rate 
 * @returns {HTMLElement} Visible DOM element to add to the list of rates
 */
const initRateEntry = (template, rateName, rate) => {
    const clone = template.content.firstElementChild.cloneNode(true);
    
    if (!clone.dataset.currentKey) clone.dataset.currentKey = rateName;
    initEditableElement(clone, 'rate-name', rateName, rate, true);
    initEditableElement(clone, 'rate', rateName, rate, false);
    
    const removeBtn = clone.querySelector('.remove-rate');
    if (removeBtn) removeBtn.addEventListener('click', async () => {
        if (Object.keys(rates).length <= MIN_RATES) return;

        // Update the data right away; only the DOM removal waits for the
        // transition, so a missed event can't lose the deletion
        delete rates[clone.dataset.currentKey];
        updateTotalDisplay();
        updateRateControls();

        clone.classList.add('opacity-0', 'scale-95', 'transition-all', 'duration-200');
        const removeClone = () => clone.remove();
        clone.addEventListener('transitionend', removeClone, { once: true });
        setTimeout(removeClone, 250); // fallback if transitionend never fires

        await chrome.storage.sync.set({ "rates": rates });
    });
    
    return clone;
}

/**
 * Shows the current toggle-tax keyboard shortcut and wires the Change button
 * to the browser's shortcut editor (MV3 cannot rebind commands directly)
 */
const initShortcutEditor = async () => {
    const display = document.querySelector('#shortcut-display');
    if (display) {
        const commands = await chrome.commands.getAll();
        const toggleCmd = commands.find(cmd => cmd.name === 'toggle-tax');
        display.textContent = toggleCmd?.shortcut || 'not set';
    }

    const editBtn = document.querySelector('#edit-shortcut');
    if (editBtn) editBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
};

/**
 * Returns the hostname of the active tab
 * @returns {Promise<?string>} Null on pages without a regular hostname (chrome://, about:, files)
 */
const getActiveHostname = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
        const url = new URL(tab?.url || '');
        if (['http:', 'https:'].includes(url.protocol)) return url.hostname;
    } catch { /* not a URL */ }
    return null;
};

/**
 * Shows a button to disable or enable the extension on the current site.
 * Stays hidden on pages without a regular hostname (chrome://, about:, files)
 */
const initSiteToggle = async (hostname) => {
    const btn = document.querySelector('#toggle-site');
    if (!btn || !hostname) return;

    const { disabledSites } = await chrome.storage.sync.get(['disabledSites']);
    let isDisabled = (disabledSites || []).includes(hostname);

    const render = () => {
        btn.textContent = `${isDisabled ? 'Enable' : 'Disable'} on ${hostname}`;
    };
    render();
    btn.classList.remove('hidden');

    btn.addEventListener('click', async () => {
        const { disabledSites: current } = await chrome.storage.sync.get(['disabledSites']);
        const sites = current || [];
        const next = isDisabled
            ? sites.filter(host => host !== hostname)
            : [...sites, hostname];
        isDisabled = !isDisabled;
        render();
        await chrome.storage.sync.set({ disabledSites: next });
    });
};

/**
 * Shows a button to mark the current site as a grocery store, which prices it
 * with the grocery rate instead of the combined rate. The grocery rate input
 * is only shown while the site is marked. Stays hidden on pages without a
 * regular hostname
 * @param {?string} hostname
 */
const initGroceryToggle = async (hostname) => {
    const btn = document.querySelector('#toggle-grocery');
    const rateRow = document.querySelector('#grocery-rate-row');
    const rateInput = document.querySelector('#grocery-rate');
    if (!btn || !rateRow || !rateInput || !hostname) return;

    const { grocerySites, groceryRate } = await chrome.storage.sync.get(['grocerySites', 'groceryRate']);
    let isGrocery = (grocerySites || []).includes(hostname);
    rateInput.value = groceryRate ?? defaultGroceryRate;

    const render = () => {
        btn.textContent = `Grocery store: ${hostname}`;
        // Filled while this site is marked as a grocery store
        btn.classList.toggle('bg-[#81986e]', isGrocery);
        btn.classList.toggle('text-white', isGrocery);
        btn.setAttribute('aria-pressed', String(isGrocery));
        rateRow.classList.toggle('hidden', !isGrocery);
    };
    render();
    btn.classList.remove('hidden');

    btn.addEventListener('click', async () => {
        const { grocerySites: current } = await chrome.storage.sync.get(['grocerySites']);
        const sites = current || [];
        const next = isGrocery
            ? sites.filter(host => host !== hostname)
            : [...sites, hostname];
        isGrocery = !isGrocery;
        render();
        await chrome.storage.sync.set({ grocerySites: next });
    });

    rateInput.addEventListener('input', async () => {
        const numericValue = parseFloat(rateInput.value);
        if (isNaN(numericValue) || numericValue < 0) {
            rateInput.classList.add('border-red-500', 'text-red-600', 'bg-red-50');
            return;
        }

        rateInput.classList.remove('border-red-500', 'text-red-600', 'bg-red-50');
        await chrome.storage.sync.set({ groceryRate: numericValue });
    });
};

/**
 * Displays the popup with the existing rates (or default rates), tax toggle,
 * input elements, and total rate display.
 */
const initPopup = async () => {
    const { rates: syncedRates } = await chrome.storage.sync.get(['rates']);
    rates = getRatesOrDefault(syncedRates);
    
    const { taxOn } = await chrome.storage.local.get(['taxOn']);
    const isCurrentlyOn = (taxOn === undefined) ? true : taxOn;
    updateToggleButtonText(isCurrentlyOn);
    
    const toggleTaxBtn = document.querySelector('#toggle-tax');
    toggleTaxBtn.addEventListener('click', async () => {
        const { taxOn: currentlyOn } = await chrome.storage.local.get(['taxOn']);
        const newState = (currentlyOn === undefined) ? false : !currentlyOn;
        await chrome.storage.local.set({ 'taxOn': newState });
    });
    
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.taxOn) {
            updateToggleButtonText(changes.taxOn.newValue);
        }
    });
    
    const template = document.getElementById('rate-template');
    const rateSpans = [];
    for (const [rateName, rate] of Object.entries(rates)) {
        rateSpans.push(initRateEntry(template, rateName, rate));
    }
    document.querySelector('#rate-list').append(...rateSpans);
    
    const newRateBtn = document.querySelector('#new-rate');
    newRateBtn.addEventListener("click", () => addNewRate('my rate', 1));

    updateTotalDisplay();
    updateRateControls();
    initShortcutEditor();
    const hostname = await getActiveHostname();
    initSiteToggle(hostname);
    initGroceryToggle(hostname);
}

initPopup();