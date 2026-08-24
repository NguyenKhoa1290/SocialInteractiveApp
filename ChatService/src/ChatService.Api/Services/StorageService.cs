using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace ChatService.Api.Services;

// Cau hinh cho MOT kho luu tru tuong thich S3. MinIO (may nha), Cloudflare R2
// va AWS S3 deu noi cung giao thuc nen dung chung class nay - chi khac
// endpoint + credentials, khong can SDK rieng.
public class StorageProviderOptions
{
    public string Endpoint { get; set; } = string.Empty;
    public string AccessKey { get; set; } = string.Empty;
    public string SecretKey { get; set; } = string.Empty;
    public string BucketName { get; set; } = string.Empty;

    // MinIO BAT BUOC path-style (http://host/bucket/key). R2/S3 nhan ca hai
    // nhung virtual-host moi la mac dinh cua ho.
    public bool ForcePathStyle { get; set; } = true;

    // Chu ky SigV4 can mot region. De trong thi AWSSDK mac dinh us-east-1
    // (MinIO khong quan tam). Cloudflare R2 dung "auto".
    public string Region { get; set; } = string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Endpoint) && !string.IsNullOrWhiteSpace(AccessKey);
}

public class StorageOptions
{
    // 0 (hoac am) = KHONG gioi han kich thuoc: moi file deu luu o "home",
    // chan duy nhat la han muc luu tru cua nhom. Dat > 0 neu muon day file
    // lon hon nguong sang "cloud".
    //
    // Truoc day mac dinh 20MB de tiet kiem bang thong duong truyen nha.
    // Cach giai quyet moi la BOP TOC DO ngay tai MinIO (xem
    // Tainguyen/infra/minio-gateway.conf) thay vi chan kich thuoc - file lon
    // van gui duoc, chi la truyen cham hon va khong cuop het duong truyen
    // cua cac service khac.
    public long HomeMaxBytes { get; set; } = 0;

    // Han cua presigned URL phai CO GIAN THEO KICH THUOC FILE. Truoc day co
    // dinh 300s, an toan khi file toi da 20MB; nhung khi da cho phep file
    // lon va bop bang thong xuong 3-5 MB/s thi mot file 1GB can hang chuc
    // phut - URL het han giua chung, upload hong ma nguoi dung khong hieu
    // vi sao. Day la hong hoc do CHINH viec bop toc do gay ra.
    public int MinPresignExpirySeconds { get; set; } = 300;
    public int MaxPresignExpirySeconds { get; set; } = 6 * 3600;

    // Toc do coi nhu TE NHAT ma mot ket noi dat duoc, chi dung de tinh han
    // presign. Dat THAP hon muc bop that (4 MB/s) co y: bang thong con chia
    // cho nhieu nguoi tai cung luc, tinh sat qua thi URL het han truoc khi
    // truyen xong.
    public long AssumedThroughputBytesPerSec { get; set; } = 512 * 1024;

    public Dictionary<string, StorageProviderOptions> Providers { get; set; } = new();
}

public class StorageService
{
    public const string Home = "home";
    public const string Cloud = "cloud";

    private readonly StorageOptions _options;
    private readonly ILogger<StorageService> _logger;
    private readonly Dictionary<string, (AmazonS3Client Client, StorageProviderOptions Opts)> _clients;

    public StorageService(StorageOptions options, ILogger<StorageService> logger)
    {
        _options = options;
        _logger = logger;
        _clients = new Dictionary<string, (AmazonS3Client, StorageProviderOptions)>(StringComparer.OrdinalIgnoreCase);

        foreach (var (name, p) in options.Providers)
        {
            if (!p.IsConfigured)
            {
                // Khong nem loi: cho phep chay voi rieng "home" khi chua mo
                // tai khoan cloud. Chi cac file vuot nguong moi bi anh huong.
                _logger.LogWarning("Kho luu tru '{Name}' chua cau hinh (thieu Endpoint/AccessKey) - bo qua", name);
                continue;
            }

            var config = new AmazonS3Config
            {
                ServiceURL = p.Endpoint,
                ForcePathStyle = p.ForcePathStyle,
                UseHttp = p.Endpoint.StartsWith("http://"),
            };
            if (!string.IsNullOrWhiteSpace(p.Region))
                config.AuthenticationRegion = p.Region;

            _clients[name] = (new AmazonS3Client(new BasicAWSCredentials(p.AccessKey, p.SecretKey), config), p);
        }

        if (!_clients.ContainsKey(Home))
            throw new InvalidOperationException("Thieu cau hinh kho luu tru 'home' trong Storage:Providers");
    }

    public long HomeMaxBytes => _options.HomeMaxBytes;

    public bool HasCloud => _clients.ContainsKey(Cloud);

    // Han presign du de truyen het file o toc do te nhat da gia dinh, kep
    // giua Min va Max. File cang lon URL cang song lau - do la co y, khong
    // phai lo hong: URL van chi mo duoc DUNG mot object key.
    public int PresignExpiryFor(long sizeBytes)
    {
        if (sizeBytes <= 0) return _options.MinPresignExpirySeconds;

        var perSec = Math.Max(1, _options.AssumedThroughputBytesPerSec);
        var needed = (long)Math.Ceiling((double)sizeBytes / perSec);
        return (int)Math.Clamp(needed, _options.MinPresignExpirySeconds, _options.MaxPresignExpirySeconds);
    }

    // Quyet dinh file nay nam o dau. Phai goi TRUOC khi insert hang vao bang
    // files de ghi ket qua vao cot storage_provider: mot khi da upload thi
    // file khong tu di chuyen, cot do la nguon su that duy nhat cho luc tai ve.
    public string ResolveProviderForUpload(long sizeBytes)
    {
        // HomeMaxBytes <= 0 nghia la khong gioi han - moi file ve "home".
        if (_options.HomeMaxBytes <= 0 || sizeBytes <= _options.HomeMaxBytes)
            return Home;

        if (_clients.ContainsKey(Cloud))
            return Cloud;

        // Chua mo kho cloud -> van cho luu o may nha thay vi tu choi upload:
        // tu choi la lam hong mot tinh nang dang chay chi vi cau hinh chua
        // duoc dien. Ghi canh bao de con biet bang thong nha van dang ganh.
        _logger.LogWarning(
            "File {Size} bytes vuot nguong {Limit} nhung kho 'cloud' chua cau hinh - tam luu o 'home'",
            sizeBytes, _options.HomeMaxBytes);
        return Home;
    }

    public string GeneratePresignedUploadUrl(string provider, string objectKey, long sizeBytes) =>
        Presign(provider, objectKey, HttpVerb.PUT, PresignExpiryFor(sizeBytes));

    // --- Tai len nhieu phan (multipart) ---------------------------------
    //
    // VI SAO CAN: he thong ra Internet qua Cloudflare Tunnel, va Cloudflare
    // bo cuoc voi nhung lan tai len lon, tra ve loi 524 ("origin khong tra
    // loi kip"). Kho luu tru chi tra loi SAU KHI nhan xong toan bo file nen
    // Cloudflare phai cho suot ca lan tai len.
    //
    // SO LIEU DO DUOC (khong phai suy dien):
    //   mot lan  10MB -> 200, 72,6 giay
    //   mot lan  25MB -> 524, 132,5 giay
    //   nhieu phan 25MB (5 phan) -> thanh cong
    //   nhieu phan 45MB (9 phan) -> thanh cong, checksum khop
    //
    // LUU Y ve co che: ban dau tuong quy tac la "qua ~100 giay thi cat" theo
    // con so Cloudflare cong bo cho goi mien phi. Nhung trong lan do 45MB co
    // MOT PHAN chay 148,7 giay VAN tra 200 - nen quy tac that phuc tap hon
    // the, khong phai mot moc tong thoi gian gon ghe. Cai chac chan la: body
    // cang nho thi cang de qua. Do la du de chon cach sua, nhung dung ghi vao
    // day mot con so chinh xac ma minh khong do duoc.
    //
    // Cach di qua: cat file thanh nhieu phan, MOI PHAN mot request rieng va
    // du nho. Kem theo mot loi lon: phan nao hong thi thu lai MOT MINH phan
    // do, khong phai lam lai ca file.
    public const int PartSizeBytes = 5 * 1024 * 1024;

    // File nho hon nguong nay thi tai mot lan cho gon - it request hon, va
    // 8MB o toc do te nhat van thua trong 100 giay.
    public const long MultipartThresholdBytes = 8 * 1024 * 1024;

    // S3 gioi han 10.000 phan. Chan som o 2000 (=10GB voi phan 5MB) de mot
    // so lieu sai khong bat server sinh ra hang van URL.
    private const int MaxParts = 2000;

    public static int PartCountFor(long sizeBytes) =>
        (int)Math.Min(MaxParts, Math.Max(1, (sizeBytes + PartSizeBytes - 1) / PartSizeBytes));

    public async Task<string> InitiateMultipartAsync(string provider, string objectKey, CancellationToken ct = default)
    {
        var entry = ClientFor(provider);
        var resp = await entry.Client.InitiateMultipartUploadAsync(new InitiateMultipartUploadRequest
        {
            BucketName = entry.Opts.BucketName,
            Key = objectKey,
        }, ct);
        return resp.UploadId;
    }

    public string GeneratePresignedPartUrl(string provider, string objectKey, string uploadId, int partNumber, int expirySeconds)
    {
        var entry = ClientFor(provider);
        var url = entry.Client.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = entry.Opts.BucketName,
            Key = objectKey,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.AddSeconds(expirySeconds),
            UploadId = uploadId,
            PartNumber = partNumber,
        });
        return FixScheme(entry, url);
    }

    // Ghep cac phan lai.
    //
    // ETag cua tung phan doc bang ListParts o PHIA SERVER chu khong bat client
    // gui len. Ly do rat thuc te: trinh duyet chi doc duoc header ETag cua
    // response neu may chu co Access-Control-Expose-Headers dung - mot chi
    // tiet CORS de hong am tham. Hoi thang kho luu tru thi khong phu thuoc
    // vao dieu do chut nao.
    public async Task CompleteMultipartAsync(string provider, string objectKey, string uploadId, CancellationToken ct = default)
    {
        var entry = ClientFor(provider);

        var parts = new List<PartETag>();
        var listed = await entry.Client.ListPartsAsync(new ListPartsRequest
        {
            BucketName = entry.Opts.BucketName,
            Key = objectKey,
            UploadId = uploadId,
        }, ct);
        foreach (var p in listed.Parts)
            parts.Add(new PartETag(p.PartNumber ?? 0, p.ETag));

        if (parts.Count == 0)
            throw new InvalidOperationException("Chua co phan nao duoc tai len");

        await entry.Client.CompleteMultipartUploadAsync(new CompleteMultipartUploadRequest
        {
            BucketName = entry.Opts.BucketName,
            Key = objectKey,
            UploadId = uploadId,
            PartETags = parts,
        }, ct);
    }

    public async Task AbortMultipartAsync(string provider, string objectKey, string uploadId, CancellationToken ct = default)
    {
        var entry = ClientFor(provider);
        await entry.Client.AbortMultipartUploadAsync(new AbortMultipartUploadRequest
        {
            BucketName = entry.Opts.BucketName,
            Key = objectKey,
            UploadId = uploadId,
        }, ct);
    }

    private (AmazonS3Client Client, StorageProviderOptions Opts) ClientFor(string provider) =>
        _clients.TryGetValue(provider, out var entry) ? entry : throw new StorageProviderUnavailableException(provider);

    // Tu de xuat - thieu sot phat hien khi build Frontend F2: chi co presign
    // PUT (upload), khong co cach nao lay lai URL de XEM/TAI file da gui.
    // Xem GET /files/{fileId}/download-url o FileEndpoints.cs.
    public string GeneratePresignedDownloadUrl(string provider, string objectKey, long sizeBytes) =>
        Presign(provider, objectKey, HttpVerb.GET, PresignExpiryFor(sizeBytes));

    private string Presign(string provider, string objectKey, HttpVerb verb, int expirySeconds)
    {
        if (!_clients.TryGetValue(provider, out var entry))
            throw new StorageProviderUnavailableException(provider);

        var url = entry.Client.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = entry.Opts.BucketName,
            Key = objectKey,
            Verb = verb,
            Expires = DateTime.UtcNow.AddSeconds(expirySeconds),
        });

        // AWSSDK.S3 luon sinh scheme "https://" trong URL presign bat ke
        // AmazonS3Config.UseHttp da bat - da xac nhan bang test thuc te voi
        // MinIO cua du an (chi nghe HTTP thuong tren port 9000, khong co TLS).
        // Ep lai dung scheme theo Endpoint da cau hinh, neu khong client that
        // se bi loi SSL handshake khi PUT len URL nay.
        return FixScheme(entry, url);
    }

    // AWSSDK.S3 luon sinh scheme "https://" trong URL presign bat ke
    // AmazonS3Config.UseHttp da bat - da xac nhan bang test thuc te voi MinIO
    // cua du an (chi nghe HTTP thuong tren port 9000, khong co TLS). Ep lai
    // dung scheme theo Endpoint da cau hinh, neu khong client that se bi loi
    // SSL handshake khi PUT len URL nay.
    private static string FixScheme((AmazonS3Client Client, StorageProviderOptions Opts) entry, string url) =>
        entry.Opts.Endpoint.StartsWith("http://") && url.StartsWith("https://")
            ? "http://" + url["https://".Length..]
            : url;
}

// Hang file tro toi mot kho khong con cau hinh (vd da go cau hinh cloud
// nhung file cu van nam tren do). Phai bao loi ro rang chu KHONG duoc am
// tham presign vao kho khac - lam vay se tra ve URL tro toi object khong
// ton tai, nguoi dung nhan 404 tu MinIO ma khong hieu vi sao.
public class StorageProviderUnavailableException(string provider)
    : InvalidOperationException($"Kho luu tru '{provider}' chua duoc cau hinh")
{
    public string Provider { get; } = provider;
}
