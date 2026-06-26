// Instagram Reels Auto-Scroller - Content Script

(function () {
  'use strict';

  const VIDEO_SELECTOR = 'video';

  const MIN_VISIBLE_VIDEO_AREA = 2500;

  let state = { paused: false, scrollDelay: 2000, autoLikeFollowedCreators: false, showPill: true };
  let isRunning = false;
  let pendingScrollTimeout = null;
  let statusIndicator = null;
  let videoObserver = null;
  let scanInterval = null;
  const preparedVideos = new WeakSet();

  const RESERVED_PROFILE_PATHS = new Set([
    'explore', 'reels', 'stories', 'direct', 'accounts',
    'p', 'reel', 'tv', 'tags', 'locations', 'nametag'
  ]);

  const FOLLOW_LABELS = new Set(['Follow', 'Follow Back', '關注', '回關', '追踪', '追蹤']);
  const FOLLOWING_LABELS = new Set(['Following', '已追蹤', '已關注', '正在追蹤', '正在关注', '追蹤中', '关注中']);
  const LIKE_LABELS = ['Like', '讚', '讚好', '赞', '赞好', '喜歡', '喜欢'];
  const UNLIKE_LABELS = ['Unlike', '收回讚', '收回讚好', '收回赞', '取消讚', '取消讚好', '取消赞'];
  const LIKE_SVG_SELECTOR =
    'svg[aria-label="Like"], svg[aria-label="讚"], svg[aria-label="讚好"], svg[aria-label="赞"], svg[aria-label="赞好"], ' +
    'svg[aria-label="喜歡"], svg[aria-label="喜欢"], ' +
    'svg[aria-label="Unlike"], svg[aria-label="收回讚"], svg[aria-label="收回讚好"], svg[aria-label="收回赞"], ' +
    'svg[aria-label="取消讚"], svg[aria-label="取消讚好"], svg[aria-label="取消赞"]';

  let lastLikedVideoKey = null;
  let lastAutoLikedVideo = null;
  let reelChangeTimer = null;
  let videoReelIdCounter = 0;

  function log(...args) {
    console.log('[Reel Scroller]', ...args);
  }

  function isInstagramReelsContext() {
    const path = window.location.pathname;
    return (
      path.startsWith('/reels') ||
      path.includes('/reel/') ||
      getVideos().length > 0
    );
  }

  function getVideos() {
    const mainVideos = Array.from(document.querySelectorAll('main video'));
    if (mainVideos.length > 0) return mainVideos;
    return Array.from(document.querySelectorAll('video')).filter((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 80 && rect.height > 80;
    });
  }

  function getVisibleArea(rect) {
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, window.innerWidth);
    return Math.max(0, bottom - top) * Math.max(0, right - left);
  }

  function getCurrentVideo() {
    let bestVideo = null;
    let bestArea = 0;

    for (const video of getVideos()) {
      const rect = video.getBoundingClientRect();
      const area = getVisibleArea(rect);
      if (area > bestArea) {
        bestArea = area;
        bestVideo = video;
      }
    }

    return bestArea > MIN_VISIBLE_VIDEO_AREA ? bestVideo : null;
  }

  function getReelIdFromUrl() {
    const path = window.location.pathname.replace(/\/$/, '');
    const reelMatch = path.match(/\/reel\/([^/?#]+)/);
    if (reelMatch) return reelMatch[1];

    const uuidMatch = path.match(/^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (uuidMatch) return uuidMatch[1];

    return null;
  }

  function distanceToVideoCenter(element, video) {
    const vRect = video.getBoundingClientRect();
    const eRect = element.getBoundingClientRect();
    const vx = vRect.left + vRect.width / 2;
    const vy = vRect.top + vRect.height / 2;
    const ex = eRect.left + eRect.width / 2;
    const ey = eRect.top + eRect.height / 2;
    return Math.hypot(ex - vx, ey - vy);
  }

  function belongsToCurrentReel(element, video) {
    if (!element || !video) return false;

    const eRect = element.getBoundingClientRect();
    if (eRect.width === 0 && eRect.height === 0) return false;

    return isOverReelOverlay(element, video);
  }

  function isOnActionRail(element, video) {
    if (!element || !video) return false;

    const vRect = video.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;

    return (
      midX >= vRect.right - 32 &&
      midX <= vRect.right + 220 &&
      midY >= vRect.top + 32 &&
      midY <= vRect.bottom - 32
    );
  }

  function isNonLikeRailControl(label) {
    const lower = (label || '').toLowerCase();
    return /comment|share|save|more|repost|send|audio|mute|unmute|播放|音訊|音訊|靜音|留言|分享|儲存|更多|轉發|傳送|收藏|加強|標註/i.test(lower);
  }

  function getElementAriaLabel(el) {
    if (!el) return '';
    const own = el.getAttribute('aria-label') || '';
    if (own) return own;
    const svg = el.querySelector?.('svg[aria-label]');
    return svg?.getAttribute('aria-label') || '';
  }

  function getReelViewportRoot(video) {
    if (!video) return null;

    let best = null;
    let bestDepth = -1;
    let node = video.parentElement;

    for (let depth = 0; depth < 30 && node && node !== document.documentElement; depth++) {
      const hasLike = node.querySelector(LIKE_SVG_SELECTOR);
      const hasProfile = Array.from(node.querySelectorAll('a[href^="/"]')).some((link) => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/^\/([^/?#]+)\/?$/);
        if (!match) return false;
        const segment = match[1].toLowerCase();
        return !RESERVED_PROFILE_PATHS.has(segment) && !/^[0-9a-f-]{36}$/i.test(match[1]);
      });

      const videoCount = node.querySelectorAll('video').length;
      if (hasLike && hasProfile && node.contains(video) && videoCount <= 3) {
        if (depth > bestDepth) {
          best = node;
          bestDepth = depth;
        }
      }
      node = node.parentElement;
    }

    if (best) return best;

    return (
      video.closest('main') ||
      video.closest('article[role="presentation"]') ||
      video.closest('article') ||
      video.parentElement
    );
  }

  function getCurrentReelArticle(video) {
    if (!video) return null;
    return (
      video.closest('article[role="presentation"]') ||
      video.closest('article') ||
      video.closest('[role="article"]')
    );
  }

  function getCurrentReelContainer() {
    const video = getCurrentVideo();
    if (video) {
      return getReelViewportRoot(video);
    }

    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog) return dialog;

    return document.querySelector('article[role="presentation"]');
  }

  function getClickableFromSvg(svg) {
    return (
      svg.closest('button') ||
      svg.closest('[role="button"]') ||
      svg.parentElement?.closest('button') ||
      svg.parentElement?.closest('[role="button"]') ||
      svg.parentElement
    );
  }

  function getNextVideo(currentVideo) {
    const videos = getVideos();
    const index = videos.indexOf(currentVideo);
    if (index === -1) return null;
    return videos[index + 1] || null;
  }

  function disableLoop(video) {
    if (!video) return;
    video.loop = false;
    video.removeAttribute('loop');
  }

  function clearScrollFlags(video) {
    if (!video?.dataset) return;
    delete video.dataset.reelScrollerScheduled;
    delete video.dataset.reelScrollerScrolled;
  }

  function prepareVideo(video) {
    if (!video || preparedVideos.has(video)) return;
    preparedVideos.add(video);

    disableLoop(video);
    clearScrollFlags(video);
    ensureVideoReelId(video);

    video.addEventListener('ended', onVideoEnded);
    video.addEventListener('timeupdate', onVideoTimeUpdate);
    video.addEventListener('loadedmetadata', () => disableLoop(video));
  }

  function onVideoEnded(event) {
    scheduleScroll(event.currentTarget, 'ended');
  }

  function onVideoTimeUpdate(event) {
    const video = event.currentTarget;
    if (state.paused || !isRunning) return;

    const duration = video.duration;
    if (!duration || !Number.isFinite(duration)) return;

    disableLoop(video);

    const remaining = duration - video.currentTime;
    if (remaining > 0 && remaining <= 0.35) {
      scheduleScroll(video, 'timeupdate');
    }
  }

  function scheduleScroll(video, reason) {
    if (state.paused || !isRunning || !video) return;
    if (video.dataset.reelScrollerScheduled === 'true') return;
    if (video.dataset.reelScrollerScrolled === 'true') return;

    video.dataset.reelScrollerScheduled = 'true';
    log(`Scheduling scroll (${reason}) in ${state.scrollDelay}ms`);

    clearTimeout(pendingScrollTimeout);
    pendingScrollTimeout = setTimeout(() => {
      if (!state.paused && isRunning) {
        scrollToNextReel(video);
      }
    }, state.scrollDelay);
  }

  function scrollToNextReel(fromVideo) {
    const current = fromVideo || getCurrentVideo();
    if (!current || state.paused || !isRunning) return;
    if (current.dataset.reelScrollerScrolled === 'true') return;

    current.dataset.reelScrollerScrolled = 'true';
    clearTimeout(pendingScrollTimeout);

    const nextVideo = getNextVideo(current);
    log('Scrolling to next reel', { hasNextVideo: Boolean(nextVideo) });

    if (nextVideo) {
      nextVideo.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });

      setTimeout(() => {
        prepareVideo(nextVideo);
        clearScrollFlags(current);
        if (state.autoLikeFollowedCreators) scheduleAutoLike('scroll');
      }, 1200);
      return;
    }

    const scrollContainer = findScrollContainer(current);
    if (scrollContainer) {
      scrollContainer.scrollBy({
        top: window.innerHeight,
        behavior: 'smooth'
      });
      setTimeout(() => {
        clearScrollFlags(current);
        if (state.autoLikeFollowedCreators) scheduleAutoLike('scroll');
      }, 1200);
      return;
    }

    injectPageKeyPress('ArrowDown');
    setTimeout(() => {
      clearScrollFlags(current);
      if (state.autoLikeFollowedCreators) scheduleAutoLike('scroll');
    }, 1200);
  }

  function findScrollContainer(element) {
    let node = element;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const canScroll =
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight + 20;
      if (canScroll) return node;
      node = node.parentElement;
    }
    return null;
  }

  function injectPageKeyPress(key) {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        const target = document.activeElement || document.body;
        const event = new KeyboardEvent('keydown', {
          key: ${JSON.stringify(key)},
          code: ${JSON.stringify(key)},
          bubbles: true,
          cancelable: true
        });
        target.dispatchEvent(event);
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  }

  function getCreatorUsername(container, video) {
    if (video) {
      const profileLink = findCreatorProfileLink(video);
      if (profileLink) {
        const text = (profileLink.textContent || '').trim();
        if (text && /^[a-zA-Z0-9._]+$/.test(text)) return text;
        const segment = parseProfileSegment(profileLink.getAttribute('href') || '');
        if (segment) return segment;
      }
    }

    const root = video ? getReelViewportRoot(video) : container;
    if (!root) return null;

    for (const link of root.querySelectorAll('a[href^="/"]')) {
      const segment = parseProfileSegment(link.getAttribute('href') || '');
      if (!isValidProfileSegment(segment)) continue;
      if (video && !isOverReelOverlay(link, video)) continue;

      const text = (link.textContent || '').trim();
      if (text && /^[a-zA-Z0-9._]+$/.test(text) && text.length < 40) return text;
      return segment;
    }

    return null;
  }

  function ensureVideoReelId(video) {
    if (!video?.dataset) return 'unknown';
    if (!video.dataset.reelScrollerId) {
      videoReelIdCounter += 1;
      video.dataset.reelScrollerId = `v${videoReelIdCounter}`;
    }
    return video.dataset.reelScrollerId;
  }

  function getReelId(container) {
    if (!container) return null;

    const links = container.querySelectorAll('a[href*="/reel/"]');
    for (const link of links) {
      const match = (link.getAttribute('href') || '').match(/\/reel\/([^/?#]+)/);
      if (match) return match[1];
    }

    return null;
  }

  function getReelIdForVideo(video) {
    if (!video) return null;

    const root = getReelViewportRoot(video);
    const reelId = getReelId(root) || getReelId(getCurrentReelContainer());
    if (reelId) return reelId;

    return getReelIdFromUrl();
  }

  function getCurrentReelKey() {
    const video = getCurrentVideo();
    if (!video) return null;

    const reelId = getReelIdForVideo(video);
    if (reelId) return `reel:${reelId}`;

    const container = getCurrentReelContainer();
    const username = getCreatorUsername(container, video) || 'unknown';
    return `reel:${username}:${ensureVideoReelId(video)}`;
  }

  function isOverReelOverlay(element, video) {
    if (!element || !video) return false;

    const rect = element.getBoundingClientRect();
    const vRect = video.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;

    const midY = rect.top + rect.height / 2;
    if (midY > vRect.bottom + 220) return false;
    if (midY < vRect.top - 64) return false;

    const midX = rect.left + rect.width / 2;
    return midX >= vRect.left - 48 && midX <= vRect.right + 220;
  }

  function parseProfileSegment(href) {
    const match = (href || '').match(/^\/([^/?#]+)\/?$/);
    return match ? match[1] : null;
  }

  function isValidProfileSegment(segment) {
    if (!segment) return false;
    const lower = segment.toLowerCase();
    if (RESERVED_PROFILE_PATHS.has(lower)) return false;
    if (/^[0-9a-f-]{36}$/i.test(segment)) return false;
    return true;
  }

  function isReelActionButton(btn) {
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = (btn.textContent || '').toLowerCase();
    return (
      aria.includes('like') || aria.includes('unlike') || aria.includes('comment') ||
      aria.includes('share') || aria.includes('save') || aria.includes('repost') ||
      aria.includes('audio') || aria.includes('more') || aria.includes('讚') ||
      aria.includes('播放') || aria.includes('傳送') || text.includes('like')
    );
  }

  function normalizeLabelText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getFollowControlLabel(el) {
    if (!el) return null;

    const ariaCandidates = [el.getAttribute('aria-label') || '', el.getAttribute('title') || ''];
    for (const node of el.querySelectorAll('[aria-label], [title]')) {
      const label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
      if (label) ariaCandidates.push(label);
    }

    for (const candidate of ariaCandidates) {
      const trimmed = normalizeLabelText(candidate);
      if (trimmed && trimmed.length <= 24) return trimmed;
    }

    const visited = new Set();
    const stack = [el];
    while (stack.length) {
      const node = stack.pop();
      if (!node || visited.has(node)) continue;
      visited.add(node);

      if (node.nodeType === Node.TEXT_NODE) {
        const trimmed = normalizeLabelText(node.textContent || '');
        if (trimmed && trimmed.length <= 24) return trimmed;
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (['SCRIPT', 'STYLE'].includes(node.tagName)) continue;

      const text = normalizeLabelText(node.textContent || '');
      if (text && text.length <= 24) {
        const lower = text.toLowerCase();
        if (/(follow|following|追蹤|追踪|關注|回關)/i.test(lower)) return text;
      }

      for (const child of node.childNodes) stack.push(child);
    }

    return null;
  }

  function isFollowingLabel(label) {
    if (!label) return false;
    const normalized = normalizeLabelText(label).toLowerCase();
    if (FOLLOWING_LABELS.has(label)) return true;
    if (/追蹤中|正在追蹤|已追蹤|正在关注|关注中|已关注/i.test(label)) return true;
    return /(^|\b)(following|已追蹤|正在追蹤|追蹤中|已關注|正在关注|关注中|已关注|關注)(\b|$)/i.test(normalized);
  }

  function isFollowLabel(label) {
    if (!label) return false;
    const normalized = normalizeLabelText(label).toLowerCase();
    if (label === 'Follow Back') return true;
    if (FOLLOW_LABELS.has(label)) return true;
    return /(^|\b)(follow(?: back)?|追蹤|追踪|關注|回關)(\b|$)/i.test(normalized);
  }

  function areElementsAdjacent(a, b, maxDistance) {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (!ar.width && !ar.height) return false;
    if (!br.width && !br.height) return false;

    const ax = ar.left + ar.width / 2;
    const ay = ar.top + ar.height / 2;
    const bx = br.left + br.width / 2;
    const by = br.top + br.height / 2;
    return Math.hypot(bx - ax, by - ay) <= maxDistance;
  }

  function isCreatorProfileLink(link, video) {
    const segment = parseProfileSegment(link.getAttribute('href') || '');
    if (!isValidProfileSegment(segment)) return false;

    const rect = link.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      const parentRect = link.parentElement?.getBoundingClientRect();
      if (!parentRect?.width) return false;
    }

    return isOverReelOverlay(link, video);
  }

  function findCreatorProfileLink(video) {
    if (!video) return null;

    const scopes = new Set([
      getReelViewportRoot(video),
      video.closest('main'),
      document
    ]);

    const vRect = video.getBoundingClientRect();
    let bestLink = null;
    let bestScore = Infinity;

    for (const scope of scopes) {
      if (!scope) continue;

      for (const link of scope.querySelectorAll('a[href^="/"]')) {
        if (!isCreatorProfileLink(link, video)) continue;

        const rect = link.getBoundingClientRect();
        const toBottomLeft = Math.hypot(rect.left - vRect.left, rect.top - (vRect.bottom - 56));
        const toTopLeft = Math.hypot(rect.left - vRect.left, rect.top - (vRect.top + 56));
        const score = Math.min(toBottomLeft, toTopLeft);
        const text = (link.textContent || '').trim();
        const finalScore = /^[a-zA-Z0-9._]+$/.test(text) ? score : score + 200;

        if (finalScore < bestScore) {
          bestScore = finalScore;
          bestLink = link;
        }
      }
    }

    return bestLink;
  }

  function findOverlayFollowControl(video, mode) {
    if (!video) return null;

    for (const el of document.querySelectorAll('*')) {
      if (!isOverReelOverlay(el, video)) continue;
      if (isReelActionButton(el)) continue;

      const label = getFollowControlLabel(el);
      if (!label) continue;

      if (mode === 'following' && isFollowingLabel(label)) return el;
      if (mode === 'follow' && isFollowLabel(label)) return el;
    }

    return null;
  }

  function hasFollowingSiblingText(profileLink) {
    const parent = profileLink.parentElement;
    if (!parent) return false;

    for (const child of parent.children) {
      if (child === profileLink || child.contains(profileLink)) continue;
      const text = (child.textContent || '').trim();
      if (text.length > 24) continue;
      if (isFollowingLabel(text)) return true;
    }

    return false;
  }

  function getFollowStateNearProfile(profileLink) {
    if (!profileLink) return null;

    let sawFollowing = false;
    let sawFollow = false;

    let container = profileLink.parentElement;
    for (let depth = 0; depth < 6 && container; depth++) {
      const controls = container.querySelectorAll('button, [role="button"]');
      for (const el of controls) {
        if (el === profileLink || el.contains(profileLink)) continue;

        const label = getFollowControlLabel(el);
        if (!label) continue;
        if (!areElementsAdjacent(profileLink, el, 140)) continue;
        if (isReelActionButton(el)) continue;

        if (isFollowingLabel(label)) sawFollowing = true;
        else if (isFollowLabel(label)) sawFollow = true;
      }

      if (sawFollowing) return 'following';
      if (sawFollow) return 'follow';

      container = container.parentElement;
    }

    if (sawFollowing) return 'following';
    if (sawFollow) return 'follow';
    return null;
  }

  function isFollowControlElement(el) {
    const label = getFollowControlLabel(el);
    if (!label) return false;
    if (isReelActionButton(el)) return false;
    return isFollowingLabel(label) || isFollowLabel(label);
  }

  function matchesFollowing(el) {
    return isFollowingLabel(getFollowControlLabel(el));
  }

  function matchesNotFollowing(el) {
    return isFollowLabel(getFollowControlLabel(el));
  }

  function isCreatorFollowed(video) {
    if (!video) return false;

    const followingControl = findOverlayFollowControl(video, 'following');
    if (followingControl) {
      log('Followed: overlay control', getFollowControlLabel(followingControl));
      return true;
    }

    const followControl = findOverlayFollowControl(video, 'follow');
    if (followControl) {
      log('Not followed: overlay Follow control', getFollowControlLabel(followControl));
      return false;
    }

    const profileLink = findCreatorProfileLink(video);
    if (!profileLink) {
      log('No creator profile link found; not auto-liking');
      return false;
    }

    const username = parseProfileSegment(profileLink.getAttribute('href') || '') || 'unknown';
    const state = getFollowStateNearProfile(profileLink);

    if (state === 'following') {
      log('Followed: creator shows Following near', username);
      return true;
    }
    if (state === 'follow') {
      log('Not followed: creator shows Follow near', username);
      return false;
    }

    if (hasFollowingSiblingText(profileLink)) {
      log('Followed: Following text beside creator header for', username);
      return true;
    }

    log('No explicit follow label found; not auto-liking', username);
    return false;
  }

  function isUnlikeLabel(label) {
    const text = label || '';
    const lower = text.toLowerCase();
    if (lower.includes('unlike')) return true;
    if (UNLIKE_LABELS.some((l) => text === l || lower === l.toLowerCase())) return true;
    return /收回讚|收回赞|取消讚|取消赞|收回讚好|取消讚好/.test(text);
  }

  function isLikeLabel(label) {
    const text = label || '';
    if (!text || isUnlikeLabel(text)) return false;

    const lower = text.toLowerCase();
    if (lower.includes('like') && !lower.includes('unlike')) return true;
    if (LIKE_LABELS.some((l) => text === l || lower === l.toLowerCase())) return true;
    if (text === '讚好' || text === '赞好') return true;
    if (text.includes('讚') && !text.includes('收回') && !text.includes('取消')) return true;
    if (text.includes('赞') && !text.includes('收回') && !text.includes('取消')) return true;
    return text === '喜歡' || text === '喜欢';
  }

  function isAlreadyLiked(video) {
    if (!video) return false;

    for (const svg of document.querySelectorAll('svg[aria-label]')) {
      const label = svg.getAttribute('aria-label') || '';
      if (!isUnlikeLabel(label)) continue;
      if (!isOverReelOverlay(svg, video)) continue;
      return true;
    }

    const railLike = findLikeButtonOnActionRail(video, true);
    if (!railLike) return false;
    const label = getElementAriaLabel(railLike);
    return isUnlikeLabel(label);
  }

  function findLikeButtonOnActionRail(video, silent) {
    const candidates = [];

    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (!isOnActionRail(el, video)) continue;
      if (!el.querySelector('svg')) continue;

      const label = getElementAriaLabel(el);
      if (isUnlikeLabel(label)) continue;
      if (isNonLikeRailControl(label)) continue;

      const rect = el.getBoundingClientRect();
      candidates.push({
        el,
        top: rect.top,
        hasLikeLabel: isLikeLabel(label)
      });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (a.hasLikeLabel !== b.hasLikeLabel) return a.hasLikeLabel ? -1 : 1;
      return a.top - b.top;
    });

    if (!silent) log('Found like button on action rail');
    return candidates[0].el;
  }

  function findLikeButtonByHitTest(video) {
    const rect = video.getBoundingClientRect();
    const xPoints = [
      rect.right + 16,
      rect.right + 36,
      rect.right + 56,
      rect.right + 80,
      rect.right + 110
    ].map((x) => Math.min(Math.max(x, 8), window.innerWidth - 8));

    const yPoints = [0.28, 0.36, 0.44, 0.52, 0.6].map((ratio) => rect.top + rect.height * ratio);

    for (const x of xPoints) {
      for (const y of yPoints) {
        for (const el of document.elementsFromPoint(x, y)) {
          const btn = el.closest?.('button, [role="button"]');
          if (!btn || !isOnActionRail(btn, video)) continue;
          if (!btn.querySelector('svg')) continue;

          const label = getElementAriaLabel(btn);
          if (isUnlikeLabel(label)) continue;
          if (isNonLikeRailControl(label)) continue;

          log('Found like button via hit-test on action rail');
          return btn;
        }
      }
    }

    return null;
  }

  function findLikeButton(video) {
    if (!video || isAlreadyLiked(video)) return null;

    let best = null;
    let bestDist = Infinity;

    for (const svg of document.querySelectorAll('svg[aria-label]')) {
      const label = svg.getAttribute('aria-label') || '';
      if (!isLikeLabel(label)) continue;
      if (!isOverReelOverlay(svg, video)) continue;

      const clickable = getClickableFromSvg(svg);
      if (!clickable) continue;

      const dist = distanceToVideoCenter(clickable, video);
      if (dist < bestDist) {
        bestDist = dist;
        best = clickable;
      }
    }

    for (const btn of document.querySelectorAll('button[aria-label], [role="button"][aria-label]')) {
      const label = btn.getAttribute('aria-label') || '';
      if (!isLikeLabel(label)) continue;
      if (!isOverReelOverlay(btn, video)) continue;

      const dist = distanceToVideoCenter(btn, video);
      if (dist < bestDist) {
        bestDist = dist;
        best = btn;
      }
    }

    if (best) {
      log('Found like button for current reel, distance:', Math.round(bestDist));
      return best;
    }

    const railButton = findLikeButtonOnActionRail(video);
    if (railButton) return railButton;

    return findLikeButtonByHitTest(video);
  }

  let lastScanReelKey = null;
  let lastAutoLikeLogKey = null;
  let lastLikeDebugKey = null;

  function scheduleAutoLike(reason) {
    if (!state.autoLikeFollowedCreators || !isRunning) return;

    clearTimeout(reelChangeTimer);
    tryAutoLike(reason);
    reelChangeTimer = setTimeout(() => tryAutoLike(reason), 400);
  }

  function tryAutoLike(reason) {
    if (!state.autoLikeFollowedCreators) {
      log('Auto-like skipped: toggle is off');
      return false;
    }
    if (!isRunning) {
      log('Auto-like skipped: extension not running on this page');
      return false;
    }

    const video = getCurrentVideo();
    if (!video) {
      log('Auto-like skipped: no visible video', { reason, videos: getVideos().length });
      return false;
    }

    const container = getCurrentReelContainer();

    const reelKey = getCurrentReelKey();
    if (!reelKey) {
      log('Auto-like skipped: could not identify current reel', { reason });
      return false;
    }

    if (reelKey === lastLikedVideoKey && video === lastAutoLikedVideo) {
      log('Auto-like skipped: already processed reel', reelKey);
      return false;
    }

    const creator = getCreatorUsername(container, video) || 'unknown';
    const followed = isCreatorFollowed(video);
    const logKey = `${reelKey}:${followed}:${creator}`;
    if (logKey !== lastAutoLikeLogKey) {
      lastAutoLikeLogKey = logKey;
      log('Follow check result:', followed, 'creator:', creator, 'reel:', reelKey, 'reason:', reason || 'scan');
    }

    if (!followed) return false;

    if (isAlreadyLiked(video)) {
      lastLikedVideoKey = reelKey;
      lastAutoLikedVideo = video;
      log('Auto-like skipped: reel already liked');
      return false;
    }

    const likeButton = findLikeButton(video);
    if (!likeButton) {
      const debugKey = `${reelKey}:like-missing`;
      if (debugKey !== lastLikeDebugKey) {
        lastLikeDebugKey = debugKey;
        const nearbySvgs = Array.from(document.querySelectorAll('svg[aria-label]'))
          .filter((svg) => isOverReelOverlay(svg, video))
          .map((svg) => svg.getAttribute('aria-label'))
          .slice(0, 12);
        log('Auto-like skipped: like button not found', { nearbySvgs, reason });
      }
      return false;
    }

    log('Auto-liking reel from followed creator:', creator);
    likeButton.click();
    lastLikedVideoKey = reelKey;
    lastAutoLikedVideo = video;
    showToast('Auto-liked followed creator');
    return true;
  }

  function onReelsChange() {
    scheduleAutoLike('reel-change');
  }

  function scanVideos() {
    if (!isRunning || state.paused || !isInstagramReelsContext()) return;

    for (const video of getVideos()) {
      prepareVideo(video);
      disableLoop(video);
    }

    if (state.autoLikeFollowedCreators) {
      const reelKey = getCurrentReelKey();
      if (reelKey && reelKey !== lastScanReelKey) {
        lastScanReelKey = reelKey;
        lastAutoLikeLogKey = null;
        scheduleAutoLike('reel-change');
      }
    }
  }

  function updateStatusIndicator() {
    if (!statusIndicator) return;

    const onReels = isInstagramReelsContext();
    statusIndicator.classList.toggle('visible', onReels && state.showPill);

    if (!onReels) return;

    if (state.paused) {
      statusIndicator.classList.add('paused');
      statusIndicator.classList.remove('active');
      statusIndicator.querySelector('.text').textContent = 'Paused';
    } else {
      statusIndicator.classList.add('active');
      statusIndicator.classList.remove('paused');
      statusIndicator.querySelector('.text').textContent = state.autoLikeFollowedCreators ? 'Auto-Scroll + Like' : 'Auto-Scroll';
    }
  }

  function showToast(message) {
    let toast = document.querySelector('.reel-scroller-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'reel-scroller-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 1800);
  }

  function createStatusIndicator() {
    if (statusIndicator) return;

    statusIndicator = document.createElement('button');
    statusIndicator.type = 'button';
    statusIndicator.className = 'reel-scroller-indicator';
    statusIndicator.title = 'Click to pause or resume auto-scroll';
    statusIndicator.innerHTML = `
      <span class="dot"></span>
      <span class="text">Auto-Scroll</span>
    `;

    statusIndicator.addEventListener('click', () => {
      state.paused = !state.paused;
      chrome.storage.local.set({ reelScrollerState: state });
      updateStatusIndicator();
      showToast(state.paused ? 'Auto-scroll paused' : 'Auto-scroll resumed');
      if (state.paused) clearTimeout(pendingScrollTimeout);
      else scanVideos();
    });

    document.body.appendChild(statusIndicator);
    updateStatusIndicator();
  }

  function applyState(nextState) {
    const wasAutoLike = state.autoLikeFollowedCreators;
    state = { ...state, ...nextState };
    log('State updated', {
      paused: state.paused,
      autoLikeFollowedCreators: state.autoLikeFollowedCreators,
      scrollDelay: state.scrollDelay
    });
    updateStatusIndicator();
    if (state.paused) clearTimeout(pendingScrollTimeout);
    else scanVideos();
    if (state.autoLikeFollowedCreators && !wasAutoLike) {
      lastLikedVideoKey = null;
      lastAutoLikedVideo = null;
      scheduleAutoLike('toggle-on');
    }
  }

  function startApp() {
    if (isRunning) return;
    isRunning = true;
    log('Started on Instagram reels context');

    createStatusIndicator();
    scanVideos();

    videoObserver = new MutationObserver(scanVideos);
    videoObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    scanInterval = window.setInterval(scanVideos, 800);
    updateStatusIndicator();
  }

  function stopApp() {
    if (!isRunning) return;
    isRunning = false;
    log('Stopped');

    clearTimeout(pendingScrollTimeout);
    if (videoObserver) {
      videoObserver.disconnect();
      videoObserver = null;
    }
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }

    updateStatusIndicator();
  }

  function checkContext() {
    if (isInstagramReelsContext()) startApp();
    else stopApp();
  }

  function setupStorageListener() {
    chrome.storage.local.get(['reelScrollerState'], (result) => {
      if (result.reelScrollerState) applyState(result.reelScrollerState);
      checkContext();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.reelScrollerState) return;
      applyState(changes.reelScrollerState.newValue);
    });
  }

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'stateUpdate' || message.type === 'stateChange') {
        applyState(message.state);
      }
      sendResponse({ received: true });
      return true;
    });
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      if (event.key !== 'p' && event.key !== 'P') return;

      state.paused = !state.paused;
      chrome.storage.local.set({ reelScrollerState: state });
      updateStatusIndicator();
      showToast(state.paused ? 'Auto-scroll paused' : 'Auto-scroll resumed');
      if (state.paused) clearTimeout(pendingScrollTimeout);
      else scanVideos();
    });
  }

  function setupSpaNavigation() {
    let lastPathname = window.location.pathname;

    const onUrlChange = () => {
      const pathname = window.location.pathname;
      if (pathname === lastPathname) return;

      const reelMatch = pathname.match(/\/reel\/([^/?#]+)/);
      const prevReelMatch = lastPathname.match(/\/reel\/([^/?#]+)/);
      lastPathname = pathname;

      if (reelMatch) {
        const reelId = reelMatch[1];
        if (!prevReelMatch || prevReelMatch[1] !== reelId) {
          log('Reel changed:', reelId);
          lastLikedVideoKey = null;
          lastAutoLikedVideo = null;
          lastScanReelKey = null;
          lastAutoLikeLogKey = null;
        }
        checkContext();
        scheduleAutoLike('reel-url');
        return;
      }

      log('URL changed:', pathname);
      lastLikedVideoKey = null;
      lastAutoLikedVideo = null;
      checkContext();
      scheduleAutoLike('url');
    };

    window.addEventListener('popstate', onUrlChange);

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      originalPushState(...args);
      onUrlChange();
    };

    history.replaceState = (...args) => {
      originalReplaceState(...args);
      onUrlChange();
    };
  }

  function init() {
    setupStorageListener();
    setupMessageListener();
    setupKeyboardShortcuts();
    setupSpaNavigation();
    checkContext();
    log('Content script ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
