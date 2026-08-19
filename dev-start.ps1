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

# Bi mat KHONG nam trong file nay (file nay duoc commit len GitHub cong khai).
# Doc tu .env o thu muc goc - file do bi .gitignore chan.
# Chua co .env thi chep mau:  cp .env.example .env
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "Thieu file .env - chep tu .env.example roi dien gia tri." -ForegroundColor Red
    exit 1
}
$cfg = @{}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -and -not $t.StartsWith("#") -and $t.Contains("=")) {
        $i = $t.IndexOf("=")
        $cfg[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
    }
}
function Need($key) {
    if (-not $cfg.ContainsKey($key) -or -not $cfg[$key]) {
        Write-Host "Thieu khoa '$key' trong .env" -ForegroundColor Red
        exit 1
    }
    return $cfg[$key]
}
#
# TAT CA deu dung 127.0.0.1 chu KHONG dung "localhost": localhost phan giai
# ra ::1 (IPv6) truoc, ma cac port-forward/kind chi lang nghe IPv4 -> ket noi
# treo cho toi khi timeout. Day la loi da gap that nhieu lan.
$redis = "127.0.0.1:6379,password=$(Need 'REDIS_PASSWORD')"
$jwtKey   = Need 'JWT_SIGNING_KEY'
$rabbitPw = Need 'RABBITMQ_PASSWORD'
$minioAk  = Need 'MINIO_ACCESS_KEY'
$minioSk  = Need 'MINIO_SECRET_KEY'
# Kafka quang ba 'host.docker.internal:9092' - dia chi ca may that lan
# container deu toi duoc. KHONG con dung port-forward 19092.
$kafka    = "host.docker.internal:9092"

$services = @(
    @{
        Key = "identity"; Name = "Identity"; Port = 5194
        Path = "IdentityService\src\IdentityService.Api"
        Env  = @{
            "ConnectionStrings__IdentityDb" = "Host=127.0.0.1;Port=5432;Database=identity;Username=identity_admin;Password=$(Need 'IDENTITY_DB_PASSWORD')"
            "ConnectionStrings__Redis"      = $redis
            "Kafka__BootstrapServers"       = $kafka
            "RabbitMq__HostName"            = "127.0.0.1"
            "RabbitMq__Password"            = $rabbitPw
            "Jwt__SigningKey"               = $jwtKey
        }
    },
    @{
        Key = "workspace"; Name = "WorkSpace"; Port = 5153
        Path = "WorkspaceService\src\WorkspaceService.Api"
        Env  = @{
            "ConnectionStrings__WorkspaceDb" = "Host=127.0.0.1;Port=5433;Database=workspace;Username=workspace_admin;Password=$(Need 'WORKSPACE_DB_PASSWORD')"
            "ConnectionStrings__Redis"       = $redis
            "RabbitMq__HostName"             = "127.0.0.1"
            "RabbitMq__Password"             = $rabbitPw
            "Jwt__SigningKey"                = $jwtKey
            "IdentityClient__BaseUrl"        = "http://127.0.0.1:5194"
            "ChatServiceClient__BaseUrl"     = "http://127.0.0.1:5261"
        }
    },
    @{
        Key = "chat"; Name = "Chat"; Port = 5261
        Path = "ChatService\src\ChatService.Api"
        Env  = @{
            "ConnectionStrings__ChatDb"    = "Host=127.0.0.1;Port=5434;Database=chat;Username=chat_admin;Password=$(Need 'CHAT_DB_PASSWORD')"
            "ConnectionStrings__Redis"     = $redis
            "Kafka__BootstrapServers"      = $kafka
            "RabbitMq__HostName"           = "127.0.0.1"
            "RabbitMq__Password"           = $rabbitPw
            "Jwt__SigningKey"              = $jwtKey
            "WorkspaceClient__BaseUrl"     = "http://127.0.0.1:5153"
            "MediaServiceClient__BaseUrl"  = "http://127.0.0.1:5300"
            "IdentityClient__BaseUrl"      = "http://127.0.0.1:5194"
            # Ba khoa nay truoc nam trong appsettings.json - da bo trong o do
            # de commit duoc, nen phai cap tu day.
            "Storage__Providers__home__AccessKey" = $minioAk
            "Storage__Providers__home__SecretKey" = $minioSk
        }
    },
    @{
        Key = "spamtracking"; Name = "SpamTracking"; Port = 5160
        Path = "SpamTrackingService\src\SpamTrackingService.Api"
        Env  = @{
            "ConnectionStrings__SpamTrackingDb" = "Host=127.0.0.1;Port=5435;Database=spamtracking;Username=spamtracking_admin;Password=$(Need 'SPAMTRACKING_DB_PASSWORD')"
            "ConnectionStrings__Redis"          = $redis
            "Kafka__BootstrapServers"           = $kafka
            "RabbitMq__HostName"                = "127.0.0.1"
            "RabbitMq__Password"                = $rabbitPw
            "Jwt__SigningKey"                   = $jwtKey
            "IdentityClient__BaseUrl"           = "http://127.0.0.1:5194"
        }
    },
    @{
        Key = "media"; Name = "Media"; Port = 5300
        Path = "MediaService\src\MediaService.Api"
        Env  = @{
            "ConnectionStrings__MediaDb"   = "Host=127.0.0.1;Port=5436;Database=media;Username=media_admin;Password=$(Need 'MEDIA_DB_PASSWORD')"
            "ConnectionStrings__MiniAppDb" = "Host=127.0.0.1;Port=5437;Database=miniapp;Username=miniapp_admin;Password=$(Need 'MINIAPP_DB_PASSWORD')"
            "ConnectionStrings__Redis"     = $redis
            "RabbitMq__HostName"           = "127.0.0.1"
            "RabbitMq__Password"           = $rabbitPw
            "Jwt__SigningKey"              = $jwtKey
            "IdentityClient__BaseUrl"      = "http://127.0.0.1:5194"
            "ChatServiceClient__BaseUrl"   = "http://127.0.0.1:5261"
            "LiveKit__ServerUrl"           = $(if ($cfg['LIVEKIT_SERVER_URL']) { $cfg['LIVEKIT_SERVER_URL'] } else { "http://127.0.0.1:7880" })
            "LiveKit__ClientUrl"           = $(if ($cfg['LIVEKIT_CLIENT_URL']) { $cfg['LIVEKIT_CLIENT_URL'] } else { "ws://127.0.0.1:7880" })
            "LiveKit__ApiKey"              = $(if ($cfg['LIVEKIT_API_KEY']) { $cfg['LIVEKIT_API_KEY'] } else { "" })
            "LiveKit__ApiSecret"           = $(if ($cfg['LIVEKIT_API_SECRET']) { $cfg['LIVEKIT_API_SECRET'] } else { "" })
        }
    },
    @{
        Key = "admin"; Name = "Admin"; Port = 5230
        Path = "AdminService\src\AdminService.Api"
        Env  = @{
            "RabbitMq__HostName"           = "127.0.0.1"
            "RabbitMq__Password"           = $rabbitPw
            "Jwt__SigningKey"              = $jwtKey
            "IdentityClient__BaseUrl"      = "http://127.0.0.1:5194"
            "SpamTrackingClient__BaseUrl"  = "http://127.0.0.1:5160"
            "ChatServiceClient__BaseUrl"   = "http://127.0.0.1:5261"
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
