using System.Collections.Concurrent;

namespace Jellyfin.Plugin.Tessera
{
    /// <summary>
    /// Maps Jellyfin deviceId → arc_cashier_user_id from the paywall bundle.
    /// Billing webhooks must use the paywall wallet session id, not the Jellyfin user GUID.
    /// </summary>
    public static class ViewerSessionRegistry
    {
        private static readonly ConcurrentDictionary<string, string> ByDevice = new();

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
