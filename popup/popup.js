/** * @type {Object.<string, number>} 
 * @description Default tax rates used when rates is empty.
 */
const defaultRates = { 'Tax': 1.13 };

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
 * Creates an entry for a new rate with a unique name
 * @param {string} rateName Name of rate
 * @param {number} rate Rate
 */
const addNewRate = async (rateName, rate) => {
    const list = document.querySelector('#rate-list');
    const template = document.querySelector('#rate-template');
    
    const uniqueName = getUnusedName(rateName);
    rates[uniqueName] = rate;
    await chrome.storage.sync.set({ "rates": rates });
    list.appendChild(initRateEntry(template, uniqueName, rate));
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
        if (newName == parent.dataset.currentKey) return;
        
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
        clone.classList.add('opacity-0', 'scale-95', 'transition-all', 'duration-200');
        delete rates[clone.dataset.currentKey];
        clone.remove();
        updateTotalDisplay();
        await chrome.storage.sync.set({ "rates": rates });
    });
    
    return clone;
}

/**
 * Displays the popup with the existing rates (or default rates), tax toggle,
 * input elements, and total rate display.
 */
const initPopup = async () => {
    const { rates: syncedRates } = await chrome.storage.sync.get(['rates']);
    rates = (syncedRates && Object.keys(syncedRates).length > 0) 
    ? syncedRates 
    : defaultRates;
    
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
}

initPopup();