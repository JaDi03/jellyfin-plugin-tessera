# Tessera for Jellyfin

<div align="center">

[![License](https://img.shields.io/badge/License-Apache_2.0-yellow.svg?style=for-the-badge)](https://github.com/JaDi03/jellyfin-plugin-tessera)
[![Jellyfin](https://img.shields.io/badge/Jellyfin-%3E%3D%2010.9-00A4DC?style=for-the-badge&logo=jellyfin&logoColor=white)](https://jellyfin.org)
[![Tessera](https://img.shields.io/badge/Tessera-sidecar-blue?style=for-the-badge)](https://github.com/JaDi03/tessera)

</div>

<p align="center">
  <b><i>Jellyfin plugin for creator support: tips on free items, pay-per-second on exclusive items.</i></b>
</p>

> **TL;DR:**
> `jellyfin-plugin-tessera` connects a self-hosted [Jellyfin](https://jellyfin.org) server to a [Tessera](https://github.com/JaDi03/tessera) sidecar. **Exclusive** items: Tessera overlay on the HTML5 video player until the viewer funds Gateway and unlocks; play meters with HMAC `sessions/start`, leave / pause / end with HMAC `sessions/stop`. **Free** items: no lock; manual tips only. This README is install and settings for the plugin. Sidecar: [Getting Started](https://jadi03.github.io/tessera/getting-started/). Contract: [Connector spec](https://jadi03.github.io/tessera/connectors/spec/). Modes: [Payment models](https://jadi03.github.io/tessera/payment-models/).

---

## Table of Contents

- [What this plugin does](#what-this-plugin-does)
- [Prerequisites](#prerequisites)
- [Install and activate](#install-and-activate)
- [Plugin settings](#plugin-settings)
- [Creator support](#creator-support)
- [What the viewer sees](#what-the-viewer-sees)
- [Verification checklist](#verification-checklist)
- [How it talks to Tessera](#how-it-talks-to-tessera)
- [License](#license)

---

## What this plugin does

- **Exclusive (pay-per-second):** After Jellyfin `PlaybackStart`, the client polls `GET /plugins/tessera/playback-state` and calls `ArcCashier.initPaywall` on the player container. Unlock (and unlocked play) POSTs `/plugins/tessera/billing-start`, which HMAC-signs Tessera `POST /api/core/v1/sessions/start` with `userId`, `resourceId` (item id), `ratePerSecond`, and `payoutAddress` (creator wallet). Pause, ended, or leave POSTs `/plugins/tessera/billing-stop` → HMAC `sessions/stop`. The server also listens to Jellyfin `PlaybackStart` / `PlaybackStopped` and may call the same ingest when a Tessera viewer id is already registered for that device.
- **Free (tips):** `ArcCashier.initTipMode(creatorWallet, "0.10")`. No lock. No `billing-start` / `sessions/start` for free. Tip only when the viewer taps; the paywall POSTs tips through this plugin's API relay (`/plugins/tessera/api/core/*`).
- Loads Tessera UI assets through the plugin (`/plugins/tessera/assets/...`), so the browser stays on the Jellyfin origin.
- Injects `<script src="/plugins/tessera/paywall-jellyfin.js">` into jellyfin-web `index.html` on plugin load (needs write access to that file).
- **Creator Earnings** on the plugin config page mounts `ArcCashier.initCreatorEarnings` for the configured creator wallet (balance / withdraw via sidecar).

Point this plugin at a running Tessera instance. Circle keys and `MASTER_KEY` stay in Tessera `.env` ([Getting Started](https://jadi03.github.io/tessera/getting-started/)).

---

## Prerequisites

- A Jellyfin server compatible with plugin ABI **10.9+** (releases target `10.9.0.0`).
- A running [Tessera sidecar](https://github.com/JaDi03/tessera) (default port `7878`). Follow [Getting Started](https://jadi03.github.io/tessera/getting-started/). Confirm:

```bash
curl -sS http://127.0.0.1:7878/health
```

Expect JSON with `"status": "healthy"`.

---

## Install and activate

### Plugin repository (recommended)

1. In Jellyfin Admin open **Dashboard → Plugins → Repositories → +**.
2. Add a repository. Repository URL:

```text
https://raw.githubusercontent.com/JaDi03/jellyfin-plugin-tessera/main/manifest.json
```

3. Open **Catalog**, find **Tessera**, install it, and restart Jellyfin if prompted.
4. Open **Dashboard → Plugins → Tessera** (plugin name **Tessera Support**) and fill the settings below.

<div align="center">
  <img src="docs/screenshots/jellyfin_add_repository.png" alt="Jellyfin Repositories page with Tessera manifest URL added" width="800"/>
  <p><i>Figure 1: Add the Tessera plugin repository, then install from Catalog.</i></p>
</div>

If the player overlay never appears after install, the plugin needs write access to jellyfin-web `index.html` to inject `paywall-jellyfin.js`. Docker example from plugin logs: `docker exec -u root jellyfin chmod 666 /jellyfin/jellyfin-web/index.html`, then restart Jellyfin.

### Optional: build from source

For local development only: clone this repo, `dotnet build -c Release`, and place `bin/Release/net8.0/Jellyfin.Plugin.Tessera.dll` in Jellyfin's plugins folder (then restart). Normal installs use the repository path above.

---

## Plugin settings

Open **Dashboard → Plugins → Tessera**.

Fields on this page (exact labels):

- **Tessera Sidecar API URL:** HTTP origin where **this Jellyfin server** reaches Tessera (not your public Jellyfin URL). Same host: `http://127.0.0.1:7878`. Jellyfin in Docker / Tessera on the host: often `http://172.17.0.1:7878`. Verify with `curl http://HOST:7878/health`.
- **Creator Arc Network Wallet Address (0x...):** Tessera `payoutAddress` for exclusive `sessions/start`, and tip destination for free tip mode.
- **Monetization Mode:** UI label for the server default when an item has no Tessera tag. Options: **Pay-per-second (private paywall stream)** or **Free (tips welcome)**. Per-item tags override this (see [Creator support](#creator-support)).
- **Default Streaming Rate per Second (USDC):** Sent as Tessera `ratePerSecond` on exclusive start (default `0.0001`).
- **Tessera Ingest Secret:** Exact same string as sidecar `TESSERA_INGEST_SECRET`. Required for HMAC `sessions/start` and `sessions/stop`. Never send it to the browser.
- **Enable Native UI Injection (⚡ Buttons & Native Dialogs):** Stored in plugin configuration (default on).
- **Enable Creator Tipping Buttons on Free Content:** Stored in plugin configuration (default on).

Save, then keep Tessera running. Circle API keys and `MASTER_KEY` stay in Tessera `.env`, not here.

<div align="center">
  <img src="docs/screenshots/jellyfin_plugin_settings.png" alt="Tessera plugin settings: Sidecar API URL, creator wallet, mode, rate, ingest secret" width="800"/>
  <p><i>Figure 2: Plugin settings. Sidecar API URL here is <code>http://tessera-backend:7878</code> (same Docker network).</i></p>
</div>

On the same page, **Creator Earnings** loads when a valid `0x` creator wallet is saved (MetaMask / Arc Testnet withdraw via sidecar).

<div align="center">
  <img src="docs/screenshots/jellyfin_creator_earnings.png" alt="Creator Earnings widget with Check Balance and Withdraw Earnings" width="800"/>
  <p><i>Figure 3: Creator Earnings on the plugin settings page.</i></p>
</div>

---

## Creator support

Default mode comes from the plugin setting above. Override per library item with Jellyfin tags:

- `tessera:free` (also accepted: `tessera-free`, `tessera_free`) → free tip mode
- `tessera:pay-per-second` (also accepted: `tessera-pay-per-second`, `tessera:paid`) → exclusive pay-per-second

Suggested tip amount in the client is currently fixed at `0.10` USDC (`initTipMode`). Rate for exclusive items is the plugin **Default Streaming Rate per Second**.

There is no separate admin-wallet / display-fee / splits UI in this plugin; exclusive start sends `payoutAddress` only.

---

## What the viewer sees

**Exclusive (pay-per-second):** While mode resolves, a short neutral veil may sit on the player. Then the Tessera paywall overlay mounts on the HTML5 player container. The viewer signs in through the overlay, funds Gateway, and unlocks. Unlocked play meters at the configured rate. Leave, pause, or end stops billing (`sessions/stop`). Unused USDC stays in Gateway. Starting another item resets the per-item client session.

**Free:** No lock. A tip control mounts for manual tips only (`initTipMode`). Each tip is a browser call through the plugin API relay to Tessera tips, not ingest HMAC.

Tessera `userId` is the paywall value in `localStorage` key `arc_cashier_user_id` (`email:` or `social:`, legacy `arc_`). The plugin registers that id per Jellyfin `deviceId` and forwards it on `start` / `stop`.

---

## Verification checklist

- [ ] Sidecar health: `curl -sS http://127.0.0.1:7878/health` (or your Sidecar API URL) includes `"status": "healthy"`.
- [ ] Plugin settings: Tessera Sidecar API URL and Tessera Ingest Secret saved (secret equals `TESSERA_INGEST_SECRET`); creator wallet set for exclusive / tips.
- [ ] Client script: jellyfin-web loads `/plugins/tessera/paywall-jellyfin.js`; overlay assets load `/plugins/tessera/assets/paywall.bundle.js` (HTTP 200).
- [ ] Exclusive: overlay on the player; after Gateway fund + unlock, play meters; leave/pause/end sends stop; unused Gateway balance remains; replay on a new item works.
- [ ] Free (`tessera:free`): no lock; no `billing-start` / HMAC `sessions/start`; tip only when the viewer taps.
- [ ] Optional: Creator Earnings on the plugin page shows a balance after settled activity.

---

## How it talks to Tessera

Same contract as Tessera [Connector spec](https://jadi03.github.io/tessera/connectors/spec/) and [Payment models](https://jadi03.github.io/tessera/payment-models/).

1. Browser loads `paywall-jellyfin.js` (config header injects `TESSERA_URL`, creator wallet, default mode, rate). Paywall assets and `/api/core/*` go through the **plugin relay** (`/plugins/tessera/assets/...`, `/plugins/tessera/api/core/*`). HMAC ingest uses **Tessera Sidecar API URL** from the Jellyfin server, not the browser origin.
2. Mode: Jellyfin `PlaybackStart` publishes tags + resolved mode; client reads `GET /plugins/tessera/playback-state?deviceId=...`.
3. Exclusive: unlock / play → `POST /plugins/tessera/billing-start` → HMAC `POST {Sidecar API URL}/api/core/v1/sessions/start`. Leave / pause / end → `billing-stop` → HMAC `sessions/stop` with `{ userId }`. Headers: `x-tessera-timestamp`, `x-tessera-nonce`, `x-tessera-signature`.
4. Free: `initTipMode` only. Tips via relayed `/api/core/v1/tips` (no ingest HMAC on tips).

`userId` prefixes, HMAC, and tip body: [Connector spec](https://jadi03.github.io/tessera/connectors/spec/). Sidecar `.env`: [Getting Started](https://jadi03.github.io/tessera/getting-started/).

---

## License

Apache-2.0. Tessera Project.
