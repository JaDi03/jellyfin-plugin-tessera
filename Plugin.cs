using System;
using System.IO;
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
            CleanupOldVersions(applicationPaths);
            InjectClientScript(applicationPaths);
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

        private void CleanupOldVersions(IApplicationPaths applicationPaths)
        {
            try
            {
                var pluginsDir = Path.Combine(applicationPaths.ProgramDataPath, "plugins");
                if (!Directory.Exists(pluginsDir)) return;

                // Read the version from the executing assembly instead of hardcoding it,
                // so this never drifts from the .csproj <Version> again.
                var currentVersion = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version
                    ?? new Version("1.0.24.0");
                var directories = Directory.GetDirectories(pluginsDir, "Tessera_*");

                foreach (var dir in directories)
                {
                    var dirName = Path.GetFileName(dir);
                    var versionStr = dirName.Replace("Tessera_", "");
                    if (Version.TryParse(versionStr, out var ver))
                    {
                        if (ver < currentVersion)
                        {
                            Console.WriteLine($"[Tessera] Auto-cleaning old plugin version folder: {dir}");
                            Directory.Delete(dir, true);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tessera] Error cleaning up old versions: {ex.Message}");
            }
        }

        private void InjectClientScript(IApplicationPaths applicationPaths)
        {
            try
            {
                var searchPaths = new List<string>
                {
                    Environment.GetEnvironmentVariable("JELLYFIN_WEB_DIR") ?? string.Empty,
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "jellyfin-web"),
                    Path.Combine(applicationPaths.ProgramDataPath, "jellyfin-web"),
                    "/usr/share/jellyfin/web",
                    "/jellyfin/jellyfin-web"
                };

                string? indexPath = null;
                foreach (var path in searchPaths)
                {
                    if (string.IsNullOrEmpty(path)) continue;
                    var file = Path.Combine(path, "index.html");
                    if (File.Exists(file))
                    {
                        indexPath = file;
                        break;
                    }
                }

                if (indexPath == null)
                {
                    Console.WriteLine("[Tessera] Warning: Could not locate Jellyfin web's index.html.");
                    return;
                }

                Console.WriteLine($"[Tessera] Found index.html at: {indexPath}");

                string html = File.ReadAllText(indexPath);
                string scriptTag = "<script src=\"/plugins/tessera/paywall-jellyfin.js\"></script>";

                if (!html.Contains("paywall-jellyfin.js"))
                {
                    int bodyCloseIndex = html.LastIndexOf("</body>");
                    if (bodyCloseIndex != -1)
                    {
                        html = html.Insert(bodyCloseIndex, scriptTag + "\n");
                        File.WriteAllText(indexPath, html);
                        Console.WriteLine("[Tessera] Successfully injected client script tag into index.html.");
                    }
                    else
                    {
                        Console.WriteLine("[Tessera] Warning: Could not locate </body> tag in index.html.");
                    }
                }
                else
                {
                    Console.WriteLine("[Tessera] Client script already injected in index.html.");
                }
            }
            catch (UnauthorizedAccessException)
            {
                Console.WriteLine("[Tessera] ERROR: Write permission to index.html denied. To automate in-app UI script injection, please run: docker exec -u root jellyfin chmod 666 /jellyfin/jellyfin-web/index.html");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tessera] Error injecting client script: {ex.Message}");
            }
        }
    }
}
