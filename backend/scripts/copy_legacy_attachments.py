import csv
import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError


DEFAULT_TABLE = Path(__file__).resolve().parents[1] / "import_data" / "task_attachments_202603011530.csv"


def iter_rows(csv_path):
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def main(argv):
    csv_path = Path(argv[1]).resolve() if len(argv) > 1 else DEFAULT_TABLE
    target_bucket = argv[2] if len(argv) > 2 else "sprint-flow-attachments-132334512551-ap-south-1"
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    client = boto3.client("s3")
    copied = 0
    failed = []

    for row in iter_rows(csv_path):
        source_bucket = row["s3_bucket"]
        key = row["s3_key"]
        if not source_bucket or not key:
            failed.append((key, "missing-source"))
            continue
        try:
            client.copy({"Bucket": source_bucket, "Key": key}, target_bucket, key)
            copied += 1
        except ClientError as exc:
            failed.append((key, exc.response.get("Error", {}).get("Code")))

    print(
        {
            "csv": str(csv_path),
            "target_bucket": target_bucket,
            "copied": copied,
            "failed": failed,
        }
    )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main(sys.argv)
