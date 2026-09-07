import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits a structured line carrying the service name and extra fields", () => {
    const logger = createLogger("api");
    logger.info("webhook received", { correlationId: "corr-1", conversationId: "conv-1" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({
      level: "info",
      service: "api",
      message: "webhook received",
      correlationId: "corr-1",
      conversationId: "conv-1",
    });
    expect(typeof line.timestamp).toBe("string");
  });
});
