# Jellyfin Tessera Plugin ⚡

Per-second streaming payments and native tipping plugin for Jellyfin, powered by **Tessera**, **Circle x402 Gateway**, and **Arc Network**.

---

## Overview

Sustain your Jellyfin media server using real-time USDC micropayments without modifying Jellyfin's core codebase:
- **Streaming Payments:** Meter playback by the second or minute for courses, tutorials, and exclusive media.
- **Native UI Overlay:** Seamlessly injects ⚡ action buttons into Jellyfin's OSD control bar (`.videoOsdBottom`), item detail view (`.detailButtons`), and native dialogs (`.dialogContainer`).
- **Direct Tipping:** Enable 1-click USDC micro-contributions ($0.25, $0.50, $1.00, $5.00) on free content.

---

## Project Structure

```text
jellyfin-plugin-tessera/
├── Configuration/
│   └── configPage.html           # Admin Dashboard plugin configuration UI
├── web/
│   └── paywall-jellyfin.js       # Native Client UI Script for jellyfin-web
├── Jellyfin.Plugin.Tessera.csproj# .NET 8.0 C# Project file
├── Plugin.cs                     # Entrypoint implementing IPlugin & IHasWebPages
├── PluginConfiguration.cs        # Plugin configuration data model
├── manifest.json                 # Jellyfin Plugin Repository Manifest
└── README.md                     # Documentation & build instructions
```

---

## Development & Build

> **Note:** `.NET 8.0 SDK` is only required on your development environment to compile the assembly. Production Jellyfin instances run the compiled `.dll` directly using their embedded runtime.

Build the release binary:
```bash
dotnet build -c Release
```

Output binary:
`bin/Release/net8.0/Jellyfin.Plugin.Tessera.dll`

---

## Deployment

Copy the compiled `Jellyfin.Plugin.Tessera.dll` into your Jellyfin plugins directory.

### Docker Deployment
Place the DLL into the server's plugins directory within your config volume:
```bash
# Example volume path
cp bin/Release/net8.0/Jellyfin.Plugin.Tessera.dll /var/lib/docker/volumes/jellyfin_config/_data/plugins/Tessera/
docker restart jellyfin
```

### Native Host Deployment
```bash
sudo mkdir -p /var/lib/jellyfin/plugins/Tessera
sudo cp bin/Release/net8.0/Jellyfin.Plugin.Tessera.dll /var/lib/jellyfin/plugins/Tessera/
sudo chown -R jellyfin:jellyfin /var/lib/jellyfin/plugins/Tessera
sudo systemctl restart jellyfin
```

### Repository Manifest Deployment
Host `manifest.json` on your web server and register the repository in Jellyfin Admin:
- **Dashboard -> Plugins -> Repositories -> Add Repository (+)**
- URL: `https://your-domain.com/manifest.json`

---

## Configuration

1. Open Jellyfin Admin Dashboard: **Dashboard -> Plugins -> Tessera**.
2. Set **Tessera Sidecar API URL** to your running Tessera sidecar instance (e.g. `http://localhost:7878` or `https://tessera.yourdomain.com`).
3. Set default streaming rates and save.

---

## License

Apache-2.0 - Tessera Project.
