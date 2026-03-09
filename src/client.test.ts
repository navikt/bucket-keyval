import { describe, it, expect, vi, beforeEach } from "vitest";
import { BucketKeyval } from "./client.js";

function createMockFile(data?: { content?: string; exists?: boolean }) {
  const content = data?.content ?? "";
  const exists = data?.exists ?? true;
  return {
    save: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockImplementation(() => {
      if (!exists) {
        return Promise.reject(Object.assign(new Error("Not Found"), { code: 404 }));
      }
      return Promise.resolve([Buffer.from(content)]);
    }),
    delete: vi.fn().mockImplementation(() => {
      if (!exists) {
        return Promise.reject(Object.assign(new Error("Not Found"), { code: 404 }));
      }
      return Promise.resolve([{}]);
    }),
    exists: vi.fn().mockResolvedValue([exists]),
    name: "",
  };
}

type MockFile = ReturnType<typeof createMockFile>;

function createMockStorage(files: Record<string, MockFile>) {
  const fileMap = files;
  const getFilesFn = vi.fn().mockImplementation(async (opts?: { prefix?: string }) => {
    const prefix = opts?.prefix ?? "";
    const matching = Object.entries(fileMap)
      .filter(([name]) => name.startsWith(prefix))
      .map(([name]) => ({ name }));
    return [matching];
  });

  return {
    bucket: vi.fn().mockReturnValue({
      file: vi.fn().mockImplementation((name: string) => {
        if (fileMap[name]) {
          fileMap[name].name = name;
          return fileMap[name];
        }
        const missing = createMockFile({ exists: false });
        missing.name = name;
        return missing;
      }),
      getFiles: getFilesFn,
    }),
    fileMap,
    getFilesFn,
  };
}

vi.mock("@google-cloud/storage", () => ({
  Storage: function () {
    return mockStorage;
  },
}));

let mockStorage: ReturnType<typeof createMockStorage>;

describe("BucketKeyval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("set", () => {
    it("serializes value as JSON and saves to bucket", async () => {
      const file = createMockFile();
      mockStorage = createMockStorage({ "my-key": file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.set("my-key", { hello: "world" });

      expect(result).toBe("OK");
      expect(file.save).toHaveBeenCalledWith(
        JSON.stringify({ hello: "world" }),
        { contentType: "application/json" },
      );
    });

    it("handles string values", async () => {
      const file = createMockFile();
      mockStorage = createMockStorage({ "str-key": file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      await kv.set("str-key", "just a string");

      expect(file.save).toHaveBeenCalledWith(
        JSON.stringify("just a string"),
        { contentType: "application/json" },
      );
    });

    it("prepends prefix to object path", async () => {
      const file = createMockFile();
      mockStorage = createMockStorage({ "myapp/my-key": file });

      const kv = new BucketKeyval({ bucketName: "test-bucket", prefix: "myapp" });
      await kv.set("my-key", 42);

      expect(mockStorage.bucket("test-bucket").file).toHaveBeenCalledWith("myapp/my-key");
    });
  });

  describe("get", () => {
    it("returns parsed JSON value", async () => {
      const file = createMockFile({ content: JSON.stringify({ hello: "world" }) });
      mockStorage = createMockStorage({ "my-key": file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.get("my-key");

      expect(result).toEqual({ hello: "world" });
    });

    it("returns null when key does not exist", async () => {
      mockStorage = createMockStorage({});

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.get("missing-key");

      expect(result).toBeNull();
    });

    it("supports generic type parameter", async () => {
      const file = createMockFile({ content: JSON.stringify({ name: "test", count: 5 }) });
      mockStorage = createMockStorage({ "typed-key": file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.get<{ name: string; count: number }>("typed-key");

      expect(result?.name).toBe("test");
      expect(result?.count).toBe(5);
    });

    it("propagates non-404 errors", async () => {
      const file = createMockFile();
      file.download.mockRejectedValue(Object.assign(new Error("Forbidden"), { code: 403 }));
      mockStorage = createMockStorage({ "err-key": file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      await expect(kv.get("err-key")).rejects.toThrow("Forbidden");
    });
  });

  describe("del", () => {
    it("returns count of successfully deleted keys", async () => {
      const file1 = createMockFile();
      const file2 = createMockFile();
      mockStorage = createMockStorage({ key1: file1, key2: file2 });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.del("key1", "key2");

      expect(result).toBe(2);
    });

    it("returns 0 for non-existent keys", async () => {
      mockStorage = createMockStorage({});

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.del("missing1", "missing2");

      expect(result).toBe(0);
    });

    it("counts only keys that existed", async () => {
      const file = createMockFile();
      mockStorage = createMockStorage({ existing: file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.del("existing", "missing");

      expect(result).toBe(1);
    });
  });

  describe("exists", () => {
    it("returns count of existing keys", async () => {
      const file1 = createMockFile({ exists: true });
      const file2 = createMockFile({ exists: true });
      mockStorage = createMockStorage({ key1: file1, key2: file2 });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.exists("key1", "key2");

      expect(result).toBe(2);
    });

    it("returns 0 when no keys exist", async () => {
      mockStorage = createMockStorage({});

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.exists("a", "b");

      expect(result).toBe(0);
    });

    it("counts only keys that exist", async () => {
      const file = createMockFile({ exists: true });
      mockStorage = createMockStorage({ existing: file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.exists("existing", "missing");

      expect(result).toBe(1);
    });
  });

  describe("keys", () => {
    it("returns all keys with wildcard pattern", async () => {
      const f1 = createMockFile();
      const f2 = createMockFile();
      const f3 = createMockFile();
      mockStorage = createMockStorage({ a: f1, b: f2, c: f3 });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.keys("*");

      expect(result).toEqual(["a", "b", "c"]);
    });

    it("filters keys by glob pattern", async () => {
      const f1 = createMockFile();
      const f2 = createMockFile();
      const f3 = createMockFile();
      mockStorage = createMockStorage({
        "user:1": f1,
        "user:2": f2,
        "session:1": f3,
      });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.keys("user:*");

      expect(result).toEqual(["user:1", "user:2"]);
    });

    it("strips prefix from returned keys", async () => {
      const f1 = createMockFile();
      const f2 = createMockFile();
      mockStorage = createMockStorage({
        "myapp/key1": f1,
        "myapp/key2": f2,
      });

      const kv = new BucketKeyval({ bucketName: "test-bucket", prefix: "myapp" });
      const result = await kv.keys("*");

      expect(result).toEqual(["key1", "key2"]);
    });

    it("combines prefix with pattern for efficient listing", async () => {
      const f1 = createMockFile();
      mockStorage = createMockStorage({
        "myapp/users/alice": f1,
      });

      const kv = new BucketKeyval({ bucketName: "test-bucket", prefix: "myapp" });
      await kv.keys("users/*");

      expect(mockStorage.getFilesFn).toHaveBeenCalledWith({
        prefix: "myapp/users/",
      });
    });

    it("defaults to * pattern", async () => {
      const f1 = createMockFile();
      mockStorage = createMockStorage({ key1: f1 });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      const result = await kv.keys();

      expect(result).toEqual(["key1"]);
    });
  });

  describe("prefix handling", () => {
    it("normalizes trailing slash in prefix", async () => {
      const file = createMockFile({ content: JSON.stringify("val") });
      mockStorage = createMockStorage({ "myprefix/key": file });

      const kv = new BucketKeyval({ bucketName: "test-bucket", prefix: "myprefix/" });
      await kv.get("key");

      expect(mockStorage.bucket("test-bucket").file).toHaveBeenCalledWith("myprefix/key");
    });

    it("works without prefix", async () => {
      const file = createMockFile({ content: JSON.stringify("val") });
      mockStorage = createMockStorage({ key: file });

      const kv = new BucketKeyval({ bucketName: "test-bucket" });
      await kv.get("key");

      expect(mockStorage.bucket("test-bucket").file).toHaveBeenCalledWith("key");
    });
  });
});
