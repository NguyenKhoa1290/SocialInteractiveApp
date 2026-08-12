using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace ChatService.Api.Services;

public class MinioOptions
{
    public string Endpoint { get; set; } = "http://192.168.50.10:9000";
    public string AccessKey { get; set; } = string.Empty;
    public string SecretKey { get; set; } = string.Empty;
    public string BucketName { get; set; } = "chat-media";
    public int PresignedUrlExpirySeconds { get; set; } = 300;
}

// MinIO tuong thich S3 - dung AWSSDK.S3 voi ServiceURL tro vao MinIO thay vi
// AWS that, ForcePathStyle bat buoc voi MinIO (theo dang http://host/bucket/key
// thay vi http://bucket.host/key).
public class MinioStorageService
{
    private readonly AmazonS3Client _s3;
    private readonly MinioOptions _options;

    public MinioStorageService(MinioOptions options)
    {
        _options = options;
        var config = new AmazonS3Config
        {
            ServiceURL = options.Endpoint,
            ForcePathStyle = true,
            UseHttp = options.Endpoint.StartsWith("http://"),
        };
        _s3 = new AmazonS3Client(new BasicAWSCredentials(options.AccessKey, options.SecretKey), config);
    }

    public string GeneratePresignedUploadUrl(string objectKey)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _options.BucketName,
            Key = objectKey,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.AddSeconds(_options.PresignedUrlExpirySeconds),
        };
        var url = _s3.GetPreSignedURL(request);

        // AWSSDK.S3 luon sinh scheme "https://" trong URL presign bat ke
        // AmazonS3Config.UseHttp da bat - da xac nhan bang test thuc te voi
        // MinIO cua du an (chi nghe HTTP thuong tren port 9000, khong co TLS).
        // Ep lai dung scheme theo Endpoint da cau hinh, neu khong client that
        // se bi loi SSL handshake khi PUT len URL nay.
        if (_options.Endpoint.StartsWith("http://") && url.StartsWith("https://"))
            url = "http://" + url["https://".Length..];

        return url;
    }

    // Tu de xuat - thieu sot phat hien khi build Frontend F2: chi co presign
    // PUT (upload), khong co cach nao lay lai URL de XEM/TAI file da gui
    // (anh/video/voice/file). Xem GET /files/{fileId}/download-url o
    // FileEndpoints.cs.
    public string GeneratePresignedDownloadUrl(string objectKey)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _options.BucketName,
            Key = objectKey,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.AddSeconds(_options.PresignedUrlExpirySeconds),
        };
        var url = _s3.GetPreSignedURL(request);

        if (_options.Endpoint.StartsWith("http://") && url.StartsWith("https://"))
            url = "http://" + url["https://".Length..];

        return url;
    }
}
