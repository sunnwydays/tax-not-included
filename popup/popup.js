const defaultRates = { 'Tax': 1.13 };

let rates = {};

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

const updateToggleButtonText = (isOn) => {
  const toggleTaxBtn = document.querySelector('#toggle-tax');
  if (!toggleTaxBtn) return;
  toggleTaxBtn.textContent = (isOn ? 'Hide' : 'Show') + ' real prices';
};

const updateTotalDisplay = () => {
  const total = getCombinedRate(rates);
  const display = document.querySelector('#total-rate');
  if (display) {
    display.textContent = `Total Multiplier: x${total.toFixed(4)}`;
  }
};

const addNewRate = async (rateName, rate) => {
  const list = document.querySelector('#rate-list');
  const template = document.querySelector('#rate-template');

  const uniqueName = getUnusedName(rateName);
  rates[uniqueName] = rate;
  await chrome.storage.sync.set({ "rates": rates });
  list.appendChild(initRateEntry(template, uniqueName, rate));
}

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

// Add listeners to a editable rate with name and delete button
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