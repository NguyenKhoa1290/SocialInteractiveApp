using System.Text.Json;
using System.Text.RegularExpressions;
using MediaService.Api.Models;

namespace MediaService.Api.Services;

public sealed class ClearKeyResolver(PlaylistFetcher fetcher, ILogger<ClearKeyResolver> logger)
{
    private static readonly Regex DirectHexPair = new(
        @"(?<kid>[0-9a-fA-F]{32}):(?<key>[0-9a-fA-F]{32})",
        RegexOptions.Compiled);

    private static readonly Regex DefaultKid = new(
        @"(?:default_KID|default_Kid)\s*=\s*[""'](?<kid>[0-9a-fA-F-]{32,36})[""']",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex JsonKeyBeforeKid = new(
        @"\{[^{}]*""k""\s*:\s*""(?<key>[^""]+)""[^{}]*""kid""\s*:\s*""(?<kid>[^""]+)""[^{}]*\}",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex JsonKidBeforeKey = new(
        @"\{[^{}]*""kid""\s*:\s*""(?<kid>[^""]+)""[^{}]*""k""\s*:\s*""(?<key>[^""]+)""[^{}]*\}",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public async Task<string?> ResolveAsync(IptvChannel channel, CancellationToken ct = default)
    {
        var licenseKey = channel.LicenseKey?.Trim();
        if (string.IsNullOrEmpty(licenseKey))
            return null;

        var direct = NormalizeDirectClearKey(licenseKey);
        if (direct is not null)
            return direct;

        if (!IsClearKey(channel.LicenseType) ||
            !Uri.TryCreate(licenseKey, UriKind.Absolute, out var licenseUri) ||
            licenseUri.Scheme is not ("http" or "https"))
            return null;

        var kidHex = await ReadDefaultKidAsync(channel.StreamUrl, ct);
        if (kidHex is null)
            return null;

        var fetched = await fetcher.FetchAsync(licenseKey, ct);
        if (!fetched.Ok || fetched.Content is null)
            return null;

        return FindKeyInLicenseContent(fetched.Content, kidHex);
    }

    private async Task<string?> ReadDefaultKidAsync(string streamUrl, CancellationToken ct)
    {
        var fetched = await fetcher.FetchAsync(streamUrl, ct);
        if (!fetched.Ok || fetched.Content is null)
            return null;

        var match = DefaultKid.Match(fetched.Content);
        if (!match.Success)
            return null;

        var kid = NormalizeHexId(match.Groups["kid"].Value);
        return kid?.Length == 32 ? kid : null;
    }

    private string? FindKeyInLicenseContent(string content, string wantedKidHex)
    {
        var direct = DirectHexPair.Matches(content)
            .Select(m => new
            {
                Kid = NormalizeHexId(m.Groups["kid"].Value),
                Key = NormalizeHexId(m.Groups["key"].Value),
            })
            .FirstOrDefault(x => x.Kid == wantedKidHex && x.Key?.Length == 32);
        if (direct is not null)
            return $"{wantedKidHex}:{direct.Key}";

        foreach (var match in JsonKeyBeforeKid.Matches(content).Cast<Match>()
                     .Concat(JsonKidBeforeKey.Matches(content).Cast<Match>()))
        {
            var kid = ToHex16(match.Groups["kid"].Value);
            if (kid != wantedKidHex)
                continue;

            var key = ToHex16(match.Groups["key"].Value);
            if (key?.Length == 32)
                return $"{wantedKidHex}:{key}";
        }

        try
        {
            using var doc = JsonDocument.Parse(content);
            if (!doc.RootElement.TryGetProperty("keys", out var keys) || keys.ValueKind != JsonValueKind.Array)
                return null;

            foreach (var item in keys.EnumerateArray())
            {
                if (!item.TryGetProperty("kid", out var kidEl) || !item.TryGetProperty("k", out var keyEl))
                    continue;
                var kid = ToHex16(kidEl.GetString() ?? "");
                if (kid != wantedKidHex)
                    continue;
                var key = ToHex16(keyEl.GetString() ?? "");
                if (key?.Length == 32)
                    return $"{wantedKidHex}:{key}";
            }
        }
        catch (JsonException ex)
        {
            logger.LogDebug(ex, "License key response is not a single JSON object");
        }

        return null;
    }

    private static string? NormalizeDirectClearKey(string value)
    {
        var match = DirectHexPair.Match(value);
        if (!match.Success)
            return null;

        var kid = NormalizeHexId(match.Groups["kid"].Value);
        var key = NormalizeHexId(match.Groups["key"].Value);
        return kid?.Length == 32 && key?.Length == 32 ? $"{kid}:{key}" : null;
    }

    private static bool IsClearKey(string? licenseType) =>
        licenseType?.Contains("clearkey", StringComparison.OrdinalIgnoreCase) == true;

    private static string? NormalizeHexId(string value)
    {
        var normalized = value.Trim().Replace("-", "").ToLowerInvariant();
        return normalized.Length == 32 && normalized.All(Uri.IsHexDigit) ? normalized : null;
    }

    private static string? ToHex16(string value)
    {
        var hex = NormalizeHexId(value);
        if (hex is not null)
            return hex;

        var normalized = value.Trim().Replace('-', '+').Replace('_', '/');
        if (normalized.Length == 0)
            return null;
        normalized = normalized.PadRight(normalized.Length + ((4 - normalized.Length % 4) % 4), '=');

        try
        {
            var bytes = Convert.FromBase64String(normalized);
            return bytes.Length == 16 ? Convert.ToHexString(bytes).ToLowerInvariant() : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
