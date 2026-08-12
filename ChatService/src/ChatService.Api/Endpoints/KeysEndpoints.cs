using System.Security.Claims;
using ChatService.Api.Data;
using ChatService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Endpoints;

public record RegisterPublicKeyRequest(string PublicKey, string? Algorithm);
public record PublicKeyResponse(long UserId, string PublicKey, string Algorithm);

public record SaveVaultRequest(string Salt, string Nonce, string Ciphertext);
public record VaultResponse(string Salt, string Nonce, string Ciphertext, DateTimeOffset UpdatedAt);

// E2EE (tu de xuat, khong co trong OpenAPI spec goc vi tai lieu goc chi ghi
// ten "E2EE" khong mo ta co che). "Danh ba khoa cong khai" - client tu sinh
// cap khoa X25519 luc dang nhap lan dau, dang ky khoa cong khai qua day.
// Khoa RIENG TU KHONG BAO GIO gui len day/len server - chi ton tai tren
// thiet bi cua user, tu bao ve bang PIN cuc bo (ngoai pham vi backend).
public static class KeysEndpoints
{
    public static void MapKeysEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/keys").RequireAuthorization();

        // Upsert - client goi lai moi lan sinh cap khoa moi (vd cai lai app,
        // mat thiet bi cu) - ghi de khoa cu, cac tin nhan ma hoa cho khoa cu
        // se khong con giai ma duoc nua (danh doi chap nhan cua E2EE that).
        group.MapPost("", async (RegisterPublicKeyRequest req, ClaimsPrincipal principal, ChatDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.PublicKey))
                return Results.BadRequest(new ErrorResponse("invalid_request", "publicKey khong duoc trong"));

            var userId = GetUserId(principal)!.Value;
            var existing = await db.UserPublicKeys.FindAsync(userId);
            if (existing is null)
            {
                db.UserPublicKeys.Add(new UserPublicKey
                {
                    UserId = userId,
                    PublicKey = req.PublicKey,
                    Algorithm = req.Algorithm ?? "x25519",
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
            }
            else
            {
                existing.PublicKey = req.PublicKey;
                existing.Algorithm = req.Algorithm ?? "x25519";
                existing.UpdatedAt = DateTimeOffset.UtcNow;
            }
            await db.SaveChangesAsync();

            return Results.Ok(new PublicKeyResponse(userId, req.PublicKey, req.Algorithm ?? "x25519"));
        });

        group.MapGet("/{userId:long}", async (long userId, ChatDbContext db) =>
        {
            var key = await db.UserPublicKeys.FindAsync(userId);
            return key is null
                ? Results.NotFound(new ErrorResponse("key_not_found", "User chua dang ky khoa cong khai - chua the ma hoa gui cho nguoi nay"))
                : Results.Ok(new PublicKeyResponse(key.UserId, key.PublicKey, key.Algorithm));
        });

        // Batch resolve - dung khi gui tin nhan Group (can khoa cong khai
        // cua TAT CA thanh vien de ma hoa fan-out), tranh N+1.
        group.MapGet("/batch", async (string ids, ChatDbContext db) =>
        {
            var parsedIds = ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => long.TryParse(s, out var id) ? id : (long?)null)
                .Where(id => id.HasValue)
                .Select(id => id!.Value)
                .ToList();

            var found = await db.UserPublicKeys.Where(k => parsedIds.Contains(k.UserId)).ToListAsync();
            return Results.Ok(found.Select(k => new PublicKeyResponse(k.UserId, k.PublicKey, k.Algorithm)));
        });

        // Vault - luu ban ma hoa (bang PIN) cua private key de khoi phuc
        // duoc tren thiet bi moi (tu thiet ke, xac nhan voi nguoi dung du
        // an - xem UserKeyVault.cs). Server chi thay ciphertext, khong bao
        // gio thay PIN hay private key that.
        group.MapPost("/vault", async (SaveVaultRequest req, ClaimsPrincipal principal, ChatDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Salt) || string.IsNullOrWhiteSpace(req.Nonce) || string.IsNullOrWhiteSpace(req.Ciphertext))
                return Results.BadRequest(new ErrorResponse("invalid_request", "salt, nonce, ciphertext deu bat buoc"));

            var userId = GetUserId(principal)!.Value;
            var existing = await db.UserKeyVaults.FindAsync(userId);
            if (existing is null)
            {
                db.UserKeyVaults.Add(new UserKeyVault
                {
                    UserId = userId,
                    Salt = req.Salt,
                    Nonce = req.Nonce,
                    Ciphertext = req.Ciphertext,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
            }
            else
            {
                existing.Salt = req.Salt;
                existing.Nonce = req.Nonce;
                existing.Ciphertext = req.Ciphertext;
                existing.UpdatedAt = DateTimeOffset.UtcNow;
            }
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        group.MapGet("/vault", async (ClaimsPrincipal principal, ChatDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var vault = await db.UserKeyVaults.FindAsync(userId);
            return vault is null
                ? Results.NotFound(new ErrorResponse("vault_not_found", "Chua thiet lap PIN tren thiet bi nao"))
                : Results.Ok(new VaultResponse(vault.Salt, vault.Nonce, vault.Ciphertext, vault.UpdatedAt));
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
