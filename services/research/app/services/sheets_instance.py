"""Shared GoogleSheetsAdapter singleton.

The adapter is instantiated once here (unconnected) and connected exactly
once from the FastAPI lifespan hook in ``app.main``. Routers import
``sheets_adapter`` directly -- the same module-level-singleton pattern
used by ``chat.py`` (``llm = LLMService()``) and ``operations.py``
(``jev = Jev()``), except the connection step is async and therefore
deferred to app startup rather than done at import time.

Before ``connect()`` has run, the adapter is unconnected; calling its
read/write methods would raise via ``_ensure_connected()``. In practice
the lifespan hook always connects it (falling back to mock mode on any
failure) before the app starts serving requests.
"""

from __future__ import annotations

from .sheets import GoogleSheetsAdapter

sheets_adapter = GoogleSheetsAdapter()
