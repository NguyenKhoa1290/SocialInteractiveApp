# Tat toan bo service .NET + Vite + port-forward Kafka.
#
# KHONG dung toi ha tang (DB/Redis/RabbitMQ/LiveKit trong kind/Docker) - mo
# dung o day thi lan sau khoi dong lai rat lau va co the mat du lieu phien.
# Muon tat ha tang thi tat Docker Desktop.
#
# Cach dung:
#   .\dev-stop.ps1            # tat het
#   .\dev-stop.ps1 -Only chat # chi tat 1 service

param([string]$Only = "")

$map = @{
    "identity"  = "IdentityService.Api"
    "workspace" = "WorkspaceService.Api"
    "chat"      = "ChatService.Api"
    "admin"     = "AdminService.Api"
    "media"     = "MediaService.Api"
}

Write-Host "=== Tat he thong Chat_APP (dev) ===" -ForegroundColor Cyan

foreach ($kv in $map.GetEnumerator()) {
    if ($Only -and $Only -ne $kv.Key) { continue }
    $p = Get-Process -Name $kv.Value -ErrorAction SilentlyContinue
    if ($p) {
        $p | ForEach-Object { Stop-Process -Id $_.Id -Force }
        Write-Host "  [tat] $($kv.Value)" -ForegroundColor Yellow
    }
}

if (-not $Only -or $Only -eq "frontend") {
    # Vite chay duoi node.exe - chi tat dung tien trinh dang giu cong 5173,
    # khong tat bua moi node.exe tren may (co the co viec khac cua nguoi dung).
    $conn = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            Write-Host "  [tat] Vite (pid $_)" -ForegroundColor Yellow
        }
    }
}

# Khong con khoi tat Kafka port-forward: da bo han port-forward, Kafka gio
# di thang qua hostPort 9092 (xem dev-start.ps1).

Write-Host "Xong. Ha tang (DB/Redis/RabbitMQ/LiveKit) van giu nguyen." -ForegroundColor DarkGray
