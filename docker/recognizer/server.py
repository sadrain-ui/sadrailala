#!/usr/bin/env python3
"""Minimal reCognizer HTTP bridge — authorized lab CAPTCHA solving."""
from __future__ import annotations

import base64
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("RECOGNIZER_PORT", "5000"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        pass

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in ("/health", "/"):
            self._json(200, {"ok": True, "service": "recognizer"})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/solve":
            self._json(404, {"ok": False, "error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "invalid json"})
            return

        token = None
        try:
            import recognizer  # type: ignore

            screenshot = data.get("screenshot")
            if screenshot:
                img_bytes = base64.b64decode(screenshot)
                token = recognizer.solve_image(img_bytes)
            elif data.get("site_key") and data.get("url"):
                token = recognizer.solve_recaptcha_v2(
                    data["url"],
                    data["site_key"],
                )
        except ImportError:
            self._json(
                503,
                {
                    "ok": False,
                    "error": "pip install recognizer in container",
                },
            )
            return
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc)})
            return

        if token:
            self._json(200, {"ok": True, "token": str(token)})
        else:
            self._json(422, {"ok": False, "error": "solver returned no token"})


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
