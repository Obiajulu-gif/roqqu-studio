"""RAS webhook bodies are encrypted (https://roqqu-api-services.gitbook.io/ras/webhooks/decrypt-webhook-body).

The body is `{"hash": "<hex ciphertext>"}`; the `x-api-key` request header carries
the hex IV. Cipher: AES-256-CTR, key = the first 32 characters of our API key.
A body that does not decrypt to JSON came from someone without our key: reject it.
"""

from __future__ import annotations

import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def _cipher(api_key: str, iv_hex: str) -> Cipher:
    key = api_key[:32].encode("utf-8")
    if len(key) != 32:
        raise ValueError("RAS API key must be at least 32 characters")
    return Cipher(algorithms.AES(key), modes.CTR(bytes.fromhex(iv_hex)))


def decrypt_webhook(body: dict[str, Any], iv_hex: str, api_key: str) -> dict[str, Any] | None:
    """The decrypted event, or None when it does not decrypt to a JSON object."""
    try:
        dec = _cipher(api_key, iv_hex).decryptor()
        plain = dec.update(bytes.fromhex(str(body.get("hash", "")))) + dec.finalize()
        event = json.loads(plain.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, TypeError):
        return None
    return event if isinstance(event, dict) else None


def encrypt_webhook(event: dict[str, Any], api_key: str) -> tuple[dict[str, str], str]:
    """(body, iv_hex) the way RAS sends it; used by Practice mode and tests."""
    iv_hex = os.urandom(16).hex()
    enc = _cipher(api_key, iv_hex).encryptor()
    cipher = enc.update(json.dumps(event).encode("utf-8")) + enc.finalize()
    return {"hash": cipher.hex()}, iv_hex
