sh -lc 'set -eu
apk add --no-cache aws-cli jq coreutils
: "${PGHOST:?missing PGHOST}"
: "${PGDATABASE:?missing PGDATABASE}"
: "${PGUSER:?missing PGUSER}"
: "${PGPASSWORD:?missing PGPASSWORD}"
: "${S3_BUCKET:?missing S3_BUCKET}"
: "${S3_ENDPOINT:?missing S3_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?missing AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?missing AWS_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="${S3_REGION:-auto}"
export PGPASSWORD
export AWS_EC2_METADATA_DISABLED=true
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="/tmp/${stamp}.dump"
key="database-backups/${stamp}.dump"
/usr/local/bin/pg_dump --no-owner --no-acl --format=custom --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$PGDATABASE" --file="$file"
/usr/local/bin/pg_restore --list "$file" >/tmp/restore-list.txt
test -s /tmp/restore-list.txt
size="$(wc -c < "$file" | tr -d " ")"
sha="$(sha256sum "$file" | cut -d " " -f 1)"
aws --endpoint-url "$S3_ENDPOINT" s3 cp "$file" "s3://$S3_BUCKET/$key" --only-show-errors --metadata "sha256=$sha,source=railway-postgres-daily"
remote_size="$(aws --endpoint-url "$S3_ENDPOINT" s3api head-object --bucket "$S3_BUCKET" --key "$key" --query ContentLength --output text)"
test "$remote_size" = "$size"
printf "%s  %s\\n" "$sha" "$key" >/tmp/checksum.txt
aws --endpoint-url "$S3_ENDPOINT" s3 cp /tmp/checksum.txt "s3://$S3_BUCKET/${key}.sha256" --only-show-errors --content-type text/plain
echo "BACKUP_SUCCESS timestamp=$stamp bytes=$size sha256=$sha verified=object_size+pg_restore_list"'
