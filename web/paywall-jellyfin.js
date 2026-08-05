/**
 * Tessera - Jellyfin Client UI Script
 *
 * Mode comes from Jellyfin PlaybackStart (server) via GET /playback-state.
 * No URL guessing. No PeerTube-style client pings for mode detection.
 */
(function () {
    'use strict';

    const pluginRoute = '/plugins/tessera';
    const STATE_POLL_MS = 400;
    const STATE_POLL_MAX = 20;

    let paywallInitialized = false;
    let currentItemId = null;
    let currentMode = null;
    let billingActive = false;

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
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

    async function fetchPlaybackState(deviceId) {
        const res = await fetch(
            pluginRoute + '/playback-state?deviceId=' + encodeURIComponent(deviceId),
            { credentials: 'same-origin' }
        );
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('playback-state HTTP ' + res.status);
        return res.json();
    }

    async function waitForPlaybackState(deviceId) {
        for (let i = 0; i < STATE_POLL_MAX; i++) {
            const state = await fetchPlaybackState(deviceId);
            if (state && state.itemId) return state;
            await sleep(STATE_POLL_MS);
        }
        return null;
    }

    async function registerViewer(deviceId, sessionId) {
        await fetch(pluginRoute + '/register-viewer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ deviceId: deviceId, sessionId: sessionId }),
        });
    }

    async function billingStart(deviceId, sessionId) {
        const res = await fetch(pluginRoute + '/billing-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ deviceId: deviceId, sessionId: sessionId }),
        });
        return res.ok;
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
        if (!deviceId || !sessionId || !sessionId.startsWith('arc_')) return;
        if (billingActive) return;
        await registerViewer(deviceId, sessionId);
        const ok = await billingStart(deviceId, sessionId);
        if (ok) billingActive = true;
    };

    async function initPaywallEngine() {
        const deviceId = getDeviceId();
        if (!deviceId) {
            console.warn('[Tessera] No deviceId — cannot read playback state.');
            return;
        }

        const state = await waitForPlaybackState(deviceId);
        if (!state) {
            console.warn('[Tessera] No playback state from Jellyfin yet.');
            return;
        }

        if (paywallInitialized && currentItemId === state.itemId) return;

        const arcCashier = window.ArcCashier;
        if (!arcCashier) return;

        paywallInitialized = true;
        currentItemId = state.itemId;
        currentMode = state.mode === 'free' ? 'free' : 'pay-per-second';

        const wallet = window.TESSERA_CREATOR_WALLET || '';
        const rate = window.TESSERA_RATE || 0.0001;

        const videoEl = document.querySelector('video');
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
            if (sessionId) await registerViewer(deviceId, sessionId);
        } else {
            if (typeof arcCashier.initPaywall === 'function') {
                arcCashier.initPaywall(targetContainer);
            }
            if (typeof window.arcResetVideoSession === 'function') {
                window.arcResetVideoSession(rate);
            }
        }
    }

    function teardownUiOnNavigate() {
        const deviceId = getDeviceId();
        const sessionId = getPaywallUserId();
        if (deviceId && sessionId && currentMode === 'pay-per-second') {
            billingStop(deviceId, sessionId);
        }

        if (typeof window.arcTeardownOnNavigate === 'function') {
            window.arcTeardownOnNavigate();
        } else {
            document.body.classList.remove('arc-locked');
        }

        paywallInitialized = false;
        currentItemId = null;
        currentMode = null;
        billingActive = false;
    }

    if (!document.getElementById('tessera-paywall-bundle')) {
        const bundleScript = document.createElement('script');
        bundleScript.id = 'tessera-paywall-bundle';
        bundleScript.src = pluginRoute + '/assets/paywall.bundle.js';
        bundleScript.onload = function () {
            if (document.querySelector('video')) initPaywallEngine();
        };
        document.head.appendChild(bundleScript);
    }

    window.addEventListener('hashchange', teardownUiOnNavigate);
    window.addEventListener('pagehide', teardownUiOnNavigate);

    document.addEventListener('play', function (e) {
        if (e.target && e.target.tagName === 'VIDEO') {
            initPaywallEngine();
        }
    }, true);

    let mutationScheduled = false;
    const observer = new MutationObserver(function () {
        if (mutationScheduled) return;
        mutationScheduled = true;
        window.requestAnimationFrame(function () {
            mutationScheduled = false;
            if (document.querySelector('video') && !paywallInitialized) {
                initPaywallEngine();
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[Tessera] Client loaded — mode from Jellyfin PlaybackStart via /playback-state');
})();
