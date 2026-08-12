using System;
using System.Collections.Generic;
using System.Globalization;
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
    /// Publishes per-device playback mode and calls Tessera sessions/start|stop when a viewer id is registered.
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

                var rate = (config?.DefaultRatePerSecond ?? 0.0001).ToString(CultureInfo.InvariantCulture);
                var payout = config?.CreatorWallet ?? string.Empty;
                _ = SendSignedIngestAsync(
                    "/api/core/v1/sessions/start",
                    new
                    {
                        userId = tesseraUserId,
                        resourceId = e.Item.Id.ToString("N"),
                        ratePerSecond = rate,
                        payoutAddress = payout,
                        metadata = new Dictionary<string, string>
                        {
                            ["itemName"] = e.Item.Name ?? string.Empty,
                            ["deviceId"] = e.DeviceId,
                            ["tesseraMode"] = mode,
                        },
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

                if (wasFree) return;

                var tesseraUserId = ViewerSessionRegistry.GetTesseraUserId(e.DeviceId);
                if (string.IsNullOrEmpty(tesseraUserId)) return;

                _ = SendSignedIngestAsync(
                    "/api/core/v1/sessions/stop",
                    new { userId = tesseraUserId });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Tessera] PlaybackStopped handler failed");
            }
        }

        private async Task SendSignedIngestAsync(string path, object payload)
        {
            var config = Plugin.Instance?.Configuration;
            if (string.IsNullOrWhiteSpace(config?.WebhookSecret))
            {
                _logger.LogWarning("[Tessera] WebhookSecret not configured — skipping ingest.");
                return;
            }

            var serverUrl = (config.TesseraServerUrl ?? "http://tessera-backend:7878").TrimEnd('/');
            var url = $"{serverUrl}{path}";
            var json = JsonSerializer.Serialize(payload);

            using var request = new HttpRequestMessage(HttpMethod.Post, url);
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
                _logger.LogWarning("[Tessera] Ingest HTTP {Status}: {Body}", (int)response.StatusCode, body);
            }
        }
    }
}
