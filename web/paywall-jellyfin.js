/**
 * Tessera - Jellyfin Client UI Script
 *
 * Injects Tessera paywall bundle, UI overlay, and handles client-side UI widget lifecycle.
 * Server-side session lifecycle (PlaybackStart / PlaybackStop) is handled natively by ServerEntryPoint.cs.
 */
(function () {
    'use strict';

    const pluginRoute = '/plugins/tessera';
    let paywallInitialized = false;

    /**
     * Initialize the paywall or tipping widget based on server configuration.
     */
    function initPaywallEngine() {
        if (paywallInitialized) return;

        const arcCashier = window.ArcCashier;
        if (!arcCashier) return;

        paywallInitialized = true;

        const mode = window.TESSERA_MODE || 'pay-per-second';
        const wallet = window.TESSERA_CREATOR_WALLET || '';
        const rate = window.TESSERA_RATE || 0.0001;

        const videoEl = document.querySelector('video');
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
    }

    // Auto-inject Tessera paywall bundle on page startup
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

    // Clean up UI widgets on SPA navigation
    function teardownUiOnNavigate() {
        if (typeof window.arcTeardownOnNavigate === 'function') {
            window.arcTeardownOnNavigate();
        }
        paywallInitialized = false;
    }

    window.addEventListener('hashchange', teardownUiOnNavigate);
    window.addEventListener('pagehide', teardownUiOnNavigate);

    // Listen for video playback start to initialize UI overlay
    document.addEventListener('play', function (e) {
        if (e.target && e.target.tagName === 'VIDEO') {
            initPaywallEngine();
        }
    }, true);

    // Observer fallback for SPA navigation to video view
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
