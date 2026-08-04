/**
 * Tessera - Jellyfin Native Client UI Script
 *
 * Injects native Jellyfin OSD and Detail Page controls, native emby-dialog modals,
 * Circle User-Controlled Wallet management, and HTML5 video playback session enforcement.
 */
(function () {
    'use strict';

    const pluginRoute = '/plugins/tessera';
    let paywallInitialized = false;
    let currentInitializedItemId = null;

    const QUERY_ID_REGEX = /[?&]id=([a-f0-9]{32})/i;
    const PATH_ID_REGEX = /\/(?:Items|Videos|Audio)\/([a-f0-9]{32})\b/i;

    const URL_RETRY_DELAYS_MS = [150, 300, 600, 1200];
    const SESSION_LOOKUP_RETRY_DELAYS_MS = [500, 750, 1000, 1500];

    let navigationEpoch = 0;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function extractIdFromUrlString(str) {
        if (!str) return null;
        const queryMatch = str.match(QUERY_ID_REGEX);
        if (queryMatch) return queryMatch[1];
        const pathMatch = str.match(PATH_ID_REGEX);
        return pathMatch ? pathMatch[1] : null;
    }

    function extractIdFromVideoElement() {
        const videoEl = document.querySelector('video');
        if (!videoEl) return null;
        return extractIdFromUrlString(videoEl.currentSrc) || extractIdFromUrlString(videoEl.src);
    }

    async function fetchNowPlayingItemIdFromSession() {
        if (
            !window.ApiClient ||
            typeof window.ApiClient.serverAddress !== 'function' ||
            typeof window.ApiClient.accessToken !== 'function' ||
            typeof window.ApiClient.deviceId !== 'function'
        ) {
            return null;
        }

        const deviceId = window.ApiClient.deviceId();
        if (!deviceId) return null;

        const serverAddress = window.ApiClient.serverAddress();
        const accessToken = window.ApiClient.accessToken();
        const url = `${serverAddress}/Sessions?deviceId=${encodeURIComponent(deviceId)}`;

        try {
            const res = await fetch(url, {
                headers: accessToken ? { 'X-Emby-Token': accessToken } : {},
            });
            if (!res.ok) {
                console.warn('[Tessera] Session lookup returned non-OK status:', res.status);
                return null;
            }

            const sessions = await res.json();
            if (!Array.isArray(sessions) || sessions.length === 0) return null;

            const playingSessions = sessions.filter((s) => s && s.NowPlayingItem && s.NowPlayingItem.Id);
            if (playingSessions.length === 0) return null;

            playingSessions.sort((a, b) => {
                const aDate = a.LastActivityDate ? Date.parse(a.LastActivityDate) : 0;
                const bDate = b.LastActivityDate ? Date.parse(b.LastActivityDate) : 0;
                return bDate - aDate;
            });

            return playingSessions[0].NowPlayingItem.Id;
        } catch (err) {
            console.warn('[Tessera] Session lookup request failed:', err);
            return null;
        }
    }

    let lastAppliedItemId = null;
    let navigatedSincePlayResolution = false;

    async function resolveCurrentItemId() {
        const isStaleCandidate = (candidate) =>
            navigatedSincePlayResolution && lastAppliedItemId !== null && candidate === lastAppliedItemId;

        let bestGuess = null;

        let id = extractIdFromUrlString(window.location.href) || extractIdFromVideoElement();
        if (id && !isStaleCandidate(id)) return id;
        if (id) bestGuess = id;

        for (const delay of URL_RETRY_DELAYS_MS) {
            await sleep(delay);
            id = extractIdFromUrlString(window.location.href) || extractIdFromVideoElement();
            if (id && !isStaleCandidate(id)) return id;
            if (id) bestGuess = id;
        }

        for (const delay of SESSION_LOOKUP_RETRY_DELAYS_MS) {
            id = await fetchNowPlayingItemIdFromSession();
            if (id && !isStaleCandidate(id)) return id;
            if (id) bestGuess = id;
            await sleep(delay);
        }

        if (bestGuess) {
            return bestGuess;
        }

        console.warn('[Tessera] Could not resolve item ID after all strategies; falling back to global mode.');
        return 'default';
    }

    const modeCache = new Map();

    async function fetchItemTags(itemId) {
        if (
            !window.ApiClient ||
            typeof window.ApiClient.serverAddress !== 'function' ||
            typeof window.ApiClient.accessToken !== 'function' ||
            typeof window.ApiClient.getCurrentUserId !== 'function'
        ) {
            return null;
        }

        const userId = window.ApiClient.getCurrentUserId();
        if (!userId) return null;

        const serverAddress = window.ApiClient.serverAddress();
        const accessToken = window.ApiClient.accessToken();
        const url = `${serverAddress}/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}?Fields=Tags`;

        try {
            const res = await fetch(url, {
                headers: accessToken ? { 'X-Emby-Token': accessToken } : {},
            });
            if (!res.ok) {
                console.warn('[Tessera] Item Tags lookup failed with status', res.status);
                return null;
            }
            const item = await res.json();
            return Array.isArray(item.Tags) ? item.Tags : [];
        } catch (err) {
            console.warn('[Tessera] Item Tags lookup request failed:', err);
            return null;
        }
    }

    async function getItemMonetizationMode(itemId) {
        const globalMode = window.TESSERA_MODE || 'pay-per-second';
        if (!itemId || itemId === 'default') {
            return globalMode;
        }

        if (modeCache.has(itemId)) {
            return modeCache.get(itemId);
        }

        const tags = await fetchItemTags(itemId);
        let mode = globalMode;

        if (tags) {
            if (tags.includes('tessera:free') || tags.includes('tessera-free')) {
                console.log('[Tessera] Video tagged as free:', itemId);
                mode = 'free';
            } else if (tags.includes('tessera:pay-per-second') || tags.includes('tessera-pay-per-second')) {
                console.log('[Tessera] Video tagged as pay-per-second:', itemId);
                mode = 'pay-per-second';
            }
        }

        modeCache.set(itemId, mode);
        return mode;
    }

    async function initPaywallEngine() {
        const epoch = ++navigationEpoch;

        const itemId = await resolveCurrentItemId();
        if (epoch !== navigationEpoch) return;

        navigatedSincePlayResolution = false;
        lastAppliedItemId = itemId;

        if (paywallInitialized && currentInitializedItemId === itemId) {
            return;
        }

        const arcCashier = window.ArcCashier;
        if (!arcCashier) return;

        paywallInitialized = true;
        currentInitializedItemId = itemId;

        const mode = await getItemMonetizationMode(itemId);
        if (epoch !== navigationEpoch) return;

        const wallet = window.TESSERA_CREATOR_WALLET || '';
        const rate = window.TESSERA_RATE || 0.0001;

        const videoEl = document.querySelector('video');
        const targetContainer = (videoEl && videoEl.parentNode)
            || document.querySelector('.htmlVideoPlayerContainer, .videoPlayerContainer, #videoPlayerContainer')
            || document.body;

        if (mode === 'free') {
            console.log('[Tessera] Free video mode active. Initializing tipping widget.');
            document.body.classList.remove('arc-locked');
            if (typeof arcCashier.initTipMode === 'function') {
                arcCashier.initTipMode(wallet, '0.10');
            }
        } else {
            console.log('[Tessera] Pay-per-second mode active. Initializing paywall on container:', targetContainer);
            if (typeof arcCashier.initPaywall === 'function') {
                arcCashier.initPaywall(targetContainer);
            }
            if (typeof window.arcResetVideoSession === 'function') {
                window.arcResetVideoSession(rate);
            }
        }
    }

    if (!document.getElementById('tessera-paywall-bundle')) {
        const bundleScript = document.createElement('script');
        bundleScript.id = 'tessera-paywall-bundle';
        bundleScript.src = `${pluginRoute}/assets/paywall.bundle.js`;
        bundleScript.onload = function () {
            if (document.querySelector('video')) {
                initPaywallEngine();
            }
        };
        document.head.appendChild(bundleScript);
    }

    function teardownActiveSessionOnNavigateAway() {
        if (typeof window.arcTeardownOnNavigate === 'function') {
            window.arcTeardownOnNavigate();
        }
    }

    window.addEventListener('hashchange', function () {
        teardownActiveSessionOnNavigateAway();
        paywallInitialized = false;
        currentInitializedItemId = null;
        navigationEpoch++;
        navigatedSincePlayResolution = true;
    });

    window.addEventListener('pagehide', teardownActiveSessionOnNavigateAway);

    document.addEventListener('play', function (e) {
        if (e.target && e.target.tagName === 'VIDEO') {
            initPaywallEngine();
        }
    }, true);

    let mutationScheduled = false;
    function handleDomMutations() {
        if (mutationScheduled) return;
        mutationScheduled = true;
        window.requestAnimationFrame(function () {
            mutationScheduled = false;
            if (document.querySelector('video') && !paywallInitialized) {
                initPaywallEngine();
            }
        });
    }

    const observer = new MutationObserver(handleDomMutations);
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[Tessera] Native Client UI Script loaded.');
})();
