#!/usr/bin/env bash
# Bop bang thong CHIEU LEN (client -> MinIO) o tang mang.
#
# VI SAO CAN: nginx `limit_rate` chi bop duoc chieu TAI VE (response body).
# Chieu day len la request body, nginx khong co directive nao gioi han toc
# do doc no. Muon chan that thi phai lam o tang mang - do la file nay.
#
# Chieu TAI VE da duoc nginx lo roi (minio-gateway.conf, do that: 4,21 MB/s),
# nen script nay CHI xu ly chieu len. Chay ca hai la du.
#
# Cach dung (tren may Ubuntu chay MinIO):
#   sudo ./minio-throttle.sh start   eth0   4        # bop 4 mbit/s
#   sudo ./minio-throttle.sh status  eth0
#   sudo ./minio-throttle.sh stop    eth0
#
# LUU Y don vi: `tc` dung mbit = MEGABIT/giay, khong phai megabyte.
# 4 MB/s ~ 32 mbit. Tham so thu 3 nhan theo MEGABYTE va tu doi sang mbit.

set -euo pipefail

ACTION="${1:-status}"
IFACE="${2:-eth0}"
RATE_MB="${3:-4}"
RATE_MBIT=$(( RATE_MB * 8 ))
PORT=9000

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Can chay bang sudo." >&2
    exit 1
  fi
}

start() {
  need_root
  # Chieu vao khong gan qdisc truc tiep duoc - phai lai luu luong sang thiet
  # bi ao IFB roi bop tren do. Day la cach duy nhat tc lam duoc ingress
  # shaping tu te (ingress policing thuan chi biet VUT BO goi, gay mat goi
  # va TCP retransmit thay vi lam cham muot).
  modprobe ifb numifbs=1 2>/dev/null || true
  ip link add ifb-minio type ifb 2>/dev/null || true
  ip link set ifb-minio up

  tc qdisc del dev "$IFACE" handle ffff: ingress 2>/dev/null || true
  tc qdisc add dev "$IFACE" handle ffff: ingress

  tc filter add dev "$IFACE" parent ffff: protocol ip u32 \
    match ip dport $PORT 0xffff \
    action mirred egress redirect dev ifb-minio

  tc qdisc del dev ifb-minio root 2>/dev/null || true
  tc qdisc add dev ifb-minio root handle 1: htb default 10
  tc class add dev ifb-minio parent 1: classid 1:10 htb \
    rate ${RATE_MBIT}mbit ceil ${RATE_MBIT}mbit

  echo "Da bop chieu len toi cong $PORT tren $IFACE: ${RATE_MB} MB/s (${RATE_MBIT} mbit/s)"
}

stop() {
  need_root
  tc qdisc del dev "$IFACE" handle ffff: ingress 2>/dev/null || true
  tc qdisc del dev ifb-minio root 2>/dev/null || true
  ip link set ifb-minio down 2>/dev/null || true
  ip link del ifb-minio 2>/dev/null || true
  echo "Da go gioi han tren $IFACE"
}

status() {
  echo "--- qdisc ingress tren $IFACE ---"
  tc -s qdisc show dev "$IFACE" ingress 2>/dev/null || echo "  (khong co)"
  echo "--- class tren ifb-minio ---"
  tc -s class show dev ifb-minio 2>/dev/null || echo "  (khong co)"
}

case "$ACTION" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  *) echo "Dung: $0 {start|stop|status} <iface> [MB/s]" >&2; exit 1 ;;
esac
