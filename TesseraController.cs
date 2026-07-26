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
    }
}
