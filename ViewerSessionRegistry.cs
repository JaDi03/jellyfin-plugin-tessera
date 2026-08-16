using System.Collections.Concurrent;

namespace Jellyfin.Plugin.Tessera
{
    /// <summary>
    /// Maps Jellyfin deviceId to the Tessera viewer id from the paywall bundle
    /// (localStorage arc_cashier_user_id). Must match sidecar isValidViewerUserId:
    /// email:, social:, or legacy arc_. Never a Jellyfin user GUID.
    /// </summary>
    public static class ViewerSessionRegistry
    {
        private static readonly ConcurrentDictionary<string, string> ByDevice = new();

        public static bool IsValidTesseraUserId(string? userId)
        {
            if (string.IsNullOrWhiteSpace(userId)) return false;
            if (userId.Length < 7 || userId.Length > 256) return false;
            if (userId.StartsWith("email:", StringComparison.Ordinal))
                return userId.Length > "email:".Length;
            if (userId.StartsWith("social:", StringComparison.Ordinal))
                return userId.Length > "social:".Length;
            if (userId.StartsWith("arc_", StringComparison.Ordinal))
                return userId.Length > "arc_".Length;
            return false;
        }

        public static void Register(string deviceId, string tesseraUserId)
        {
            if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(tesseraUserId)) return;
            ByDevice[deviceId] = tesseraUserId;
        }

        public static string? GetTesseraUserId(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId)) return null;
            return ByDevice.TryGetValue(deviceId, out var id) ? id : null;
        }

        public static void Unregister(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId)) return;
            ByDevice.TryRemove(deviceId, out _);
        }
    }
}
