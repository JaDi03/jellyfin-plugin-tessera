/**
 * Tessera - Jellyfin Native Client UI Script
 *
 * Injects native-looking buttons into jellyfin-web:
 * - OSD Control Bar Button (.videoOsdBottom .buttons-right)
 * - Detail Page Action Button (.detailButtons)
 * - Native-styled Dialog (.dialogContainer / emby-dialog)
 */
(function () {
    'use strict';

    const TESSERA_API_URL = window.TESSERA_URL || 'http://localhost:7878';
    let currentSession = null;
    let currentUserToken = null;
    let currentWalletId = null;

    function getJellyfinUserId() {
        if (window.ApiClient) return window.ApiClient.getCurrentUserId();
        return 'unknown_user';
    }

    async function ensureCircleSdk() {
        return new Promise((resolve, reject) => {
            if (document.getElementById('circle-sdk-script')) return resolve(true);
            const script = document.createElement('script');
            script.id = 'circle-sdk-script';
            script.src = 'https://s3.amazonaws.com/circle-web-sdk/W3sPwWebSdk.wasm.js';
            script.onload = () => resolve(true);
            script.onerror = () => reject(new Error('Failed to load Circle SDK'));
            document.head.appendChild(script);
        });
    }

    async function initializeWallet(statusElement) {
        try {
            statusElement.innerHTML = '<i>Conectando a Tessera API...</i>';
            const userId = getJellyfinUserId();
            
            let res = await fetch(`${TESSERA_API_URL}/api/core/circle/get-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            let data = await res.json();
            if (!data.userToken) throw new Error('No userToken received');
            currentUserToken = data.userToken;
            const appId = data.appId;
            const encryptionKey = data.encryptionKey;

            statusElement.innerHTML = '<i>Obteniendo Wallet...</i>';
            res = await fetch(`${TESSERA_API_URL}/api/core/circle/get-wallet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, userToken: currentUserToken })
            });
            data = await res.json();

            if (data.status === 'existing') {
                currentWalletId = data.walletId;
                statusElement.innerHTML = `<span style="color: #4caf50; font-weight: bold;">Wallet Conectada:</span> <br/><span style="font-family: monospace; font-size: 0.8rem;">${data.walletAddress}</span>`;
                return;
            }

            if (data.status === 'indexing') {
                statusElement.innerHTML = '<i>Wallet en proceso de creación en Arc Network... espere unos segundos e intente de nuevo.</i>';
                return;
            }

            if (data.status === 'needs_creation' && data.challengeId) {
                statusElement.innerHTML = '<i>Requiere configuración de PIN. Abre el diálogo de Circle.</i>';
                await ensureCircleSdk();
                
                if (window.W3sPwWebSdk) {
                    const sdk = new window.W3sPwWebSdk();
                    sdk.setAppSettings({ appId: appId });
                    sdk.setAuthentication({ userToken: currentUserToken, encryptionKey: encryptionKey });
                    
                    sdk.execute(data.challengeId, (error, result) => {
                        if (error) {
                            statusElement.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
                        } else {
                            statusElement.innerHTML = '<i>PIN Configurado. Verificando wallet...</i>';
                            setTimeout(() => initializeWallet(statusElement), 4000);
                        }
                    });
                } else {
                    statusElement.innerHTML = `<span style="color: red;">Error: SDK de Circle no cargado.</span>`;
                }
            }
        } catch (err) {
            console.error('[Tessera] Wallet init error:', err);
            statusElement.innerHTML = `<span style="color: red;">Error de red al conectar con Tessera.</span>`;
        }
    }

    /**
     * Inject native ⚡ button into video player OSD control bar
     */
    function injectOSDButton() {
        const osdControls = document.querySelector('.videoOsdBottom .buttons-right');
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

        osdControls.appendChild(btn);
        console.log('[Tessera] Native OSD button injected successfully.');
    }

    /**
     * Inject native "Apoyar Creador" button into detail page action buttons
     */
    function injectDetailButton() {
        const detailButtons = document.querySelector('.detailButtons');
        if (!detailButtons || detailButtons.querySelector('.tessera-detail-btn')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'raised detailButton emby-button tessera-detail-btn';
        btn.title = 'Apoyar a este creador con Tessera';
        btn.innerHTML = '<i class="material-icons button-icon button-icon-left" style="color: #ffb300;">bolt</i><span class="button-text">Apoyar Creador</span>';

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openTesseraNativeDialog();
        });

        detailButtons.appendChild(btn);
        console.log('[Tessera] Native detail page button injected successfully.');
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
                alert('Propina de $' + amount + ' iniciada. Implementación de transacción en próxima fase.');
            });
        });
    }

    // MutationObserver to detect DOM changes and inject buttons dynamically
    const observer = new MutationObserver(function () {
        injectOSDButton();
        injectDetailButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[Tessera] Native Client UI Script loaded.');
})();
