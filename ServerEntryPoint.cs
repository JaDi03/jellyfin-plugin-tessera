using System;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Tessera
{
    /// <summary>
    /// Listens to native Jellyfin ISessionManager playback events.
    /// Publishes per-device mode (from Item.Tags) for the browser UI and relays
    /// paid PlaybackStart/Stop to Tessera using arc_cashier_user_id when registered.
    /// </summary>
    public class ServerEntryPoint : IHostedService
    {
        private static readonly HttpClient SharedHttpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        };

        private readonly ISessionManager _sessionManager;
        private readonly ILogger<ServerEntryPoint> _logger;

        public ServerEntryPoint(
            ISessionManager sessionManager,
            ILogger<ServerEntryPoint> logger)
        {
            _sessionManager = sessionManager;
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            _sessionManager.PlaybackStart += OnPlaybackStart;
            _sessionManager.PlaybackStopped += OnPlaybackStopped;
            _logger.LogInformation("[Tessera] Listening to Jellyfin PlaybackStart / PlaybackStopped.");
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            _sessionManager.PlaybackStart -= OnPlaybackStart;
            _sessionManager.PlaybackStopped -= OnPlaybackStopped;
            return Task.CompletedTask;
        }

        private void OnPlaybackStart(object? sender, PlaybackProgressEventArgs e)
        {
            try
            {
                if (e.Item == null || string.IsNullOrWhiteSpace(e.DeviceId)) return;

                var config = Plugin.Instance?.Configuration;
                var globalMode = config?.MonetizationMode ?? "pay-per-second";
                var tags = e.Item.Tags?.ToArray() ?? Array.Empty<string>();
                var mode = PlaybackStateService.ResolveModeFromTags(tags, globalMode);

                PlaybackStateService.SetPlaying(e.DeviceId, new PlaybackState
                {
                    ItemId = e.Item.Id.ToString("N"),
                    ItemName = e.Item.Name ?? string.Empty,
                    Mode = mode,
                    Tags = tags,
                    PlaySessionId = e.PlaySessionId,
                });

                _logger.LogInformation(
                    "[Tessera] PlaybackStart device={DeviceId} item={ItemId} mode={Mode} tags=[{Tags}]",
                    e.DeviceId,
                    e.Item.Id,
                    mode,
                    string.Join(", ", tags));

                if (mode == "free")
                {
                    return;
                }

                var tesseraUserId = ViewerSessionRegistry.GetTesseraUserId(e.DeviceId);
                if (string.IsNullOrEmpty(tesseraUserId))
                {
                    _logger.LogDebug("[Tessera] Paid item — no arc_cashier_user_id registered for device {DeviceId} yet.", e.DeviceId);
                    return;
                }

                _ = RelayWebhookAsync(new
                {
                    NotificationType = "PlaybackStart",
                    PlaySessionId = tesseraUserId,
                    Id = e.Item.Id.ToString("N"),
                    ItemId = e.Item.Id.ToString("N"),
                    DeviceId = e.DeviceId,
                    UserId = tesseraUserId,
                    Item = new { Name = e.Item.Name ?? string.Empty, Tags = tags },
                    ratePerSecond = config?.DefaultRatePerSecond ?? 0.0001,
                    creatorWallet = config?.CreatorWallet ?? string.Empty,
                    tesseraMode = mode,
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Tessera] PlaybackStart handler failed");
            }
        }

        private void OnPlaybackStopped(object? sender, PlaybackStopEventArgs e)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(e.DeviceId)) return;

                var prior = PlaybackStateService.Get(e.DeviceId);
                var wasFree = string.Equals(prior?.Mode, "free", StringComparison.OrdinalIgnoreCase);
                PlaybackStateService.Clear(e.DeviceId);

                // Free / tip content never started a Tessera billing webhook on PlaybackStart.
                if (wasFree) return;

                var tesseraUserId = ViewerSessionRegistry.GetTesseraUserId(e.DeviceId);
                if (string.IsNullOrEmpty(tesseraUserId)) return;

                _ = RelayWebhookAsync(new
                {
                    NotificationType = "PlaybackStop",
                    PlaySessionId = tesseraUserId,
                    DeviceId = e.DeviceId,
                    UserId = tesseraUserId,
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Tessera] PlaybackStopped handler failed");
            }
        }

        private async Task RelayWebhookAsync(object payload)
        {
            var config = Plugin.Instance?.Configuration;
            if (string.IsNullOrWhiteSpace(config?.WebhookSecret))
            {
                _logger.LogWarning("[Tessera] WebhookSecret not configured — skipping Tessera relay.");
                return;
            }

            var serverUrl = (config.TesseraServerUrl ?? "http://tessera-backend:7878").TrimEnd('/');
            var webhookUrl = $"{serverUrl}/api/connectors/jellyfin/webhook";
            var json = JsonSerializer.Serialize(payload);

            using var request = new HttpRequestMessage(HttpMethod.Post, webhookUrl);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");

            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
            var nonce = Guid.NewGuid().ToString("N");
            var signingInput = $"{timestamp}.{nonce}.{json}";
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(config.WebhookSecret));
            var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(signingInput));
            request.Headers.Add("x-tessera-timestamp", timestamp);
            request.Headers.Add("x-tessera-nonce", nonce);
            request.Headers.Add("x-tessera-signature", Convert.ToHexString(hash).ToLowerInvariant());

            using var response = await SharedHttpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("[Tessera] Webhook HTTP {Status}: {Body}", (int)response.StatusCode, body);
            }
        }
    }
}
