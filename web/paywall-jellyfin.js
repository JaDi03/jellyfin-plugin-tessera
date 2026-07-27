/**
 * Tessera - Jellyfin Client UI Script
 *
 * Injects the standard Tessera Universal Paywall bundle into Jellyfin,
 * bypassing CSP by routing through the plugin's internal asset relay.
 */
(function () {
    'use strict';

    const pluginRoute = '/plugins/tessera';

    // 1. Inject Tessera paywall assets via plugin relay (browser never contacts sidecar directly)
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = `${pluginRoute}/assets/paywall.css`;
    document.head.appendChild(cssLink);

    const script = document.createElement('script');
    script.src = `${pluginRoute}/assets/paywall.bundle.js?v=1.2.0`;
    document.head.appendChild(script);

    // Inject SPA styles to prevent paywall from blocking the dashboard
    const style = document.createElement('style');
    style.innerHTML = `
        body.arc-hide-paywall {
           overflow: auto !important;
        }
        body.arc-hide-paywall #arc-paywall-overlay,
        body.arc-hide-paywall #arc-session-manager {
           display: none !important;
        }
        body.arc-locked.arc-hide-paywall > * {
           filter: none !important;
           pointer-events: auto !important;
           user-select: auto !important;
        }
        body.arc-resolving-owner #arc-paywall-overlay,
        body.arc-resolving-owner #arc-session-manager {
           opacity: 0 !important;
           pointer-events: none !important;
           transition: opacity 0.15s ease !important;
        }
    `;
    document.head.appendChild(style);

    console.log('[Tessera] Standard Paywall Engine injected via local relay.');
})();
