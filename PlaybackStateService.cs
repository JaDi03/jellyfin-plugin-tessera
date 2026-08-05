using System;
using System.Collections.Concurrent;
using System.Linq;

namespace Jellyfin.Plugin.Tessera
{
    public sealed class PlaybackState
    {
        public string ItemId { get; set; } = string.Empty;
        public string ItemName { get; set; } = string.Empty;
        public string Mode { get; set; } = "pay-per-second";
        public string[] Tags { get; set; } = Array.Empty<string>();
        public string? PlaySessionId { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }

    /// <summary>
    /// In-memory playback state published by ISessionManager PlaybackStart/Stop.
    /// The browser reads this via GET /plugins/tessera/playback-state — no URL guessing.
    /// </summary>
    public static class PlaybackStateService
    {
        private static readonly ConcurrentDictionary<string, PlaybackState> ByDevice = new();

        public static string ResolveModeFromTags(string[] tags, string globalDefault)
        {
            if (tags == null || tags.Length == 0)
            {
                return globalDefault;
            }

            var normalized = tags.Select(t => t.Trim().ToLowerInvariant()).ToArray();
            if (normalized.Any(t => t == "tessera:free" || t == "tessera-free" || t == "tessera_free"))
            {
                return "free";
            }

            if (normalized.Any(t => t == "tessera:pay-per-second" || t == "tessera-pay-per-second" || t == "tessera:paid"))
            {
                return "pay-per-second";
            }

            return globalDefault;
        }

        public static void SetPlaying(string deviceId, PlaybackState state)
        {
            if (string.IsNullOrWhiteSpace(deviceId)) return;
            state.UpdatedAtUtc = DateTime.UtcNow;
            ByDevice[deviceId] = state;
        }

        public static void Clear(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId)) return;
            ByDevice.TryRemove(deviceId, out _);
        }

        public static PlaybackState? Get(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId)) return null;
            return ByDevice.TryGetValue(deviceId, out var state) ? state : null;
        }
    }
}
