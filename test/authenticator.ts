// En passkey i software (ES256, attestation "none"), så registrering og login kan testes
// gennem hele WebAuthn-verifikationen uden en telefon.
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

const enc = new TextEncoder();
const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

/** ECDSA-signaturen fra WebCrypto (r || s) som DER, som WebAuthn bruger. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.slice(i);
    return v[0] & 0x80 ? concat(new Uint8Array([0]), v) : v;
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return concat(new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length]), r, new Uint8Array([0x02, s.length]), s);
}

export class SoftAuthenticator {
  private keys!: CryptoKeyPair;
  readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
  private counter = 0;

  constructor(
    readonly origin: string,
    readonly rpId = new URL(origin).hostname,
  ) {}

  async init() {
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    return this;
  }

  get id() {
    return isoBase64URL.fromBuffer(new Uint8Array(this.credentialId));
  }

  private clientData(type: string, challenge: string) {
    return enc.encode(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  /** Svar på registrerings-options (navigator.credentials.create). */
  async register(options: { challenge: string }) {
    const jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey;
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)],
      ]),
    );
    const authData = concat(
      await sha256(enc.encode(this.rpId)),
      new Uint8Array([0x45]), // UP | UV | AT
      new Uint8Array(4),
      new Uint8Array(16), // aaguid
      new Uint8Array([0, this.credentialId.length]),
      this.credentialId,
      cose,
    );
    const attestationObject = isoCBOR.encode(
      new Map<string, Parameters<typeof isoCBOR.encode>[0]>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(this.clientData('webauthn.create', options.challenge))),
        attestationObject: isoBase64URL.fromBuffer(new Uint8Array(attestationObject)),
        transports: ['internal'],
      },
    };
  }

  /** Svar på login-options (navigator.credentials.get). */
  async login(options: { challenge: string }) {
    this.counter++;
    const authData = concat(await sha256(enc.encode(this.rpId)), new Uint8Array([0x05]), new Uint8Array([0, 0, 0, this.counter]));
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const signed = concat(authData, await sha256(clientDataJSON));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, signed));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
        authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authData)),
        signature: isoBase64URL.fromBuffer(new Uint8Array(derSignature(raw))),
        userHandle: isoBase64URL.fromBuffer(new Uint8Array(enc.encode('tn'))),
      },
    };
  }
}
