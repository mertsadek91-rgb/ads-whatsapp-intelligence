// What gets handed to app.listen().
//
// This exists because of a deployment that built perfectly and then answered
// 503 to every request. PORT was not a number: the CloudLinux/Passenger stack
// behind much shared hosting passes a UNIX SOCKET PATH in it. Number(path) is
// NaN, and app.listen(NaN) throws ERR_SOCKET_BAD_PORT — so the process died at
// boot, before serving anything, while the build log ended in "built in 3.30s"
// with nothing wrong in it.
import { describe, it, expect } from "vitest";
import { listenTarget } from "../src/config.js";

describe("listenTarget", () => {
  it("passes a normal port through as a number", () => {
    expect(listenTarget("3000")).toBe(3000);
    expect(listenTarget(8080)).toBe(8080);
  });

  it("keeps a socket path as a string, which is what app.listen wants", () => {
    const sock = "/tmp/passenger.ABC123/apps.s/node.sock";
    expect(listenTarget(sock)).toBe(sock);
  });

  it("never returns NaN, which is the whole point", () => {
    // app.listen(NaN) throws ERR_SOCKET_BAD_PORT and takes the process with it,
    // so NaN is the one value that turns a host's convention into a crash.
    for (const v of ["/var/run/app.sock", "not-a-port", "80a", "  "]) {
      expect(Number.isNaN(listenTarget(v))).toBe(false);
    }
  });

  it("falls back when PORT is unset or empty", () => {
    expect(listenTarget(undefined)).toBe(3000);
    expect(listenTarget(null)).toBe(3000);
    expect(listenTarget("")).toBe(3000);
    expect(listenTarget("   ")).toBe(3000);
    expect(listenTarget(undefined, 9000)).toBe(9000);
  });

  it("rejects a number outside the port range rather than binding nonsense", () => {
    // Out of range is far more likely to be a mistyped path or an id than a
    // port, so it is handed over as given and fails loudly at listen().
    expect(listenTarget("70000")).toBe("70000");
    expect(listenTarget("-1")).toBe("-1");
  });

  it("treats port 0 as the explicit request it is", () => {
    // 0 means "any free port" and someone may mean it; only NaN is the trap.
    expect(listenTarget("0")).toBe(0);
  });
});
