using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Tessera
{
    /// <summary>
    /// Configuration model for the Tessera Jellyfin Plugin.
    /// Stores sidecar connection parameters and default rate settings.
    /// </summary>
    public class PluginConfiguration : BasePluginConfiguration
    {
        /// <summary>
        /// Gets or sets the URL of the running Tessera Sidecar.
        /// </summary>
        public string TesseraServerUrl { get; set; } = "http://localhost:7878";

        /// <summary>
        /// Gets or sets the default contribution rate per second in USDC.
        /// </summary>
        public double DefaultRatePerSecond { get; set; } = 0.0001;

        /// <summary>
        /// Gets or sets the EVM wallet address of the creator/server owner to receive payments.
        /// </summary>
        public string CreatorWallet { get; set; } = string.Empty;

        /// <summary>
        /// Gets or sets the monetization mode: "pay-per-second" or "free".
        /// </summary>
        public string MonetizationMode { get; set; } = "pay-per-second";

        /// <summary>
        /// Gets or sets whether the community support overlay is enabled.
        /// </summary>
        public bool EnablePaywallOverlay { get; set; } = true;

        /// <summary>
        /// Gets or sets whether direct tipping buttons are enabled.
        /// </summary>
        public bool EnableTipping { get; set; } = true;

        /// <summary>
        /// Gets or sets optional webhook secret key.
        /// </summary>
        public string WebhookSecret { get; set; } = string.Empty;
    }
}
