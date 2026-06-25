// Instagram Reels Auto-Scroller - Background Script

const defaultState = {
  paused: false,
  scrollDelay: 2000,
  autoLikeFollowedCreators: false,
  showPill: true
};

function broadcastState(state) {
  chrome.tabs.query({ url: '*://www.instagram.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs
        .sendMessage(tab.id, { type: 'stateUpdate', state })
        .catch(() => {
          // Content script may not be ready on that tab yet.
        });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['reelScrollerState'], (result) => {
    if (!result.reelScrollerState) {
      chrome.storage.local.set({ reelScrollerState: defaultState });
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['reelScrollerState'], (result) => {
    if (!result.reelScrollerState) {
      chrome.storage.local.set({ reelScrollerState: defaultState });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'stateChange') return;

  chrome.storage.local.set({ reelScrollerState: message.state }, () => {
    broadcastState(message.state);
    sendResponse({ success: true });
  });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.includes('instagram.com')) return;

  chrome.storage.local.get(['reelScrollerState'], (result) => {
    const state = result.reelScrollerState || defaultState;
    chrome.tabs
      .sendMessage(tabId, { type: 'stateUpdate', state })
      .catch(() => {
        // Content script may not be ready yet.
      });
  });
});
