#!/usr/bin/env bash
# Historical whole-disk provisioning recipe, retained for launch evidence.
# Superseded by the partitioned layout in docs/NODE200_STORAGE_2026-10-05.md.
# Do not run against the current node-200 disk.
set -euo pipefail
echo 'This historical whole-disk provisioner is retired; see docs/NODE200_STORAGE_2026-10-05.md' >&2
exit 1

device=/dev/disk/by-id/nvme-UCSC-NVME-H32003_SDM00000E225
pool=aggr-parallax
test "$(readlink -f "$device")" = /dev/nvme0n1
test "$(lsblk -ndo MODEL /dev/nvme0n1 | xargs)" = UCSC-NVME-H32003
test "$(blockdev --getsize64 /dev/nvme0n1)" -gt 3000000000000
test "$(readlink -f /dev/nvme1n1)" != "$(readlink -f "$device")"
test -z "$(wipefs -n "$device")"
if blkid -p "$device" >/dev/null 2>&1; then
  echo 'Target disk has a signature; aborting' >&2
  exit 1
fi
if zpool list -H "$pool" >/dev/null 2>&1; then
  echo 'Pool already exists; aborting' >&2
  exit 1
fi
zpool create -o ashift=12 -O compression=zstd -O atime=off -O xattr=sa \
  -O mountpoint=none "$pool" "$device"
zfs create -o mountpoint=/srv/aggr-parallax -o quota=500G "$pool"/project
zfs create -o mountpoint=/srv/aggr-parallax/influx -o quota=350G "$pool"/project/influx
zfs create -o mountpoint=/srv/aggr-parallax/journal -o quota=150G "$pool"/project/journal
chown 1500:1500 /srv/aggr-parallax/influx
chown 1000:1000 /srv/aggr-parallax/journal
chmod 0750 /srv/aggr-parallax/influx /srv/aggr-parallax/journal
zpool status "$pool"
zfs list -o name,used,avail,quota,mountpoint "$pool"/project "$pool"/project/influx "$pool"/project/journal
