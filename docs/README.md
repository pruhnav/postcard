# docs/

Put the persona document here as `persona.md`.

`server/persona.js` reads it at boot and prepends it to the system prompt on
every turn, so this file is live configuration rather than a design artifact.
Edit it and restart the server.

If the file is missing the server falls back to a one-line placeholder persona,
which will run but will not sound like anyone.
