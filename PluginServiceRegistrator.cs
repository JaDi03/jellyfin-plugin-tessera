using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Tessera
{
    public class PluginServiceRegistrator : IPluginServiceRegistrator
    {
        public void RegisterServices(IServiceCollection serviceCollection, IServiceProvider applicationServiceProvider)
        {
            serviceCollection.AddHostedService<ServerEntryPoint>();
        }
    }
}
