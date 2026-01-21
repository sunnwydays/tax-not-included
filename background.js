chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-tax') {
        const result = await chrome.storage.local.get(['taxOn']);
        const newState = (result.taxOn === undefined) ? false : !result.taxOn;

        await chrome.storage.local.set({ 'taxOn': newState });
        await chrome.action.setBadgeBackgroundColor({ color: newState ? '#54b840' : '#d98071' });
        await chrome.action.setBadgeText({ text: newState ? 'ON' : 'OFF' });
    }
});

chrome.runtime.onInstalled.addListener(async () => {
	await chrome.storage.local.set({ 'taxOn': true });
    await chrome.action.setBadgeBackgroundColor({ color: '#54b840' });
    await chrome.action.setBadgeText({ text: 'ON' });
});