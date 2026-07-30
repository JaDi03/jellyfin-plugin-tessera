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

    /**
     * Extract Jellyfin item ID from current URL hash/query
     */
    function getCurrentItemId() {
        const match = window.location.href.match(/[?&]id=([a-f0-9]{32})/i);
        return match ? match[1] : 'default';
    }

    /**
     * Fetch video monetization mode: checks Jellyfin Item Tags first, falls back to global setting
     */
    async function getItemMonetizationMode(itemId) {
        const globalMode = window.TESSERA_MODE || 'pay-per-second';
        if (!window.ApiClient || typeof window.ApiClient.getItem !== 'function' || !itemId || itemId === 'default') {
            return globalMode;
        }

        try {
            const userId = window.ApiClient.getCurrentUserId();
            const item = await window.ApiClient.getItem(userId, itemId);
            if (item && Array.isArray(item.Tags)) {
                if (item.Tags.includes('tessera:free') || item.Tags.includes('tessera-free')) {
                    console.log('[Tessera] Video tagged as free:', itemId);
                    return 'free';
                }
                if (item.Tags.includes('tessera:pay-per-second') || item.Tags.includes('tessera-pay-per-second')) {
                    console.log('[Tessera] Video tagged as pay-per-second:', itemId);
                    return 'pay-per-second';
                }
            }
        } catch (err) {
            console.warn('[Tessera] Could not fetch Jellyfin item tags:', err);
        }

        return globalMode;
    }

    /**
     * Initialize the paywall or tipping engine based on configured mode
     */
    async function initPaywallEngine() {
        const itemId = getCurrentItemId();
        if (paywallInitialized && currentInitializedItemId === itemId) {
            return;
        }

        const arcCashier = window.ArcCashier;
        if (!arcCashier) return;

        paywallInitialized = true;
        currentInitializedItemId = itemId;

        const mode = await getItemMonetizationMode(itemId);
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

    // 1. Auto-inject Tessera paywall bundle immediately on page startup for instant sidecar log initialization
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

    // Reset init state on navigation
    window.addEventListener('hashchange', function () {
        paywallInitialized = false;
        currentInitializedItemId = null;
    });

    // Listen for video playback start
    document.addEventListener('play', function (e) {
        if (e.target && e.target.tagName === 'VIDEO') {
            const newItemId = getCurrentItemId();
            if (currentInitializedItemId !== newItemId) {
                paywallInitialized = false;
            }
            initPaywallEngine();
        }
    }, true);

    // MutationObserver only needs to detect SPA navigation to a video page now
    // that native button injection was removed (that removal also eliminates
    // the mutation feedback loop that was the primary cause of the reported
    // main-thread freeze: injectOSDButton/injectDetailButton ran
    // querySelectorAll + DOM inserts on every mutation, which triggered new
    // mutations, in a tight loop). requestAnimationFrame coalescing is kept
    // as defense-in-depth against high-frequency OSD updates.
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
