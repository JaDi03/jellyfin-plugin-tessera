/**
 * Tessera - Jellyfin Client UI Script
 *
 * Injects Tessera paywall bundle and owns the UI + billing lifecycle.
 * Billing is driven from the browser with arc_cashier_user_id (same model as PeerTube),
 * so Gateway charges match the wallet session the paywall registered.
 *
 * Mode resolution (PeerTube-compatible):
 *   1) Item tags: tessera:free / tessera-free → tip mode (never lock)
 *   2) Item tags: tessera:pay-per-second / tessera:paid → paywall
 *   3) Fallback: window.TESSERA_MODE from plugin global config
 */
(function () {
    'use strict';

    const pluginRoute = '/plugins/tessera';
    const PING_INTERVAL_MS = 15000;

    let paywallInitialized = false;
    let initInFlight = false;
    let hasStartedBilling = false;
    let pingInterval = null;
    let currentItemId = null;
    /** @type {'free'|'pay-per-second'|null} */
    let currentMode = null;
    let attachedVideo = null;
    let videoAbort = null;
    let isCleaningUp = false;
    let lastPlayerPresent = false;

    function dbg(hypothesisId, location, message, data) {
        // #region agent log
        fetch('http://127.0.0.1:7748/ingest/c0f951d1-8dac-4149-9764-01cf090645f1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'44a21f'},body:JSON.stringify({sessionId:'44a21f',runId:'post-fix',hypothesisId:hypothesisId,location:location,message:message,data:data||{},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
    }

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
            const pm = window.playbackManager || window.PlaybackManager;
            if (pm) {
                if (typeof pm.currentItem === 'function') {
                    const item = pm.currentItem();
                    if (item && (item.Id || item.id)) return item.Id || item.id;
                }
                if (pm._currentItem && (pm._currentItem.Id || pm._currentItem.id)) {
                    return pm._currentItem.Id || pm._currentItem.id;
                }
            }
        } catch (_) { /* ignore */ }

        return currentItemId || 'unknown';
    }

    /**
     * Resolve free vs pay-per-second for the current item.
     * Tags override the plugin-wide TESSERA_MODE (same idea as PeerTube per-video metadata).
     */
    async function resolveModeForItem(itemId) {
        const globalMode = window.TESSERA_MODE || 'pay-per-second';
        if (!itemId || itemId === 'unknown' || !window.ApiClient) {
            dbg('H-A', 'paywall-jellyfin.js:resolveModeForItem', 'fallback global (no item/ApiClient)', { itemId: itemId, globalMode: globalMode });
            return { mode: globalMode, tags: [], source: 'global-fallback' };
        }

        try {
            const userId = window.ApiClient.getCurrentUserId();
            const item = await window.ApiClient.getItem(userId, itemId);
            const tags = (item && item.Tags) ? item.Tags.map(function (t) { return String(t).toLowerCase(); }) : [];

            let mode = globalMode;
            let source = 'global-default';
            if (tags.indexOf('tessera:free') !== -1 || tags.indexOf('tessera-free') !== -1 || tags.indexOf('tessera_free') !== -1) {
                mode = 'free';
                source = 'item-tag-free';
            } else if (
                tags.indexOf('tessera:pay-per-second') !== -1
                || tags.indexOf('tessera:paid') !== -1
                || tags.indexOf('tessera-pay') !== -1
                || tags.indexOf('tessera_paid') !== -1
            ) {
                mode = 'pay-per-second';
                source = 'item-tag-paid';
            }

            dbg('H-A', 'paywall-jellyfin.js:resolveModeForItem', 'resolved item mode', {
                itemId: itemId,
                itemName: item && item.Name,
                tags: tags,
                globalMode: globalMode,
                mode: mode,
                source: source,
            });
            return { mode: mode, tags: tags, source: source };
        } catch (err) {
            console.warn('[Tessera] Could not load item tags; using global mode.', err);
            dbg('H-A', 'paywall-jellyfin.js:resolveModeForItem', 'getItem failed', { itemId: itemId, error: String(err && err.message || err), globalMode: globalMode });
            return { mode: globalMode, tags: [], source: 'global-error' };
        }
    }

    async function sendPing(action) {
        // Never bill free / tip-mode content
        if (currentMode === 'free' && action !== 'stop') return;
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

    async function initPaywallEngine() {
        dbg('H-C', 'paywall-jellyfin.js:initPaywallEngine:entry', 'initPaywallEngine entry', {
            paywallInitialized: paywallInitialized,
            initInFlight: initInFlight,
            isPlayer: isVideoPlayerView(),
            hasArcCashier: !!window.ArcCashier,
            rawMode: window.TESSERA_MODE,
            arcLocked: document.body.classList.contains('arc-locked'),
        });

        if (paywallInitialized || initInFlight) return;
        if (!isVideoPlayerView()) return;

        const arcCashier = window.ArcCashier;
        if (!arcCashier) return;

        initInFlight = true;
        currentItemId = getItemId();

        const wallet = window.TESSERA_CREATOR_WALLET || '';
        const rate = window.TESSERA_RATE || 0.0001;

        let resolved;
        try {
            resolved = await resolveModeForItem(currentItemId);
        } catch (err) {
            resolved = { mode: window.TESSERA_MODE || 'pay-per-second', tags: [], source: 'resolve-throw' };
        }

        // Player may have closed while we awaited tags
        if (!isVideoPlayerView()) {
            initInFlight = false;
            return;
        }

        paywallInitialized = true;
        initInFlight = false;
        currentMode = resolved.mode === 'free' ? 'free' : 'pay-per-second';

        const videoEl = getPlayerVideo();
        const targetContainer = (videoEl && videoEl.parentNode)
            || document.querySelector('.htmlVideoPlayerContainer, .videoPlayerContainer, #videoPlayerContainer')
            || document.body;

        dbg('H-A', 'paywall-jellyfin.js:initPaywallEngine:branch', 'mode branch decision', {
            mode: currentMode,
            rawMode: window.TESSERA_MODE,
            source: resolved.source,
            tags: resolved.tags,
            willUseTipMode: currentMode === 'free',
            itemId: currentItemId,
        });

        if (currentMode === 'free') {
            console.log('[Tessera] Initializing tipping widget for free video.', { itemId: currentItemId, source: resolved.source });
            document.body.classList.remove('arc-locked');
            if (typeof arcCashier.initTipMode === 'function') {
                arcCashier.initTipMode(wallet, '0.10');
            }
        } else {
            console.log('[Tessera] Initializing paywall widget on container:', targetContainer, { itemId: currentItemId, source: resolved.source });
            if (typeof arcCashier.initPaywall === 'function') {
                arcCashier.initPaywall(targetContainer);
            }
            if (typeof window.arcResetVideoSession === 'function') {
                window.arcResetVideoSession(rate);
            }
        }

        dbg('H-B', 'paywall-jellyfin.js:initPaywallEngine:after', 'after init branch', {
            mode: currentMode,
            arcLocked: document.body.classList.contains('arc-locked'),
            hasOverlay: !!document.getElementById('arc-paywall-overlay'),
            hasTipBtn: !!document.getElementById('arc-tip-btn-container'),
        });

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
            if (currentMode === 'free') {
                setMediaPlaying(true);
                return;
            }
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
            if (currentMode !== 'free') sendPing('stop');
        }, { signal: signal });

        video.addEventListener('ended', function () {
            hasStartedBilling = false;
            setMediaPlaying(false);
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            if (currentMode !== 'free') sendPing('stop');
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

        if (currentMode !== 'free') {
            await sendPing('stop');
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
    console.log('[Tessera] Native Client UI Script loaded.');
})();
