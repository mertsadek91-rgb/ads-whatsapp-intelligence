// Recognising "I do not trust this certificate", in both directions.
//
// It shows up in two unrelated places and means something different in each:
//
//   Inbound  — connecting to a MySQL whose certificate is self-signed. The fix
//              is a per-connection setting (see mysqlSsl.js).
//   Outbound — calling Meta, Wati or the AI provider through something that is
//              intercepting TLS: a corporate proxy, or antivirus with HTTPS
//              scanning switched on (Kaspersky, ESET, Bitdefender all do this).
//              Their root certificate is installed in the OPERATING SYSTEM
//              store, which browsers use — so the same URL works in Chrome and
//              fails here, because Node ships its own CA list and ignores the
//              system one unless told otherwise.
//
// That asymmetry is why the outbound case needs its own message. Telling
// someone their API key is wrong, or that the host is unreachable, when their
// antivirus is re-signing the connection, sends them looking in the wrong place
// for a long time.
const TRUST_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_SIGNATURE_FAILURE",
]);

export function isTlsTrustError(err) {
  // Drivers and HTTP clients wrap errors, so the original code is often one or
  // two levels down, or only survives in the message.
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (TRUST_CODES.has(e.code)) return true;
    if (e.response?.code && TRUST_CODES.has(e.response.code)) return true;
  }
  return /self.?signed certificate|unable to verify the first certificate|unable to get local issuer|certificate has expired|altname/i
    .test(String(err?.message || ""));
}

/** True when this Node can be told to trust the OS certificate store. */
export function supportsSystemCa() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 15);
}

export const systemCaEnabled = () =>
  process.execArgv.includes("--use-system-ca")
  || /--use-system-ca/.test(process.env.NODE_OPTIONS || "");

export default { isTlsTrustError, supportsSystemCa, systemCaEnabled };
