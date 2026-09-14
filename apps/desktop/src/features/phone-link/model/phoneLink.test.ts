import { describe, expect, it } from "vitest";

import { pairUrl, preferredAddress, type AddressProbe } from "./phoneLink";

const probe = (address: string, reachable: boolean): AddressProbe => ({
  address,
  reachable,
});

describe("preferredAddress", () => {
  it("picks an address that answered over one that did not", () => {
    // The case that prompted all of this: an Ethernet address that sorts first
    // and times out, next to the Wi-Fi address that actually works. Before the
    // probe existed, the panel put the dead one in front of the user.
    const addresses = ["169.254.10.4", "192.168.1.155"];
    const probes = [probe("169.254.10.4", false), probe("192.168.1.155", true)];
    expect(preferredAddress(addresses, probes)).toBe("192.168.1.155");
  });

  it("falls back to the first address before any probe has run", () => {
    // No verdicts yet is not the same as every verdict being bad. This is the
    // pre-probe behaviour, kept so the panel is never empty while checking.
    expect(preferredAddress(["10.0.0.7", "192.168.1.155"], [])).toBe("10.0.0.7");
  });

  it("still offers an address when every one of them failed", () => {
    // A guess beats nothing: the probe cannot see a firewall that blocks only
    // the phone, so an address it calls dead may still be the right one to show.
    const addresses = ["10.0.0.7", "192.168.1.155"];
    const probes = [probe("10.0.0.7", false), probe("192.168.1.155", false)];
    expect(preferredAddress(addresses, probes)).toBe("10.0.0.7");
  });

  it("ignores verdicts for addresses the machine no longer has", () => {
    // Probes outlive a network change by a moment; a stale one must not resurrect
    // an address that is gone from the list.
    const probes = [probe("192.168.1.155", true)];
    expect(preferredAddress(["10.0.0.7"], probes)).toBe("10.0.0.7");
  });

  it("has nothing to offer when the machine has no address", () => {
    expect(preferredAddress([], [])).toBeUndefined();
  });
});

describe("pairUrl", () => {
  it("carries the code so a scanned link needs nothing typed", () => {
    expect(pairUrl("192.168.1.155", 7643, "ABC234")).toBe(
      "http://192.168.1.155:7643/pair?code=ABC234",
    );
  });

  it("omits the parameter entirely when there is no code", () => {
    expect(pairUrl("192.168.1.155", 7643)).toBe("http://192.168.1.155:7643/pair");
  });

  it("escapes a code rather than pasting it into the query raw", () => {
    // Codes are drawn from a safe alphabet, so this guards the boundary rather
    // than today's input: nothing should be able to smuggle a second parameter
    // in through the code.
    expect(pairUrl("10.0.0.7", 7643, "A&b=c")).toBe(
      "http://10.0.0.7:7643/pair?code=A%26b%3Dc",
    );
  });
});
