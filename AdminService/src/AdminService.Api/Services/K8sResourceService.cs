using k8s;
using k8s.Autorest;

namespace AdminService.Api.Services;

public class K8sOptions
{
    // "" = tu doc config trong-cluster (ServiceAccount token) khi chay that
    // trong K8s; khi test/dev tren may local dung kubeconfig mac dinh.
    public bool UseInCluster { get; set; } = true;
    public string? MetricsNamespace { get; set; } = null; // null = tat ca namespace
}

public record PodResource(string Name, string CpuUsage, string MemoryUsage);
public record NodeResource(string Name, string CpuUsage, string MemoryUsage);
public record SystemResources(List<PodResource> Pods, List<NodeResource> Nodes);

// UC-14: doc tai nguyen he thong qua K8s API, dung Service Account RIENG,
// RBAC read-only (get/list tren pods, nodes, metrics.k8s.io) - xem
// Tainguyen/infra/adminservice-rbac.yaml. Phu thuoc Metrics Server da cai
// trong cluster (xem HUONG-DAN-TRIEN-KHAI-PHASE0.md).
public class K8sResourceService
{
    private readonly Kubernetes _client;
    private readonly ILogger<K8sResourceService> _logger;
    private readonly K8sOptions _options;

    public K8sResourceService(K8sOptions options, ILogger<K8sResourceService> logger)
    {
        _options = options;
        _logger = logger;
        var config = options.UseInCluster
            ? KubernetesClientConfiguration.InClusterConfig()
            : KubernetesClientConfiguration.BuildConfigFromConfigFile();
        _client = new Kubernetes(config);
    }

    // Tra ve null neu Metrics Server chua cai (UC-14, luong ngoai le 2a) -
    // endpoint se tra 503 trong truong hop nay.
    public async Task<SystemResources?> GetResourcesAsync()
    {
        try
        {
            var podMetrics = await _client.CustomObjects.ListClusterCustomObjectAsync(
                "metrics.k8s.io", "v1beta1", "pods");
            var nodeMetrics = await _client.CustomObjects.ListClusterCustomObjectAsync(
                "metrics.k8s.io", "v1beta1", "nodes");

            var pods = ParsePodMetrics(podMetrics);
            var nodes = ParseNodeMetrics(nodeMetrics);
            return new SystemResources(pods, nodes);
        }
        catch (HttpOperationException ex)
        {
            _logger.LogWarning(ex, "Metrics Server khong san sang (metrics.k8s.io) - co the chua cai trong cluster");
            return null;
        }
    }

    private static List<PodResource> ParsePodMetrics(object raw)
    {
        var json = System.Text.Json.JsonSerializer.SerializeToElement(raw);
        var result = new List<PodResource>();
        if (!json.TryGetProperty("items", out var items))
            return result;

        foreach (var item in items.EnumerateArray())
        {
            var name = item.GetProperty("metadata").GetProperty("name").GetString() ?? "";
            var containers = item.GetProperty("containers");
            var cpu = "0"; var mem = "0";
            foreach (var c in containers.EnumerateArray())
            {
                var usage = c.GetProperty("usage");
                cpu = usage.GetProperty("cpu").GetString() ?? cpu;
                mem = usage.GetProperty("memory").GetString() ?? mem;
            }
            result.Add(new PodResource(name, cpu, mem));
        }
        return result;
    }

    private static List<NodeResource> ParseNodeMetrics(object raw)
    {
        var json = System.Text.Json.JsonSerializer.SerializeToElement(raw);
        var result = new List<NodeResource>();
        if (!json.TryGetProperty("items", out var items))
            return result;

        foreach (var item in items.EnumerateArray())
        {
            var name = item.GetProperty("metadata").GetProperty("name").GetString() ?? "";
            var usage = item.GetProperty("usage");
            var cpu = usage.GetProperty("cpu").GetString() ?? "0";
            var mem = usage.GetProperty("memory").GetString() ?? "0";
            result.Add(new NodeResource(name, cpu, mem));
        }
        return result;
    }

    // UC-15: can RBAC Role RIENG cho patch tren deployments/scale, tach khoi
    // Role read-only o tren. Neu Service Account chua co quyen, K8s API tra
    // ve 403 - duoc bat lai va anh xa sang HTTP 403 o Endpoints.
    public async Task ScaleDeploymentAsync(string deploymentName, int replicas, string namespaceName = "default")
    {
        var patch = new k8s.Models.V1Patch(
            new { spec = new { replicas } },
            k8s.Models.V1Patch.PatchType.MergePatch);
        await _client.AppsV1.PatchNamespacedDeploymentScaleAsync(patch, deploymentName, namespaceName);
    }
}
