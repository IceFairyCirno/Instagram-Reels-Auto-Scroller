document.addEventListener('DOMContentLoaded', () => {
  const pauseBtn = document.getElementById('pauseBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const delaySlider = document.getElementById('delaySlider');
  const delayValue = document.getElementById('delayValue');
  const autoLikeToggle = document.getElementById('autoLikeToggle');
  const showPillToggle = document.getElementById('showPillToggle');

  let state = {
    paused: false,
    scrollDelay: 2000,
    autoLikeFollowedCreators: false,
    showPill: true
  };

  // Load saved state
  chrome.storage.local.get(['reelScrollerState'], (result) => {
    if (result.reelScrollerState) {
      state = result.reelScrollerState;
      updateUI();
    }
  });

  // Listen for state updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'stateUpdate') {
      state = message.state;
      updateUI();
    }
  });

  function updateUI() {
    if (state.paused) {
      statusDot.className = 'status-dot paused';
      statusText.textContent = 'Paused';
      pauseBtn.textContent = 'Resume';
      pauseBtn.classList.add('paused');
    } else {
      statusDot.className = 'status-dot active';
      statusText.textContent = 'Active';
      pauseBtn.textContent = 'Pause';
      pauseBtn.classList.remove('paused');
    }

    delaySlider.value = state.scrollDelay;
    delayValue.textContent = `${state.scrollDelay / 1000}s after reel ends`;

    autoLikeToggle.classList.toggle('active', state.autoLikeFollowedCreators || false);
    showPillToggle.classList.toggle('active', state.showPill || false);
  }

  function saveState() {
    chrome.storage.local.set({ reelScrollerState: state });
    chrome.runtime.sendMessage({ type: 'stateChange', state });
  }

  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    saveState();
    updateUI();
  });

  delaySlider.addEventListener('input', (e) => {
    state.scrollDelay = parseInt(e.target.value);
    delayValue.textContent = `${state.scrollDelay / 1000}s after reel ends`;
    saveState();
  });

  autoLikeToggle.addEventListener('click', () => {
    state.autoLikeFollowedCreators = !(state.autoLikeFollowedCreators || false);
    saveState();
    updateUI();
  });

  showPillToggle.addEventListener('click', () => {
    state.showPill = !(state.showPill || false);
    saveState();
    updateUI();
  });
});
