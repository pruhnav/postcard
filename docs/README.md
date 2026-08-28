# docs/

`persona.md` is the avatar's behaviour, in prose. `server/persona.js` reads it at
boot and prepends it to the system prompt on every turn, so it is live
configuration rather than a design artifact. Edit it and restart the server.

If the file is missing the server falls back to a one-line placeholder persona,
which will run but will not sound like anyone.
