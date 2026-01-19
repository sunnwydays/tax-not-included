chrome.commands.onCommand.addListener(async (command,tab) => {
    if (command === 'toggle-tax') {
        const result = await chrome.storage.local.get(['taxOn']);
        const newState = (result.taxOn === undefined) ? false : !result.taxOn;
        await chrome.storage.local.set({ 'taxOn': newState });
    }
});