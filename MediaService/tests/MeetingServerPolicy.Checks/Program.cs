using MediaService.Api.Services;

static void Check(bool result, string description)
{
    if (!result) throw new InvalidOperationException(description);
    Console.WriteLine($"PASS {description}");
}

var config = new ConfigurationBuilder().AddInMemoryCollection().Build();
var policy = new MeetingServerPolicy(config);
Check(policy.GetServers().Length == 2, "Both hosting choices are exposed");
Check(policy.ValidateSelection("public")?.StatusCode == 503, "Expired public hosting is blocked");
Check(policy.ValidateSelection("home")?.StatusCode == 503, "Home hosting defaults to unavailable");
Check(policy.ValidateSelection(null)?.StatusCode == 503, "Old clients cannot bypass readiness");
Check(policy.ValidateSelection("other")?.StatusCode == 400, "Unknown hosting choices are rejected");

config["LiveKit:HomeEnabled"] = "true";
Check(policy.ValidateSelection("home") is null, "Verified home hosting accepts creation");
Check(policy.ValidateSelection(null) is null, "Old clients use home hosting when ready");
Check(policy.GetServers().Single(s => s.Id == "home").Available, "Catalog reflects home availability");
Check(!policy.GetServers().Single(s => s.Id == "public").Available, "Public hosting stays disabled when home is enabled");
Check(policy.ValidateSelection("public")?.StatusCode == 503, "Explicit public requests remain blocked");
