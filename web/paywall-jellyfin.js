/**
 * Tessera - Jellyfin Native Client UI Script
 *
 * Injects native Jellyfin OSD and Detail Page controls, native emby-dialog modals,
 * Circle User-Controlled Wallet management, and HTML5 video playback session enforcement.
 */
(function () {
    'use strict';

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

    // Inject SPA helper styles for native Jellyfin UI integration
    const style = document.createElement('style');
    style.innerHTML = `
        .tessera-osd-btn {
            cursor: pointer;
            transition: transform 0.15s ease;
        }
        .tessera-osd-btn:hover {
            transform: scale(1.1);
        }
        .tessera-detail-btn {
            background-color: rgba(255, 179, 0, 0.2) !important;
            color: #ffb300 !important;
            border: 1px solid rgba(255, 179, 0, 0.4) !important;
            margin-left: 8px !important;
        }
        .tessera-detail-btn:hover {
            background-color: rgba(255, 179, 0, 0.3) !important;
        }
        .tessera-dialog-wrapper {
            z-index: 100000;
        }
    `;
    document.head.appendChild(style);

    /**
     * Trigger the full Tessera wallet onboarding flow.
     * Delegates entirely to the bundle (same pattern as PeerTube client.ts).
     * The bundle manages Circle UCW token, wallet creation, and PIN setup internally.
     */
    function triggerWalletOnboarding() {
        const arcCashier = window.ArcCashier;
        if (arcCashier && typeof arcCashier.initPaywall === 'function') {
            arcCashier.initPaywall();
        } else {
            // Bundle not ready yet — wait for it
            const bundleScript = document.getElementById('tessera-paywall-bundle');
            if (bundleScript) {
                bundleScript.addEventListener('load', function () {
                    if (window.ArcCashier) window.ArcCashier.initPaywall();
                }, { once: true });
            }
        }
    }

    /**
     * Inject native ⚡ button into video player OSD control bar
     */
    function injectOSDButton() {
        const settingsBtns = document.querySelectorAll('.btnVideoOsdSettings, .btnFullscreen');
        settingsBtns.forEach(settingsBtn => {
            const osdControls = settingsBtn.parentNode;
            if (!osdControls || osdControls.querySelector('.tessera-osd-btn')) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'paper-icon-button-light detailButton tessera-osd-btn';
            btn.title = 'Tessera ⚡ Streaming & Propinas';
            btn.innerHTML = '<span class="material-icons" style="color: #ffb300;">bolt</span>';

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openTesseraNativeDialog();
            });

            osdControls.insertBefore(btn, settingsBtn);
            console.log('[Tessera] Native OSD button injected.');
        });
    }

    /**
     * Inject native "Apoyar Creador" button into detail page action buttons
     */
    function injectDetailButton() {
        const playBtns = document.querySelectorAll('.btnPlay');

        playBtns.forEach(playBtn => {
            const container = playBtn.parentNode;
            if (!container || container.querySelector('.tessera-detail-btn')) return;

            if (!container.classList.contains('detailButtons') &&
                !container.classList.contains('itemActionButtons') &&
                !container.classList.contains('mainDetailButtons')) {
                return;
            }

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'raised detailButton emby-button tessera-detail-btn';
            btn.title = 'Apoyar a este creador con Tessera';
            btn.innerHTML = '<i class="material-icons button-icon button-icon-left" style="color: #ffb300;">bolt</i><span class="button-text">Apoyar Creador</span>';

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openTesseraNativeDialog();
            });

            container.insertBefore(btn, playBtn.nextSibling);
            console.log('[Tessera] Native detail page button injected.');
        });
    }

    /**
     * Open Native Jellyfin Dialog Container for Wallet & Tipping
     */
    function openTesseraNativeDialog() {
        if (document.querySelector('.tessera-dialog-wrapper')) return;

        const dialogWrapper = document.createElement('div');
        dialogWrapper.className = 'dialogContainer tessera-dialog-wrapper';
        dialogWrapper.innerHTML = `
            <div class="focuscontainer dialog smoothScrollY emby-dialog" style="max-width: 460px; border-radius: 12px; background: var(--dialog-background, #1c1c1c); color: var(--theme-text-color, #fff);">
                <div class="dialogHeader" style="display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <h2 class="dialogTitle" style="display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1.25rem;">
                        <span class="material-icons" style="color: #ffb300;">bolt</span> 
                        Tessera - Sostenimiento
                    </h2>
                    <button class="paper-icon-button-light btnCloseDialog" type="button">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                <div class="dialogContent" style="padding: 24px;">
                    <p style="margin-top: 0; opacity: 0.85;">Apoya al creador con micropagos en tiempo real en USDC sobre Arc Network.</p>
                    
                    <div style="background: rgba(255,179,0,0.1); border: 1px solid rgba(255,179,0,0.3); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">
                        <div style="font-weight: bold; color: #ffb300;">Tarifa de Streaming:</div>
                        <div style="font-size: 1.1rem;">⚡ ${window.TESSERA_RATE || 0.0001} USDC / segundo</div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">Enviar Propina Directa:</label>
                        <div style="display: flex; gap: 8px;">
                            <button class="raised emby-button btnTip" data-amount="0.25" style="flex: 1;">$0.25</button>
                            <button class="raised emby-button btnTip" data-amount="0.50" style="flex: 1;">$0.50</button>
                            <button class="raised emby-button btnTip" data-amount="1.00" style="flex: 1;">$1.00</button>
                            <button class="raised emby-button btnTip" data-amount="5.00" style="flex: 1;">$5.00</button>
                        </div>
                    </div>

                    <div id="tesseraWalletStatus" style="font-size: 0.9rem; opacity: 0.7; text-align: center; margin-top: 15px;">
                        <button id="btnInitWallet" class="raised emby-button">Conectar / Crear Wallet UCW</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dialogWrapper);

        dialogWrapper.querySelector('.btnCloseDialog').addEventListener('click', function () {
            dialogWrapper.remove();
        });

        dialogWrapper.querySelector('#btnInitWallet').addEventListener('click', function () {
            dialogWrapper.remove();
            triggerWalletOnboarding();
        });

        dialogWrapper.querySelectorAll('.btnTip').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const amount = this.getAttribute('data-amount');
                try {
                    btn.disabled = true;
                    btn.innerText = 'Enviando...';
                    const res = await fetch(`${pluginRoute}/api/core/tip`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: getJellyfinUserId(),
                            amount: parseFloat(amount),
                            walletId: currentWalletId
                        })
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    alert(`¡Propina de $${amount} USDC enviada exitosamente! TX: ${data.txHash || 'Confirmada'}`);
                } catch (err) {
                    alert(`Error al enviar propina: ${err.message}`);
                } finally {
                    btn.disabled = false;
                    btn.innerText = `$${amount}`;
                }
            });
        });
    }

    // MutationObserver to detect DOM changes and inject buttons dynamically
    const observer = new MutationObserver(function () {
        injectOSDButton();
        injectDetailButton();
        if (document.querySelector('video') && !paywallInitialized) {
            initPaywallEngine();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[Tessera] Native Client UI Script loaded.');
})();
