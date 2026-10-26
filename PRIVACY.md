# Privacy Policy

Tax Not Included doesn't collect, store, or send any of your data. There's no server, no analytics, and no account. The extension makes zero network requests (you can check, it's all in this repo).

## What it does with a page
On every page you visit, the extension reads the text to find prices and rewrites them with your tax rate added. That all happens locally in your browser. Page content is never saved or sent anywhere, and I never see which sites you visit.

## What it saves
Your settings, and only your settings:
- Your tax rates (and the grocery rate)
- The sites you turned the extension off for, and the sites you marked as grocery stores
- Whether the extension is on or off

These live in `chrome.storage`. If you're signed in to Chrome with sync turned on, Chrome syncs the rates and site lists across your devices through your Google account (that's Chrome's doing, I don't get a copy). Removing the extension deletes them.

## Permissions
- `storage` is for the settings above.
- `activeTab` lets the popup check which site you're on, for the "disable on this site" and "grocery store" buttons.
- The content script runs on all sites because prices can be on any shop. It only touches the price text.

## Third parties
None. No ads, no trackers, no remote code. Nothing is sold or shared because there's nothing to sell or share.

## Questions
Open an issue at https://github.com/sunnwydays/tax-not-included/issues. If this policy ever changes, the change will show up in this file's history.

Last updated: October 26, 2026
