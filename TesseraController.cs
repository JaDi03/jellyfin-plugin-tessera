using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Tessera
{
    [ApiController]
    [Route("plugins/tessera")]
    public class TesseraController : ControllerBase
    {
        private static readonly System.Net.Http.HttpClient SharedHttpClient = new System.Net.Http.HttpClient
        {
            Timeout = System.TimeSpan.FromSeconds(30)
        };

        /// <summary>
        /// Browser polls after play. Mode is set by Jellyfin PlaybackStart + Item.Tags on the server.
        /// </summary>
        [HttpGet("playback-state")]
        public IActionResult GetPlaybackState([FromQuery] string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
            {
                return BadRequest(new { error = "Missing deviceId" });
            }

            var state = PlaybackStateService.Get(deviceId);
            if (state == null)
            {
                return NotFound(new { error = "No active playback for this device" });
            }

            return Ok(new
            {
                itemId = state.ItemId,
                itemName = state.ItemName,
                mode = state.Mode,
                tags = state.Tags,
                playSessionId = state.PlaySessionId,
                updatedAtUtc = state.UpdatedAtUtc,
            });
        }

        [HttpPost("register-viewer")]
        public IActionResult RegisterViewer([FromBody] RegisterViewerRequest? body)
        {
            if (body == null || string.IsNullOrWhiteSpace(body.DeviceId) || string.IsNullOrWhiteSpace(body.SessionId))
            {
                return BadRequest(new { error = "Missing deviceId or sessionId" });
            }

            if (!body.SessionId.StartsWith("arc_", StringComparison.Ordinal))
            {
                return BadRequest(new { error = "Invalid sessionId" });
            }

            ViewerSessionRegistry.Register(body.DeviceId, body.SessionId);
            return Ok(new { status = "registered" });
        }

        [HttpPost("billing-start")]
        public async System.Threading.Tasks.Task<IActionResult> BillingStart([FromBody] BillingRequest? body)
        {
            if (body == null || string.IsNullOrWhiteSpace(body.DeviceId) || string.IsNullOrWhiteSpace(body.SessionId))
            {
                return BadRequest(new { error = "Missing deviceId or sessionId" });
            }

            if (!body.SessionId.StartsWith("arc_", StringComparison.Ordinal))
            {
                return BadRequest(new { error = "Invalid sessionId" });
            }

            var state = PlaybackStateService.Get(body.DeviceId);
            if (state == null)
            {
                return NotFound(new { error = "No active playback for this device" });
            }

            if (state.Mode == "free")
            {
                return Ok(new { status = "skipped", reason = "free content" });
            }

            var config = Plugin.Instance?.Configuration;
            if (string.IsNullOrWhiteSpace(config?.WebhookSecret))
            {
                return StatusCode(500, new { error = "WebhookSecret not configured" });
            }

            ViewerSessionRegistry.Register(body.DeviceId, body.SessionId);

            var payload = new
            {
                NotificationType = "PlaybackStart",
                PlaySessionId = body.SessionId,
                Id = state.ItemId,
                ItemId = state.ItemId,
                DeviceId = body.DeviceId,
                UserId = body.SessionId,
                Item = new { Name = state.ItemName, Tags = state.Tags },
                ratePerSecond = config.DefaultRatePerSecond,
                creatorWallet = config.CreatorWallet ?? string.Empty,
                tesseraMode = state.Mode,
            };

            try
            {
                await SendSignedWebhookAsync(
                    $"{(config.TesseraServerUrl ?? "http://tessera-backend:7878").TrimEnd('/')}/api/connectors/jellyfin/webhook",
                    payload,
                    config.WebhookSecret);
                return Ok(new { status = "ok", eventName = "PlaybackStart" });
            }
            catch (Exception ex)
            {
                return StatusCode(502, new { error = ex.Message });
            }
        }

        [HttpPost("billing-stop")]
        public async System.Threading.Tasks.Task<IActionResult> BillingStop([FromBody] BillingRequest? body)
        {
            if (body == null || string.IsNullOrWhiteSpace(body.DeviceId) || string.IsNullOrWhiteSpace(body.SessionId))
            {
                return BadRequest(new { error = "Missing deviceId or sessionId" });
            }

            var config = Plugin.Instance?.Configuration;
            if (string.IsNullOrWhiteSpace(config?.WebhookSecret))
            {
                return StatusCode(500, new { error = "WebhookSecret not configured" });
            }

            var payload = new
            {
                NotificationType = "PlaybackStop",
                PlaySessionId = body.SessionId,
                DeviceId = body.DeviceId,
                UserId = body.SessionId,
            };

            try
            {
                await SendSignedWebhookAsync(
                    $"{(config.TesseraServerUrl ?? "http://tessera-backend:7878").TrimEnd('/')}/api/connectors/jellyfin/webhook",
                    payload,
                    config.WebhookSecret);
                return Ok(new { status = "ok", eventName = "PlaybackStop" });
            }
            catch (Exception ex)
            {
                return StatusCode(502, new { error = ex.Message });
            }
        }

        [HttpGet("paywall-jellyfin.js")]
        public IActionResult GetClientScript()
        {
            var assembly = Assembly.GetExecutingAssembly();
            var resourceName = "Jellyfin.Plugin.Tessera.web.paywall-jellyfin.js";

            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                {
                    return NotFound();
                }
                using (StreamReader reader = new StreamReader(stream))
                {
                    string content = reader.ReadToEnd();
                    var config = Plugin.Instance?.Configuration;
                    var serverUrl = config?.TesseraServerUrl ?? "http://tessera-backend:7878";
                    var creatorWallet = config?.CreatorWallet ?? string.Empty;
                    var mode = config?.MonetizationMode ?? "pay-per-second";
                    var rate = config?.DefaultRatePerSecond ?? 0.0001;

                    string configHeader = $"window.TESSERA_URL = '{serverUrl}';\n" +
                                         $"window.TESSERA_CREATOR_WALLET = '{creatorWallet}';\n" +
                                         $"window.TESSERA_MODE = '{mode}';\n" +
                                         $"window.TESSERA_RATE = {rate.ToString(System.Globalization.CultureInfo.InvariantCulture)};\n";
                    Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
                    return Content(configHeader + content, "application/javascript");
                }
            }
        }

        [HttpGet("assets")]
        public async System.Threading.Tasks.Task<IActionResult> GetAsset([FromQuery] string file)
        {
            var serverUrl = Plugin.Instance?.Configuration?.TesseraServerUrl ?? "http://tessera-backend:7878";
            serverUrl = serverUrl.TrimEnd('/');
            string url = $"{serverUrl}/jellyfin-assets/{file}";

            try
            {
                System.Net.Http.HttpResponseMessage response = await SharedHttpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode((int)response.StatusCode, "Failed to fetch asset from sidecar");
                }

                string contentType = "application/octet-stream";
                if (file.EndsWith(".js")) contentType = "application/javascript; charset=utf-8";
                else if (file.EndsWith(".css")) contentType = "text/css; charset=utf-8";
                else if (file.EndsWith(".svg")) contentType = "image/svg+xml";
                else if (file.EndsWith(".png")) contentType = "image/png";
                else if (file.EndsWith(".ico")) contentType = "image/x-icon";

                var stream = await response.Content.ReadAsStreamAsync();
                return File(stream, contentType);
            }
            catch (System.Threading.Tasks.TaskCanceledException)
            {
                return StatusCode(504, "Tessera sidecar did not respond in time.");
            }
            catch (System.Exception ex)
            {
                return StatusCode(502, $"Could not reach Tessera sidecar: {ex.Message}");
            }
        }

        [HttpGet("assets/{filename}")]
        public async System.Threading.Tasks.Task<IActionResult> GetAssetByPath([FromRoute] string filename)
        {
            var serverUrl = Plugin.Instance?.Configuration?.TesseraServerUrl ?? "http://tessera-backend:7878";
            serverUrl = serverUrl.TrimEnd('/');
            string url = $"{serverUrl}/jellyfin-assets/{filename}";

            try
            {
                System.Net.Http.HttpResponseMessage response = await SharedHttpClient.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode((int)response.StatusCode, "Failed to fetch asset from sidecar");
                }

                string contentType = "application/octet-stream";
                if (filename.EndsWith(".js")) contentType = "application/javascript; charset=utf-8";
                else if (filename.EndsWith(".css")) contentType = "text/css; charset=utf-8";
                else if (filename.EndsWith(".svg")) contentType = "image/svg+xml";
                else if (filename.EndsWith(".png")) contentType = "image/png";
                else if (filename.EndsWith(".ico")) contentType = "image/x-icon";

                var stream = await response.Content.ReadAsStreamAsync();
                return File(stream, contentType);
            }
            catch (System.Threading.Tasks.TaskCanceledException)
            {
                return StatusCode(504, "Tessera sidecar did not respond in time.");
            }
            catch (System.Exception ex)
            {
                return StatusCode(502, $"Could not reach Tessera sidecar: {ex.Message}");
            }
        }

        [Route("api/core/{*path}")]
        public async System.Threading.Tasks.Task<IActionResult> RelayCoreApi([FromRoute] string path)
        {
            var serverUrl = Plugin.Instance?.Configuration?.TesseraServerUrl ?? "http://tessera-backend:7878";
            serverUrl = serverUrl.TrimEnd('/');
            var queryString = Request.QueryString.HasValue ? Request.QueryString.Value : string.Empty;
            string targetUrl = $"{serverUrl}/api/core/{path}{queryString}";

            try
            {
                var request = new System.Net.Http.HttpRequestMessage(
                    new System.Net.Http.HttpMethod(Request.Method),
                    targetUrl
                );

                if (Microsoft.AspNetCore.Http.HttpMethods.IsPost(Request.Method) ||
                    Microsoft.AspNetCore.Http.HttpMethods.IsPut(Request.Method) ||
                    Microsoft.AspNetCore.Http.HttpMethods.IsPatch(Request.Method))
                {
                    using (var reader = new StreamReader(Request.Body))
                    {
                        string bodyString = await reader.ReadToEndAsync();
                        request.Content = new System.Net.Http.StringContent(bodyString, System.Text.Encoding.UTF8, "application/json");
                    }
                }

                var response = await SharedHttpClient.SendAsync(request);
                string responseBody = await response.Content.ReadAsStringAsync();
                Response.StatusCode = (int)response.StatusCode;
                return Content(responseBody, "application/json");
            }
            catch (System.Threading.Tasks.TaskCanceledException)
            {
                Response.StatusCode = 504;
                return Content("{\"error\":\"Tessera sidecar API relay did not respond in time.\"}", "application/json");
            }
            catch (System.Exception ex)
            {
                return StatusCode(502, $"{{\"error\":\"Could not reach Tessera sidecar API relay: {ex.Message}\"}}");
            }
        }

        private static async System.Threading.Tasks.Task SendSignedWebhookAsync(string url, object payload, string? secret)
        {
            var json = JsonSerializer.Serialize(payload);
            using var request = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Post, url);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");

            if (!string.IsNullOrEmpty(secret))
            {
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
                var nonce = Guid.NewGuid().ToString("N");
                var signingInput = $"{timestamp}.{nonce}.{json}";
                using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
                var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(signingInput));
                var hex = Convert.ToHexString(hash).ToLowerInvariant();

                request.Headers.Add("x-tessera-timestamp", timestamp);
                request.Headers.Add("x-tessera-nonce", nonce);
                request.Headers.Add("x-tessera-signature", hex);
            }

            using var response = await SharedHttpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var errBody = await response.Content.ReadAsStringAsync();
                throw new InvalidOperationException($"Webhook HTTP {(int)response.StatusCode}: {errBody}");
            }
        }

        public sealed class RegisterViewerRequest
        {
            public string? DeviceId { get; set; }
            public string? SessionId { get; set; }
        }

        public sealed class BillingRequest
        {
            public string? DeviceId { get; set; }
            public string? SessionId { get; set; }
        }
    }
}
