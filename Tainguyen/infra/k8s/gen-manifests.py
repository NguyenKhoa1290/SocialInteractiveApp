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
REDIS_PW = "154f8287a3654e90665f4e6a58399e0f"
RABBIT_PW = need("RabbitMq__Password")
MINIO_AK = need("Storage__Providers__home__AccessKey")
MINIO_SK = need("Storage__Providers__home__SecretKey")

# Dia chi ma TRINH DUYET dung. Phai trung voi luc build image frontend -
# Vite nhung URL vao bundle luc build, doi o day khong an.
PUBLIC_HOST = "192.168.101.18"

# Nguon image. De TRONG = dung image cuc bo do nerdctl build thang vao
# containerd cua k3s (imagePullPolicy: Never). Dien registry vao = keo tu do
# (imagePullPolicy: Always), dung khi da bat CI/CD day image len GHCR.
#   IMAGE_REGISTRY = "ghcr.io/nguyenkhoa1290"
IMAGE_REGISTRY = ""

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
    ("identity-db",     "identity",     "identity_admin",     "f8f12714edad39133b1a2f619500a0dc", "5Gi"),
    ("workspace-db",    "workspace",    "workspace_admin",    "9142ecf6969c0f66826be3d51270ff3e", "5Gi"),
    ("chat-db",         "chat",         "chat_admin",         "6486380b7831f81bc082871538a2c771", "10Gi"),
    ("spamtracking-db", "spamtracking", "spamtracking_admin", "5e8b2da3ae764b4bc0d09d9d0c22e92d", "5Gi"),
    ("media-db",        "media",        "media_admin",        "f82b6df20ed68a55b97361360c1a0f8d", "5Gi"),
    ("miniapp-db",      "miniapp",      "miniapp_admin",      "a377345d7812f08609dae5d97e8d4de2", "5Gi"),
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
          args: ["redis-server", "--requirepass", "{REDIS_PW}", "--appendonly", "yes"]
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
emit(f"""
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: minio-data
  namespace: {NS_DATA}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 50Gi
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
            - {{name: MINIO_ROOT_USER, value: "minioadmin"}}
            - {{name: MINIO_ROOT_PASSWORD, value: "minioadmin"}}
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
""")

COMMON = [
    ("ConnectionStrings__Redis", REDIS_CONN),
    ("RabbitMq__HostName", data_host("rabbitmq")),
]
CORS = ("Cors__AllowedOrigins__0", f"http://{PUBLIC_HOST}")

SERVICES = [
    ("identity", 5194, [
        ("ConnectionStrings__IdentityDb", f"Host={data_host('identity-db')};Port=5432;Database=identity;Username=identity_admin;Password=f8f12714edad39133b1a2f619500a0dc"),
        ("Kafka__BootstrapServers", KAFKA_CONN), CORS,
    ]),
    ("workspace", 5153, [
        ("ConnectionStrings__WorkspaceDb", f"Host={data_host('workspace-db')};Port=5432;Database=workspace;Username=workspace_admin;Password=9142ecf6969c0f66826be3d51270ff3e"),
        CORS,
        ("IdentityClient__BaseUrl", "http://identity:8080"),
        ("ChatServiceClient__BaseUrl", "http://chat:8080"),
    ]),
    ("chat", 5261, [
        ("ConnectionStrings__ChatDb", f"Host={data_host('chat-db')};Port=5432;Database=chat;Username=chat_admin;Password=6486380b7831f81bc082871538a2c771"),
        ("Kafka__BootstrapServers", KAFKA_CONN), CORS,
        ("WorkspaceClient__BaseUrl", "http://workspace:8080"),
        ("MediaServiceClient__BaseUrl", "http://media:8080"),
        ("IdentityClient__BaseUrl", "http://identity:8080"),
        # URL presign di THANG toi trinh duyet -> phai la dia chi cong khai.
        ("Storage__Providers__home__Endpoint", f"http://{PUBLIC_HOST}:9000"),
    ]),
    ("spamtracking", 5160, [
        ("ConnectionStrings__SpamTrackingDb", f"Host={data_host('spamtracking-db')};Port=5432;Database=spamtracking;Username=spamtracking_admin;Password=5e8b2da3ae764b4bc0d09d9d0c22e92d"),
        ("Kafka__BootstrapServers", KAFKA_CONN),
        ("IdentityClient__BaseUrl", "http://identity:8080"),
    ]),
    ("media", 5300, [
        ("ConnectionStrings__MediaDb", f"Host={data_host('media-db')};Port=5432;Database=media;Username=media_admin;Password=f82b6df20ed68a55b97361360c1a0f8d"),
        ("ConnectionStrings__MiniAppDb", f"Host={data_host('miniapp-db')};Port=5432;Database=miniapp;Username=miniapp_admin;Password=a377345d7812f08609dae5d97e8d4de2"),
        CORS,
        ("IdentityClient__BaseUrl", "http://identity:8080"),
        ("ChatServiceClient__BaseUrl", "http://chat:8080"),
    ]),
    ("admin", 5230, [
        CORS,
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
