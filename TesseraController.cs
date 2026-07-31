using System.IO;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Tessera
{
    [ApiController]
    [Route("plugins/tessera")]
    public class TesseraController : ControllerBase
    {
        // Shared, reused HttpClient across all requests. Instantiating a new
        // HttpClient per-request is a documented .NET anti-pattern that exhausts
        // OS sockets under load, causing intermittent hangs in this relay.
        private static readonly System.Net.Http.HttpClient SharedHttpClient = new System.Net.Http.HttpClient
        {
            Timeout = System.TimeSpan.FromSeconds(10)
        };

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
    }
}

