using System;
using System.Collections.Generic;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Tessera
{
    /// <summary>
    /// Entry point for the Tessera Jellyfin Plugin.
    /// Implements IPlugin and IHasWebPages to provide the Admin Dashboard configuration UI.
    /// </summary>
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        public override string Name => "Tessera Support";

        public override Guid Id => Guid.Parse("f94d1b82-7e4a-4c28-9d10-8b43f01c9b88");

        public override string Description => "Voluntary server support through micro-contributions and USDC tipping. No paywalls, no blocked content — just a way for your community to keep your server running.";

        public static Plugin? Instance { get; private set; }

        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
        }

        public IEnumerable<PluginPageInfo> GetPages()
        {
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "tessera",
                    EmbeddedResourcePath = GetType().Namespace + ".Configuration.configPage.html"
                }
            };
        }
    }
}
