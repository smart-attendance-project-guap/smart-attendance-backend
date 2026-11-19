export function readWebAuthnConfig() {
  const origin = process.env.WEBAUTHN_ORIGIN?.trim();
  const rpID = process.env.WEBAUTHN_RP_ID?.trim();

  if (!origin || !rpID) {
    throw new Error("WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID are required");
  }

  return { origin, rpID };
}