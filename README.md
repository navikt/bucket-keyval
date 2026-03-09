# @navikt/bucket-keyval

Redis-like key-value store backed by a Google Cloud Storage bucket. Designed for Node.js applications running on the [NAIS platform](https://doc.nais.io).

Each key is stored as a separate GCS object. Values are automatically serialized as JSON.

## Prerequisites

- [mise](https://mise.jdx.dev/) installed
- A NAIS application with a GCS bucket declared in the manifest

## Getting started

```sh
mise install     # installs Node.js + pnpm
pnpm install     # installs dependencies
mise run build   # builds the library
mise run test    # runs tests
mise run lint    # type-checks
```

## NAIS setup

### 1. Declare a bucket in your application manifest

```yaml
apiVersion: nais.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: my-team
spec:
  image: {{image}}
  gcp:
    buckets:
      - name: my-team-my-app-keyval
  env:
    - name: BUCKET_NAME
      value: my-team-my-app-keyval
```

Bucket names must be globally unique across all of Google Cloud. A common pattern is `<team>-<app>-<purpose>`.

### 2. Deploy

Authentication is handled automatically via [Workload Identity](https://doc.nais.io/workloads/explanations/migrating-to-gcp/) — no credentials or service account keys needed in your code.

### 3. Install the library

```sh
pnpm add @navikt/bucket-keyval
```

### 4. Use it

```typescript
import { createClient } from "@navikt/bucket-keyval";

const kv = createClient({
  bucketName: process.env.BUCKET_NAME!,
});

await kv.set("user:1", { name: "Ola", age: 30 });

const user = await kv.get("user:1");
// { name: "Ola", age: 30 }

const exists = await kv.exists("user:1");
// 1

const keys = await kv.keys("user:*");
// ["user:1"]

const deleted = await kv.del("user:1");
// 1
```

## API

### `createClient(options): BucketKeyval`

Creates a new client instance.

| Option           | Type             | Required | Description                                          |
| ---------------- | ---------------- | -------- | ---------------------------------------------------- |
| `bucketName`     | `string`         | Yes      | GCS bucket name                                      |
| `prefix`         | `string`         | No       | Key prefix / namespace within the bucket             |
| `storageOptions` | `StorageOptions` | No       | Options passed to the `@google-cloud/storage` client |

### `kv.set(key, value): Promise<"OK">`

Stores a value. The value is JSON-serialized automatically.

### `kv.get<T>(key): Promise<T | null>`

Retrieves a value. Returns `null` if the key doesn't exist. Supports a generic type parameter for the return type.

### `kv.del(...keys): Promise<number>`

Deletes one or more keys. Returns the number of keys that were deleted.

### `kv.exists(...keys): Promise<number>`

Checks if one or more keys exist. Returns the number of keys that exist.

### `kv.keys(pattern?): Promise<string[]>`

Lists keys matching a glob pattern. Defaults to `*` (all keys). Supports `*` (match any characters) and `?` (match single character).

## Key prefix

Use the `prefix` option to namespace keys within a shared bucket:

```typescript
const kv = createClient({
  bucketName: "my-team-shared-bucket",
  prefix: "my-app",
});

await kv.set("config", { debug: true });
// Stored at: gs://my-team-shared-bucket/my-app/config

const keys = await kv.keys("*");
// ["config"] — prefix is stripped from results
```

## Local development

Outside the NAIS cluster, authenticate with Application Default Credentials:

```sh
gcloud auth application-default login
```

Then use the library as normal. The `@google-cloud/storage` client picks up credentials automatically.

## Limitations

- **Latency**: Each operation is a GCS API call (~50–200ms). Not suitable for high-frequency reads/writes. Consider [Valkey](https://doc.nais.io/persistence/valkey/) for low-latency use cases.
- **Concurrency**: No atomic compare-and-set. Concurrent writes to the same key result in last-write-wins.
- **No TTL**: Use [GCS lifecycle rules](https://doc.nais.io/persistence/buckets/reference/) in the NAIS manifest (`lifecycleCondition.age`) for automatic expiry.
