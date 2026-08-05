/**
 * Tessera - Jellyfin Client UI Script
 *
 * Injects Tessera paywall bundle and owns the UI + billing lifecycle.
 * Billing is driven from the browser with arc_cashier_user_id (same model as PeerTube),
 * so Gateway charges match the wallet session the paywall registered.
 */
(function () {
    'use strict';

    const pluginRoute = '/plugins/tessera';
    const PING_INTERVAL_MS = 15000;

    let paywallInitialized = false;
    let hasStartedBilling = false;
    let pingInterval = null;
    let currentItemId = null;
    let attachedVideo = null;
    let videoAbort = null;
    let isCleaningUp = false;
    let lastPlayerPresent = false;

    function getPaywallUserId() {
        try {
            return localStorage.getItem('arc_cashier_user_id');
        } catch (_) {
            return null;
        }
    }

    function isPaywallUnlocked() {
        try {
            return !document.body.classList.contains('arc-locked');
        } catch (_) {
            return false;
        }
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

    function getPlayerVideo() {
        return document.querySelector(
            '.htmlVideoPlayerContainer video, video.htmlvideoplayer, #videoOsdPage video, .videoPlayerContainer video'
        );
    }

    function getItemId() {
        const hash = window.location.hash || '';
        const match = hash.match(/[?&]id=([^&]+)/i);
        if (match && match[1]) return decodeURIComponent(match[1]);

        try {
            if (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function') {
                // Fall back to a stable placeholder; connector tolerates unknown item ids.
            }
        } catch (_) { /* ignore */ }

        return currentItemId || 'unknown';
    }

    async function sendPing(action) {
        if (action !== 'stop' && !isPaywallUnlocked()) return;

        const sessionId = getPaywallUserId();
        if (!sessionId || !String(sessionId).startsWith('arc_')) return;

        const itemId = getItemId();
        try {
            await fetch(pluginRoute + '/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: action,
                    sessionId: sessionId,
                    itemId: itemId,
                    itemName: document.title || 'Jellyfin Media',
                }),
            });
        } catch (err) {
            console.error('[Tessera] Ping failed:', err);
            if (action === 'start') hasStartedBilling = false;
        }
    }

    function setMediaPlaying(isPlaying) {
        window.arcManualMediaControl = true;
        if (typeof window.arcSetMediaPlaying === 'function') {
            window.arcSetMediaPlaying(isPlaying);
        }
    }

    function initPaywallEngine() {
        if (paywallInitialized) return;
        if (!isVideoPlayerView()) return;

        const arcCashier = window.ArcCashier;
        if (!arcCashier) return;

        paywallInitialized = true;
        currentItemId = getItemId();

        const mode = window.TESSERA_MODE || 'pay-per-second';
        const wallet = window.TESSERA_CREATOR_WALLET || '';
        const rate = window.TESSERA_RATE || 0.0001;

        const videoEl = getPlayerVideo();
        const targetContainer = (videoEl && videoEl.parentNode)
            || document.querySelector('.htmlVideoPlayerContainer, .videoPlayerContainer, #videoPlayerContainer')
            || document.body;

        if (mode === 'free') {
            console.log('[Tessera] Initializing tipping widget for free video.');
            document.body.classList.remove('arc-locked');
            if (typeof arcCashier.initTipMode === 'function') {
                arcCashier.initTipMode(wallet, '0.10');
            }
        } else {
            console.log('[Tessera] Initializing paywall widget on container:', targetContainer);
            if (typeof arcCashier.initPaywall === 'function') {
                arcCashier.initPaywall(targetContainer);
            }
            if (typeof window.arcResetVideoSession === 'function') {
                window.arcResetVideoSession(rate);
            }
        }

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
            if (!isPaywallUnlocked()) return;

            setMediaPlaying(true);
            if (hasStartedBilling) return;

            hasStartedBilling = true;
            if (pingInterval) clearInterval(pingInterval);
            sendPing('start');
            pingInterval = window.setInterval(function () {
                sendPing('ping');
            }, PING_INTERVAL_MS);
        }, { signal: signal });

        video.addEventListener('pause', function () {
            hasStartedBilling = false;
            setMediaPlaying(false);
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            sendPing('stop');
        }, { signal: signal });

        video.addEventListener('ended', function () {
            hasStartedBilling = false;
            setMediaPlaying(false);
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            sendPing('stop');
        }, { signal: signal });
    }

    async function teardownUiOnNavigate() {
        if (isCleaningUp) return;
        isCleaningUp = true;

        hasStartedBilling = false;
        setMediaPlaying(false);

        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }

        await sendPing('stop');

        if (videoAbort) {
            videoAbort.abort();
            videoAbort = null;
        }
        attachedVideo = null;
        currentItemId = null;
        paywallInitialized = false;

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

    // Auto-inject Tessera paywall bundle on page startup
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
        teardownUiOnNavigate();
    });
    window.addEventListener('popstate', function () {
        teardownUiOnNavigate();
    });
    window.addEventListener('pagehide', function () {
        teardownUiOnNavigate();
    });

    // Re-init only for the real player; never for detail/preview trailers.
    document.addEventListener('play', function (e) {
        if (!e.target || e.target.tagName !== 'VIDEO') return;
        if (!isVideoPlayerView()) return;
        initPaywallEngine();
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
                teardownUiOnNavigate();
            } else if (playerPresent && !paywallInitialized) {
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
    console.log('[Tessera] Native Client UI Script loaded.');
})();
