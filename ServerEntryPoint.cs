using System;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Controller.Session;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Tessera
{
    /// <summary>
    /// Listens to native Jellyfin server playback events (PlaybackStart, PlaybackStopped)
    /// and relays them to the Tessera sidecar via HTTP webhook contract.
    /// </summary>
    public class ServerEntryPoint : IServerEntryPoint
    {
        private readonly ISessionManager _sessionManager;
        private readonly HttpClient _httpClient;
        private readonly ILogger<ServerEntryPoint> _logger;

        public ServerEntryPoint(
            ISessionManager sessionManager,
            IHttpClientFactory httpClientFactory,
            ILogger<ServerEntryPoint> logger)
        {
            _sessionManager = sessionManager;
            _httpClient = httpClientFactory.CreateClient();
            _logger = logger;
        }

        public Task RunAsync()
        {
            _sessionManager.PlaybackStart += OnPlaybackStart;
            _sessionManager.PlaybackStopped += OnPlaybackStopped;
            _logger.LogInformation("[Tessera] Native ServerEntryPoint active — listening to ISessionManager playback events.");
            return Task.CompletedTask;
        }

        private async void OnPlaybackStart(object? sender, PlaybackProgressEventArgs e)
        {
            try
            {
                if (e.Item == null || e.SessionInfo == null) return;

                var config = Plugin.Instance?.Configuration;
                var serverUrl = config?.TesseraServerUrl ?? "http://tessera-backend:7878";
                serverUrl = serverUrl.TrimEnd('/');

                var webhookUrl = $"{serverUrl}/api/connectors/jellyfin/webhook";

                var payload = new
                {
                    NotificationType = "PlaybackStart",
                    PlaySessionId = e.SessionInfo.Id,
                    Id = e.Item.Id.ToString("N"),
                    ItemId = e.Item.Id.ToString("N"),
                    DeviceId = e.SessionInfo.DeviceId,
                    UserId = e.SessionInfo.UserId.ToString("N"),
                    Item = new
                    {
                        Name = e.Item.Name,
                        Tags = e.Item.Tags ?? Array.Empty<string>()
                    },
                    ratePerSecond = config?.DefaultRatePerSecond ?? 0.0001,
                    creatorWallet = config?.CreatorWallet ?? string.Empty,
                    tesseraMode = config?.MonetizationMode ?? "pay-per-second"
                };

                await SendWebhookAsync(webhookUrl, payload, config?.WebhookSecret);
                _logger.LogInformation("[Tessera] Relayed PlaybackStart for item '{Name}' ({Id}) user {UserId}", e.Item.Name, e.Item.Id, e.SessionInfo.UserId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Tessera] Failed to relay PlaybackStart event");
            }
        }

        private async void OnPlaybackStopped(object? sender, PlaybackStopEventArgs e)
        {
            try
            {
                if (e.SessionInfo == null) return;

                var config = Plugin.Instance?.Configuration;
                var serverUrl = config?.TesseraServerUrl ?? "http://tessera-backend:7878";
                serverUrl = serverUrl.TrimEnd('/');

                var webhookUrl = $"{serverUrl}/api/connectors/jellyfin/webhook";

                var payload = new
                {
                    NotificationType = "PlaybackStop",
                    PlaySessionId = e.SessionInfo.Id,
                    DeviceId = e.SessionInfo.DeviceId,
                    UserId = e.SessionInfo.UserId.ToString("N")
                };

                await SendWebhookAsync(webhookUrl, payload, config?.WebhookSecret);
                _logger.LogInformation("[Tessera] Relayed PlaybackStop for user {UserId}", e.SessionInfo.UserId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Tessera] Failed to relay PlaybackStop event");
            }
        }

        private async Task SendWebhookAsync(string url, object payload, string? secret)
        {
            var json = JsonSerializer.Serialize(payload);
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");

            if (!string.IsNullOrEmpty(secret))
            {
                using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
                var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(json));
                var hex = Convert.ToHexString(hash).ToLowerInvariant();
                request.Headers.Add("x-tessera-signature", hex);
            }

            using var response = await _httpClient.SendAsync(request);
        }

        public void Dispose()
        {
            _sessionManager.PlaybackStart -= OnPlaybackStart;
            _sessionManager.PlaybackStopped -= OnPlaybackStopped;
        }
    }
}
