/**
 * Tessera - Jellyfin Client UI Script
 *
 * Mode comes from Jellyfin PlaybackStart (server) via GET /playback-state.
 * No URL guessing. No PeerTube-style client pings for mode detection.
 */
(function () {
    'use strict';

    // Avoid double-inject (plugin script tag + cached VM copy) doubling polls/listeners.
    if (window.__tesseraPaywallJellyfinLoaded) return;
    window.__tesseraPaywallJellyfinLoaded = true;

    const pluginRoute = '/plugins/tessera';
    // Faster poll: shortens the visible gap between player chrome and tip/paywall UI.
    const STATE_POLL_MS = 100;
    const STATE_POLL_MAX = 40;

    let paywallInitialized = false;
    let initInFlight = false;
    let currentItemId = null;
    let currentMode = null;
    let billingActive = false;
    let attachedVideo = null;
    let videoAbort = null;
    let isCleaningUp = false;
    let lastPlayerPresent = false;

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function ensurePendingStyle() {
        if (document.getElementById('tessera-pending-style')) return;
        const style = document.createElement('style');
        style.id = 'tessera-pending-style';
        style.textContent =
            '#tessera-mode-pending{position:absolute;inset:0;z-index:9998;' +
            'background:rgba(0,0,0,.55);pointer-events:none;}';
        document.head.appendChild(style);
    }

    /** Neutral veil while mode resolves: not a paywall / not "Initializing". */
    function showModePending() {
        if (document.getElementById('tessera-mode-pending')) return;
        ensurePendingStyle();
        const host = document.querySelector(
            '.htmlVideoPlayerContainer, .videoPlayerContainer, #videoPlayerContainer'
        ) || (getPlayerVideo() && getPlayerVideo().parentNode);
        if (!host) return;
        try {
            if (window.getComputedStyle(host).position === 'static') {
                host.style.position = 'relative';
            }
        } catch (_) { /* ignore */ }
        const el = document.createElement('div');
        el.id = 'tessera-mode-pending';
        host.appendChild(el);
    }

    function clearModePending() {
        const el = document.getElementById('tessera-mode-pending');
        if (el) el.remove();
    }

    function getDeviceId() {
        try {
            return window.ApiClient && typeof window.ApiClient.deviceId === 'function'
                ? window.ApiClient.deviceId()
                : null;
        } catch (_) {
            return null;
        }
    }

    function getPaywallUserId() {
        try {
            return localStorage.getItem('arc_cashier_user_id');
        } catch (_) {
            return null;
        }
    }

    /** Same prefixes as Tessera sidecar isValidViewerUserId. */
    function isValidTesseraUserId(id) {
        if (!id || typeof id !== 'string') return false;
        if (id.length < 7 || id.length > 256) return false;
        return id.startsWith('email:') || id.startsWith('social:') || id.startsWith('arc_');
    }

    /**
     * True only when Jellyfin's real video OSD / html5 player chrome is present.
     * Detail-page trailers and backdrop videos must NOT match.
     */
    function isVideoPlayerView() {
        return !!(
            document.querySelector('.videoOsdBottom')
            || document.querySelector('#videoOsdPage')
            || document.querySelector('.htmlVideoPlayerContainer video')
            || document.querySelector('video.htmlvideoplayer')
        );
    }

    /** Circle OAuth returns on location.hash; do not teardown while that resume is in flight. */
    function isSocialLoginReturn() {
        try {
            if (document.getElementById('arc-social-resume-splash')) return true;
            if (sessionStorage.getItem('tessera_opaque_cover')) return true;
            const pending = sessionStorage.getItem('tessera_social_login_pending');
            const hash = window.location.hash || '';
            const oauthHash = /^#(?:[a-zA-Z0-9-_.%]+=[^&]*&)*[a-zA-Z0-9-_.%]+=[^&]*$/.test(hash);
            return Boolean(pending && oauthHash);
        } catch (_) {
            return false;
        }
    }

    function hideSocialResumeSplash() {
        const el = document.getElementById('arc-social-resume-splash');
        if (el) el.remove();
        try { sessionStorage.removeItem('tessera_opaque_cover'); } catch (_) { /* ignore */ }
    }

    function getPlayerVideo() {
        return document.querySelector(
            '.htmlVideoPlayerContainer video, video.htmlvideoplayer, #videoOsdPage video, .videoPlayerContainer video'
        );
    }

    function setMediaPlaying(isPlaying) {
        window.arcManualMediaControl = true;
        if (typeof window.arcSetMediaPlaying === 'function') {
            window.arcSetMediaPlaying(isPlaying);
        }
    }

    async function fetchPlaybackState(deviceId) {
        const res = await fetch(
            pluginRoute + '/playback-state?deviceId=' + encodeURIComponent(deviceId),
            { credentials: 'same-origin' }
        );
        // Legacy 404 = not ready yet. Prefer 200 { ready: false } to avoid console spam.
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('playback-state HTTP ' + res.status);
        const body = await res.json();
        if (!body || body.ready === false || !body.itemId) return null;
        return body;
    }

    async function waitForPlaybackState(deviceId) {
        for (let i = 0; i < STATE_POLL_MAX; i++) {
            if (!isVideoPlayerView()) return null;
            const state = await fetchPlaybackState(deviceId);
            if (state && state.itemId) return state;
            await sleep(STATE_POLL_MS);
        }
        return null;
    }

    async function registerViewer(deviceId, sessionId) {
        const res = await fetch(pluginRoute + '/register-viewer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ deviceId: deviceId, sessionId: sessionId }),
        });
        if (!res.ok) {
            console.error('[Tessera] register-viewer HTTP ' + res.status);
            return false;
        }
        return true;
    }

    async function billingStart(deviceId, sessionId) {
        const res = await fetch(pluginRoute + '/billing-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ deviceId: deviceId, sessionId: sessionId }),
        });
        if (!res.ok) {
            console.error('[Tessera] billing-start HTTP ' + res.status);
            return false;
        }
        return true;
    }

    async function billingStop(deviceId, sessionId) {
        try {
            await fetch(pluginRoute + '/billing-stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ deviceId: deviceId, sessionId: sessionId }),
            });
        } catch (_) { /* best effort */ }
        billingActive = false;
    }

    window.tesseraOnPaywallUnlocked = async function () {
        if (currentMode !== 'pay-per-second') return;
        const deviceId = getDeviceId();
        const sessionId = getPaywallUserId();
        if (!deviceId || !isValidTesseraUserId(sessionId)) return;
        if (billingActive) return;
        const registered = await registerViewer(deviceId, sessionId);
        if (!registered) return;
        const ok = await billingStart(deviceId, sessionId);
        if (ok) billingActive = true;
    };

    async function initPaywallEngine() {
        if (paywallInitialized || initInFlight) return;
        if (!isVideoPlayerView()) return;

        const deviceId = getDeviceId();
        if (!deviceId) {
            console.warn('[Tessera] No deviceId - cannot read playback state.');
            return;
        }

        const arcCashier = window.ArcCashier;
        if (!arcCashier) return;

        initInFlight = true;
        showModePending();

        let state = null;
        try {
            state = await waitForPlaybackState(deviceId);
        } catch (err) {
            console.warn('[Tessera] playback-state poll failed:', err);
            clearModePending();
            initInFlight = false;
            return;
        }

        // Player may have closed while we awaited state
        if (!isVideoPlayerView()) {
            clearModePending();
            initInFlight = false;
            return;
        }

        if (!state) {
            console.warn('[Tessera] No playback state from Jellyfin yet.');
            clearModePending();
            initInFlight = false;
            if (!isSocialLoginReturn()) hideSocialResumeSplash();
            return;
        }

        if (paywallInitialized && currentItemId === state.itemId) {
            clearModePending();
            initInFlight = false;
            return;
        }

        paywallInitialized = true;
        initInFlight = false;
        currentItemId = state.itemId;
        currentMode = state.mode === 'free' ? 'free' : 'pay-per-second';

        const wallet = window.TESSERA_CREATOR_WALLET || '';
        const rate = window.TESSERA_RATE || 0.0001;

        const videoEl = getPlayerVideo();
        const targetContainer = (videoEl && videoEl.parentNode)
            || document.querySelector('.htmlVideoPlayerContainer, .videoPlayerContainer, #videoPlayerContainer')
            || document.body;

        console.log('[Tessera] Playback state:', state);

        if (currentMode === 'free') {
            document.body.classList.remove('arc-locked');
            if (typeof arcCashier.initTipMode === 'function') {
                arcCashier.initTipMode(wallet, '0.10');
            }
            const sessionId = getPaywallUserId();
            if (isValidTesseraUserId(sessionId)) await registerViewer(deviceId, sessionId);
        } else {
            if (typeof arcCashier.initPaywall === 'function') {
                arcCashier.initPaywall(targetContainer);
            }
            if (typeof window.arcResetVideoSession === 'function') {
                window.arcResetVideoSession(rate);
            }
        }

        clearModePending();
        if (videoEl) attachVideoListeners(videoEl);
    }

    function attachVideoListeners(video) {
        if (attachedVideo === video) return;

        if (videoAbort) videoAbort.abort();
        videoAbort = new AbortController();
        const { signal } = videoAbort;
        attachedVideo = video;
        window.arcManualMediaControl = true;

        video.addEventListener('play', function () {
            if (!isVideoPlayerView()) return;
            setMediaPlaying(true);

            // Strict: null/unknown must not bill (avoids 404 race before playback-state).
            if (currentMode !== 'pay-per-second') return;
            if (document.body.classList.contains('arc-locked')) return;
            if (billingActive) return;

            const deviceId = getDeviceId();
            const sessionId = getPaywallUserId();
            if (!deviceId || !isValidTesseraUserId(sessionId)) return;
            registerViewer(deviceId, sessionId).then(function (registered) {
                if (!registered) return false;
                return billingStart(deviceId, sessionId);
            }).then(function (ok) {
                if (ok) billingActive = true;
            }).catch(function () { /* best effort */ });
        }, { signal: signal });

        video.addEventListener('pause', function () {
            setMediaPlaying(false);
            if (currentMode === 'pay-per-second' && billingActive) {
                const deviceId = getDeviceId();
                const sessionId = getPaywallUserId();
                if (deviceId && isValidTesseraUserId(sessionId)) billingStop(deviceId, sessionId);
            }
        }, { signal: signal });

        video.addEventListener('ended', function () {
            setMediaPlaying(false);
            if (currentMode === 'pay-per-second' && billingActive) {
                const deviceId = getDeviceId();
                const sessionId = getPaywallUserId();
                if (deviceId && isValidTesseraUserId(sessionId)) billingStop(deviceId, sessionId);
            }
        }, { signal: signal });
    }

    async function teardownUiOnNavigate() {
        if (isCleaningUp) return;
        isCleaningUp = true;

        setMediaPlaying(false);

        const deviceId = getDeviceId();
        const sessionId = getPaywallUserId();
        if (deviceId && isValidTesseraUserId(sessionId) && currentMode === 'pay-per-second' && billingActive) {
            await billingStop(deviceId, sessionId);
        }

        if (videoAbort) {
            videoAbort.abort();
            videoAbort = null;
        }
        attachedVideo = null;
        currentItemId = null;
        currentMode = null;
        paywallInitialized = false;
        initInFlight = false;
        billingActive = false;
        clearModePending();

        if (typeof window.arcTeardownOnNavigate === 'function') {
            await window.arcTeardownOnNavigate();
        } else {
            const sm = document.getElementById('arc-session-manager');
            if (sm) sm.remove();
            const tip = document.getElementById('arc-tip-btn-container');
            if (tip) tip.remove();
            const overlay = document.getElementById('arc-paywall-overlay');
            if (overlay) overlay.remove();
            document.body.classList.remove('arc-locked');
        }

        isCleaningUp = false;
    }

    if (!document.getElementById('tessera-paywall-bundle')) {
        const bundleScript = document.createElement('script');
        bundleScript.id = 'tessera-paywall-bundle';
        bundleScript.src = pluginRoute + '/assets/paywall.bundle.js';
        bundleScript.onload = function () {
            if (isVideoPlayerView()) initPaywallEngine();
        };
        document.head.appendChild(bundleScript);
    }

    window.addEventListener('hashchange', function () {
        if (isSocialLoginReturn()) return;
        teardownUiOnNavigate();
    });
    window.addEventListener('popstate', function () {
        if (isSocialLoginReturn()) return;
        teardownUiOnNavigate();
    });
    window.addEventListener('pagehide', function () {
        teardownUiOnNavigate();
    });

    // Re-init only for the real player; never for detail/preview trailers.
    // Do not attach video listeners until init sets currentMode (same play event
    // would otherwise race billing-start before playback-state exists).
    document.addEventListener('play', function (e) {
        if (!e.target || e.target.tagName !== 'VIDEO') return;
        if (!isVideoPlayerView()) return;
        if (!paywallInitialized) {
            initPaywallEngine();
            return;
        }
        if (e.target !== attachedVideo) attachVideoListeners(e.target);
    }, true);

    let mutationScheduled = false;
    function handleDomMutations() {
        if (mutationScheduled) return;
        mutationScheduled = true;
        window.requestAnimationFrame(function () {
            mutationScheduled = false;
            const playerPresent = isVideoPlayerView();

            if (lastPlayerPresent && !playerPresent) {
                if (!isSocialLoginReturn()) teardownUiOnNavigate();
            } else if (playerPresent && !paywallInitialized && !initInFlight) {
                initPaywallEngine();
            } else if (playerPresent && paywallInitialized) {
                const video = getPlayerVideo();
                if (video && video !== attachedVideo) attachVideoListeners(video);
            }

            lastPlayerPresent = playerPresent;
        });
    }

    const observer = new MutationObserver(handleDomMutations);
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[Tessera] Client loaded - mode from Jellyfin PlaybackStart via /playback-state');
})();
