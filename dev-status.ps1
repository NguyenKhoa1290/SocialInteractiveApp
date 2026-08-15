# Xem nhanh cai gi dang song, cai gi chet - ke ca ha tang duoi (DB, Redis,
# RabbitMQ, LiveKit, Kafka) chu khong chi cac service .NET.
#
# Cot "Health" goi that /health chu khong chi kiem tra cong co mo: mot
# service co the giu cong nhung ben trong da hong (vd sai mat khau CSDL,
# Kafka chet) - luc do cong van mo ma request nao cung treo hoac 500.

function Test-Port([int]$Port) {
    $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Get-Health([int]$Port) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4 -UseBasicParsing
        if ($r.StatusCode -eq 200) { return "OK" } else { return "HTTP $($r.StatusCode)" }
    } catch {
        return "khong phan hoi"
    }
}

Write-Host ""
Write-Host "=== SERVICE ===" -ForegroundColor Cyan
$services = @(
    @{ Name = "Identity";  Port = 5194 },
    @{ Name = "WorkSpace"; Port = 5153 },
    @{ Name = "Chat";      Port = 5261 },
    @{ Name = "Admin";     Port = 5230 },
    @{ Name = "Media";     Port = 5300 }
)
foreach ($s in $services) {
    if (Test-Port $s.Port) {
        $h = Get-Health $s.Port
        $color = if ($h -eq "OK") { "Green" } else { "Red" }
        Write-Host ("  {0,-12} :{1,-6} {2}" -f $s.Name, $s.Port, $h) -ForegroundColor $color
    } else {
        Write-Host ("  {0,-12} :{1,-6} TAT" -f $s.Name, $s.Port) -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=== FRONTEND ===" -ForegroundColor Cyan
if (Test-Port 5173) {
    Write-Host "  Vite         :5173   OK  -> http://localhost:5173" -ForegroundColor Green
} else {
    Write-Host "  Vite         :5173   TAT" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== HA TANG ===" -ForegroundColor Cyan
$infra = @(
    @{ Name = "identity-db";  Port = 5432 },
    @{ Name = "workspace-db"; Port = 5433 },
    @{ Name = "chat-db";      Port = 5434 },
    @{ Name = "media-db";     Port = 5436 },
    @{ Name = "miniapp-db";   Port = 5437 },
    @{ Name = "Redis";        Port = 6379 },
    @{ Name = "RabbitMQ";     Port = 5672 },
    @{ Name = "LiveKit";      Port = 7880 },
    @{ Name = "Kafka";        Port = 9092 }
)
foreach ($i in $infra) {
    if (Test-Port $i.Port) {
        Write-Host ("  {0,-14} :{1,-6} OK" -f $i.Name, $i.Port) -ForegroundColor Green
    } else {
        $hint = if ($i.Port -eq 9092) { "TAT  <- dang ky/dang nhap se TREO neu thieu cai nay" } else { "TAT" }
        Write-Host ("  {0,-14} :{1,-6} {2}" -f $i.Name, $i.Port, $hint) -ForegroundColor Red
    }
}
Write-Host ""
