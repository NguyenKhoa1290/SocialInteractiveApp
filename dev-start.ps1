# Khoi dong toan bo he thong cho moi truong DEV tren may Windows.
#
# LUU Y: duong chinh bay gio la DOCKER COMPOSE ("docker compose up -d" o thu
# muc goc). Script nay giu lai cho truong hop can chay 1 service thang tren
# may de gan debugger hoac sua nhanh khong muon build lai image.
#
# Moi service chay trong MOT CUA SO RIENG co tieu de ro rang - nhin thay
# duoc log truc tiep, tat rieng tung cai duoc. Khac han cach chay nen
# (nohup/background) vi chay nen thi khong thay gi va khong biet cai nao
# dang song.
#
# Cach dung:
#   .\dev-start.ps1              # khoi dong tat ca
#   .\dev-start.ps1 -Only chat   # chi khoi dong 1 service
#   .\dev-start.ps1 -NoFrontend  # bo qua Vite
#
# Xem trang thai:  .\dev-status.ps1
# Tat het:         .\dev-stop.ps1

param(
    [string]$Only = "",
    [switch]$NoFrontend
)

$root = $PSScriptRoot

# LUU Y: mat khau duoi day trung voi appsettings.json da commit trong repo
# (rieng Identity lay tu Tainguyen/infra/.identity-db-credentials.txt vi
# appsettings cua no de trong). Day la moi truong dev noi bo.
#
# TAT CA deu dung 127.0.0.1 chu KHONG dung "localhost": localhost phan giai
# ra ::1 (IPv6) truoc, ma cac port-forward/kind chi lang nghe IPv4 -> ket noi
# treo cho toi khi timeout. Day la loi da gap that nhieu lan.
$redis = "127.0.0.1:6379,password=154f8287a3654e90665f4e6a58399e0f"
$jwtKey = "C:/Program Files/Git/zzLL7FpBzfbY34fNU6H1vQUIRqocBVF9P1ETxgKtJIb+W8sYO/ARu4TtCTc8+GC"

$services = @(
    @{
        Key = "identity"; Name = "Identity"; Port = 5194
        Path = "IdentityService\src\IdentityService.Api"
        Env  = @{
            "ConnectionStrings__IdentityDb" = "Host=127.0.0.1;Port=5432;Database=identity;Username=identity_admin;Password=f8f12714edad39133b1a2f619500a0dc"
            "ConnectionStrings__Redis"      = $redis
            "Kafka__BootstrapServers"       = "host.docker.internal:9092"
            "RabbitMq__HostName"            = "127.0.0.1"
            "Jwt__SigningKey"               = $jwtKey
        }
    },
    @{
        Key = "workspace"; Name = "WorkSpace"; Port = 5153
        Path = "WorkspaceService\src\WorkspaceService.Api"
        Env  = @{
            "ConnectionStrings__WorkspaceDb" = "Host=127.0.0.1;Port=5433;Database=workspace;Username=workspace_admin;Password=9142ecf6969c0f66826be3d51270ff3e"
            "ConnectionStrings__Redis"       = $redis
            "RabbitMq__HostName"             = "127.0.0.1"
            "IdentityClient__BaseUrl"        = "http://127.0.0.1:5194"
            "ChatServiceClient__BaseUrl"     = "http://127.0.0.1:5261"
        }
    },
    @{
        Key = "chat"; Name = "Chat"; Port = 5261
        Path = "ChatService\src\ChatService.Api"
        Env  = @{
            "ConnectionStrings__ChatDb"    = "Host=127.0.0.1;Port=5434;Database=chat;Username=chat_admin;Password=6486380b7831f81bc082871538a2c771"
            "ConnectionStrings__Redis"     = $redis
            "Kafka__BootstrapServers"      = "127.0.0.1:19092"
            "RabbitMq__HostName"           = "127.0.0.1"
            "WorkspaceClient__BaseUrl"     = "http://127.0.0.1:5153"
            "MediaServiceClient__BaseUrl"  = "http://127.0.0.1:5300"
            "IdentityClient__BaseUrl"      = "http://127.0.0.1:5194"
        }
    },
    @{
        Key = "admin"; Name = "Admin"; Port = 5230
        Path = "AdminService\src\AdminService.Api"
        Env  = @{
            "RabbitMq__HostName"           = "127.0.0.1"
            "IdentityClient__BaseUrl"      = "http://127.0.0.1:5194"
            "SpamTrackingClient__BaseUrl"  = "http://127.0.0.1:5240"
            "ChatServiceClient__BaseUrl"   = "http://127.0.0.1:5261"
        }
    },
    @{
        Key = "media"; Name = "Media"; Port = 5300
        Path = "MediaService\src\MediaService.Api"
        Env  = @{
            "ConnectionStrings__MediaDb"   = "Host=127.0.0.1;Port=5436;Database=media;Username=media_admin;Password=f82b6df20ed68a55b97361360c1a0f8d"
            "ConnectionStrings__MiniAppDb" = "Host=127.0.0.1;Port=5437;Database=miniapp;Username=miniapp_admin;Password=a377345d7812f08609dae5d97e8d4de2"
            "ConnectionStrings__Redis"     = $redis
            "RabbitMq__HostName"           = "127.0.0.1"
            "IdentityClient__BaseUrl"      = "http://127.0.0.1:5194"
            "ChatServiceClient__BaseUrl"   = "http://127.0.0.1:5261"
            "LiveKit__ServerUrl"           = "http://127.0.0.1:7880"
            "LiveKit__ClientUrl"           = "ws://127.0.0.1:7880"
        }
    }
)

function Test-Port([int]$Port) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    return $null -ne $c
}

function Start-InWindow([string]$Title, [string]$Command) {
    # -NoExit: giu cua so lai sau khi tien trinh chet, de con doc duoc loi.
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "`$host.UI.RawUI.WindowTitle = '$Title'; $Command"
    ) -WindowStyle Normal
}

Write-Host "=== Khoi dong he thong Chat_APP (dev) ===" -ForegroundColor Cyan

# KHONG con can kubectl port-forward cho Kafka: Kafka gio quang ba
# "host.docker.internal:9092" - dia chi ma ca may that lan container deu toi
# duoc, di thang qua hostPort 9092 cua kind-messaging-cluster.

# --- Cac service .NET ---------------------------------------------------
foreach ($svc in $services) {
    if ($Only -and $Only -ne $svc.Key) { continue }

    if (Test-Port $svc.Port) {
        Write-Host "  [bo qua] $($svc.Name) da chay san (cong $($svc.Port))" -ForegroundColor DarkGray
        continue
    }

    $envLines = ($svc.Env.GetEnumerator() | ForEach-Object {
        "`$env:$($_.Key) = '$($_.Value)'"
    }) -join "; "

    $dir = Join-Path $root $svc.Path
    $cmd = "Set-Location '$dir'; $envLines; dotnet run --no-launch-profile --urls 'http://localhost:$($svc.Port)'"

    Write-Host "  [bat]    $($svc.Name) tren cong $($svc.Port)" -ForegroundColor Green
    Start-InWindow "$($svc.Name) Service :$($svc.Port)" $cmd
}

# --- Frontend -----------------------------------------------------------
if (-not $NoFrontend -and (-not $Only -or $Only -eq "frontend")) {
    if (Test-Port 5173) {
        Write-Host "  [bo qua] Frontend da chay san (5173)" -ForegroundColor DarkGray
    } else {
        Write-Host "  [bat]    Frontend (Vite) tren cong 5173" -ForegroundColor Green
        Start-InWindow "Frontend Vite :5173" "Set-Location '$(Join-Path $root 'Frontend')'; npm run dev"
    }
}

Write-Host ""
Write-Host "Dang cho cac service san sang..." -ForegroundColor Yellow
Start-Sleep -Seconds 20
& (Join-Path $root "dev-status.ps1")
