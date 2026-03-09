import type { StorageOptions } from "@google-cloud/storage";

export interface BucketKeyvalOptions {
  bucketName: string;
  prefix?: string;
  storageOptions?: StorageOptions;
}
