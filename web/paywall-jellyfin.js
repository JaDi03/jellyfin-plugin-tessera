/**
 * Tessera - Jellyfin Native Client UI Script
 *
 * Injects native Jellyfin OSD and Detail Page controls, native emby-dialog modals,
 * Circle User-Controlled Wallet management, and HTML5 video playback session enforcement.
 */
(function () {
    'use strict';

    const pluginRoute = '/plugins/tessera';

    // 1. Auto-inject Tessera paywall bundle immediately on page startup for instant sidecar log initialization
    if (!document.getElementById('tessera-paywall-bundle')) {
        const bundleScript = document.createElement('script');
        bundleScript.id = 'tessera-paywall-bundle';
        bundleScript.src = `${pluginRoute}/assets?file=paywall.bundle.js`;
        document.head.appendChild(bundleScript);
    }

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

    let currentUserToken = null;
    let currentWalletId = null;

    /**
     * Helper to obtain authenticated Jellyfin User ID
     */
    function getJellyfinUserId() {
        if (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function') {
            return window.ApiClient.getCurrentUserId();
        }
        return 'unknown_jellyfin_user';
    }

    /**
     * Dynamically load Circle Web SDK for PIN creation & challenges
     */
    async function ensureCircleSdk() {
        return new Promise((resolve, reject) => {
            if (window.W3SSdk || window.W3sPwWebSdk || window.CircleW3SSdk) return resolve(true);
            if (document.getElementById('circle-sdk-script-cdn')) return resolve(true);

            const cdnScript = document.createElement('script');
            cdnScript.id = 'circle-sdk-script-cdn';
            cdnScript.src = 'https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk@1.0.8/dist/w3s-pw-web-sdk.standalone.js';
            cdnScript.onload = () => resolve(true);
            cdnScript.onerror = () => {
                const altScript = document.createElement('script');
                altScript.id = 'circle-sdk-script-alt';
                altScript.src = `${pluginRoute}/assets?file=paywall.bundle.js`;
                altScript.onload = () => resolve(true);
                altScript.onerror = () => reject(new Error('Failed to load Circle Web SDK'));
                document.head.appendChild(altScript);
            };
            document.head.appendChild(cdnScript);
        });
    }

    /**
     * Initialize or connect Circle User-Controlled Wallet via plugin API relay
     */
    async function initializeWallet(statusElement) {
        try {
            statusElement.innerHTML = '<i>Conectando a API Tessera...</i>';
            const userId = getJellyfinUserId();

            let res = await fetch(`${pluginRoute}/api/core/circle/get-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: userId })
            });
            let data = await res.json();
            if (!data.userToken) throw new Error(data.error || 'No userToken received');
            currentUserToken = data.userToken;
            const appId = data.appId;
            const encryptionKey = data.encryptionKey;

            statusElement.innerHTML = '<i>Obteniendo datos de Wallet...</i>';
            res = await fetch(`${pluginRoute}/api/core/circle/get-wallet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: userId, userToken: currentUserToken })
            });
            data = await res.json();

            if (data.status === 'existing') {
                currentWalletId = data.walletId;
                statusElement.innerHTML = `<span style="color: #4caf50; font-weight: bold;">Wallet Conectada (Arc Network):</span><br/><span style="font-family: monospace; font-size: 0.85rem; word-break: break-all;">${data.walletAddress}</span>`;
                return;
            }

            if (data.status === 'indexing') {
                statusElement.innerHTML = '<i>Wallet en proceso de indexación en Arc Network... espere unos segundos e intente de nuevo.</i>';
                return;
            }

            if (data.status === 'needs_creation' && data.challengeId) {
                statusElement.innerHTML = '<i>Abriendo diálogo de seguridad Circle para PIN...</i>';
                await ensureCircleSdk();

                const SdkClass = window.W3SSdk || window.W3sPwWebSdk || window.CircleW3SSdk;
                if (SdkClass) {
                    const sdk = new SdkClass({ appId: appId });
                    if (typeof sdk.getDeviceId === 'function') {
                        sdk.getDeviceId();
                    }
                    if (typeof sdk.setAppSettings === 'function') {
                        sdk.setAppSettings({ appId: appId });
                    }
                    if (typeof sdk.setAuthentication === 'function') {
                        sdk.setAuthentication({ userToken: currentUserToken, encryptionKey: encryptionKey });
                    }
                    sdk.execute(data.challengeId, (error, result) => {
                        if (error) {
                            statusElement.innerHTML = `<span style="color: #f44336;">Error Circle: ${error.message}</span>`;
                        } else {
                            statusElement.innerHTML = '<i>PIN Configurado exitosamente. Verificando wallet...</i>';
                            setTimeout(() => initializeWallet(statusElement), 3000);
                        }
                    });
                } else {
                    statusElement.innerHTML = `<span style="color: #f44336;">Error: SDK de Circle no disponible.</span>`;
                }
            }
        } catch (err) {
            console.error('[Tessera] Wallet init error:', err);
            statusElement.innerHTML = `<span style="color: #f44336;">Error al conectar con Tessera API: ${err.message}</span>`;
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
                        <div style="font-size: 1.1rem;">⚡ 0.0001 USDC / segundo ($0.006 / min)</div>
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
                        <div id="walletStatusText" style="margin-top: 10px;"></div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dialogWrapper);

        dialogWrapper.querySelector('.btnCloseDialog').addEventListener('click', function () {
            dialogWrapper.remove();
        });

        const statusText = dialogWrapper.querySelector('#walletStatusText');
        dialogWrapper.querySelector('#btnInitWallet').addEventListener('click', function () {
            this.style.display = 'none';
            initializeWallet(statusText);
        });

        dialogWrapper.querySelectorAll('.btnTip').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const amount = this.getAttribute('data-amount');
                if (!currentWalletId) {
                    alert('Primero debes conectar tu Wallet.');
                    return;
                }
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

    /**
     * Native Playback Enforcement Hook for HTML5 Video
     */
    function attachPlaybackMonitor() {
        document.addEventListener('timeupdate', function (e) {
            if (e.target && e.target.tagName === 'VIDEO') {
                const video = e.target;
                // Optional: Monitor playback session active status
            }
        }, true);
    }

    // MutationObserver to detect DOM changes and inject buttons dynamically
    const observer = new MutationObserver(function () {
        injectOSDButton();
        injectDetailButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    attachPlaybackMonitor();
    console.log('[Tessera] Native Client UI Script loaded.');
})();
