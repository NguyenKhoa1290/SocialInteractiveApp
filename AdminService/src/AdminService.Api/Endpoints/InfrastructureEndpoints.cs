using AdminService.Api.Services;
using k8s.Autorest;

namespace AdminService.Api.Endpoints;

// UC-14, UC-15, UC-16. Toan bo endpoint yeu cau JWT role=admin.
public static class InfrastructureEndpoints
{
    public static void MapInfrastructureEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/system").RequireAuthorization("AdminOnly");

        group.MapGet("/resources", async (K8sResourceService k8s) =>
        {
            var resources = await k8s.GetResourcesAsync();
            return resources is null
                ? Results.Json(
                    new ErrorResponse("metrics_unavailable", "Metrics Server chua duoc cai trong cluster"),
                    statusCode: 503)
                : Results.Ok(resources);
        });

        // UC-15: can RBAC Role RIENG (patch tren deployments/scale), tach
        // khoi Role read-only dung cho /resources - xem
        // Tainguyen/infra/adminservice-rbac.yaml.
        group.MapPost("/services/{serviceName}/scale", async (string serviceName, ScaleRequest req, K8sResourceService k8s) =>
        {
            if (req.Replicas < 1)
                return Results.BadRequest(new ErrorResponse("invalid_request", "replicas phai >= 1"));

            try
            {
                await k8s.ScaleDeploymentAsync(serviceName, req.Replicas);
                return Results.Accepted();
            }
            catch (HttpOperationException ex) when (ex.Response.StatusCode == System.Net.HttpStatusCode.Forbidden)
            {
                return Results.Json(
                    new ErrorResponse("forbidden", "Service Account chua co quyen ghi (patch deployments/scale)"),
                    statusCode: 403);
            }
        });

        // UC-16: quy trinh dung thuc te co the CHUA tu dong hoa hoan toan
        // (dung VPS/nha cung cap ngoai K8s cho LiveKit - xem
        // Tainguyen/infra/HUONG-DAN-DEPLOY.md muc 6). 202 o day chi nghia la
        // "da ghi nhan yeu cau/ticket", KHONG dam bao node moi co ngay.
        group.MapPost("/livekit/expand", (LiveKitExpandRequest? req, ILogger<Program> logger) =>
        {
            logger.LogInformation("Yeu cau mo rong LiveKit duoc ghi nhan. Ly do: {Reason}", req?.Reason ?? "(khong co)");
            return Results.Accepted();
        });
    }
}
