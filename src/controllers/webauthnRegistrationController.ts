import { createHash } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { readWebAuthnConfig } from "../utils/webauthnConfig.js";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  consumeRegistrationChallenge,
  storeRegistrationChallenge,
  WEBAUTHN_REGISTRATION_TTL_SECONDS,
} from "../utils/webauthnChallenge.js";

export async function getRegistrationOptions(req: AuthRequest, res: Response) {
  if (req.user?.role !== "STUDENT") {
    return res.status(403).json({
      code: "ACCESS_DENIED",
      message: "Only students can register WebAuthn credentials",
    });
  }

  try {
    const { rpID } = readWebAuthnConfig();
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId, role: "STUDENT" },
      select: {
        id: true,
        email: true,
        webAuthnCredentials: { select: { credentialId: true } },
      },
    });

    if (!user) {
      return res.status(403).json({
        code: "ACCESS_DENIED",
        message: "Student account not found",
      });
    }

    const userID = new Uint8Array(
      createHash("sha256").update(`smart-attendance:${user.id}`).digest(),
    );

    const options = await generateRegistrationOptions({
      rpName: "Smart Attendance",
      rpID,
      userID,
      userName: user.email,
      timeout: WEBAUTHN_REGISTRATION_TTL_SECONDS * 1000,
      authenticatorSelection: { userVerification: "required" },
      excludeCredentials: user.webAuthnCredentials.map(({ credentialId }) => ({
        id: credentialId,
      })),
    });

    const requestId = await storeRegistrationChallenge(user.id, options.challenge);
    return res.status(200).json({ requestId, options });
  } catch {
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to generate WebAuthn registration options",
    });
  }
}
export async function verifyRegistration(req: AuthRequest, res: Response) {
  if (req.user?.role !== "STUDENT") {
    return res.status(403).json({
      code: "ACCESS_DENIED",
      message: "Only students can register WebAuthn credentials",
    });
  }

  const { requestId, credential } = (req.body ?? {}) as {
    requestId?: unknown;
    credential?: unknown;
  };

  const requestIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  if (
    typeof requestId !== "string" ||
    !requestIdPattern.test(requestId) ||
    typeof credential !== "object" ||
    credential === null ||
    !("id" in credential) ||
    typeof credential.id !== "string" ||
    !credential.id
  ) {
    return res.status(400).json({
      code: "INVALID_REQUEST",
      message: "A valid requestId and registration response are required",
    });
  }

  try {
    const { origin, rpID } = readWebAuthnConfig();
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId, role: "STUDENT" },
      select: { id: true },
    });

    if (!user) {
      return res.status(403).json({
        code: "ACCESS_DENIED",
        message: "Student account not found",
      });
    }

    const challenge = await consumeRegistrationChallenge(user.id, requestId);

    if (!challenge) {
      return res.status(410).json({
        code: "CHALLENGE_EXPIRED_OR_USED",
        message: "Request new registration options",
      });
    }

    const verification = await verifyRegistrationResponse({
      response: credential as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    }).catch(() => null);

    if (!verification?.verified) {
      return res.status(400).json({
        code: "VERIFICATION_FAILED",
        message: "WebAuthn registration could not be verified",
      });
    }

    const {
      credential: verifiedKey,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo;

    await prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: verifiedKey.id,
        publicKey: new Uint8Array(verifiedKey.publicKey),
        counter: BigInt(verifiedKey.counter),
        transports: Array.isArray(verifiedKey.transports)
          ? verifiedKey.transports.filter((transport) => typeof transport === "string")
          : [],
        deviceType: credentialDeviceType === "multiDevice" ? "MULTI_DEVICE" : "SINGLE_DEVICE",
        backedUp: credentialBackedUp,
      },
    });

    return res.status(201).json({ verified: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({
        code: "CREDENTIAL_ALREADY_REGISTERED",
        message: "This WebAuthn credential is already registered",
      });
    }

    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to save WebAuthn registration",
    });
  }
}