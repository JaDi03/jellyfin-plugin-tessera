using System.IO;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Tessera
{
    [ApiController]
    [Route("plugins/tessera")]
    public class TesseraController : ControllerBase
    {
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
                    var serverUrl = Plugin.Instance?.Configuration?.TesseraServerUrl ?? "http://localhost:7878";
                    string configHeader = $"window.TESSERA_URL = '{serverUrl}';\n";
                    return Content(configHeader + content, "application/javascript");
                }
            }
        }

        [HttpGet("assets/{filename}")]
        public async System.Threading.Tasks.Task<IActionResult> GetAsset(string filename)
        {
            var serverUrl = Plugin.Instance?.Configuration?.TesseraServerUrl ?? "http://localhost:7878";
            serverUrl = serverUrl.TrimEnd('/');
            string url = $"{serverUrl}/peertube-assets/{filename}";

            using (System.Net.Http.HttpClient client = new System.Net.Http.HttpClient())
            {
                try
                {
                    System.Net.Http.HttpResponseMessage response = await client.GetAsync(url);
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
                catch (System.Exception ex)
                {
                    return StatusCode(502, $"Could not reach Tessera sidecar: {ex.Message}");
                }
            }
        }
    }
}
