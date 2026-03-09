export { BucketKeyval } from "./client.js";
export type { BucketKeyvalOptions } from "./types.js";

import { BucketKeyval } from "./client.js";
import type { BucketKeyvalOptions } from "./types.js";

export function createClient(options: BucketKeyvalOptions): BucketKeyval {
  return new BucketKeyval(options);
}
