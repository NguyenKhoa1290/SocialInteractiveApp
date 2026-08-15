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
    // File <= nguong nay luu o "home", lon hon thi day len "cloud".
    // Ly do phan nguong theo DUNG LUONG chu khong theo loai file: bang thong
    // upload cua duong truyen nha la thu khan hiem nhat, va presigned URL
    // KHONG cuu duoc no - presign chi chuyen phan xac thuc sang API, con
    // bytes van di ra tu MinIO nha moi lan co nguoi tai ve.
    public long HomeMaxBytes { get; set; } = 20L * 1024 * 1024;

    public int PresignedUrlExpirySeconds { get; set; } = 300;

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

    public int PresignedUrlExpirySeconds => _options.PresignedUrlExpirySeconds;

    public long HomeMaxBytes => _options.HomeMaxBytes;

    public bool HasCloud => _clients.ContainsKey(Cloud);

    // Quyet dinh file nay nam o dau. Phai goi TRUOC khi insert hang vao bang
    // files de ghi ket qua vao cot storage_provider: mot khi da upload thi
    // file khong tu di chuyen, cot do la nguon su that duy nhat cho luc tai ve.
    public string ResolveProviderForUpload(long sizeBytes)
    {
        if (sizeBytes <= _options.HomeMaxBytes)
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

    public string GeneratePresignedUploadUrl(string provider, string objectKey) =>
        Presign(provider, objectKey, HttpVerb.PUT);

    // Tu de xuat - thieu sot phat hien khi build Frontend F2: chi co presign
    // PUT (upload), khong co cach nao lay lai URL de XEM/TAI file da gui.
    // Xem GET /files/{fileId}/download-url o FileEndpoints.cs.
    public string GeneratePresignedDownloadUrl(string provider, string objectKey) =>
        Presign(provider, objectKey, HttpVerb.GET);

    private string Presign(string provider, string objectKey, HttpVerb verb)
    {
        if (!_clients.TryGetValue(provider, out var entry))
            throw new StorageProviderUnavailableException(provider);

        var url = entry.Client.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = entry.Opts.BucketName,
            Key = objectKey,
            Verb = verb,
            Expires = DateTime.UtcNow.AddSeconds(_options.PresignedUrlExpirySeconds),
        });

        // AWSSDK.S3 luon sinh scheme "https://" trong URL presign bat ke
        // AmazonS3Config.UseHttp da bat - da xac nhan bang test thuc te voi
        // MinIO cua du an (chi nghe HTTP thuong tren port 9000, khong co TLS).
        // Ep lai dung scheme theo Endpoint da cau hinh, neu khong client that
        // se bi loi SSL handshake khi PUT len URL nay.
        if (entry.Opts.Endpoint.StartsWith("http://") && url.StartsWith("https://"))
            url = "http://" + url["https://".Length..];

        return url;
    }
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
