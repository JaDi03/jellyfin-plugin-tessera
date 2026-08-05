using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Tessera
{
    /// <summary>
    /// Hosted service stub kept for Jellyfin 10.9 DI via IPluginServiceRegistrator.
    /// Per-second billing is client-driven (see TesseraController.Ping + paywall-jellyfin.js),
    /// matching the PeerTube arc_cashier_user_id model. Do not subscribe to ISessionManager
    /// PlaybackStart/Stop here — those event args do not expose SessionInfo on JF 10.9 and
    /// Jellyfin user GUIDs do not match the paywall wallet session id.
    /// </summary>
    public class ServerEntryPoint : IHostedService
    {
        private readonly ILogger<ServerEntryPoint> _logger;

        public ServerEntryPoint(ILogger<ServerEntryPoint> logger)
        {
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            _logger.LogInformation(
                "[Tessera] ServerEntryPoint active — billing via /plugins/tessera/ping (arc_cashier_user_id).");
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
