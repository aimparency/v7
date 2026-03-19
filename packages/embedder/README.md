# Python Embedder

This package contains the older Python-based embedding service that predated the backend's in-process Node embedding path.

For the open source release, treat it as legacy infrastructure:

- it is not part of the default `npm run dev` flow
- it is not part of the default `npm run start` flow
- the backend no longer depends on it for normal semantic search

Current contents:

- `service.py`: HTTP embedding service
- `start.sh`: local startup wrapper
- `requirements.txt`: Python dependencies (`fastembed`)

Release direction:

- keep it available only for experimentation or comparison work
- avoid making Python a requirement for normal local setup
- keep the default embedding path inside `packages/backend`

If you are not actively working on embedding internals, you can ignore this package.
