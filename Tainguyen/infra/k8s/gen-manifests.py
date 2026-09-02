#!/usr/bin/env python3
"""Sinh manifest k3s cho toan bo he thong.

Viet bang script thay vi go tay 15 file YAML gan giong nhau: 6 Postgres chi
khac ten/mat khau, 6 service .NET chi khac bien moi truong. Go tay la kieu
gi cung co mot cho sai chinh ta ma khong ai phat hien ra.

Chay:  python3 gen-manifests.py > all.yaml
"""

# Hai namespace de ap duoc ResourceQuota 60/30/10 theo muc 5.4 cua
# HUONG-DAN-DEPLOY.md. Cung namespace thi khong tach han muc duoc.
NS_DATA = "chat-data"
NS_APP = "chat-app"

import os, sys

# Bi mat KHONG nam trong file nay (file nay duoc commit len GitHub cong khai).
# Doc tu secrets.env o thu muc goc - file do bi .gitignore chan.
def load_secrets(path="secrets.env"):
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (path, os.path.join(here, "../../..", path)):
        if os.path.exists(cand):
            out = {}
            for line in io.open(cand, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
            return out
    sys.exit(f"Khong tim thay {path} - xem secrets.env.example")

import io
SECRETS = load_secrets()

def need(key):
    v = SECRETS.get(key)
    if not v:
        sys.exit(f"Thieu khoa '{key}' trong secrets.env")
    return v

JWT = need("Jwt__SigningKey")
REDIS_PW = need("Redis__Password")
RABBIT_PW = need("RabbitMq__Password")
MINIO_AK = need("Storage__Providers__home__AccessKey")
MINIO_SK = need("Storage__Providers__home__SecretKey")
SMTP_PW  = need("Smtp__AppPassword")
# Mot mat khau chung cho ca 6 CSDL - lua chon cua nguoi van hanh
# (de nho hon 6 chuoi hex). Ca 6 DB deu la ClusterIP, khong mo ra
# ngoai cum, nen be mat tan cong van gioi han trong cum.
DB_PW = need("Db__Password")

# Ten mien cong khai, phuc vu qua cloudflared tunnel. Moi service mot
# subdomain; frontend o domain goc.
#
# PHAI TRUNG voi luc build image frontend - Vite nhung URL vao bundle luc
# build chu khong doc luc chay, doi o day ma khong build lai la vo nghia.
PUBLIC_DOMAIN = "callimeet.com"

def pub(sub=None):
    return f"https://{sub}.{PUBLIC_DOMAIN}" if sub else f"https://{PUBLIC_DOMAIN}"

# Van giu IP LAN de truy cap noi bo khong qua Internet (nhanh hon, va van
# chay khi tunnel chet).
LAN_HOST = "192.168.101.18"

# Nguon image. De TRONG = dung image cuc bo do nerdctl build thang vao
# containerd cua k3s (imagePullPolicy: Never). Dien registry vao = keo tu do
# (imagePullPolicy: Always), dung khi da bat CI/CD day image len GHCR.
#   IMAGE_REGISTRY = "ghcr.io/nguyenkhoa1290"
IMAGE_REGISTRY = "ghcr.io/nguyenkhoa1290"

def image_ref(name):
    return f"{IMAGE_REGISTRY}/{name}:latest" if IMAGE_REGISTRY else f"{name}:latest"

# Never: image nam san trong containerd, k8s KHONG duoc di tim tren mang.
# Always: moi lan tao pod deu hoi registry - can thiet vi the :latest khong
# doi ten khi noi dung doi, khong keo lai thi rollout restart vo nghia.
PULL_POLICY = "Always" if IMAGE_REGISTRY else "Never"

# Ten DNS day du: pod o chat-app goi sang chat-data phai dung FQDN, ten ngan
# chi phan giai trong cung namespace.
def data_host(name):
    return f"{name}.{NS_DATA}.svc.cluster.local"

REDIS_CONN = f"{data_host('redis')}:6379,password={REDIS_PW}"
KAFKA_CONN = f"{data_host('kafka')}:9092"

DBS = [
    # (ten, database, user, password, dung luong)
    ("identity-db",     "identity",     "identity_admin",     DB_PW, "5Gi"),
    ("workspace-db",    "workspace",    "workspace_admin",    DB_PW, "5Gi"),
    ("chat-db",         "chat",         "chat_admin",         DB_PW, "10Gi"),
    ("spamtracking-db", "spamtracking", "spamtracking_admin", DB_PW, "5Gi"),
    ("media-db",        "media",        "media_admin",        DB_PW, "5Gi"),
    ("miniapp-db",      "miniapp",      "miniapp_admin",      DB_PW, "5Gi"),
]

out = []
def emit(s):
    out.append(s.rstrip() + "\n---")


# ------------------------------------------------------------- namespace
emit(f"""
apiVersion: v1
kind: Namespace
metadata:
  name: {NS_DATA}
""")
emit(f"""
apiVersion: v1
kind: Namespace
metadata:
  name: {NS_APP}
""")

# ResourceQuota 60/30/10 (muc 5.4). May co 7,2 GB; tru ~1,2 GB cho OS + k3s
# con ~6 GB chia ra. Day la TRAN, khong phai phan cap truoc.
emit(f"""
apiVersion: v1
kind: ResourceQuota
metadata:
  name: quota-data
  namespace: {NS_DATA}
spec:
  hard:
    # Tong limit that cua tang nay: 6 Postgres x384 + redis 128 + rabbitmq 384
    # + kafka 900 + minio 384 + gateway 64 = 4164Mi. Dat 4Gi (4096Mi) la
    # THIEU 68Mi -> MinIO bi tu choi tao pod (ReplicaFailure/FailedCreate),
    # deployment van bao "created" nen rat de tuong la da chay.
    limits.memory: 4608Mi
    requests.memory: 2Gi
""")
emit(f"""
apiVersion: v1
kind: ResourceQuota
metadata:
  name: quota-app
  namespace: {NS_APP}
spec:
  hard:
    limits.memory: 2Gi
    requests.memory: 1Gi
""")


# -------------------------------------------------------------- Postgres
for name, db, user, pw, size in DBS:
    emit(f"""
apiVersion: v1
kind: Secret
metadata:
  name: {name}-credentials
  namespace: {NS_DATA}
stringData:
  POSTGRES_DB: "{db}"
  POSTGRES_USER: "{user}"
  POSTGRES_PASSWORD: "{pw}"
""")
    emit(f"""
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {name}-data
  namespace: {NS_DATA}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: {size}
""")
    emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
  namespace: {NS_DATA}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {{app: {name}}}
  template:
    metadata:
      labels: {{app: {name}}}
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          envFrom:
            - secretRef: {{name: {name}-credentials}}
          ports:
            - containerPort: 5432
          volumeMounts:
            - {{name: data, mountPath: /var/lib/postgresql/data, subPath: pgdata}}
            - {{name: init, mountPath: /docker-entrypoint-initdb.d}}
          resources:
            requests: {{memory: 96Mi, cpu: 50m}}
            limits: {{memory: 384Mi}}
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "{user}", "-d", "{db}"]
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
      volumes:
        - {{name: data, persistentVolumeClaim: {{claimName: {name}-data}}}}
        # ConfigMap tao rieng bang kubectl tu file .sql co san - nhung SQL
        # vao YAML thi file nay phinh len hang nghin dong va rat de sai thut dong.
        - {{name: init, configMap: {{name: {name}-init}}}}
""")
    emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: {name}
  namespace: {NS_DATA}
spec:
  selector: {{app: {name}}}
  ports:
    - {{port: 5432, targetPort: 5432}}
""")


# ----------------------------------------------------------------- Redis
emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: {NS_DATA}
spec:
  replicas: 1
  selector:
    matchLabels: {{app: redis}}
  template:
    metadata:
      labels: {{app: redis}}
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          # maxmemory PHAI thap hon limits.memory ben duoi: khong dat thi
          # Redis khong biet tran nen cu ghi toi khi k8s giet ca pod (mat
          # sach du lieu). Dat roi thi no tu don khi gan day.
          #
          # volatile-lru = chi don key CO HAN. Moi key cua ung dung deu co
          # han (cache tin nhan 11 ngay, trang thai trinh bay 12 gio, phong
          # cho 5 phut), va cache tin nhan ap dao ve so luong nen thuc te no
          # bi don truoc. Cache la du lieu DAN XUAT - Postgres van la nguon
          # su that va endpoint doc tin nhan da co san duong fallback.
          args:
            - redis-server
            - --requirepass
            - "{REDIS_PW}"
            - --appendonly
            - "yes"
            - --maxmemory
            - "96mb"
            - --maxmemory-policy
            - volatile-lru
          ports:
            - containerPort: 6379
          resources:
            requests: {{memory: 32Mi, cpu: 20m}}
            limits: {{memory: 128Mi}}
""")
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: {NS_DATA}
spec:
  selector: {{app: redis}}
  ports:
    - {{port: 6379, targetPort: 6379}}
""")


# -------------------------------------------------------------- RabbitMQ
emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rabbitmq
  namespace: {NS_DATA}
spec:
  replicas: 1
  selector:
    matchLabels: {{app: rabbitmq}}
  template:
    metadata:
      labels: {{app: rabbitmq}}
    spec:
      containers:
        - name: rabbitmq
          image: rabbitmq:3.13-management-alpine
          env:
            - {{name: RABBITMQ_DEFAULT_USER, value: "admin"}}
            - {{name: RABBITMQ_DEFAULT_PASS, value: "{RABBIT_PW}"}}
          ports:
            - containerPort: 5672
            - containerPort: 15672
          resources:
            requests: {{memory: 128Mi, cpu: 50m}}
            limits: {{memory: 384Mi}}
          readinessProbe:
            exec:
              command: ["rabbitmq-diagnostics", "-q", "ping"]
            initialDelaySeconds: 30
            periodSeconds: 20
            # Mac dinh timeoutSeconds=1, ma rabbitmq-diagnostics can vai giay
            # -> probe luon "command timed out", pod khong bao gio Ready.
            timeoutSeconds: 15
""")
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq
  namespace: {NS_DATA}
spec:
  selector: {{app: rabbitmq}}
  ports:
    - {{name: amqp, port: 5672, targetPort: 5672}}
    - {{name: mgmt, port: 15672, targetPort: 15672}}
""")
# Giao dien quan tri ra ngoai cum de cloudflared tro toi duoc. AMQP (5672)
# VAN la ClusterIP - khong co ly do gi mo giao thuc do ra ngoai.
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq-mgmt-lb
  namespace: {NS_DATA}
spec:
  type: LoadBalancer
  selector: {{app: rabbitmq}}
  ports:
    - {{port: 15672, targetPort: 15672}}
""")


# TTL 24 gio cho nam hang doi thong bao. Identity Service DA consume ca nam
# (xem NotificationConsumerService.cs) nen binh thuong chung luon rong -
# day la LUOI AN TOAN, khong phai cach chong ro ri nhu ban truoc: neu
# Identity chet vai ngay, thong bao ton dong se tu het han thay vi phinh mai
# roi chan luon hai hang doi con lai.
#
# 24 gio la quyet dinh da chot va van hop ly ve nghiep vu: mot thong bao
# "co tin nhan moi" cua hom qua thi day len cung khong con y nghia gi.
#
# Regex neo hai dau (^...$) CO CHU Y: "identity.*" se quet trung ca
# identity.account-locked va identity.delete-account-spam - hai hang doi
# LENH KHOA TAI KHOAN, khong phai thong bao. Tin trong do het han nghia la
# mat luon viec khoa tai khoan spam.
#
# Dung HTTP management API chu khong phai rabbitmqctl: rabbitmqctl chi chay
# duoc TREN chinh node do (can Erlang cookie), con API thi goi qua Service
# binh thuong.
emit(f"""
apiVersion: batch/v1
kind: Job
metadata:
  name: rabbitmq-init
  namespace: {NS_DATA}
spec:
  backoffLimit: 10
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: policy
          image: curlimages/curl:8.10.1
          resources:
            requests: {{memory: 16Mi, cpu: 10m}}
            limits: {{memory: 64Mi}}
          command: ["sh", "-c"]
          args:
            - |
              until curl -sf -u admin:'{RABBIT_PW}' http://rabbitmq:15672/api/overview > /dev/null; do
                echo "cho RabbitMQ san sang..."; sleep 5
              done
              PAT='^(identity[.]storage-warning|identity[.]chat-message-notification|workspace[.]member-notifications|media[.]meeting-invite|media[.]meeting-created)$$'
              BODY="{{\\"pattern\\":\\"$$PAT\\",\\"definition\\":{{\\"message-ttl\\":86400000}},\\"apply-to\\":\\"queues\\",\\"priority\\":1}}"
              curl -sf -u admin:'{RABBIT_PW}' -H 'Content-Type: application/json' -X PUT http://rabbitmq:15672/api/policies/%2F/notification-ttl -d "$$BODY"
              echo
              curl -sf -u admin:'{RABBIT_PW}' http://rabbitmq:15672/api/policies
              echo
""")

# ----------------------------------------------------------------- Kafka
# Dia chi quang ba = FQDN cua Service. Client nhan dia chi nay roi MO KET
# NOI MOI toi do, nen no phai dung voi moi pod trong cluster - xem cam bay
# muc 8.0 cua HUONG-DAN-DEPLOY.md (tung dinh 2 lan vi dat IP/localhost).
emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka
  namespace: {NS_DATA}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {{app: kafka}}
  template:
    metadata:
      labels: {{app: kafka}}
    spec:
      containers:
        - name: kafka
          image: apache/kafka:3.8.0
          env:
            - {{name: KAFKA_NODE_ID, value: "1"}}
            - {{name: KAFKA_PROCESS_ROLES, value: "broker,controller"}}
            - {{name: KAFKA_LISTENERS, value: "PLAINTEXT://:9092,CONTROLLER://:9093"}}
            - {{name: KAFKA_ADVERTISED_LISTENERS, value: "PLAINTEXT://{data_host('kafka')}:9092"}}
            - {{name: KAFKA_CONTROLLER_LISTENER_NAMES, value: "CONTROLLER"}}
            - {{name: KAFKA_LISTENER_SECURITY_PROTOCOL_MAP, value: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT"}}
            - {{name: KAFKA_CONTROLLER_QUORUM_VOTERS, value: "1@localhost:9093"}}
            - {{name: KAFKA_INTER_BROKER_LISTENER_NAME, value: "PLAINTEXT"}}
            - {{name: CLUSTER_ID, value: "MkU3OEVBNTcwNTJENDM2Qk"}}
            - {{name: KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR, value: "1"}}
            - {{name: KAFKA_AUTO_CREATE_TOPICS_ENABLE, value: "true"}}
            - {{name: KAFKA_HEAP_OPTS, value: "-Xmx512M -Xms256M"}}
          ports:
            - containerPort: 9092
          volumeMounts:
            - {{name: data, mountPath: /tmp/kraft-combined-logs}}
          resources:
            requests: {{memory: 512Mi, cpu: 100m}}
            limits: {{memory: 900Mi}}
      volumes:
        - {{name: data, persistentVolumeClaim: {{claimName: kafka-data}}}}
""")
emit(f"""
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: kafka-data
  namespace: {NS_DATA}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 5Gi
""")
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: kafka
  namespace: {NS_DATA}
spec:
  selector: {{app: kafka}}
  ports:
    - {{port: 9092, targetPort: 9092}}
""")


# ----------------------------------------------------------------- MinIO
#
# KHAC moi PVC con lai: MinIO khong dung local-path (o SSD cua he thong) ma
# nam tren mot O CUNG RIENG gan o /mnt/hdd500.
#
# Ly do: MinIO giu file nguoi dung tai len - thu DUY NHAT trong he thong
# phinh to khong gioi han, va no doc/ghi tuan tu nen o quay hoan toan du.
# Con CSDL thi o lai SSD, vi Postgres song bang truy cap ngau nhien.
#
# hostPath + "type: Directory" la CO Y, khong phai tien tay: neu o vang mat
# (hong, rut ra, mount hut) thi thu muc /mnt/hdd500/minio khong ton tai va
# kubelet TU CHOI khoi dong pod. Neu dung local-path nhu cac PVC khac thi
# provisioner se tu tao thu muc rong ngay tren o SSD va MinIO khoi dong nhu
# chua tung co file nao - hong am tham, kieu hong te nhat.
#
# O phia may chu can hai thu, xem Tainguyen/infra/README-o-cung.md:
#   - dong fstab co "nofail" (rut o ra thi may van khoi dong duoc)
#   - thu muc /mnt/hdd500/minio ton tai tren chinh o do
emit(f"""
apiVersion: v1
kind: PersistentVolume
metadata:
  name: minio-data-hdd
spec:
  capacity:
    storage: 400Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: ""
  hostPath:
    path: /mnt/hdd500/minio
    type: Directory
  claimRef:
    namespace: {NS_DATA}
    name: minio-data
""")
emit(f"""
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: minio-data
  namespace: {NS_DATA}
spec:
  accessModes: [ReadWriteOnce]
  # storageClassName rong = khong nho local-path cap phat, ma gan dung vao
  # PV o tren. De trong thi no se lay lai o SSD.
  storageClassName: ""
  volumeName: minio-data-hdd
  resources:
    requests:
      storage: 400Gi
""")
emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: minio
  namespace: {NS_DATA}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {{app: minio}}
  template:
    metadata:
      labels: {{app: minio}}
    spec:
      containers:
        - name: minio
          image: quay.io/minio/minio:latest
          args: ["server", "/data", "--console-address", ":9001"]
          env:
            - {{name: MINIO_ROOT_USER, value: "{MINIO_AK}"}}
            - {{name: MINIO_ROOT_PASSWORD, value: "{MINIO_SK}"}}
          ports:
            - containerPort: 9000
            - containerPort: 9001
          volumeMounts:
            - {{name: data, mountPath: /data}}
          resources:
            requests: {{memory: 128Mi, cpu: 50m}}
            limits: {{memory: 384Mi}}
          readinessProbe:
            httpGet: {{path: /minio/health/live, port: 9000}}
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - {{name: data, persistentVolumeClaim: {{claimName: minio-data}}}}
""")
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: {NS_DATA}
spec:
  selector: {{app: minio}}
  ports:
    - {{name: api, port: 9000, targetPort: 9000}}
    - {{name: console, port: 9001, targetPort: 9001}}
""")
# Console MinIO ra ngoai. LoadBalancer trong k3s = ServiceLB, no bind thang
# cong do tren node - nho vay giu duoc dung so cong nhu ban Compose.
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: minio-console-lb
  namespace: {NS_DATA}
spec:
  type: LoadBalancer
  selector: {{app: minio}}
  ports:
    - {{port: 9001, targetPort: 9001}}
""")

# Tao bucket mot lan. Ban Compose co buoc nay (minio-init) nhung khi chuyen
# sang k3s thi bi bo quen -> presign VAN sinh ra URL (presign la phep tinh
# offline, khong kiem tra bucket) nhung PUT that tra 404 NoSuchBucket. Loi
# chi lo ra khi upload that.
emit(f"""
apiVersion: batch/v1
kind: Job
metadata:
  name: minio-init
  namespace: {NS_DATA}
spec:
  backoffLimit: 5
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: mc
          image: minio/mc:latest
          resources:
            requests: {{memory: 32Mi, cpu: 10m}}
            limits: {{memory: 128Mi}}
          command: ["sh", "-c"]
          args:
            - |
              until mc alias set m http://minio:9000 "{MINIO_AK}" "{MINIO_SK}"; do
                echo "cho MinIO san sang..."; sleep 5
              done
              mc mb --ignore-existing m/chat-media
              mc ls m
""")

# Cong bop toc do dat truoc MinIO.
emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: minio-gateway
  namespace: {NS_DATA}
spec:
  replicas: 1
  selector:
    matchLabels: {{app: minio-gateway}}
  template:
    metadata:
      labels: {{app: minio-gateway}}
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          command: ["sh", "-c"]
          args:
            - sed "s|MINIO_UPSTREAM|minio:9000|" /tpl/nginx.conf.tpl > /etc/nginx/nginx.conf && exec nginx -g "daemon off;"
          ports:
            - containerPort: 9000
          volumeMounts:
            - {{name: tpl, mountPath: /tpl}}
          resources:
            requests: {{memory: 16Mi, cpu: 10m}}
            limits: {{memory: 64Mi}}
      volumes:
        - {{name: tpl, configMap: {{name: minio-gateway-conf}}}}
""")
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: minio-gateway
  namespace: {NS_DATA}
spec:
  type: LoadBalancer
  selector: {{app: minio-gateway}}
  ports:
    - {{port: 9000, targetPort: 9000}}
""")


# ---------------------------------------------------------- service .NET
# Bi mat gom vao MOT Secret, service nap bang envFrom. Truoc day nhung
# thang vao env cua Deployment -> all.yaml sinh ra chua mat khau ro rang,
# ma file do rat de bi commit nham.
emit(f"""
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: {NS_APP}
stringData:
  Jwt__SigningKey: "{JWT}"
  RabbitMq__Password: "{RABBIT_PW}"
  Storage__Providers__home__AccessKey: "{MINIO_AK}"
  Storage__Providers__home__SecretKey: "{MINIO_SK}"
  Smtp__AppPassword: "{SMTP_PW}"
""")

COMMON = [
    ("ConnectionStrings__Redis", REDIS_CONN),
]
# Ca 6 service deu dung RabbitMQ. Media chi con MOT hang doi
# (media.meeting-invite, cho viec moi ban be truc tiep) - hang doi
# media.meeting-created cua ban truoc da bo han vi mo hop trong nhom da tao
# san tin nhan he thong ngay trong khung chat cua nhom.
RABBIT = [("RabbitMq__HostName", data_host("rabbitmq"))]
# Hai nguon goc: qua Internet (ten mien, https) va trong LAN (IP, http).
# Thieu cai thu hai la mo bang IP se bi chan CORS.
CORS_ORIGINS = [
    ("Cors__AllowedOrigins__0", pub()),
    ("Cors__AllowedOrigins__1", f"http://{LAN_HOST}"),
    # Tam thoi trong luc chuyen domain sang callimeet.com: van cho origin cu
    # cachephoarong.click de trang dang mo khong bi chan CORS. Go sau khi da
    # go han cachephoarong.
    ("Cors__AllowedOrigins__2", "https://cachephoarong.click"),
]

SERVICES = [
    ("identity", 5194, [
        ("ConnectionStrings__IdentityDb", f"Host={data_host('identity-db')};Port=5432;Database=identity;Username=identity_admin;Password={DB_PW}"),
        ("Kafka__BootstrapServers", KAFKA_CONN), *CORS_ORIGINS, *RABBIT,
    ]),
    ("workspace", 5153, [
        ("ConnectionStrings__WorkspaceDb", f"Host={data_host('workspace-db')};Port=5432;Database=workspace;Username=workspace_admin;Password={DB_PW}"),
        *CORS_ORIGINS, *RABBIT,
        ("IdentityClient__BaseUrl", "http://identity:8080"),
        ("ChatServiceClient__BaseUrl", "http://chat:8080"),
    ]),
    ("chat", 5261, [
        ("ConnectionStrings__ChatDb", f"Host={data_host('chat-db')};Port=5432;Database=chat;Username=chat_admin;Password={DB_PW}"),
        ("Kafka__BootstrapServers", KAFKA_CONN), *CORS_ORIGINS, *RABBIT,
        ("WorkspaceClient__BaseUrl", "http://workspace:8080"),
        ("MediaServiceClient__BaseUrl", "http://media:8080"),
        ("IdentityClient__BaseUrl", "http://identity:8080"),
        # URL presign di THANG toi trinh duyet -> phai la dia chi cong khai.
        # URL presign tra THANG cho trinh duyet -> phai la dia chi cong khai va
# phai la https, vi trang chay https se chan noi dung http (mixed content).
        ("Storage__Providers__home__Endpoint", pub("files")),
    ]),
    ("spamtracking", 5160, [
        ("ConnectionStrings__SpamTrackingDb", f"Host={data_host('spamtracking-db')};Port=5432;Database=spamtracking;Username=spamtracking_admin;Password={DB_PW}"),
        ("Kafka__BootstrapServers", KAFKA_CONN), *RABBIT,
        ("IdentityClient__BaseUrl", "http://identity:8080"),
    ]),
    ("media", 5300, [
        ("ConnectionStrings__MediaDb", f"Host={data_host('media-db')};Port=5432;Database=media;Username=media_admin;Password={DB_PW}"),
        ("ConnectionStrings__MiniAppDb", f"Host={data_host('miniapp-db')};Port=5432;Database=miniapp;Username=miniapp_admin;Password={DB_PW}"),
        *CORS_ORIGINS, *RABBIT,
        ("IdentityClient__BaseUrl", "http://identity:8080"),
        ("ChatServiceClient__BaseUrl", "http://chat:8080"),
    ]),
    ("admin", 5230, [
        *CORS_ORIGINS, *RABBIT,
        ("IdentityClient__BaseUrl", "http://identity:8080"),
        ("SpamTrackingClient__BaseUrl", "http://spamtracking:8080"),
        ("ChatServiceClient__BaseUrl", "http://chat:8080"),
        # Chay TRONG cluster -> dung ServiceAccount, khong can kubeconfig.
        # Day la thu Docker thuan khong lam duoc.
        ("K8s__UseInCluster", "true"),
        # Deployment nam o chat-app chu khong phai "default" -> phai noi ro,
        # neu khong nut scale se tim nham namespace.
        ("K8s__Namespace", NS_APP),
    ]),
]

for name, port, extra in SERVICES:
    envs = COMMON + extra
    env_yaml = "\n".join(
        f'            - {{name: {k}, value: "{v}"}}' for k, v in envs
    )
    # Media lay key LiveKit tu Secret rieng, khong nhung vao manifest.
    secret_ref = """
          envFrom:
            - secretRef: {name: app-secrets}"""
    if name == "media":
        secret_ref = """
          envFrom:
            - secretRef: {name: app-secrets}
            - secretRef: {name: livekit-credentials}"""
    sa = ""
    if name == "admin":
        sa = "\n      serviceAccountName: admin-service"

    emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
  namespace: {NS_APP}
spec:
  replicas: 1
  selector:
    matchLabels: {{app: {name}}}
  template:
    metadata:
      labels: {{app: {name}}}
    spec:{sa}
      containers:
        - name: {name}
          image: {image_ref('chat-app-' + name)}
          imagePullPolicy: {PULL_POLICY}{secret_ref}
          env:
{env_yaml}
          ports:
            - containerPort: 8080
          resources:
            requests: {{memory: 96Mi, cpu: 50m}}
            limits: {{memory: 256Mi}}
          readinessProbe:
            httpGet: {{path: /health, port: 8080}}
            initialDelaySeconds: 20
            periodSeconds: 10
          livenessProbe:
            httpGet: {{path: /health, port: 8080}}
            initialDelaySeconds: 60
            periodSeconds: 20
""")
    # ClusterIP de cac service goi lan nhau bang ten ngan (http://identity:8080)
    emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: {name}
  namespace: {NS_APP}
spec:
  selector: {{app: {name}}}
  ports:
    - {{port: 8080, targetPort: 8080}}
""")
    # LoadBalancer giu DUNG so cong nhu ban Compose - bat buoc, vi bundle
    # frontend da nhung san "http://<host>:5194" tu luc build.
    emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: {name}-lb
  namespace: {NS_APP}
spec:
  type: LoadBalancer
  selector: {{app: {name}}}
  ports:
    - {{port: {port}, targetPort: 8080}}
""")


# -------------------------------------------------------------- Frontend
emit(f"""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: {NS_APP}
spec:
  replicas: 1
  selector:
    matchLabels: {{app: frontend}}
  template:
    metadata:
      labels: {{app: frontend}}
    spec:
      containers:
        - name: nginx
          image: {image_ref('chat-app-frontend')}
          imagePullPolicy: {PULL_POLICY}
          ports:
            - containerPort: 80
          resources:
            requests: {{memory: 16Mi, cpu: 10m}}
            limits: {{memory: 64Mi}}
""")
# KHONG dung LoadBalancer cong 80 cho frontend: k3s cai san Traefik, va
# svclb cua Traefik da giu hostPort 80 -> Service thu hai xin cung cong se
# ket o trang thai Pending vinh vien (EXTERNAL-IP <pending>), curl vao cong
# 80 tra 404 cua Traefik chu khong phai trang web. Da dinh that.
# Di qua Traefik bang Ingress moi la cach dung.
emit(f"""
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: {NS_APP}
spec:
  selector: {{app: frontend}}
  ports:
    - {{port: 80, targetPort: 80}}
""")
emit(f"""
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: frontend
  namespace: {NS_APP}
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port: {{number: 80}}
""")

text = "\n".join(out)
# Bo dau --- thua o cuoi
print(text.rstrip("-\n"))
